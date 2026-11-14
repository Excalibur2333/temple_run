// Waco Family Guide backend: serves the frontend and a small announcements API.
// No dependencies; needs Node.js 18 or newer.
//
//   ADMIN_TOKEN=choose-a-long-secret PORT=3000 node server.js
//
// API
//   GET    /api/announcements          list all announcements
//   GET    /api/announcements/stream   Server-Sent Events; sends the full list on every change
//   GET    /api/session                204 if the Bearer token is valid, else 401
//   POST   /api/announcements          create (staff only)
//   DELETE /api/announcements/:id      remove (staff only)

"use strict";
const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const PORT = Number(process.env.PORT) || 3000;
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || "";
const FRONTEND_DIR = path.resolve(__dirname, process.env.FRONTEND_DIR || "../frontend");
const DATA_FILE = path.resolve(__dirname, process.env.DATA_FILE || "data/announcements.json");
const CATEGORIES = ["Event", "Deadline", "Notice", "Urgent"];
const MAX_BODY = 16 * 1024;

if (!ADMIN_TOKEN || ADMIN_TOKEN.length < 12) {
  console.warn("ADMIN_TOKEN is missing or shorter than 12 characters: posting is disabled.");
}

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
let announcements = load();

function save() {
  fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
  const tmp = DATA_FILE + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(announcements, null, 2) + "\n");
  fs.renameSync(tmp, DATA_FILE);
  broadcast();
}

// ---------- live updates (SSE) ----------
const clients = new Set();
function broadcast() {
  const msg = "data: " + JSON.stringify(announcements) + "\n\n";
  for (const res of clients) res.write(msg);
}
setInterval(() => { for (const res of clients) res.write(": ping\n\n"); }, 25000).unref();

// ---------- helpers ----------
function send(res, status, body, headers = {}) {
  const isJson = body !== undefined && typeof body !== "string" && !Buffer.isBuffer(body);
  res.writeHead(status, Object.assign(
    { "X-Content-Type-Options": "nosniff" },
    isJson ? { "Content-Type": "application/json; charset=utf-8" } : {},
    headers));
  res.end(isJson ? JSON.stringify(body) : body);
}

function isStaff(req) {
  if (!ADMIN_TOKEN || ADMIN_TOKEN.length < 12) return false;
  const m = /^Bearer (.+)$/.exec(req.headers.authorization || "");
  if (!m) return false;
  const a = crypto.createHash("sha256").update(m[1]).digest();
  const b = crypto.createHash("sha256").update(ADMIN_TOKEN).digest();
  return crypto.timingSafeEqual(a, b);
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
  const item = {
    title: str(input.title, 140),
    date: str(input.date, 10),
    category: CATEGORIES.includes(input.category) ? input.category : "Notice",
    body: str(input.body, 600),
    link: str(input.link, 500),
  };
  if (!item.title) return { error: "Title is required." };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(item.date) || isNaN(Date.parse(item.date))) return { error: "Date must be YYYY-MM-DD." };
  if (item.link && !/^https?:\/\/[^\s]+$/i.test(item.link)) return { error: "Link must start with http:// or https://" };
  return { item };
}

// ---------- static files ----------
const TYPES = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8",
  ".png": "image/png", ".jpg": "image/jpeg", ".svg": "image/svg+xml", ".ico": "image/x-icon",
};
function serveStatic(req, res, pathname) {
  let rel;
  try { rel = decodeURIComponent(pathname); } catch { return send(res, 400, "Bad request"); }
  if (rel.endsWith("/")) rel += "index.html";
  const file = path.resolve(FRONTEND_DIR, "." + rel);
  if (file !== FRONTEND_DIR && !file.startsWith(FRONTEND_DIR + path.sep)) return send(res, 403, "Forbidden");
  fs.readFile(file, (err, data) => {
    if (err) return send(res, 404, "Not found");
    send(res, 200, data, { "Content-Type": TYPES[path.extname(file)] || "application/octet-stream" });
  });
}

// ---------- routes ----------
const server = http.createServer(async (req, res) => {
  const { pathname } = new URL(req.url, "http://localhost");
  try {
    if (pathname === "/api/announcements" && req.method === "GET") {
      return send(res, 200, announcements, { "Cache-Control": "no-store" });
    }
    if (pathname === "/api/announcements/stream" && req.method === "GET") {
      res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-store", Connection: "keep-alive" });
      res.write("data: " + JSON.stringify(announcements) + "\n\n");
      clients.add(res);
      req.on("close", () => clients.delete(res));
      return;
    }
    if (pathname === "/api/session" && req.method === "GET") {
      return isStaff(req) ? send(res, 204, "") : send(res, 401, { error: "Not signed in" });
    }
    if (pathname === "/api/announcements" && req.method === "POST") {
      if (!isStaff(req)) return send(res, 401, { error: "Staff sign-in required" });
      const { item, error } = clean(await readJson(req));
      if (error) return send(res, 400, { error });
      item.id = crypto.randomUUID();
      item.createdAt = new Date().toISOString();
      announcements.push(item);
      save();
      return send(res, 201, item);
    }
    const m = /^\/api\/announcements\/([\w-]{1,100})$/.exec(pathname);
    if (m && req.method === "DELETE") {
      if (!isStaff(req)) return send(res, 401, { error: "Staff sign-in required" });
      const before = announcements.length;
      announcements = announcements.filter(a => a.id !== m[1]);
      if (announcements.length === before) return send(res, 404, { error: "Not found" });
      save();
      return send(res, 204, "");
    }
    if (pathname.startsWith("/api/")) return send(res, 404, { error: "Not found" });
    if (req.method !== "GET" && req.method !== "HEAD") return send(res, 405, "Method not allowed");
    return serveStatic(req, res, pathname);
  } catch (e) {
    send(res, e.status || 500, { error: e.status ? e.message : "Server error" });
    if (!e.status) console.error(e);
  }
});

server.listen(PORT, () => console.log(`Waco Family Guide running at http://localhost:${PORT}`));
