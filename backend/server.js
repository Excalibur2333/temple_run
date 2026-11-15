// Waco Family Guide backend
// - Serves the public site (../frontend) at /
// - Serves the staff admin console (./admin) at /admin
// - Stores events in data/events.json and exposes them through /api
// No dependencies; needs Node.js 18 or newer.
//
//   ADMIN_TOKEN=choose-a-long-staff-code PORT=3000 node server.js
//
// API
//   GET    /api/events            list all events (public)
//   GET    /api/events/stream     live feed (Server-Sent Events): full list on every change
//   GET    /api/session           204 if the staff code is valid, else 401
//   POST   /api/events            add an event           (staff)
//   PUT    /api/events/:id        replace an event       (staff)
//   DELETE /api/events/:id        delete an event        (staff)
// Staff requests send the header  Authorization: Bearer <ADMIN_TOKEN>

"use strict";
const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const PORT = Number(process.env.PORT) || 3000;
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || "";
const FRONTEND_DIR = path.resolve(__dirname, process.env.FRONTEND_DIR || "../frontend");
const ADMIN_DIR = path.resolve(__dirname, "admin");
const DATA_FILE = path.resolve(__dirname, process.env.DATA_FILE || "data/events.json");
const CATEGORIES = ["Event", "Trip", "Workshop", "Deadline", "Notice"];
const MAX_BODY = 16 * 1024;
const TOKEN_OK = ADMIN_TOKEN.length >= 12;

if (!TOKEN_OK) console.warn("ADMIN_TOKEN is missing or shorter than 12 characters: staff sign-in is disabled.");

// ---------- storage ----------
function load() {
  try {
    const list = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
    return Array.isArray(list) ? list : [];
  } catch (e) {
    if (e.code !== "ENOENT") console.error("Could not read", DATA_FILE, e.message);
    return [];
  }
}
let events = load();

function save() {
  fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
  const tmp = DATA_FILE + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(events, null, 2) + "\n");
  fs.renameSync(tmp, DATA_FILE);
  broadcast();
}

// ---------- live updates ----------
const clients = new Set();
function broadcast() {
  const msg = "data: " + JSON.stringify(events) + "\n\n";
  for (const res of clients) res.write(msg);
}
setInterval(() => { for (const res of clients) res.write(": ping\n\n"); }, 25000).unref();

// ---------- auth with a simple lockout after repeated wrong codes ----------
const failures = new Map(); // ip -> {count, until}
function clientIp(req) { return req.socket.remoteAddress || "unknown"; }
function lockedOut(req) {
  const f = failures.get(clientIp(req));
  return !!(f && f.until > Date.now());
}
function isStaff(req) {
  if (!TOKEN_OK) return false;
  const m = /^Bearer (.+)$/.exec(req.headers.authorization || "");
  if (!m) return false;
  const a = crypto.createHash("sha256").update(m[1]).digest();
  const b = crypto.createHash("sha256").update(ADMIN_TOKEN).digest();
  const ok = crypto.timingSafeEqual(a, b);
  const ip = clientIp(req);
  if (ok) failures.delete(ip);
  else {
    const f = failures.get(ip) || { count: 0, until: 0 };
    f.count += 1;
    if (f.count >= 5) { f.until = Date.now() + 5 * 60 * 1000; f.count = 0; }
    failures.set(ip, f);
  }
  return ok;
}

// ---------- helpers ----------
const SECURITY = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "same-origin",
  "X-Frame-Options": "DENY",
};
function send(res, status, body, headers = {}) {
  const isJson = body !== undefined && typeof body !== "string" && !Buffer.isBuffer(body);
  res.writeHead(status, Object.assign({}, SECURITY,
    isJson ? { "Content-Type": "application/json; charset=utf-8" } : {}, headers));
  res.end(isJson ? JSON.stringify(body) : body);
}
function readJson(req) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on("data", c => {
      size += c.length;
      if (size > MAX_BODY) { reject(Object.assign(new Error("Request too large"), { status: 413 })); req.destroy(); }
      else chunks.push(c);
    });
    req.on("end", () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}")); }
      catch { reject(Object.assign(new Error("Invalid JSON"), { status: 400 })); }
    });
    req.on("error", reject);
  });
}
function clean(input) {
  const str = (v, max) => String(v ?? "").trim().slice(0, max);
  const time = v => (/^\d{2}:\d{2}$/.test(str(v, 5)) ? str(v, 5) : "");
  const e = {
    title: str(input.title, 140),
    date: str(input.date, 10),
    startTime: time(input.startTime),
    endTime: time(input.endTime),
    location: str(input.location, 160),
    category: CATEGORIES.includes(input.category) ? input.category : "Event",
    description: str(input.description, 800),
    link: str(input.link, 500),
    featured: input.featured === true,
  };
  if (!e.title) return { error: "Title is required." };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(e.date) || isNaN(Date.parse(e.date))) return { error: "Date must be YYYY-MM-DD." };
  if (e.startTime && e.endTime && e.endTime < e.startTime) return { error: "End time is before the start time." };
  if (e.link && !/^https?:\/\/\S+$/i.test(e.link)) return { error: "Link must start with http:// or https://" };
  return { event: e };
}
// Only one featured event at a time.
function applyFeatured(id) { for (const e of events) if (e.id !== id) e.featured = false; }

// ---------- static files ----------
const TYPES = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8",
  ".png": "image/png", ".jpg": "image/jpeg", ".svg": "image/svg+xml", ".ico": "image/x-icon", ".webp": "image/webp",
};
function serveStatic(res, root, rel) {
  let p;
  try { p = decodeURIComponent(rel); } catch { return send(res, 400, "Bad request"); }
  if (p === "" || p.endsWith("/")) p += "index.html";
  const file = path.resolve(root, "." + (p.startsWith("/") ? p : "/" + p));
  if (file !== root && !file.startsWith(root + path.sep)) return send(res, 403, "Forbidden");
  fs.readFile(file, (err, data) => {
    if (err) return send(res, 404, "Not found");
    send(res, 200, data, { "Content-Type": TYPES[path.extname(file)] || "application/octet-stream" });
  });
}

// ---------- routes ----------
const server = http.createServer(async (req, res) => {
  const { pathname } = new URL(req.url, "http://localhost");
  try {
    if (pathname.startsWith("/api/")) {
      if (pathname === "/api/events" && req.method === "GET") return send(res, 200, events, { "Cache-Control": "no-store" });

      if (pathname === "/api/events/stream" && req.method === "GET") {
        res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-store", Connection: "keep-alive" });
        res.write("data: " + JSON.stringify(events) + "\n\n");
        clients.add(res);
        req.on("close", () => clients.delete(res));
        return;
      }

      // Everything below needs a staff code.
      if (lockedOut(req)) return send(res, 429, { error: "Too many wrong codes. Try again in a few minutes." });
      if (!isStaff(req)) return send(res, 401, { error: "Staff sign-in required" });

      if (pathname === "/api/session" && req.method === "GET") return send(res, 204, "");

      if (pathname === "/api/events" && req.method === "POST") {
        const { event, error } = clean(await readJson(req));
        if (error) return send(res, 400, { error });
        event.id = crypto.randomUUID();
        event.createdAt = event.updatedAt = new Date().toISOString();
        if (event.featured) applyFeatured(event.id);
        events.push(event);
        save();
        return send(res, 201, event);
      }

      const m = /^\/api\/events\/([\w-]{1,100})$/.exec(pathname);
      if (m) {
        const i = events.findIndex(e => e.id === m[1]);
        if (i === -1) return send(res, 404, { error: "That event no longer exists." });
        if (req.method === "PUT") {
          const { event, error } = clean(await readJson(req));
          if (error) return send(res, 400, { error });
          events[i] = Object.assign({ id: events[i].id, createdAt: events[i].createdAt }, event, { updatedAt: new Date().toISOString() });
          if (event.featured) applyFeatured(events[i].id);
          save();
          return send(res, 200, events[i]);
        }
        if (req.method === "DELETE") {
          events.splice(i, 1);
          save();
          return send(res, 204, "");
        }
      }
      return send(res, 404, { error: "Not found" });
    }

    if (req.method !== "GET" && req.method !== "HEAD") return send(res, 405, "Method not allowed");
    if (pathname === "/admin") return send(res, 301, "", { Location: "/admin/" });
    if (pathname.startsWith("/admin/")) return serveStatic(res, ADMIN_DIR, pathname.slice("/admin".length));
    return serveStatic(res, FRONTEND_DIR, pathname);
  } catch (e) {
    send(res, e.status || 500, { error: e.status ? e.message : "Server error" });
    if (!e.status) console.error(e);
  }
});

server.listen(PORT, () => {
  console.log(`Public site:   http://localhost:${PORT}/`);
  console.log(`Staff admin:   http://localhost:${PORT}/admin/`);
});
