/* AI Startup & VC Intelligence dashboard.
 * Data source priority on load:
 *   1. a workbook/link imported in this browser (IndexedDB; a link is re-fetched each visit)
 *   2. the repo: data/*.csv merged with any Excel listed in data/sources.json
 *   3. fictional sample data in data/sample/
 * ?data=repo skips 1, ?data=sample forces 3. No backend, no build step. */
"use strict";

const LADDER = ["Pre-Seed", "Seed", "Series A", "Series B", "Series C", "Series D+"];
const state = { schema: null, rules: null, tables: {}, source: null, report: null, warnings: [], charts: {}, model: null };

// ---------- helpers ----------
const $ = (s) => document.querySelector(s);
const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const num = (v) => (v === "" || v == null || isNaN(+v) ? null : +v);
const splitList = (v) => String(v || "").split(";").map((s) => s.trim()).filter(Boolean);
const sum = (a) => a.reduce((x, y) => x + (y || 0), 0);
function median(a) {
  const s = a.filter((x) => x != null && !isNaN(x)).sort((x, y) => x - y);
  if (!s.length) return null;
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
function money(v) {
  if (v == null || isNaN(v)) return "—";
  const a = Math.abs(v);
  if (a >= 1e9) return "$" + (v / 1e9).toFixed(1) + "B";
  if (a >= 1e6) return "$" + (v / 1e6).toFixed(1) + "M";
  if (a >= 1e3) return "$" + Math.round(v / 1e3) + "K";
  return "$" + Math.round(v);
}
const plural = (n, w) => `${n} ${w}${n === 1 ? "" : "s"}`;
const pct = (v) => (v == null || isNaN(v) ? "—" : Math.round(v * 100) + "%");
const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
const monthsBetween = (a, b) => (a && b ? (new Date(b) - new Date(a)) / (1000 * 60 * 60 * 24 * 30.44) : null);
const ago = (iso) => {
  const s = (Date.now() - new Date(iso)) / 1000;
  return s < 90 ? "just now" : s < 5400 ? Math.round(s / 60) + " min ago" : s < 129600 ? Math.round(s / 3600) + " h ago" : Math.round(s / 86400) + " days ago";
};
function countBy(rows, fn) {
  const m = new Map();
  rows.forEach((r) => { const k = fn(r); if (k != null && k !== "") m.set(k, (m.get(k) || 0) + 1); });
  return m;
}
function table(el, headers, rows) {
  el.innerHTML = `<thead><tr>${headers.map((h) => `<th class="${h.num ? "num" : ""}">${esc(h.label)}</th>`).join("")}</tr></thead>
    <tbody>${rows.map((r) => `<tr>${r.map((c, i) => `<td class="${headers[i].num ? "num" : ""}">${c}</td>`).join("")}</tr>`).join("") ||
      `<tr><td colspan="${headers.length}" class="muted">No data yet.</td></tr>`}</tbody>`;
}
function download(filename, blob) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
function downloadCsv(filename, columns, rows) {
  const csv = Papa.unparse({ fields: columns, data: rows.map((r) => columns.map((c) => r[c] ?? "")) });
  download(filename, new Blob([csv], { type: "text/csv" }));
}

// ---------- loading ----------
async function fetchCsv(path) {
  const res = await fetch(path, { cache: "no-store" });
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
  const parsed = Papa.parse(await res.text(), { header: true, skipEmptyLines: "greedy", transformHeader: (h) => h.trim() });
  return parsed.data.map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, (v ?? "").trim()])));
}
async function loadFolder(folder) {
  const out = {};
  for (const [name, t] of Object.entries(state.schema.tables)) out[name] = await fetchCsv(`${folder}/${t.file}`);
  return out;
}
const rowCount = (tables) => sum(Object.values(tables).map((r) => r.length));

async function loadRepo() {
  let tables = await loadFolder("data");
  let sources = { excel_files: [], excel_urls: [] };
  try { const r = await fetch("data/sources.json", { cache: "no-store" }); if (r.ok) sources = await r.json(); } catch { /* optional file */ }
  const files = [];
  for (const f of sources.excel_files || []) {
    try {
      const r = await fetch(f, { cache: "no-store" });
      if (r.ok) files.push({ name: f.split("/").pop(), buffer: await r.arrayBuffer() });
      else state.warnings.push(`data/sources.json lists ${f} but it returned HTTP ${r.status}.`);
    } catch (e) { state.warnings.push(`Could not load ${f}: ${e.message}`); }
  }
  let report = null;
  if (files.length) { const res = await Importer.importBuffers(files); tables = Importer.merge(tables, res.tables); report = res.report; }
  for (const u of sources.excel_urls || []) {
    try { const res = await Importer.importUrl(u); tables = Importer.merge(tables, res.tables); report = report || res.report; }
    catch (e) { state.warnings.push(`Linked workbook in data/sources.json failed: ${e.message}`); }
  }
  const n = files.length + (sources.excel_urls || []).length;
  return { tables, report, label: n ? `Repo data + ${n} Excel file${n > 1 ? "s" : ""}` : "Repo data (data/*.csv)" };
}

async function load() {
  const [schema, rules] = await Promise.all(["schema/schema.json", "schema/import_rules.json"].map((p) => fetch(p, { cache: "no-store" }).then((r) => r.json())));
  state.schema = schema; state.rules = rules;
  for (const t of Object.values(schema.tables)) t.all_columns = [...t.columns, ...schema.provenance];
  Importer.init(schema, rules);

  const mode = new URLSearchParams(location.search).get("data");
  if (mode !== "sample" && mode !== "repo") {
    const saved = await Importer.store.load();
    if (saved && saved.tables) {
      if (saved.url && saved.autoRefresh) {
        try {
          const res = await Importer.importUrl(saved.url);
          Object.assign(saved, { tables: res.tables, report: res.report, at: new Date().toISOString() });
          await Importer.store.save(saved);
        } catch (e) { state.warnings.push(`Couldn't refresh the linked workbook (${e.message}). Showing the copy from ${ago(saved.at)}.`); }
      }
      state.tables = saved.tables; state.report = saved.report;
      state.source = { kind: "browser", label: saved.label, at: saved.at, url: saved.url };
      return;
    }
  }
  if (mode !== "sample") {
    const repo = await loadRepo();
    if (rowCount(repo.tables) > 0) { state.tables = repo.tables; state.report = repo.report; state.source = { kind: "repo", label: repo.label }; return; }
  }
  state.tables = await loadFolder("data/sample");
  state.source = { kind: "sample", label: "Sample data (fictional)" };
}

function renderSource() {
  const s = state.source;
  $("#sample-banner").hidden = s.kind !== "sample";
  $("#dataset-badge").textContent = s.kind === "sample" ? "Dataset: SAMPLE (fictional)" : s.kind === "browser" ? `Dataset: ${s.label}` : `Dataset: ${s.label}`;
  const bits = [];
  if (s.kind === "browser") {
    bits.push(`<strong>${esc(s.label)}</strong> · imported ${esc(ago(s.at))}${s.url ? " · re-fetched from the link each visit" : " · saved in this browser"}`);
    bits.push(`<button class="link" id="src-reimport">Import a newer file</button>`);
    bits.push(`<button class="link" id="src-clear">Stop using it (back to repo data)</button>`);
  } else if (s.kind === "repo") {
    bits.push(`<strong>${esc(s.label)}</strong>`);
    bits.push(`<button class="link" id="src-reimport">Import an Excel file</button>`);
  } else {
    bits.push(`<button class="link" id="src-reimport">Import your Excel file to replace the sample</button>`);
  }
  $("#source-bar").innerHTML = bits.join(" ") + state.warnings.map((w) => `<div class="warn">⚠ ${esc(w)}</div>`).join("");
  $("#src-reimport")?.addEventListener("click", () => showTab("import"));
  $("#src-clear")?.addEventListener("click", async () => { await Importer.store.clear(); location.reload(); });
}

// ---------- derived model ----------
function model() {
  const { companies, funding_rounds: rounds, investors, programs, company_programs: cp } = state.tables;
  const roundsBy = new Map();
  rounds.forEach((r) => {
    if (!roundsBy.has(r.company_id)) roundsBy.set(r.company_id, []);
    roundsBy.get(r.company_id).push(r);
  });
  roundsBy.forEach((rs) => rs.sort((a, b) => (a.announced_date || "9999").localeCompare(b.announced_date || "9999")));
  const progBy = new Map();
  cp.forEach((p) => { if (!progBy.has(p.company_id)) progBy.set(p.company_id, []); progBy.get(p.company_id).push(p.program_id); });
  const co = companies.map((c) => {
    const rs = roundsBy.get(c.company_id) || [];
    const idx = Math.max(-1, ...rs.map((r) => LADDER.indexOf(r.stage)));
    const dated = rs.filter((r) => r.announced_date);
    return {
      ...c, rounds: rs,
      highest: idx >= 0 ? LADDER[idx] : (rs.length ? "Other" : "No rounds"),
      highestIdx: idx,
      totalRaised: Math.max(sum(rs.map((r) => num(r.amount_usd))), num(c.total_funding_usd) || 0),
      lastRound: dated.length ? dated[dated.length - 1].announced_date : "",
      programs: progBy.get(c.company_id) || [],
    };
  });
  return { co, coById: new Map(co.map((c) => [c.company_id, c])), rounds, investors, programs, cp };
}

// ---------- charts ----------
function axisOpts(horizontal, fmt) {
  const text = css("--text-2"), grid = css("--grid");
  return {
    x: { ticks: { color: text, ...(horizontal ? { callback: (v) => fmt(v) } : {}) }, grid: { color: horizontal ? grid : "transparent" }, border: { color: grid }, beginAtZero: true },
    y: { ticks: { color: text, ...(horizontal ? { autoSkip: false } : { callback: (v) => fmt(v) }) }, grid: { color: horizontal ? "transparent" : grid }, border: { color: grid }, beginAtZero: true },
  };
}
function makeChart(id, config) {
  if (state.charts[id]) state.charts[id].destroy();
  const el = document.getElementById(id);
  if (!el) return;
  const empty = !config.data.labels.length;
  el.parentElement.classList.toggle("empty", empty);
  if (empty) return;
  state.charts[id] = new Chart(el, config);
}
function barChart(id, labels, values, { horizontal = false, fmt, unit, tip } = {}) {
  const tick = fmt || ((v) => v);
  fmt = fmt || ((v) => (unit ? `${v} ${unit}` : v));
  makeChart(id, {
    type: "bar",
    data: { labels, datasets: [{ data: values, backgroundColor: css("--series-1"), hoverBackgroundColor: css("--series-1-hover"), borderRadius: 4, borderSkipped: "start", maxBarThickness: 34 }] },
    options: {
      indexAxis: horizontal ? "y" : "x", maintainAspectRatio: false, animation: { duration: 300 },
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => fmt(c.parsed[horizontal ? "x" : "y"]), afterLabel: tip ? (c) => tip(c.dataIndex) : undefined } } },
      scales: axisOpts(horizontal, tick),
    },
  });
}
function stackedChart(id, labels, series, { fmt = (v) => v, tick = fmt } = {}) {
  const surface = css("--surface");
  makeChart(id, {
    type: "bar",
    data: { labels, datasets: series.map((s, i) => ({ label: s.label, data: s.data, backgroundColor: css(`--cat-${i + 1}`), borderColor: surface, borderWidth: { top: 2 }, borderSkipped: "bottom", maxBarThickness: 34 })) },
    options: {
      maintainAspectRatio: false, animation: { duration: 300 },
      interaction: { mode: "index", intersect: false },
      plugins: { legend: { position: "bottom", labels: { color: css("--text-2"), boxWidth: 10, boxHeight: 10, useBorderRadius: true, borderRadius: 2 } },
        tooltip: { callbacks: { label: (c) => `${c.dataset.label}: ${fmt(c.parsed.y)}` } } },
      scales: { x: { ...axisOpts(false, tick).x, stacked: true }, y: { ...axisOpts(false, tick).y, stacked: true } },
    },
  });
}
function sortedCounts(rows, fn, order) {
  const m = countBy(rows, fn);
  const keys = order ? order.filter((k) => m.has(k)) : [...m.keys()];
  return keys.sort((a, b) => m.get(b) - m.get(a)).map((k) => [k, m.get(k)]);
}

// ---------- insights ----------
function insights(m) {
  const out = [];
  const small = (n) => (n < 10 ? ` <span class="pill">small sample: ${n}</span>` : "");
  if (!m.co.length) return [{ t: "No startups yet", d: "Import an Excel file or add rows to data/companies.csv." }];
  const cats = sortedCounts(m.co, (c) => c.category);
  out.push({ t: "Landscape", d: `<b>${m.co.length}</b> startups across <b>${cats.length}</b> categories. <b>${esc(cats[0][0])}</b> is the largest group (${cats[0][1]}, ${pct(cats[0][1] / m.co.length)}).` });
  const cap = new Map();
  m.co.forEach((c) => cap.set(c.category, (cap.get(c.category) || 0) + c.totalRaised));
  const capTotal = sum([...cap.values()]);
  if (capTotal > 0) {
    const [topC, topV] = [...cap.entries()].sort((a, b) => b[1] - a[1])[0];
    out.push({ t: "Where the money goes", d: `<b>${esc(topC)}</b> has raised the most: <b>${money(topV)}</b>, ${pct(topV / capTotal)} of the ${money(capTotal)} tracked.` });
  }
  const amt = (s) => m.rounds.filter((r) => r.stage === s).map((r) => num(r.amount_usd)).filter((v) => v != null);
  const seed = amt("Seed"), a = amt("Series A");
  if (seed.length && a.length) out.push({ t: "Round sizes", d: `Median Seed round <b>${money(median(seed))}</b>; median Series A <b>${money(median(a))}</b>, about <b>${(median(a) / median(seed)).toFixed(1)}×</b> larger.${small(Math.min(seed.length, a.length))}` });
  const years = [...countBy(m.rounds, (r) => (r.announced_date || "").slice(0, 4)).entries()].sort((x, y) => x[0].localeCompare(y[0]));
  if (years.length >= 2) {
    const [y1, n1] = years[years.length - 1], [y0, n0] = years[years.length - 2];
    const partial = +y1 === new Date().getFullYear() ? " (year to date)" : "";
    out.push({ t: "Momentum", d: `<b>${plural(n1, "round")}</b> in ${y1}${partial} vs <b>${plural(n0, "round")}</b> in ${y0} (${n1 >= n0 ? "+" : ""}${pct((n1 - n0) / n0)}).` });
  }
  // "reached at least Seed" so flat exports that only list the latest round still count correctly
  const seeded = m.co.filter((c) => c.highestIdx >= 1);
  if (seeded.length) {
    const conv = seeded.filter((c) => c.highestIdx >= 2);
    const gaps = conv.map((c) => monthsBetween(c.rounds.find((r) => r.stage === "Seed")?.announced_date, c.rounds.find((r) => r.stage === "Series A")?.announced_date)).filter((v) => v != null && v >= 0);
    out.push({ t: "Seed → Series A", d: `<b>${pct(conv.length / seeded.length)}</b> of startups that reached Seed went on to raise a Series A or later${gaps.length ? `, after a median <b>${Math.round(median(gaps))} months</b>` : ""}.${small(seeded.length)}` });
  }
  const dead = m.co.filter((c) => ["Shut Down", "Inactive"].includes(c.status));
  if (dead.length) {
    const at = sortedCounts(dead, (c) => c.highest)[0];
    out.push({ t: "Failures", d: `<b>${pct(dead.length / m.co.length)}</b> of startups are shut down or inactive; most of them stopped at <b>${esc(at[0])}</b> (${at[1]}).` });
  }
  const exits = m.co.filter((c) => ["Acquired", "IPO"].includes(c.status));
  if (exits.length) out.push({ t: "Exits", d: `<b>${plural(exits.length, "exit")}</b> (${exits.filter((c) => c.status === "Acquired").length} acquired, ${exits.filter((c) => c.status === "IPO").length} IPO).` });
  const deals = new Map(), leads = new Map();
  m.rounds.forEach((r) => {
    splitList(r.lead_investor_ids).forEach((i) => { deals.set(i, (deals.get(i) || 0) + 1); leads.set(i, (leads.get(i) || 0) + 1); });
    splitList(r.participant_investor_ids).forEach((i) => deals.set(i, (deals.get(i) || 0) + 1));
  });
  if (deals.size) {
    const [iid, d] = [...deals.entries()].sort((x, y) => y[1] - x[1])[0];
    const name = m.investors.find((i) => i.investor_id === iid)?.name || iid;
    out.push({ t: "Most active investor", d: `<b>${esc(name)}</b>: ${plural(d, "deal")}, ${leads.get(iid) || 0} as lead.` });
  }
  const alumni = m.co.filter((c) => c.programs.length), others = m.co.filter((c) => !c.programs.length);
  if (alumni.length && others.length) {
    const r = (cs) => cs.filter((c) => c.highestIdx >= 2).length / cs.length;
    out.push({ t: "Accelerator effect", d: `Program alumni reached Series A <b>${pct(r(alumni))}</b> of the time vs <b>${pct(r(others))}</b> for the rest. This is correlation, not proof: good startups also get picked by good programs.${small(alumni.length)}` });
  }
  const disclosed = m.rounds.filter((r) => num(r.amount_usd) != null).length;
  const sourced = m.co.filter((c) => c.source_url).length;
  out.push({ t: "Data quality", d: `${pct(m.rounds.length ? disclosed / m.rounds.length : 0)} of rounds have an amount; ${pct(sourced / m.co.length)} of startups have a source link. Low numbers mean the charts above are less reliable.` });
  return out;
}

// ---------- tabs ----------
function renderOverview(m) {
  const disclosed = m.rounds.map((r) => num(r.amount_usd)).filter((v) => v != null);
  const active = m.co.filter((c) => c.status === "Active").length;
  const kpis = [
    ["Startups", m.co.length], ["Funding rounds", m.rounds.length], ["Capital tracked", money(sum(m.co.map((c) => c.totalRaised)))],
    ["Median round", money(median(disclosed))], ["Investors", m.investors.length], ["Programs", m.programs.length],
    ["Still active", m.co.length ? pct(active / m.co.length) : "—"],
  ];
  $("#kpis").innerHTML = kpis.map(([l, v]) => `<div class="kpi"><div class="v">${esc(v)}</div><div class="l">${esc(l)}</div></div>`).join("");
  $("#insights").innerHTML = insights(m).map((i) => `<li><span class="it">${esc(i.t)}</span><span>${i.d}</span></li>`).join("");

  const cats = sortedCounts(m.co, (c) => c.category);
  barChart("c-category", cats.map((x) => x[0]), cats.map((x) => x[1]), { horizontal: true, unit: "startups" });
  const sts = state.schema.enums.company_status.map((s) => [s, m.co.filter((c) => c.status === s).length]).filter((x) => x[1]);
  barChart("c-status", sts.map((x) => x[0]), sts.map((x) => x[1]), { unit: "startups", tip: (i) => pct(sts[i][1] / m.co.length) + " of all" });
  const capYear = new Map();
  m.rounds.forEach((r) => { const y = (r.announced_date || "").slice(0, 4); if (y) capYear.set(y, (capYear.get(y) || 0) + (num(r.amount_usd) || 0)); });
  const ys = [...capYear.keys()].sort();
  barChart("c-capital-year", ys, ys.map((y) => capYear.get(y)), { fmt: money });

  const cov = [
    ["Startups with ≥1 funding round", m.co.filter((c) => c.rounds.length).length, m.co.length],
    ["Startups with a source link", m.co.filter((c) => c.source_url).length, m.co.length],
    ["Rounds with disclosed amount", disclosed.length, m.rounds.length],
    ["Rounds with a date", m.rounds.filter((r) => r.announced_date).length, m.rounds.length],
    ["Rounds with a lead investor", m.rounds.filter((r) => r.lead_investor_ids).length, m.rounds.length],
    ["Investors with check-size range", m.investors.filter((i) => i.check_size_min_usd && i.check_size_max_usd).length, m.investors.length],
  ];
  table($("#coverage"), [{ label: "Field" }, { label: "Count", num: true }, { label: "Coverage" }],
    cov.map(([l, a, b]) => [esc(l), `${a} / ${b}`, `<div class="bar" title="${pct(b ? a / b : 0)}"><span style="width:${b ? (100 * a) / b : 0}%"></span></div>`]));
}

function fillSelect(sel, values) { const el = $(sel); if (el.options.length === 1) values.forEach((v) => el.add(new Option(v, v))); }

function renderStartups(m) {
  const top = (fn, n = 10) => sortedCounts(m.co, fn).slice(0, n);
  const bm = top((c) => (c.business_model && c.business_model !== "Unknown" ? c.business_model : null));
  barChart("c-model", bm.map((x) => x[0]), bm.map((x) => x[1]), { horizontal: true, unit: "startups" });
  const cu = top((c) => (c.target_customer && c.target_customer !== "Unknown" ? c.target_customer : null));
  barChart("c-customer", cu.map((x) => x[0]), cu.map((x) => x[1]), { horizontal: true, unit: "startups" });
  const ci = top((c) => c.hq_city || null);
  barChart("c-cities", ci.map((x) => x[0]), ci.map((x) => x[1]), { horizontal: true, unit: "startups" });
  const fy = countBy(m.co, (c) => c.founded_year || null);
  const fys = [...fy.keys()].sort();
  barChart("c-founded", fys, fys.map((y) => fy.get(y)), { unit: "startups" });
  renderStartupTable(m);
}
function renderStartupTable(m) {
  fillSelect("#f-category", state.schema.enums.category);
  fillSelect("#f-status", state.schema.enums.company_status);
  fillSelect("#f-stage", [...LADDER, "No rounds"]);
  const q = $("#f-search").value.toLowerCase(), cat = $("#f-category").value, st = $("#f-status").value, stage = $("#f-stage").value;
  const rows = m.co.filter((c) =>
    (!q || [c.name, c.description, c.hq_city, c.sub_category].join(" ").toLowerCase().includes(q)) &&
    (!cat || c.category === cat) && (!st || c.status === st) && (!stage || c.highest === stage)
  ).sort((a, b) => b.totalRaised - a.totalRaised);
  state.filteredStartups = rows;
  $("#startup-count").textContent = `${rows.length} of ${m.co.length} startups`;
  table($("#t-startups"),
    [{ label: "Startup" }, { label: "Category" }, { label: "Model" }, { label: "Customer" }, { label: "Founded", num: true }, { label: "Status" }, { label: "Highest stage" }, { label: "Total raised", num: true }, { label: "Last round" }, { label: "Programs" }, { label: "Source" }],
    rows.map((c) => [
      `${c.website ? `<a href="${esc(c.website)}" target="_blank" rel="noopener">${esc(c.name)}</a>` : esc(c.name)}${c.description ? `<div class="muted small">${esc(c.description.slice(0, 110))}</div>` : ""}`,
      esc(c.category), esc(c.business_model), esc(c.target_customer), esc(c.founded_year), `<span class="pill">${esc(c.status)}</span>`,
      esc(c.highest), money(c.totalRaised || null), esc(c.lastRound), esc(c.programs.join(", ")),
      c.source_url ? `<a href="${esc(c.source_url)}" target="_blank" rel="noopener">link</a>` : `<span class="warn">none</span>`,
    ]));
}

function renderFunding(m) {
  const stages = LADDER.filter((s) => m.rounds.some((r) => r.stage === s));
  const amt = (s) => m.rounds.filter((r) => r.stage === s).map((r) => num(r.amount_usd));
  barChart("c-median-stage", stages, stages.map((s) => median(amt(s))), { fmt: money, tip: (i) => `${amt(stages[i]).filter((v) => v != null).length} disclosed rounds` });
  const val = (s) => m.rounds.filter((r) => r.stage === s).map((r) => num(r.post_money_valuation_usd));
  barChart("c-val-stage", stages, stages.map((s) => median(val(s))), { fmt: money, tip: (i) => `${val(stages[i]).filter((v) => v != null).length} rounds with valuation` });

  const capCat = new Map();
  m.co.forEach((c) => capCat.set(c.category, (capCat.get(c.category) || 0) + c.totalRaised));
  const cats = [...capCat.keys()].filter((c) => capCat.get(c) > 0).sort((a, b) => capCat.get(b) - capCat.get(a));
  barChart("c-cap-category", cats, cats.map((c) => capCat.get(c)), { horizontal: true, fmt: money });

  const years = [...new Set(m.rounds.map((r) => (r.announced_date || "").slice(0, 4)).filter(Boolean))].sort();
  stackedChart("c-rounds-year", years, stages.map((s) => ({ label: s, data: years.map((y) => m.rounds.filter((r) => r.stage === s && (r.announced_date || "").startsWith(y)).length) })), { fmt: (v) => `${v} rounds`, tick: (v) => v });

  // heatmap: categories x stages, shaded by round count
  const catsAll = state.schema.enums.category.filter((c) => m.co.some((x) => x.category === c));
  const cell = (cat, s) => m.rounds.filter((r) => r.stage === s && m.coById.get(r.company_id)?.category === cat);
  const max = Math.max(1, ...catsAll.flatMap((c) => stages.map((s) => cell(c, s).length)));
  table($("#t-stage-cat"), [{ label: "Category" }, ...stages.map((s) => ({ label: s, num: true }))],
    catsAll.map((cat) => [esc(cat), ...stages.map((s) => {
      const rs = cell(cat, s);
      if (!rs.length) return `<span class="muted">—</span>`;
      const w = rs.length / max;
      return `<span class="heat" style="--w:${Math.round(15 + w * 75)}%" data-strong="${w > 0.55}">${money(median(rs.map((r) => num(r.amount_usd))))} <small>(${rs.length})</small></span>`;
    })]));
}

function renderProgression(m) {
  const reached = LADDER.map((s, i) => m.co.filter((c) => c.highestIdx >= i).length);
  const used = LADDER.filter((_, i) => reached[i] > 0);
  barChart("c-funnel", used, used.map((s) => reached[LADDER.indexOf(s)]), { unit: "startups", tip: (i) => (reached[0] ? pct(reached[LADDER.indexOf(used[i])] / Math.max(...reached)) + " of the top of the funnel" : "") });

  const gaps = [];
  for (let i = 0; i < LADDER.length - 1; i++) {
    const from = LADDER[i], to = LADDER[i + 1];
    const ms = m.co.map((c) => {
      const a = c.rounds.find((r) => r.stage === from), b = c.rounds.find((r) => r.stage === to);
      return a && b ? monthsBetween(a.announced_date, b.announced_date) : null;
    }).filter((v) => v != null && v >= 0);
    if (ms.length) gaps.push([`${from} → ${to}`, median(ms), ms.length]);
  }
  barChart("c-gap", gaps.map((g) => g[0]), gaps.map((g) => Math.round(g[1] * 10) / 10), { fmt: (v) => `${v} mo`, tip: (i) => `${gaps[i][2]} startups` });

  const cohorts = [...new Set(m.co.map((c) => c.founded_year).filter(Boolean))].sort();
  const coh = cohorts.map((y) => { const cs = m.co.filter((c) => String(c.founded_year) === String(y)); return [y, cs.filter((c) => c.highestIdx >= 2).length / cs.length, cs.length]; });
  barChart("c-cohort", coh.map((x) => x[0]), coh.map((x) => Math.round(x[1] * 100)), { fmt: (v) => `${v}%`, tip: (i) => `${coh[i][2]} startups founded that year` });

  const conv = [];
  for (let i = 0; i < LADDER.length - 1; i++) {
    const base = m.co.filter((c) => c.highestIdx >= i);
    if (!base.length) continue;
    const next = base.filter((c) => c.highestIdx > i);
    conv.push([LADDER[i], LADDER[i + 1], base.length, next.length, next.length / base.length]);
  }
  table($("#t-conversion"), [{ label: "From" }, { label: "To" }, { label: "Reached from-stage", num: true }, { label: "Also reached next", num: true }, { label: "Conversion", num: true }, { label: "" }],
    conv.map(([a, b, n, k, r]) => [esc(a), esc(b), n, k, pct(r), `<div class="bar"><span style="width:${r * 100}%"></span></div>`]));

  const statuses = state.schema.enums.company_status.filter((s) => m.co.some((c) => c.status === s));
  const groups = [...LADDER, "Other", "No rounds"].filter((g) => m.co.some((c) => c.highest === g));
  table($("#t-outcome"), [{ label: "Highest stage" }, { label: "Startups", num: true }, ...statuses.map((s) => ({ label: s, num: true }))],
    groups.map((g) => {
      const cs = m.co.filter((c) => c.highest === g);
      return [esc(g), cs.length, ...statuses.map((s) => { const n = cs.filter((c) => c.status === s).length; return n ? `${n} <span class="muted">(${pct(n / cs.length)})</span>` : "—"; })];
    }));
}

function investorStats(m) {
  return m.investors.map((inv) => {
    const leads = m.rounds.filter((r) => splitList(r.lead_investor_ids).includes(inv.investor_id));
    const parts = m.rounds.filter((r) => splitList(r.participant_investor_ids).includes(inv.investor_id));
    const all = [...leads, ...parts];
    const cats = countBy(all, (r) => m.coById.get(r.company_id)?.category);
    return { inv, deals: all.length, leads: leads.length, companies: new Set(all.map((r) => r.company_id)).size,
      topCats: [...cats.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([c]) => c),
      stagesSeen: [...new Set(all.map((r) => r.stage))].sort((a, b) => LADDER.indexOf(a) - LADDER.indexOf(b)) };
  });
}
function renderInvestors(m) {
  const stats = investorStats(m);
  const top = [...stats].sort((a, b) => b.deals - a.deals).filter((s) => s.deals).slice(0, 12);
  barChart("c-top-investors", top.map((s) => s.inv.name), top.map((s) => s.deals), { horizontal: true, unit: "deals", tip: (i) => `${top[i].leads} as lead` });
  const types = sortedCounts(m.investors, (i) => i.type);
  barChart("c-investor-types", types.map((x) => x[0]), types.map((x) => x[1]), { horizontal: true, unit: "investors" });
  renderInvestorTable(m, stats);
}
function renderInvestorTable(m, stats = investorStats(m)) {
  fillSelect("#fi-type", state.schema.enums.investor_type);
  fillSelect("#fi-stage", state.schema.enums.stage);
  const q = $("#fi-search").value.toLowerCase(), type = $("#fi-type").value, stage = $("#fi-stage").value;
  const rows = stats.filter((s) => (!q || s.inv.name.toLowerCase().includes(q)) && (!type || s.inv.type === type) &&
    (!stage || splitList(s.inv.stages).includes(stage) || s.stagesSeen.includes(stage))).sort((a, b) => b.deals - a.deals || b.leads - a.leads);
  table($("#t-investors"),
    [{ label: "Investor" }, { label: "Type" }, { label: "Deals", num: true }, { label: "Leads", num: true }, { label: "Portfolio cos.", num: true }, { label: "Check size" }, { label: "Stated stages" }, { label: "Stages seen in data" }, { label: "Top categories (data)" }],
    rows.map((s) => [
      s.inv.website ? `<a href="${esc(s.inv.website)}" target="_blank" rel="noopener">${esc(s.inv.name)}</a>` : esc(s.inv.name),
      esc(s.inv.type), s.deals, s.leads, s.companies,
      s.inv.check_size_min_usd || s.inv.check_size_max_usd ? `${money(num(s.inv.check_size_min_usd))} – ${money(num(s.inv.check_size_max_usd))}` : "—",
      esc(splitList(s.inv.stages).join(", ")), esc(s.stagesSeen.join(", ")), esc(s.topCats.join(", ")),
    ]));
}

function renderPrograms(m) {
  const outcome = (cs) => ({
    n: cs.length,
    toA: cs.length ? cs.filter((c) => c.highestIdx >= 2).length / cs.length : null,
    alive: cs.length ? cs.filter((c) => ["Active", "Acquired", "IPO"].includes(c.status)).length / cs.length : null,
    medRaised: median(cs.map((c) => c.totalRaised || null)),
  });
  const progs = m.programs.map((p) => ({ p, o: outcome(m.co.filter((c) => c.programs.includes(p.program_id))) }));
  const withAlumni = progs.filter((x) => x.o.n).sort((a, b) => b.o.n - a.o.n);
  barChart("c-program-alumni", withAlumni.map((x) => x.p.name), withAlumni.map((x) => Math.round((x.o.toA || 0) * 100)), { horizontal: true, fmt: (v) => `${v}%`, tip: (i) => `${withAlumni[i].o.n} alumni in the database` });
  const valued = progs.filter((x) => num(x.p.investment_usd) && num(x.p.equity_pct));
  barChart("c-program-valuation", valued.map((x) => x.p.name), valued.map((x) => num(x.p.investment_usd) / (num(x.p.equity_pct) / 100)), { horizontal: true, fmt: money, tip: (i) => `${money(num(valued[i].p.investment_usd))} for ${valued[i].p.equity_pct}%` });
  table($("#t-programs"),
    [{ label: "Program" }, { label: "Type" }, { label: "Investment", num: true }, { label: "Equity", num: true }, { label: "Implied valuation", num: true }, { label: "Length (wks)", num: true }, { label: "Batch size", num: true }, { label: "Support" }, { label: "Alumni in DB", num: true }, { label: "Reached Series A", num: true }, { label: "Median raised", num: true }],
    progs.map(({ p, o }) => {
      const inv = num(p.investment_usd), eq = num(p.equity_pct);
      return [
        `${esc(p.name)}${p.model_summary ? `<div class="muted small">${esc(p.model_summary)}</div>` : ""}`, esc(p.type),
        money(inv), eq == null ? "—" : `${eq}%`, inv && eq ? money(inv / (eq / 100)) : "—",
        esc(p.program_length_weeks || "—"), esc(p.avg_batch_size || "—"), esc(splitList(p.support_offered).join(", ")),
        o.n, pct(o.toA), money(o.medRaised),
      ];
    }));
  const alumni = m.co.filter((c) => c.programs.length), others = m.co.filter((c) => !c.programs.length);
  table($("#t-alumni"), [{ label: "Group" }, { label: "Startups", num: true }, { label: "Reached Series A+", num: true }, { label: "Active / acquired / IPO", num: true }, { label: "Median total raised", num: true }],
    [["Program alumni", outcome(alumni)], ["Not in a tracked program", outcome(others)]].map(([l, o]) => [esc(l), o.n, pct(o.toA), pct(o.alive), money(o.medRaised)]));
}

// ---------- import tab ----------
function renderReport(res, { applied }) {
  const { tables, report } = res;
  const counts = Object.entries(state.schema.tables).map(([k, t]) => `<div class="kpi"><div class="v">${tables[k].length}</div><div class="l">${esc(t.label)}</div></div>`).join("");
  const sheetRows = report.sheets.map((s) => [
    `${esc(s.file)}<div class="muted small">sheet “${esc(s.sheet)}”</div>`,
    s.table ? `<span class="pill">${esc(state.schema.tables[s.table].label)}</span><div class="muted small">header on row ${s.headerRow} · ${s.rows} rows</div>` : `<span class="warn">skipped</span><div class="muted small">${esc(s.reason)}</div>`,
    s.mapped ? s.mapped.map((x) => `<code>${esc(x.header)}</code> → ${esc(x.field)}`).join("<br>") : "",
    s.ignored && s.ignored.length ? `<span class="muted">${s.ignored.map(esc).join(", ")}</span>` : "",
  ]);
  const notes = report.notes.map((n) => `<li><b>${esc(n.msg)}</b> <span class="muted">(${n.count}×${n.examples.length ? `, e.g. ${n.examples.map((e) => `“${esc(e)}”`).join(", ")}` : ""})</span></li>`).join("");
  const kinds = new Map();
  report.issues.forEach((i) => { const k = `${state.schema.tables[i.table].label}: ${i.kind}`; if (!kinds.has(k)) kinds.set(k, []); kinds.get(k).push(i); });
  const issues = [...kinds.entries()].sort((a, b) => b[1].length - a[1].length).map(([k, list]) =>
    `<details><summary><b>${list.length}</b> × ${esc(k)}</summary><ul class="small">${list.slice(0, 50).map((i) => `<li>${esc(i.key)} — ${esc(i.msg)}</li>`).join("")}${list.length > 50 ? `<li class="muted">…and ${list.length - 50} more</li>` : ""}</ul></details>`).join("");
  $("#imp-result").innerHTML = `
    ${applied ? `<p class="ok"><strong>✓ Dashboard updated</strong> from ${esc(report.files.join(", "))}. ${state.source.url ? "The link is re-fetched every time this page opens." : "Saved in this browser; it loads automatically next time."}
      <button class="primary" id="imp-view">View dashboard →</button></p>` : ""}
    <div class="kpis">${counts}</div>
    <h4>How each sheet was read</h4>
    <div class="table-wrap"><table id="imp-sheets"></table></div>
    ${notes ? `<h4>Automatic clean-up</h4><ul class="notes">${notes}</ul>` : ""}
    <h4>${report.issues.length ? `${report.issues.length} things to fix before this is publishable` : "No problems found ✓"}</h4>
    ${report.issues.length ? `<p class="muted">The charts already work. These only matter for the official database (CI rejects them). Missing <code>source_url</code> / <code>collected_by</code> are the usual ones.</p>${issues}` : ""}
    <div class="filters" style="margin-top:12px">
      <button id="dl-clean" class="secondary">Download cleaned workbook (.xlsx)</button>
      ${Object.entries(state.schema.tables).map(([k, t]) => `<button class="secondary dl-csv" data-t="${k}">${esc(t.file)}</button>`).join("")}
    </div>`;
  table($("#imp-sheets"), [{ label: "File / sheet" }, { label: "Read as" }, { label: "Columns used" }, { label: "Columns ignored" }], sheetRows);
  $("#imp-view")?.addEventListener("click", () => showTab("overview"));
  $("#dl-clean").addEventListener("click", () => XLSX.writeFile(Importer.cleanedWorkbook(tables, report.issues), "cleaned_research_data.xlsx"));
  document.querySelectorAll(".dl-csv").forEach((b) => b.addEventListener("click", () => {
    const t = state.schema.tables[b.dataset.t];
    downloadCsv(t.file, t.all_columns.map((c) => c.name), tables[b.dataset.t]);
  }));
}

async function applyImport(res, meta) {
  state.tables = res.tables; state.report = res.report; state.warnings = [];
  state.source = { kind: "browser", label: meta.label, at: res.report.at, url: meta.url };
  await Importer.store.save({ tables: res.tables, report: res.report, label: meta.label, at: res.report.at, url: meta.url || null, autoRefresh: !!meta.autoRefresh });
  renderSource();
  renderAll();
  renderReport(res, { applied: true });
}

function setupImport() {
  const status = (html) => { $("#imp-status").innerHTML = html; };
  const run = async (fn, label) => {
    status(`<span class="muted">Reading ${esc(label)}…</span>`);
    try { await fn(); status(""); }
    catch (e) { console.error(e); status(`<p class="err"><strong>Couldn't import:</strong> ${esc(e.message)}</p>`); }
  };
  const handleFiles = (files) => {
    if (!files.length) return;
    const names = [...files].map((f) => f.name);
    run(async () => applyImport(await Importer.importFiles(files), { label: names.length > 1 ? `${names[0]} +${names.length - 1}` : names[0] }), names.join(", "));
  };
  $("#imp-file").addEventListener("change", (e) => handleFiles(e.target.files));
  const dz = $("#dropzone");
  ["dragenter", "dragover"].forEach((ev) => dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.add("over"); }));
  ["dragleave", "drop"].forEach((ev) => dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.remove("over"); }));
  dz.addEventListener("drop", (e) => handleFiles(e.dataTransfer.files));
  $("#imp-url-go").addEventListener("click", () => {
    const url = $("#imp-url").value.trim();
    if (!url) return;
    run(async () => applyImport(await Importer.importUrl(url), { label: "Linked workbook", url, autoRefresh: $("#imp-url-auto").checked }), "the link");
  });
  $("#imp-template").addEventListener("click", () => XLSX.writeFile(Importer.templateWorkbook(), "ai_vc_research_template.xlsx"));
  if (state.source.kind === "browser" && state.report) renderReport({ tables: state.tables, report: state.report }, { applied: false });

  const sel = $("#ref-table");
  Object.entries(state.schema.tables).forEach(([k, t]) => sel.add(new Option(t.label, k)));
  const fields = () => {
    const t = state.schema.tables[sel.value], al = Importer.aliasesFor(sel.value);
    table($("#imp-fields"), [{ label: "Column" }, { label: "Required" }, { label: "Excel headers we recognise" }, { label: "Rules / notes" }],
      t.all_columns.map((c) => [`<code>${esc(c.name)}</code>`, c.required ? "yes" : "", `<span class="muted small">${esc((al[c.name] || []).join(", "))}</span>`,
        esc([c.enum ? "One of: " + state.schema.enums[c.enum].join(" | ") : "", c.ref ? `Must exist in ${c.ref}` : "", c.doc || ""].filter(Boolean).join(" · "))]));
  };
  sel.addEventListener("change", fields);
  fields();
}

// ---------- wiring ----------
function renderAll() {
  const m = model();
  state.model = m;
  renderOverview(m); renderStartups(m); renderFunding(m); renderProgression(m); renderInvestors(m); renderPrograms(m);
}
function showTab(name) {
  document.querySelectorAll(".tabs button").forEach((x) => x.classList.toggle("active", x.dataset.tab === name));
  document.querySelectorAll(".tab").forEach((t) => t.classList.toggle("active", t.id === "tab-" + name));
  window.scrollTo({ top: 0 });
}

async function main() {
  Chart.defaults.font.family = getComputedStyle(document.body).fontFamily;
  document.querySelectorAll(".tabs button").forEach((b) => b.addEventListener("click", () => showTab(b.dataset.tab)));
  try {
    await load();
  } catch (err) {
    console.error(err);
    document.querySelector("main").innerHTML = `<div class="card err"><strong>Could not load data.</strong> ${esc(err.message)}<br>
      Open this page through a web server (e.g. <code>python3 -m http.server</code> then http://localhost:8000), not by double-clicking the file.</div>`;
    return;
  }
  renderSource();
  ["#f-search", "#f-category", "#f-status", "#f-stage"].forEach((s) => $(s).addEventListener("input", () => renderStartupTable(state.model)));
  ["#fi-search", "#fi-type", "#fi-stage"].forEach((s) => $(s).addEventListener("input", () => renderInvestorTable(state.model)));
  $("#f-export").addEventListener("click", () => {
    const cols = state.schema.tables.companies.all_columns.map((c) => c.name);
    downloadCsv("startups_filtered.csv", [...cols, "highest_stage", "total_raised_usd"],
      state.filteredStartups.map((c) => ({ ...c, highest_stage: c.highest, total_raised_usd: c.totalRaised })));
  });
  setupImport();
  renderAll();
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", renderAll);
}
main();
