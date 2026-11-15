// Public page logic. Events come from the backend API (/api/events) with live updates;
// if no backend is running, they fall back to data/events.json.
(function () {
  "use strict";
  const $ = s => document.querySelector(s);
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const safeUrl = u => (/^https?:\/\//i.test(u || "") ? u : "");
  const pad = n => String(n).padStart(2, "0");
  const now = new Date();
  const today = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;

  const ICON = {
    pin: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 22s7-6.2 7-12a7 7 0 1 0-14 0c0 5.8 7 12 7 12z"/><circle cx="12" cy="10" r="2.5"/></svg>',
    clock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
    passport: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="5" y="3" width="14" height="18" rx="2"/><circle cx="12" cy="10" r="3"/><path d="M9 16h6"/></svg>',
    family: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="8" cy="6" r="2.5"/><circle cx="16" cy="6" r="2.5"/><circle cx="12" cy="13" r="2"/><path d="M4 21v-6a4 4 0 0 1 4-4M20 21v-6a4 4 0 0 0-4-4M9 21v-2a3 3 0 0 1 6 0v2"/></svg>',
    briefcase: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="7" width="18" height="13" rx="2"/><path d="M9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2M3 13h18"/></svg>',
    ball: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/></svg>',
    heart: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20s-7-4.5-9-9a4.5 4.5 0 0 1 9-3 4.5 4.5 0 0 1 9 3c-2 4.5-9 9-9 9z"/></svg>',
    school: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 9l10-5 10 5-10 5z"/><path d="M6 11v5c0 1.5 3 3 6 3s6-1.5 6-3v-5"/></svg>',
    gov: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 21h18M4 10h16M12 3l9 5H3zM6 10v8M10 10v8M14 10v8M18 10v8"/></svg>',
    health: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="4"/><path d="M12 8v8M8 12h8"/></svg>',
    bus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4" y="3" width="16" height="15" rx="3"/><path d="M4 11h16M8 21v-3M16 21v-3"/><circle cx="8" cy="14.5" r=".6"/><circle cx="16" cy="14.5" r=".6"/></svg>',
    chat: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z"/></svg>'
  };
  const GROUP_ICON = [
    [/visa|legal/i, "passport"], [/benefit/i, "family"], [/career/i, "briefcase"], [/recreation|dining/i, "ball"],
    [/faith|friend/i, "heart"], [/school/i, "school"], [/government/i, "gov"], [/health/i, "health"],
    [/getting around/i, "bus"], [/english/i, "chat"]
  ];
  const iconFor = g => ICON[(GROUP_ICON.find(([re]) => re.test(g)) || [0, "heart"])[1]];

  // ---------- events ----------
  let events = [], cat = "all";
  function dparts(d) {
    const x = new Date(d + "T12:00:00");
    if (isNaN(x)) return { m: "", d: "?", y: "", long: d };
    return {
      m: x.toLocaleString("en-US", { month: "short" }), d: x.getDate(), y: x.getFullYear(),
      long: x.toLocaleString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" })
    };
  }
  function t12(t) {
    if (!/^\d{2}:\d{2}$/.test(t || "")) return "";
    let [h, m] = t.split(":").map(Number); const ap = h >= 12 ? "PM" : "AM"; h = h % 12 || 12;
    return `${h}:${pad(m)} ${ap}`;
  }
  const timeText = e => [t12(e.startTime), t12(e.endTime)].filter(Boolean).join(" – ");
  const tile = p => `<div class="tile" aria-hidden="true"><div class="m">${esc(p.m)}</div><div class="d">${esc(p.d)}</div><div class="y">${esc(p.y)}</div></div>`;
  function meta(e, p) {
    const t = timeText(e);
    return `<div class="meta"><span>${ICON.clock}${esc(p.long)}${t ? " · " + esc(t) : ""}</span>${e.location ? `<span>${ICON.pin}${esc(e.location)}</span>` : ""}</div>`;
  }
  function card(e, featured) {
    const p = dparts(e.date), link = safeUrl(e.link), c = esc(e.category || "Notice");
    return `<article class="ev${featured ? " featured" : ""}${e.date < today ? " past" : ""}">${tile(p)}
      <div class="info"><span class="cat cat-${c}">${c}</span><h3>${esc(e.title)}</h3>${meta(e, p)}
      ${e.description ? `<p>${esc(e.description)}</p>` : ""}
      ${link ? `<a class="more" href="${esc(link)}" target="_blank" rel="noopener">Details ↗</a>` : ""}</div></article>`;
  }
  function renderEvents() {
    const showPast = $("#show-past").checked;
    const sorted = events.slice().sort((a, b) => (a.date + (a.startTime || "")).localeCompare(b.date + (b.startTime || "")));
    const upcoming = sorted.filter(e => e.date >= today);
    const list = sorted.filter(e => (showPast || e.date >= today) && (cat === "all" || e.category === cat));
    const feat = list.find(e => e.featured && e.date >= today);
    const rest = list.filter(e => e !== feat);
    $("#event-list").innerHTML = list.length
      ? (feat ? card(feat, true) : "") + rest.map(e => card(e, false)).join("")
      : `<div class="empty">No ${cat === "all" ? "" : cat.toLowerCase() + " "}events scheduled right now. Check back soon.</div>`;
    $("#fact-events").textContent = upcoming.length;
    const next = upcoming.find(e => e.featured) || upcoming[0];
    const spot = $("#spot");
    if (next) {
      const p = dparts(next.date), link = safeUrl(next.link), t = timeText(next);
      spot.innerHTML = `<div class="eyebrow">${next.featured ? "Featured event" : "Next up"}</div>
        <div class="when">${tile(p)}<h3>${esc(next.title)}</h3></div>
        <p>${esc(p.long)}${t ? " · " + esc(t) : ""}${next.location ? "<br>" + esc(next.location) : ""}</p>
        ${next.description ? `<p>${esc(next.description)}</p>` : ""}
        ${link ? `<a href="${esc(link)}" target="_blank" rel="noopener">Event details ↗</a>` : `<a href="#events">All events ↓</a>`}`;
      spot.hidden = false;
    } else spot.hidden = true;
  }
  function setLive(on, text) { $("#live").classList.toggle("on", on); $("#live-text").textContent = text; }

  async function loadEvents() {
    // 0) Private preview on claude.ai: shared store
    if (window.claude && window.claude.use) {
      const db = await window.claude.use("db").catch(() => null);
      if (db) {
        db.collection("events").onSnapshot(snap => {
          events = snap.docs.map(d => Object.assign({ id: d.id }, d.data()));
          setLive(true, "Live · updates appear automatically"); renderEvents();
        }, () => setLive(false, "Events unavailable right now"));
        return;
      }
    }
    // 1) Backend API with live updates
    try {
      const r = await fetch("api/events", { cache: "no-store" });
      if (!r.ok) throw 0;
      events = await r.json(); setLive(true, "Live · updates appear automatically"); renderEvents();
      if (window.EventSource) {
        const es = new EventSource("api/events/stream");
        es.onmessage = ev => { try { events = JSON.parse(ev.data); setLive(true, "Live · updates appear automatically"); renderEvents(); } catch (e) {} };
        es.onerror = () => setLive(false, "Reconnecting…");
      }
      return;
    } catch (e) {}
    // 2) Static file
    try {
      const r = await fetch("data/events.json", { cache: "no-store" });
      events = await r.json(); setLive(false, "Showing the published schedule");
    } catch (e) { events = []; setLive(false, "Events unavailable right now"); }
    renderEvents();
  }
  document.querySelectorAll("[data-cat]").forEach(b => b.addEventListener("click", () => {
    cat = b.dataset.cat;
    document.querySelectorAll("[data-cat]").forEach(x => x.setAttribute("aria-pressed", String(x === b)));
    renderEvents();
  }));
  $("#show-past").addEventListener("change", renderEvents);

  // ---------- resources ----------
  const SETS = { campus: window.CAMPUS || [], community: window.COMMUNITY || [] };
  function renderRes(which) {
    $("#res-panel").innerHTML = SETS[which].map(g => `<div class="group">
      <div class="group-h"><span class="ico">${iconFor(g.g)}</span><h3>${esc(g.g)}</h3></div>
      <div class="links">${g.items.map(([t, d, u, s]) =>
        `<a class="res" href="${esc(u)}" target="_blank" rel="noopener"><b>${esc(t)}</b><span>${esc(d)}</span><small>${esc(s)}</small></a>`).join("")}</div></div>`).join("");
    $("#res-panel").setAttribute("aria-labelledby", "tab-" + which);
  }
  ["campus", "community"].forEach(k => $("#tab-" + k).addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach(t => t.setAttribute("aria-selected", String(t.id === "tab-" + k)));
    renderRes(k);
  }));
  renderRes("campus");
  $("#fact-res").textContent = [...SETS.campus, ...SETS.community].reduce((n, g) => n + g.items.length, 0);

  // ---------- churches ----------
  const CH = window.CHURCHES || [];
  let cf = "all";
  function renderChurches() {
    const q = $("#church-q").value.trim().toLowerCase();
    const list = CH.filter(([n, d, u, town, note, lang]) => {
      if (cf === "lang" && !lang) return false;
      if (cf !== "all" && cf !== "lang" && d !== cf) return false;
      return !q || (n + " " + town + " " + note).toLowerCase().includes(q);
    });
    $("#church-count").textContent = `Showing ${list.length} of ${CH.length} churches`;
    $("#church-list").innerHTML = list.map(([n, d, u, town, note, lang]) =>
      `<div class="ch"><a href="${esc(u)}" target="_blank" rel="noopener">${esc(n)} ↗</a>
       <div class="pills"><span class="pill">${esc(d)}</span><span class="pill">${esc(town)}</span>${lang ? `<span class="pill lang">${esc(lang)}</span>` : ""}</div>
       ${note ? `<p>${esc(note)}</p>` : ""}</div>`).join("") || `<div class="empty">No churches match that search.</div>`;
  }
  document.querySelectorAll("[data-f]").forEach(b => b.addEventListener("click", () => {
    cf = b.dataset.f;
    document.querySelectorAll("[data-f]").forEach(x => x.setAttribute("aria-pressed", String(x === b)));
    renderChurches();
  }));
  $("#church-q").addEventListener("input", renderChurches);
  renderChurches();
  $("#fact-ch").textContent = CH.length;

  loadEvents();
})();
