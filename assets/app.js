/* AI Startup & VC Intelligence dashboard.
 * Loads schema/schema.json + data/*.csv (falls back to data/sample/ when empty),
 * computes the analytics in the browser, and validates CSVs on the Import tab
 * with the same rules as scripts/validate.py. No build step, no backend. */
"use strict";

const LADDER = ["Pre-Seed", "Seed", "Series A", "Series B", "Series C", "Series D+"];
const state = { schema: null, tables: {}, isSample: false, charts: {} };

// ---------- helpers ----------
const $ = (s) => document.querySelector(s);
const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const num = (v) => (v === "" || v == null || isNaN(+v) ? null : +v);
const splitList = (v) => String(v || "").split(";").map((s) => s.trim()).filter(Boolean);
const sum = (a) => a.reduce((x, y) => x + y, 0);
function median(a) {
  const s = a.filter((x) => x != null).sort((x, y) => x - y);
  if (!s.length) return null;
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
function money(v) {
  if (v == null) return "—";
  const a = Math.abs(v);
  if (a >= 1e9) return "$" + (v / 1e9).toFixed(1) + "B";
  if (a >= 1e6) return "$" + (v / 1e6).toFixed(1) + "M";
  if (a >= 1e3) return "$" + Math.round(v / 1e3) + "K";
  return "$" + v;
}
const pct = (v) => (v == null ? "—" : Math.round(v * 100) + "%");
const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
const monthsBetween = (a, b) => (new Date(b) - new Date(a)) / (1000 * 60 * 60 * 24 * 30.44);
function countBy(rows, fn) {
  const m = new Map();
  rows.forEach((r) => { const k = fn(r); if (k != null && k !== "") m.set(k, (m.get(k) || 0) + 1); });
  return m;
}
function table(el, headers, rows) {
  // headers: [{label, num?}], rows: array of arrays of HTML strings
  el.innerHTML = `<thead><tr>${headers.map((h) => `<th class="${h.num ? "num" : ""}">${esc(h.label)}</th>`).join("")}</tr></thead>
    <tbody>${rows.map((r) => `<tr>${r.map((c, i) => `<td class="${headers[i].num ? "num" : ""}">${c}</td>`).join("")}</tr>`).join("") ||
      `<tr><td colspan="${headers.length}" class="muted">No data yet.</td></tr>`}</tbody>`;
}
function downloadCsv(filename, columns, rows) {
  const csv = Papa.unparse({ fields: columns, data: rows.map((r) => columns.map((c) => r[c] ?? "")) });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
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
async function load() {
  const res = await fetch("schema/schema.json", { cache: "no-store" });
  state.schema = await res.json();
  for (const t of Object.values(state.schema.tables)) t.all_columns = [...t.columns, ...state.schema.provenance];
  const forceSample = new URLSearchParams(location.search).get("data") === "sample";
  let tables = forceSample ? null : await loadFolder("data");
  if (!tables || sum(Object.values(tables).map((r) => r.length)) === 0) {
    tables = await loadFolder("data/sample");
    state.isSample = true;
  }
  state.tables = tables;
}

// ---------- derived model ----------
function model() {
  const { companies, funding_rounds: rounds, investors, programs, company_programs: cp } = state.tables;
  const roundsBy = new Map();
  rounds.forEach((r) => {
    if (!roundsBy.has(r.company_id)) roundsBy.set(r.company_id, []);
    roundsBy.get(r.company_id).push(r);
  });
  roundsBy.forEach((rs) => rs.sort((a, b) => a.announced_date.localeCompare(b.announced_date)));
  const co = companies.map((c) => {
    const rs = roundsBy.get(c.company_id) || [];
    const idx = Math.max(-1, ...rs.map((r) => LADDER.indexOf(r.stage)));
    return {
      ...c,
      rounds: rs,
      highest: idx >= 0 ? LADDER[idx] : (rs.length ? "Other" : "No rounds"),
      highestIdx: idx,
      totalRaised: sum(rs.map((r) => num(r.amount_usd) || 0)),
      lastRound: rs.length ? rs[rs.length - 1].announced_date : "",
      programs: cp.filter((p) => p.company_id === c.company_id).map((p) => p.program_id),
    };
  });
  return { co, coById: new Map(co.map((c) => [c.company_id, c])), rounds, investors, programs, cp };
}

// ---------- charts ----------
function barChart(id, labels, values, { horizontal = false, fmt = (v) => v, yLabel } = {}) {
  if (state.charts[id]) state.charts[id].destroy();
  const ctx = document.getElementById(id);
  const text = css("--text-2"), grid = css("--grid");
  state.charts[id] = new Chart(ctx, {
    type: "bar",
    data: { labels, datasets: [{ label: yLabel || "", data: values, backgroundColor: css("--series-1"), borderRadius: 4, borderSkipped: "start", maxBarThickness: 36 }] },
    options: {
      indexAxis: horizontal ? "y" : "x",
      maintainAspectRatio: false,
      animation: false,
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: (c) => fmt(c.parsed[horizontal ? "x" : "y"]) } },
      },
      scales: {
        x: { ticks: { color: text, ...(horizontal ? { callback: (v) => fmt(v) } : {}) }, grid: { color: horizontal ? grid : "transparent" }, border: { color: grid }, beginAtZero: true },
        y: { ticks: { color: text, ...(horizontal ? {} : { callback: (v) => fmt(v) }) }, grid: { color: horizontal ? "transparent" : grid }, border: { color: grid }, beginAtZero: true },
      },
    },
  });
}

// ---------- tabs ----------
function renderOverview(m) {
  const disclosed = m.rounds.map((r) => num(r.amount_usd)).filter((v) => v != null);
  const active = m.co.filter((c) => c.status === "Active").length;
  const kpis = [
    ["Startups", m.co.length],
    ["Funding rounds", m.rounds.length],
    ["Capital tracked", money(sum(disclosed))],
    ["Median round", money(median(disclosed))],
    ["Investors", m.investors.length],
    ["Programs", m.programs.length],
    ["Still active", m.co.length ? pct(active / m.co.length) : "—"],
  ];
  $("#kpis").innerHTML = kpis.map(([l, v]) => `<div class="kpi"><div class="v">${esc(v)}</div><div class="l">${esc(l)}</div></div>`).join("");

  const byCat = countBy(m.co, (c) => c.category);
  const cats = state.schema.enums.category.filter((c) => byCat.has(c)).sort((a, b) => byCat.get(b) - byCat.get(a));
  barChart("c-category", cats, cats.map((c) => byCat.get(c)), { horizontal: true });
  const bySt = countBy(m.co, (c) => c.status);
  const sts = state.schema.enums.company_status.filter((s) => bySt.has(s));
  barChart("c-status", sts, sts.map((s) => bySt.get(s)));

  const cov = [
    ["Startups with ≥1 funding round", m.co.filter((c) => c.rounds.length).length, m.co.length],
    ["Rounds with disclosed amount", disclosed.length, m.rounds.length],
    ["Rounds with a lead investor", m.rounds.filter((r) => r.lead_investor_ids).length, m.rounds.length],
    ["Rounds marked High confidence", m.rounds.filter((r) => r.confidence === "High").length, m.rounds.length],
    ["Investors with check-size range", m.investors.filter((i) => i.check_size_min_usd && i.check_size_max_usd).length, m.investors.length],
  ];
  table($("#coverage"), [{ label: "Field" }, { label: "Count", num: true }, { label: "Coverage" }],
    cov.map(([l, a, b]) => [esc(l), `${a} / ${b}`, `<div class="bar"><span style="width:${b ? (100 * a) / b : 0}%"></span></div>`]));
}

function renderStartups(m) {
  const fill = (sel, values) => { const el = $(sel); if (el.options.length === 1) values.forEach((v) => el.add(new Option(v, v))); };
  fill("#f-category", state.schema.enums.category);
  fill("#f-status", state.schema.enums.company_status);
  fill("#f-stage", [...LADDER, "No rounds"]);
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
      c.website ? `<a href="${esc(c.website)}" target="_blank" rel="noopener">${esc(c.name)}</a>` : esc(c.name),
      esc(c.category), esc(c.business_model), esc(c.target_customer), esc(c.founded_year), `<span class="pill">${esc(c.status)}</span>`,
      esc(c.highest), money(c.totalRaised || null), esc(c.lastRound), esc(c.programs.join(", ")),
      c.source_url ? `<a href="${esc(c.source_url)}" target="_blank" rel="noopener">link</a>` : "",
    ]));
}

function renderFunding(m) {
  const stages = LADDER.filter((s) => m.rounds.some((r) => r.stage === s));
  const amt = (s) => m.rounds.filter((r) => r.stage === s).map((r) => num(r.amount_usd));
  barChart("c-median-stage", stages, stages.map((s) => median(amt(s))), { fmt: money });
  const val = (s) => m.rounds.filter((r) => r.stage === s).map((r) => num(r.post_money_valuation_usd));
  barChart("c-val-stage", stages, stages.map((s) => median(val(s))), { fmt: money });

  const capCat = new Map();
  m.rounds.forEach((r) => { const c = m.coById.get(r.company_id); if (c) capCat.set(c.category, (capCat.get(c.category) || 0) + (num(r.amount_usd) || 0)); });
  const cats = [...capCat.keys()].sort((a, b) => capCat.get(b) - capCat.get(a));
  barChart("c-cap-category", cats, cats.map((c) => capCat.get(c)), { horizontal: true, fmt: money });

  const byYear = countBy(m.rounds, (r) => r.announced_date.slice(0, 4));
  const years = [...byYear.keys()].sort();
  barChart("c-rounds-year", years, years.map((y) => byYear.get(y)));

  const catsAll = state.schema.enums.category.filter((c) => m.co.some((x) => x.category === c));
  table($("#t-stage-cat"), [{ label: "Category" }, ...stages.map((s) => ({ label: s, num: true }))],
    catsAll.map((cat) => [esc(cat), ...stages.map((s) => {
      const rs = m.rounds.filter((r) => r.stage === s && m.coById.get(r.company_id)?.category === cat);
      return rs.length ? `${money(median(rs.map((r) => num(r.amount_usd))))} <span class="muted">(${rs.length})</span>` : "—";
    })]));
}

function renderProgression(m) {
  const reached = LADDER.map((s, i) => m.co.filter((c) => c.highestIdx >= i).length);
  const used = LADDER.filter((_, i) => reached[i] > 0);
  barChart("c-funnel", used, used.map((s) => reached[LADDER.indexOf(s)]));

  const gaps = [];
  for (let i = 0; i < LADDER.length - 1; i++) {
    const from = LADDER[i], to = LADDER[i + 1];
    const ms = m.co.map((c) => {
      const a = c.rounds.find((r) => r.stage === from), b = c.rounds.find((r) => r.stage === to);
      return a && b ? monthsBetween(a.announced_date, b.announced_date) : null;
    }).filter((v) => v != null);
    if (ms.length) gaps.push([`${from} → ${to}`, median(ms), ms.length]);
  }
  barChart("c-gap", gaps.map((g) => g[0]), gaps.map((g) => Math.round(g[1] * 10) / 10), { fmt: (v) => `${v} mo` });

  const conv = [];
  for (let i = 0; i < LADDER.length - 1; i++) {
    const base = m.co.filter((c) => c.rounds.some((r) => r.stage === LADDER[i]));
    if (!base.length) continue;
    const next = base.filter((c) => c.highestIdx > i);
    conv.push([LADDER[i], LADDER[i + 1], base.length, next.length, next.length / base.length]);
  }
  table($("#t-conversion"), [{ label: "From" }, { label: "To" }, { label: "Raised from-stage", num: true }, { label: "Later raised next", num: true }, { label: "Conversion", num: true }, { label: "" }],
    conv.map(([a, b, n, k, r]) => [esc(a), esc(b), n, k, pct(r), `<div class="bar"><span style="width:${r * 100}%"></span></div>`]));

  const statuses = state.schema.enums.company_status.filter((s) => m.co.some((c) => c.status === s));
  const groups = [...LADDER, "Other", "No rounds"].filter((g) => m.co.some((c) => c.highest === g));
  table($("#t-outcome"), [{ label: "Highest stage" }, { label: "Startups", num: true }, ...statuses.map((s) => ({ label: s, num: true }))],
    groups.map((g) => {
      const cs = m.co.filter((c) => c.highest === g);
      return [esc(g), cs.length, ...statuses.map((s) => { const n = cs.filter((c) => c.status === s).length; return n ? `${n} <span class="muted">(${pct(n / cs.length)})</span>` : "—"; })];
    }));
}

function renderInvestors(m) {
  const fill = (sel, values) => { const el = $(sel); if (el.options.length === 1) values.forEach((v) => el.add(new Option(v, v))); };
  fill("#fi-type", state.schema.enums.investor_type);
  fill("#fi-stage", state.schema.enums.stage);
  const q = $("#fi-search").value.toLowerCase(), type = $("#fi-type").value, stage = $("#fi-stage").value;
  const stats = m.investors.map((inv) => {
    const leads = m.rounds.filter((r) => splitList(r.lead_investor_ids).includes(inv.investor_id));
    const parts = m.rounds.filter((r) => splitList(r.participant_investor_ids).includes(inv.investor_id));
    const all = [...leads, ...parts];
    const cats = countBy(all, (r) => m.coById.get(r.company_id)?.category);
    const topCats = [...cats.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([c]) => c);
    const companies = new Set(all.map((r) => r.company_id));
    return { inv, deals: all.length, leads: leads.length, companies: companies.size, topCats,
      stagesSeen: [...new Set(all.map((r) => r.stage))].sort((a, b) => LADDER.indexOf(a) - LADDER.indexOf(b)) };
  }).filter((s) =>
    (!q || s.inv.name.toLowerCase().includes(q)) && (!type || s.inv.type === type) &&
    (!stage || splitList(s.inv.stages).includes(stage) || s.stagesSeen.includes(stage))
  ).sort((a, b) => b.deals - a.deals || b.leads - a.leads);
  table($("#t-investors"),
    [{ label: "Investor" }, { label: "Type" }, { label: "Deals", num: true }, { label: "Leads", num: true }, { label: "Portfolio cos.", num: true }, { label: "Check size" }, { label: "Stated stages" }, { label: "Stages seen in data" }, { label: "Top categories (data)" }],
    stats.map((s) => [
      s.inv.website ? `<a href="${esc(s.inv.website)}" target="_blank" rel="noopener">${esc(s.inv.name)}</a>` : esc(s.inv.name),
      esc(s.inv.type), s.deals, s.leads, s.companies,
      s.inv.check_size_min_usd || s.inv.check_size_max_usd ? `${money(num(s.inv.check_size_min_usd))} – ${money(num(s.inv.check_size_max_usd))}` : "—",
      esc(splitList(s.inv.stages).join(", ")), esc(s.stagesSeen.join(", ")), esc(s.topCats.join(", ")),
    ]));
}

function renderPrograms(m) {
  const seriesAIdx = LADDER.indexOf("Series A");
  const outcome = (cs) => ({
    n: cs.length,
    toA: cs.length ? cs.filter((c) => c.highestIdx >= seriesAIdx).length / cs.length : null,
    alive: cs.length ? cs.filter((c) => ["Active", "Acquired", "IPO"].includes(c.status)).length / cs.length : null,
    medRaised: median(cs.map((c) => c.totalRaised || null)),
  });
  table($("#t-programs"),
    [{ label: "Program" }, { label: "Type" }, { label: "Investment", num: true }, { label: "Equity", num: true }, { label: "Implied valuation", num: true }, { label: "Length (wks)", num: true }, { label: "Batch size", num: true }, { label: "Support" }, { label: "Alumni in DB", num: true }, { label: "Reached Series A", num: true }, { label: "Median raised", num: true }],
    m.programs.map((p) => {
      const inv = num(p.investment_usd), eq = num(p.equity_pct);
      const o = outcome(m.co.filter((c) => c.programs.includes(p.program_id)));
      return [
        `${esc(p.name)}${p.model_summary ? `<div class="muted">${esc(p.model_summary)}</div>` : ""}`, esc(p.type),
        money(inv), eq == null ? "—" : `${eq}%`, inv && eq ? money(inv / (eq / 100)) : "—",
        esc(p.program_length_weeks || "—"), esc(p.avg_batch_size || "—"), esc(splitList(p.support_offered).join(", ")),
        o.n, pct(o.toA), money(o.medRaised),
      ];
    }));
  const alumni = m.co.filter((c) => c.programs.length), others = m.co.filter((c) => !c.programs.length);
  const rows = [["Program alumni", outcome(alumni)], ["Not in a tracked program", outcome(others)]];
  table($("#t-alumni"), [{ label: "Group" }, { label: "Startups", num: true }, { label: "Reached Series A+", num: true }, { label: "Active / acquired / IPO", num: true }, { label: "Median total raised", num: true }],
    rows.map(([l, o]) => [esc(l), o.n, pct(o.toA), pct(o.alive), money(o.medRaised)]));
}

// ---------- validation (mirrors scripts/validate.py) ----------
const ID_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/, DATE_RE = /^\d{4}-\d{2}-\d{2}$/, URL_RE = /^https?:\/\/\S+$/;
function checkValue(col, v) {
  const E = state.schema.enums;
  switch (col.type) {
    case "id": return ID_RE.test(v) ? null : `'${v}' is not a lowercase slug`;
    case "int": case "number": {
      const ok = col.type === "int" ? /^-?\d+$/.test(v) : v !== "" && !isNaN(+v);
      if (!ok) return `'${v}' is not a${col.type === "int" ? "n integer" : " number"} (no $, commas or 'M')`;
      if (col.min != null && +v < col.min) return `${v} is below minimum ${col.min}`;
      if (col.max != null && +v > col.max) return `${v} is above maximum ${col.max}`;
      return null;
    }
    case "date": {
      if (!DATE_RE.test(v)) return `'${v}' is not YYYY-MM-DD`;
      const d = new Date(v + "T00:00:00Z");
      if (isNaN(d) || d.toISOString().slice(0, 10) !== v) return `'${v}' is not a real date`;
      if (d > new Date()) return `${v} is in the future`;
      return null;
    }
    case "url": return URL_RE.test(v) ? null : `'${v}' is not an http(s) URL`;
    case "enum": return E[col.enum].includes(v) ? null : `'${v}' must be one of: ${E[col.enum].join(", ")}`;
    case "enum_list": { const bad = splitList(v).filter((x) => !E[col.enum].includes(x)); return bad.length ? `${bad.join(", ")} not in ${col.enum}` : null; }
    case "ref_list": { const bad = splitList(v).filter((x) => !ID_RE.test(x)); return bad.length ? `${bad.join(", ")} are not valid ids` : null; }
    default: return null;
  }
}
function validateRows(tableName, header, rows) {
  const t = state.schema.tables[tableName], errors = [];
  const expected = t.all_columns.map((c) => c.name);
  const missing = expected.filter((c) => !header.includes(c)), extra = header.filter((c) => !expected.includes(c));
  if (missing.length) errors.push(["header", `missing columns: ${missing.join(", ")}`]);
  if (extra.length) errors.push(["header", `unknown columns: ${extra.join(", ")}`]);
  const pk = Array.isArray(t.primary_key) ? t.primary_key : [t.primary_key];
  const seen = new Map();
  const knownIds = (ref) => new Set((state.tables[ref] || []).map((r) => r[state.schema.tables[ref].primary_key]).concat(ref === tableName ? rows.map((r) => r[t.primary_key]) : []));
  rows.forEach((row, i) => {
    const line = i + 2;
    t.all_columns.forEach((col) => {
      const v = row[col.name] || "";
      if (!v) { if (col.required) errors.push([line, `'${col.name}' is required`]); return; }
      const msg = checkValue(col, v);
      if (msg) errors.push([line, `${col.name}: ${msg}`]);
      if (col.type === "ref" || col.type === "ref_list") {
        const ids = knownIds(col.ref);
        (col.type === "ref" ? [v] : splitList(v)).forEach((x) => { if (!ids.has(x)) errors.push([line, `${col.name}: '${x}' not found in ${col.ref} (add it there first)`]); });
      }
    });
    const key = pk.map((c) => row[c] || "").join("|");
    if (pk.every((c) => row[c])) { if (seen.has(key)) errors.push([line, `duplicate key ${key} (first on line ${seen.get(key)})`]); else seen.set(key, line); }
    if (tableName === "companies" && row.status === "Acquired" && !row.acquirer) errors.push([line, "status is Acquired but 'acquirer' is empty"]);
    if (tableName === "investors" && num(row.check_size_min_usd) != null && num(row.check_size_max_usd) != null && +row.check_size_min_usd > +row.check_size_max_usd)
      errors.push([line, "check_size_min_usd > check_size_max_usd"]);
  });
  return errors;
}

function setupImport() {
  const sel = $("#imp-table");
  Object.entries(state.schema.tables).forEach(([k, t]) => sel.add(new Option(`${t.label} (${t.file})`, k)));
  const fields = () => {
    const t = state.schema.tables[sel.value];
    table($("#imp-fields"), [{ label: "Column" }, { label: "Type" }, { label: "Required" }, { label: "Rules / notes" }],
      t.all_columns.map((c) => [`<code>${esc(c.name)}</code>`, esc(c.type), c.required ? "yes" : "",
        esc([c.enum ? "One of: " + state.schema.enums[c.enum].join(" | ") : "", c.ref ? `Must exist in ${c.ref}` : "", c.doc || ""].filter(Boolean).join(" · "))]));
  };
  sel.addEventListener("change", () => { fields(); $("#imp-result").innerHTML = ""; $("#imp-file").value = ""; });
  fields();
  $("#imp-template").addEventListener("click", () => {
    const t = state.schema.tables[sel.value];
    downloadCsv(t.file, t.all_columns.map((c) => c.name), []);
  });
  $("#imp-file").addEventListener("change", (e) => {
    const file = e.target.files[0];
    if (!file) return;
    Papa.parse(file, {
      header: true, skipEmptyLines: "greedy", transformHeader: (h) => h.trim(),
      complete: (res) => {
        const rows = res.data.map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, (v ?? "").trim()])));
        const errors = validateRows(sel.value, res.meta.fields || [], rows);
        const out = $("#imp-result");
        if (!errors.length) {
          out.innerHTML = `<p class="ok"><strong>✓ ${rows.length} rows pass every check.</strong> Commit this file to <code>data/${esc(state.schema.tables[sel.value].file)}</code> in a pull request.</p>
            <button id="imp-preview" class="primary">Preview in dashboard (this tab only)</button>`;
          $("#imp-preview").addEventListener("click", () => {
            const t = state.schema.tables[sel.value], pk = Array.isArray(t.primary_key) ? t.primary_key : [t.primary_key];
            const key = (r) => pk.map((c) => r[c]).join("|");
            const incoming = new Set(rows.map(key));
            state.tables[sel.value] = [...(state.tables[sel.value] || []).filter((r) => !incoming.has(key(r))), ...rows];
            renderAll();
            $("#dataset-badge").textContent += " + local import (not saved)";
          });
        } else {
          out.innerHTML = `<p class="err"><strong>✗ ${errors.length} problem(s) in ${rows.length} rows.</strong> Fix them in your sheet and re-export.</p><div class="table-wrap"><table id="imp-errors"></table></div>`;
          table($("#imp-errors"), [{ label: "Line" }, { label: "Problem" }], errors.slice(0, 500).map(([l, msg]) => [esc(l), esc(msg)]));
        }
      },
    });
  });
}

// ---------- wiring ----------
function renderAll() {
  const m = model();
  renderOverview(m); renderStartups(m); renderFunding(m); renderProgression(m); renderInvestors(m); renderPrograms(m);
  state.model = m;
}

async function main() {
  document.querySelectorAll(".tabs button").forEach((b) => b.addEventListener("click", () => {
    document.querySelectorAll(".tabs button").forEach((x) => x.classList.toggle("active", x === b));
    document.querySelectorAll(".tab").forEach((t) => t.classList.toggle("active", t.id === "tab-" + b.dataset.tab));
  }));
  try {
    await load();
  } catch (err) {
    document.querySelector("main").innerHTML = `<div class="card err"><strong>Could not load data.</strong> ${esc(err.message)}<br>
      Open this page through a web server (e.g. <code>python3 -m http.server</code> then http://localhost:8000), not by double-clicking the file.</div>`;
    return;
  }
  $("#sample-banner").hidden = !state.isSample;
  $("#dataset-badge").textContent = state.isSample ? "Dataset: SAMPLE (fictional)" : "Dataset: data/";
  ["#f-search", "#f-category", "#f-status", "#f-stage"].forEach((s) => $(s).addEventListener("input", () => renderStartups(state.model)));
  ["#fi-search", "#fi-type", "#fi-stage"].forEach((s) => $(s).addEventListener("input", () => renderInvestors(state.model)));
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
