// Staff admin console for events.
// Normal mode: talks to the backend API with a staff code.
// Preview mode (inside a claude.ai private preview): uses the preview's shared store; only its editors can change events.
(function () {
  "use strict";
  const $ = s => document.querySelector(s);
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const pad = n => String(n).padStart(2, "0");
  const d0 = new Date();
  const today = `${d0.getFullYear()}-${pad(d0.getMonth() + 1)}-${pad(d0.getDate())}`;
  let token = "", events = [], view = "upcoming", editing = null, db = null, readOnly = false;
  try { token = sessionStorage.getItem("cge-admin") || ""; } catch (e) {}

  // ---------- data access ----------
  async function api(path, opt = {}) {
    const r = await fetch("/api/" + path, Object.assign({}, opt, {
      headers: Object.assign({ "Content-Type": "application/json", "Authorization": "Bearer " + token }, opt.headers || {})
    }));
    if (r.status === 401) { signOut("Your session ended. Please sign in again."); throw new Error("Not signed in"); }
    if (!r.ok) { const j = await r.json().catch(() => ({})); throw new Error(j.error || "Something went wrong (" + r.status + ")"); }
    return r.status === 204 ? null : r.json();
  }
  const store = {
    async list() { if (!db) events = await api("events"); },
    async create(data) {
      if (!db) return api("events", { method: "POST", body: JSON.stringify(data) });
      const ref = await db.collection("events").add(Object.assign({ createdAt: new Date().toISOString() }, data));
      if (data.featured) await unfeatureOthers(ref.id);
    },
    async update(id, data) {
      if (!db) return api("events/" + encodeURIComponent(id), { method: "PUT", body: JSON.stringify(data) });
      const prev = events.find(e => e.id === id) || {};
      await db.collection("events").doc(id).set(Object.assign({ createdAt: prev.createdAt || new Date().toISOString() }, data, { updatedAt: new Date().toISOString() }));
      if (data.featured) await unfeatureOthers(id);
    },
    async remove(id) {
      if (!db) return api("events/" + encodeURIComponent(id), { method: "DELETE" });
      await db.collection("events").doc(id).delete();
    }
  };
  async function unfeatureOthers(id) {
    for (const e of events) if (e.featured && e.id !== id) await db.collection("events").doc(e.id).update({ featured: false });
  }

  // ---------- sign in (backend mode) ----------
  function signOut(msg) {
    token = ""; try { sessionStorage.removeItem("cge-admin"); } catch (e) {}
    $("#work").hidden = true; $("#login").hidden = false; $("#logout").hidden = true; $("#login-msg").textContent = msg || "";
  }
  async function signIn(code) {
    token = code;
    const r = await fetch("/api/session", { headers: { "Authorization": "Bearer " + code } }).catch(() => null);
    if (!r || !r.ok) {
      token = "";
      $("#login-msg").textContent = r && r.status === 429 ? "Too many attempts. Wait a few minutes and try again." : "That staff code didn't work. Check it and try again.";
      return;
    }
    try { sessionStorage.setItem("cge-admin", code); } catch (e) {}
    $("#login").hidden = true; $("#work").hidden = false; $("#logout").hidden = false; $("#login-msg").textContent = "";
    await store.list(); render();
  }

  // ---------- rendering ----------
  function fmt(d) {
    const x = new Date(d + "T12:00:00");
    return isNaN(x) ? { m: "", d: "?" } : { m: x.toLocaleString("en-US", { month: "short" }) + " " + String(x.getFullYear()).slice(2), d: x.getDate() };
  }
  function t12(t) {
    if (!/^\d{2}:\d{2}$/.test(t || "")) return "";
    let [h, m] = t.split(":").map(Number); const ap = h >= 12 ? "PM" : "AM"; h = h % 12 || 12;
    return `${h}:${pad(m)} ${ap}`;
  }
  function render() {
    const sorted = events.slice().sort((a, b) => (a.date + (a.startTime || "")).localeCompare(b.date + (b.startTime || "")));
    const list = sorted.filter(e => view === "all" || (view === "upcoming" ? e.date >= today : e.date < today));
    if (view === "past") list.reverse();
    $("#count").textContent = `· ${list.length} shown`;
    const dis = readOnly ? " disabled" : "";
    $("#items").innerHTML = list.length ? list.map(e => {
      const f = fmt(e.date), t = [t12(e.startTime), t12(e.endTime)].filter(Boolean).join("–");
      return `<div class="a-item${e.date < today ? " past" : ""}${editing === e.id ? " editing" : ""}"><div class="a-date"><b>${f.d}</b><span>${esc(f.m)}</span></div>
        <div><div class="a-t"><span class="a-tag">${esc(e.category)}</span>${e.featured ? '<span class="a-tag star">★ Featured</span>' : ""}${esc(e.title)}</div>
        <div class="a-s">${[t, e.location].filter(Boolean).map(esc).join(" · ") || "No time or place set"}</div></div>
        <div class="a-act"><button type="button" data-edit="${esc(e.id)}"${dis}>Edit</button><button type="button" class="del" data-del="${esc(e.id)}"${dis}>Delete</button></div></div>`;
    }).join("") : `<div class="a-empty">No ${view === "all" ? "" : view + " "}events. Add one with the form.</div>`;
  }
  function fill(e) {
    $("#f-title").value = e ? e.title : ""; $("#f-date").value = e ? e.date : today; $("#f-cat").value = e ? e.category : "Event";
    $("#f-start").value = e ? e.startTime || "" : ""; $("#f-end").value = e ? e.endTime || "" : ""; $("#f-loc").value = e ? e.location || "" : "";
    $("#f-desc").value = e ? e.description || "" : ""; $("#f-link").value = e ? e.link || "" : ""; $("#f-feat").checked = !!(e && e.featured);
    $("#form-title").textContent = e ? "Edit event" : "Add an event"; $("#save").textContent = e ? "Save changes" : "Add event"; $("#cancel").hidden = !e;
  }
  function msg(t, kind) { const m = $("#form-msg"); m.textContent = t; m.className = "a-msg " + (kind || ""); }

  // ---------- events ----------
  $("#login").addEventListener("submit", e => { e.preventDefault(); signIn($("#code").value.trim()); });
  $("#logout").addEventListener("click", () => signOut(""));
  $("#cancel").addEventListener("click", () => { editing = null; fill(null); msg(""); render(); });
  document.querySelectorAll("[data-v]").forEach(b => b.addEventListener("click", () => {
    view = b.dataset.v; document.querySelectorAll("[data-v]").forEach(x => x.setAttribute("aria-pressed", String(x === b))); render();
  }));
  $("#items").addEventListener("click", async ev => {
    const ed = ev.target.closest("[data-edit]"), del = ev.target.closest("[data-del]");
    if (ed) { editing = ed.dataset.edit; fill(events.find(x => x.id === editing)); render(); $("#form").scrollIntoView({ behavior: "smooth", block: "start" }); $("#f-title").focus(); return; }
    if (del) {
      if (!del.classList.contains("confirm")) {
        del.classList.add("confirm"); del.textContent = "Confirm delete";
        setTimeout(() => { if (del.isConnected) { del.classList.remove("confirm"); del.textContent = "Delete"; } }, 4000);
        return;
      }
      del.disabled = true;
      try { await store.remove(del.dataset.del); if (editing === del.dataset.del) { editing = null; fill(null); } await store.list(); render(); msg("Event deleted.", "ok"); }
      catch (err) { msg(err.message, "err"); del.disabled = false; }
    }
  });
  $("#form").addEventListener("submit", async e => {
    e.preventDefault();
    if (readOnly) return;
    const data = {
      title: $("#f-title").value.trim(), date: $("#f-date").value, category: $("#f-cat").value,
      startTime: $("#f-start").value, endTime: $("#f-end").value, location: $("#f-loc").value.trim(),
      description: $("#f-desc").value.trim(), link: $("#f-link").value.trim(), featured: $("#f-feat").checked
    };
    if (!data.title || !data.date) return msg("Add a title and a date.", "err");
    if (data.link && !/^https?:\/\//i.test(data.link)) return msg("Links must start with https://", "err");
    if (data.startTime && data.endTime && data.endTime < data.startTime) return msg("End time is before the start time.", "err");
    $("#save").disabled = true;
    try {
      if (editing) { await store.update(editing, data); msg("Changes saved. The public site is updated.", "ok"); }
      else { await store.create(data); msg("Event added. It's live on the public site now.", "ok"); }
      editing = null; fill(null); await store.list(); render();
    } catch (err) { msg(err.message || "Couldn't save. Only editors can change events.", "err"); }
    finally { $("#save").disabled = readOnly; }
  });

  // ---------- start ----------
  async function startPreview() {
    db = await window.claude.use("db").catch(() => null);
    if (!db) return false;
    const user = await window.claude.use("user").catch(() => null);
    let canEdit = false;
    try { canEdit = !!(user && await user.canEdit()); } catch (e) {}
    readOnly = !canEdit;
    $("#login").hidden = true; $("#work").hidden = false; $("#logout").hidden = true;
    $("#preview-note").hidden = false;
    $("#preview-note").textContent = canEdit
      ? "Preview mode: you can add, edit and delete events here. Changes show on the public site tab immediately."
      : "Preview mode (view only): ask the owner for edit access to try adding events.";
    document.querySelectorAll("#form input,#form select,#form textarea,#save").forEach(el => { el.disabled = readOnly; });
    const site = $("#view-site-link"); if (site) { site.href = "#site"; site.removeAttribute("target"); }
    db.collection("events").onSnapshot(snap => {
      events = snap.docs.map(d => Object.assign({ id: d.id }, d.data())); render();
    }, () => msg("Couldn't load events.", "err"));
    return true;
  }
  fill(null);
  (async () => {
    if (window.claude && window.claude.use && await startPreview()) return;
    if (token) signIn(token);
  })();
})();
