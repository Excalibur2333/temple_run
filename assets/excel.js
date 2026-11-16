/* Excel / CSV import engine.
 * Reads any .xlsx/.xls/.csv workbook (SheetJS), figures out which sheet is which table,
 * maps messy headers onto schema columns (schema/import_rules.json), cleans values
 * ("$3.5M" -> 3500000, "series-a" -> "Series A", Excel dates -> YYYY-MM-DD),
 * derives companies/investors/rounds from flat sheets, validates, and can keep the
 * result in IndexedDB so the dashboard auto-loads it next time. */
"use strict";

const Importer = (() => {
  let S = null, R = null; // schema, import rules
  const TABLE_ORDER = ["programs", "investors", "companies", "company_programs", "funding_rounds"];
  const LADDER = ["Pre-Seed", "Seed", "Series A", "Series B", "Series C", "Series D+"];

  // ---------- small utils ----------
  const norm = (s) => String(s ?? "").toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9%]+/g, " ").trim();
  const slug = (s) => String(s ?? "").toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "")
    .replace(/&/g, " and ").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  const isBlank = (v) => v == null || (typeof v === "string" && /^\s*(|-|—|–|n\/?a|na|none|null|undisclosed|unknown|\?|tbd)\s*$/i.test(v));
  const splitNames = (v) => String(v ?? "").split(/[;,|\n]+|\s+&\s+/).map((s) => s.trim()).filter((s) => s && !isBlank(s));
  const pad = (n) => String(n).padStart(2, "0");
  const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const cols = (t) => [...S.tables[t].columns, ...S.provenance];
  const colDef = (t, name) => cols(t).find((c) => c.name === name);

  function init(schema, rules) {
    S = schema; R = rules;
    for (const t of Object.values(S.tables)) t.all_columns = [...t.columns, ...S.provenance];
  }

  // ---------- header mapping ----------
  const headerKey = (h) => norm(String(h ?? "").replace(/\(.*?\)|\[.*?\]/g, " ").replace(/\b(usd|us\$|in (millions|thousands|billions)|\$m|\$k)\b/gi, " "));
  function unitFactor(h) {
    const s = String(h ?? "").toLowerCase();
    const unit = (s.match(/\(([^)]*)\)|\[([^\]]*)\]/) || [])[1] || (s.match(/\bin\s+(millions|thousands|billions)\b/) || [])[1] || "";
    if (/\b(b|bn|billions?)\b/.test(unit)) return 1e9;
    if (/\b(m|mm|mn|millions?)\b|\$\s*m\b/.test(unit)) return 1e6;
    if (/\b(k|thousands?)\b|\$\s*k\b/.test(unit)) return 1e3;
    return 1;
  }
  function aliasIndex(table) {
    const idx = new Map();
    const add = (field, a) => { const k = headerKey(a); if (k && !idx.has(k)) idx.set(k, field); };
    const al = { ...(R.column_aliases[table] || {}), ...R.column_aliases._provenance };
    for (const [field, list] of Object.entries(al)) list.forEach((a) => add(field, a));
    cols(table).forEach((c) => { add(c.name, c.name); add(c.name, c.name.replace(/_/g, " ")); });
    return idx;
  }
  function mapHeaders(table, headers) {
    const idx = aliasIndex(table), used = new Set(), mapping = [];
    headers.forEach((h, i) => {
      const f = idx.get(headerKey(h));
      if (f && !used.has(f)) { used.add(f); mapping.push({ i, header: String(h), field: f, factor: unitFactor(h) }); }
    });
    return mapping;
  }
  function detect(sheetName, aoa) {
    let best = null;
    const sn = norm(sheetName);
    for (let r = 0; r < Math.min(aoa.length, 12); r++) {
      const headers = (aoa[r] || []).map((h) => String(h ?? "").trim());
      if (headers.filter(Boolean).length < 2) continue;
      for (const table of Object.keys(S.tables)) {
        const m = mapHeaders(table, headers);
        const hint = (R.sheet_hints[table] || []).some((h) => sn.includes(h)) ? 1.5 : 0;
        const score = m.length + hint;
        if (m.length >= 2 && (!best || score > best.score)) best = { table, row: r, mapping: m, headers, score };
      }
    }
    return best;
  }

  // ---------- value cleaning ----------
  function toNumber(raw, factor = 1, notes) {
    if (isBlank(raw)) return null;
    if (typeof raw === "number") return raw * factor;
    let s = String(raw).trim().toLowerCase();
    if (/[€£¥₹]|\b(eur|gbp|cny|rmb|inr|jpy|cad|aud)\b/.test(s)) notes?.add("Non-USD amounts kept as written (convert them to USD)", raw);
    s = s.replace(/us\$|usd|\$|€|£|¥|₹|,|\s+|~|≈|approx\.?|\+|%/g, "");
    const m = s.match(/^(-?\d*\.?\d+)(k|thousand|m|mm|mn|million|millions|b|bn|billion|billions)?$/);
    if (!m) return NaN;
    const mult = { k: 1e3, thousand: 1e3, m: 1e6, mm: 1e6, mn: 1e6, million: 1e6, millions: 1e6, b: 1e9, bn: 1e9, billion: 1e9, billions: 1e9 }[m[2]] || factor;
    if (m[2] && notes) notes.add('Converted amounts like "$3.5M" to plain USD', raw);
    return +m[1] * mult;
  }
  function toRange(raw, notes) {
    if (isBlank(raw)) return [null, null];
    const parts = String(raw).split(/\s*(?:-|–|—|to)\s*/i).filter(Boolean);
    if (parts.length === 2) {
      // "$100K - 1M": a suffix on the second part applies to the first if the first has none
      const suf = (parts[1].match(/[kmb]n?$/i) || [""])[0];
      const a = /[kmb]/i.test(parts[0]) ? parts[0] : parts[0] + suf;
      return [toNumber(a, 1, notes), toNumber(parts[1], 1, notes)];
    }
    const v = toNumber(raw, 1, notes);
    return [v, v];
  }
  const MONTHS = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };
  function toDate(raw, notes) {
    if (isBlank(raw)) return null;
    if (raw instanceof Date && !isNaN(raw)) return ymd(raw);
    if (typeof raw === "number") {
      if (raw > 1900 && raw < 2100) { notes?.add("Year-only dates set to Jan 1 of that year", raw); return `${raw}-01-01`; }
      const d = new Date(Math.round((raw - 25569) * 86400 * 1000)); // Excel serial
      return isNaN(d) ? null : d.toISOString().slice(0, 10);
    }
    const s = String(raw).trim();
    let m;
    if ((m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/))) return `${m[1]}-${pad(m[2])}-${pad(m[3])}`;
    if ((m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/))) {
      const y = m[3].length === 2 ? 2000 + +m[3] : +m[3];
      return `${y}-${pad(m[1])}-${pad(m[2])}`; // US order m/d/y
    }
    if ((m = s.match(/^(\d{4})[-/](\d{1,2})$/))) { notes?.add("Month-only dates set to the 1st", s); return `${m[1]}-${pad(m[2])}-01`; }
    if ((m = s.match(/^q([1-4])\s*[-']?\s*(\d{4})$/i) || s.match(/^(\d{4})\s*q([1-4])$/i))) {
      const [q, y] = /^q/i.test(s) ? [m[1], m[2]] : [m[2], m[1]];
      notes?.add("Quarter dates set to the first day of the quarter", s);
      return `${y}-${pad((q - 1) * 3 + 1)}-01`;
    }
    if ((m = s.match(/^(\d{4})$/))) { notes?.add("Year-only dates set to Jan 1 of that year", s); return `${m[1]}-01-01`; }
    if ((m = s.match(/^([a-z]{3})[a-z]*\.?\s+(\d{4})$/i)) && MONTHS[m[1].toLowerCase()] != null) {
      notes?.add("Month-only dates set to the 1st", s);
      return `${m[2]}-${pad(MONTHS[m[1].toLowerCase()] + 1)}-01`;
    }
    const d = new Date(s);
    return isNaN(d) ? undefined : ymd(d);
  }
  function toYear(raw) {
    if (isBlank(raw)) return null;
    if (raw instanceof Date) return raw.getFullYear();
    if (typeof raw === "number") return raw > 1900 && raw < 2100 ? Math.round(raw) : new Date(Math.round((raw - 25569) * 86400000)).getUTCFullYear();
    const m = String(raw).match(/(19|20)\d{2}/);
    return m ? +m[0] : undefined;
  }
  function toStage(raw) {
    const s = norm(raw);
    if (!s) return null;
    if (/pre\s?seed|angel|friends|f and f|preseed/.test(s)) return "Pre-Seed";
    if (/\bseed\b/.test(s)) return "Seed";
    let m = s.match(/series\s?([a-z])\b/) || s.match(/^([a-z])\s?round$/) || s.match(/^round\s?([a-z])$/);
    if (m) { const L = m[1].toUpperCase(); return L <= "C" ? `Series ${L}` : "Series D+"; }
    if (/bridge|convertible|safe\b|note/.test(s)) return "Bridge";
    if (/grant/.test(s)) return "Grant";
    if (/^(a|b|c)$/.test(s)) return `Series ${s.toUpperCase()}`;
    return undefined;
  }
  function toCategory(raw) {
    const s = " " + norm(raw) + " ";
    if (!s.trim()) return null;
    const exact = S.enums.category.find((c) => norm(c) === s.trim());
    if (exact) return exact;
    // category_keywords is in priority order: specific sectors first, generic "AI/SaaS" terms last
    for (const [cat, kws] of R.category_keywords) if (kws.some((k) => s.includes(norm(k)))) return cat;
    return undefined;
  }
  function toEnum(enumName, raw) {
    if (isBlank(raw)) return null;
    if (enumName === "stage") return toStage(raw);
    if (enumName === "category") return toCategory(raw);
    const s = norm(raw);
    const exact = S.enums[enumName].find((v) => norm(v) === s);
    if (exact) return exact;
    const al = (R.value_aliases[enumName] || {});
    if (al[s]) return al[s];
    const hit = Object.keys(al).sort((a, b) => b.length - a.length).find((k) => s.includes(k));
    return hit ? al[hit] : undefined;
  }
  function toUrl(raw) {
    if (isBlank(raw)) return null;
    let s = String(raw).trim().split(/\s+/)[0];
    if (/^www\.|^[a-z0-9-]+(\.[a-z0-9-]+)+(\/.*)?$/i.test(s)) s = "https://" + s.replace(/^\/+/, "");
    return /^https?:\/\/\S+$/i.test(s) ? s : undefined;
  }

  class Notes {
    constructor() { this.map = new Map(); }
    add(msg, example) {
      const e = this.map.get(msg) || { msg, count: 0, examples: new Set() };
      e.count++; if (example != null && e.examples.size < 4) e.examples.add(String(example));
      this.map.set(msg, e);
    }
    list() { return [...this.map.values()].map((e) => ({ ...e, examples: [...e.examples] })); }
  }

  // ---------- building tables ----------
  function newBuilder() {
    const b = { tables: {}, byName: {}, notes: new Notes() };
    Object.keys(S.tables).forEach((t) => { b.tables[t] = new Map(); b.byName[t] = new Map(); });
    return b;
  }
  const pkOf = (t, row) => { const pk = S.tables[t].primary_key; return Array.isArray(pk) ? pk.map((c) => row[c]).join("|") : row[pk]; };
  function upsert(b, t, row) {
    const key = pkOf(t, row);
    const cur = b.tables[t].get(key);
    if (!cur) { b.tables[t].set(key, row); }
    else {
      for (const [k, v] of Object.entries(row)) {
        if (v == null || v === "") continue;
        if (cur[k] == null || cur[k] === "" || (cur.__stub && !row.__stub)) cur[k] = v;
      }
      if (!row.__stub) delete cur.__stub;
    }
    const r = b.tables[t].get(key);
    if (r.name) b.byName[t].set(norm(r.name), key);
    return r;
  }
  function findId(b, t, nameOrId) {
    if (isBlank(nameOrId)) return null;
    const s = String(nameOrId).trim();
    if (b.tables[t].has(s)) return s;
    return b.byName[t].get(norm(s)) || (b.tables[t].has(slug(s)) ? slug(s) : null);
  }
  function guessInvestorType(name) {
    const s = norm(name);
    if (/combinator|techstars|accelerat|500 global|plug and play|incubat/.test(s)) return "Accelerator";
    if (/studio/.test(s)) return "Venture Studio";
    if (/ventures|capital|partners|fund|vc\b|investments|holdings|equity/.test(s)) return "VC";
    if (/^[a-z]+ [a-z]+$/.test(s)) return "Angel";
    return "Other";
  }
  function ensureCompany(b, nameOrId, extra = {}) {
    let id = findId(b, "companies", nameOrId);
    if (!id) {
      id = slug(nameOrId);
      if (!id) return null;
      b.notes.add("Companies created from rounds / participation rows (fill in their details)", nameOrId);
      upsert(b, "companies", { company_id: id, name: String(nameOrId).trim(), __stub: true, ...extra });
    } else if (Object.keys(extra).length) upsert(b, "companies", { company_id: id, ...extra });
    return id;
  }
  function ensureInvestor(b, name) {
    let id = findId(b, "investors", name);
    if (!id) {
      id = slug(name);
      if (!id) return null;
      b.notes.add("Investors created from names in round rows (fill in type, check size, focus)", name);
      upsert(b, "investors", { investor_id: id, name: String(name).trim(), type: guessInvestorType(name), __stub: true });
    }
    return id;
  }
  function ensureProgram(b, name) {
    let id = findId(b, "programs", name);
    if (!id) {
      const clean = String(name).replace(/\b[WSFX]\d{2}\b|\b(19|20)\d{2}\b/g, "").trim();
      id = findId(b, "programs", clean) || slug(clean);
      if (!id) return null;
      if (!b.tables.programs.has(id)) {
        b.notes.add("Programs created from company rows (fill in their terms)", clean);
        upsert(b, "programs", { program_id: id, name: clean, type: toEnum("program_type", clean) || "Accelerator", __stub: true });
      }
    }
    return id;
  }

  // convert one raw cell for a schema column
  function clean(b, table, field, raw, factor) {
    const c = colDef(table, field);
    if (!c) return isBlank(raw) ? null : String(raw).trim();
    const N = b.notes;
    switch (c.type) {
      case "id": return isBlank(raw) ? null : slug(raw);
      case "string": return isBlank(raw) ? null : (raw instanceof Date ? ymd(raw) : String(raw).trim());
      case "url": { const u = toUrl(raw); if (u === undefined) { N.add(`Dropped values in '${field}' that are not links`, raw); return null; } return u; }
      case "date": { const d = toDate(raw, N); if (d === undefined) { N.add(`Could not read dates in '${field}'`, raw); return null; } return d; }
      case "int": case "number": {
        if (field === "founded_year" || field === "year") { const y = toYear(raw); if (y === undefined) N.add(`Could not read years in '${field}'`, raw); return y ?? null; }
        let v = toNumber(raw, factor, N);
        if (v != null && isNaN(v)) { N.add(`Could not read numbers in '${field}'`, raw); return null; }
        if (field === "equity_pct" && v != null && v > 0 && v < 1 && typeof raw === "number") v = v * 100;
        if (field === "equity_pct" && typeof raw === "string" && raw.includes("%")) v = parseFloat(raw);
        if (v != null && c.type === "int") v = Math.round(v);
        if (v != null && factor !== 1 && typeof raw === "number") N.add(`Multiplied '${field}' by the unit in its header`, raw);
        return v;
      }
      case "enum": {
        const v = toEnum(c.enum, raw);
        if (v === undefined) {
          const fallback = S.enums[c.enum].includes("Unknown") ? "Unknown" : S.enums[c.enum].includes("Other") ? "Other" : null;
          N.add(`Unrecognised ${field} values set to '${fallback ?? "blank"}' (add aliases in import_rules.json)`, raw);
          return fallback;
        }
        return v;
      }
      case "enum_list": {
        const vals = splitNames(raw).map((x) => toEnum(c.enum, x));
        if (vals.some((v) => v === undefined)) N.add(`Some ${field} values not recognised`, raw);
        return [...new Set(vals.filter(Boolean))].join(";") || null;
      }
      default: return isBlank(raw) ? null : String(raw).trim();
    }
  }

  function processSheet(b, det, aoa) {
    const { table, row: hr, mapping } = det;
    let rows = 0;
    for (let r = hr + 1; r < aoa.length; r++) {
      const line = aoa[r] || [];
      if (!line.some((v) => !isBlank(v))) continue;
      const rec = {};
      mapping.forEach((m) => { rec[m.field] = { raw: line[m.i], factor: m.factor }; });
      const val = (tbl, f, as = f) => (rec[f] ? clean(b, tbl, as, rec[f].raw, rec[f].factor) : null);
      const rawOf = (f) => (rec[f] ? rec[f].raw : null);
      const prov = {};
      S.provenance.forEach((p) => { const v = val(table, p.name); if (v != null) prov[p.name] = v; });
      rows++;

      if (table === "companies") {
        const name = val("companies", "name");
        const id = val("companies", "company_id") || slug(name);
        if (!id) { b.notes.add("Skipped company rows without a name"); continue; }
        const row = { company_id: id, ...prov };
        S.tables.companies.columns.forEach((c) => { if (c.name !== "company_id") { const v = val("companies", c.name); if (v != null) row[c.name] = v; } });
        if (!row.name) row.name = name || id;
        if (rec.category && !row.sub_category && !isBlank(rawOf("category")) && norm(rawOf("category")) !== norm(row.category)) row.sub_category = String(rawOf("category")).slice(0, 120);
        upsert(b, "companies", row);
        const rStage = rec["round.stage"] ? toStage(rawOf("round.stage")) : null;
        const rAmt = val("funding_rounds", "round.amount_usd", "amount_usd");
        const rDate = val("funding_rounds", "round.announced_date", "announced_date");
        if (rec["round.stage"] && rStage === undefined && !isBlank(rawOf("round.stage"))) b.notes.add("Unrecognised stage values set to 'Unknown'", rawOf("round.stage"));
        if (rStage || rAmt != null || rDate) {
          addRound(b, {
            company_id: id, stage: rStage || "Unknown", announced_date: rDate, amount_usd: rAmt,
            post_money_valuation_usd: val("funding_rounds", "round.post_money_valuation_usd", "post_money_valuation_usd"),
            leads: splitNames(rawOf("round.lead_investor_ids")), parts: splitNames(rawOf("round.participant_investor_ids")),
            source_url: prov.source_url, collected_by: prov.collected_by, collected_at: prov.collected_at,
          });
        }
        if (rec["company_programs.program_id"]) {
          splitNames(rawOf("company_programs.program_id")).forEach((pn) => {
            const pid = ensureProgram(b, pn);
            const bm = String(pn).match(/\b([WSFX])(\d{2})\b/) || String(rawOf("company_programs.batch") ?? "").match(/\b([WSFX])(\d{2})\b/);
            if (pid) upsert(b, "company_programs", { company_id: id, program_id: pid, batch: val("company_programs", "company_programs.batch", "batch") || (bm ? bm[0] : null), year: bm ? 2000 + +bm[2] : null, ...prov });
          });
        }
      } else if (table === "funding_rounds") {
        const cref = rawOf("company_id") ?? rawOf("company.name");
        if (isBlank(cref)) { b.notes.add("Skipped round rows without a company"); continue; }
        const extra = {};
        if (rec["company.category"]) { const c = toCategory(rawOf("company.category")); if (c) extra.category = c; }
        if (rec["company.founded_year"]) { const y = toYear(rawOf("company.founded_year")); if (y) extra.founded_year = y; }
        if (rec["company.hq_city"] && !isBlank(rawOf("company.hq_city"))) extra.hq_city = String(rawOf("company.hq_city")).trim();
        const cid = ensureCompany(b, cref, extra);
        const st = rec.stage ? toStage(rawOf("stage")) : null;
        if (rec.stage && st === undefined && !isBlank(rawOf("stage"))) b.notes.add("Unrecognised stage values set to 'Unknown'", rawOf("stage"));
        addRound(b, {
          round_id: val("funding_rounds", "round_id"), company_id: cid, stage: st || "Unknown",
          announced_date: val("funding_rounds", "announced_date"), amount_usd: val("funding_rounds", "amount_usd"),
          post_money_valuation_usd: val("funding_rounds", "post_money_valuation_usd"), confidence: val("funding_rounds", "confidence"),
          leads: splitNames(rawOf("lead_investor_ids")), parts: splitNames(rawOf("participant_investor_ids")), ...prov,
        });
      } else if (table === "investors") {
        const name = val("investors", "name");
        const id = val("investors", "investor_id") || slug(name);
        if (!id) continue;
        const row = { investor_id: id, ...prov };
        S.tables.investors.columns.forEach((c) => { if (c.name !== "investor_id") { const v = val("investors", c.name); if (v != null) row[c.name] = v; } });
        if (rec.check_size_range) {
          const [lo, hi] = toRange(rawOf("check_size_range"), b.notes);
          if (lo != null && !isNaN(lo) && row.check_size_min_usd == null) row.check_size_min_usd = lo;
          if (hi != null && !isNaN(hi) && row.check_size_max_usd == null) row.check_size_max_usd = hi;
        }
        if (!row.type) row.type = guessInvestorType(row.name || id);
        if (!row.name) row.name = id;
        upsert(b, "investors", row);
      } else if (table === "programs") {
        const name = val("programs", "name");
        const id = val("programs", "program_id") || slug(name);
        if (!id) continue;
        const row = { program_id: id, ...prov };
        S.tables.programs.columns.forEach((c) => { if (c.name !== "program_id") { const v = val("programs", c.name); if (v != null) row[c.name] = v; } });
        if (!row.type) row.type = toEnum("program_type", row.name || "") || "Accelerator";
        if (!row.name) row.name = id;
        upsert(b, "programs", row);
      } else if (table === "company_programs") {
        const cid = ensureCompany(b, rawOf("company_id") ?? rawOf("company.name"));
        const pid = ensureProgram(b, rawOf("program_id") ?? rawOf("program.name"));
        if (cid && pid) upsert(b, "company_programs", { company_id: cid, program_id: pid, batch: val("company_programs", "batch"), year: val("company_programs", "year"), ...prov });
      }
    }
    return rows;
  }

  function addRound(b, r) {
    const leads = r.leads.map((n) => ensureInvestor(b, n)).filter(Boolean);
    const parts = r.parts.map((n) => ensureInvestor(b, n)).filter((id) => id && !leads.includes(id));
    let id = r.round_id || `${r.company_id}-${slug(r.stage)}`;
    const existing = b.tables.funding_rounds.get(id);
    if (!r.round_id && existing && existing.announced_date && r.announced_date && existing.announced_date !== r.announced_date) {
      let n = 2; while (b.tables.funding_rounds.has(`${id}-${n}`)) n++;
      id = `${id}-${n}`;
    }
    const row = { round_id: id, company_id: r.company_id, stage: r.stage, announced_date: r.announced_date, amount_usd: r.amount_usd,
      post_money_valuation_usd: r.post_money_valuation_usd, lead_investor_ids: leads.join(";") || null,
      participant_investor_ids: parts.join(";") || null, confidence: r.confidence || null,
      source_url: r.source_url, collected_by: r.collected_by, collected_at: r.collected_at, notes: r.notes };
    upsert(b, "funding_rounds", row);
  }

  function finish(b) {
    const out = {};
    for (const t of Object.keys(S.tables)) {
      const names = cols(t).map((c) => c.name);
      out[t] = [...b.tables[t].values()].map((r) => {
        const o = {};
        names.forEach((n) => { o[n] = r[n] == null ? "" : String(r[n]); });
        return o;
      });
    }
    out.companies.forEach((c) => {
      if (c.hq_city.includes(",")) {
        const parts = c.hq_city.split(",").map((s) => s.trim()).filter(Boolean);
        if (!c.hq_country && parts.length > 1) c.hq_country = parts[parts.length - 1];
        c.hq_city = parts[0];
      }
      if (!c.category) {
        const guess = toCategory([c.sub_category, c.description].join(" "));
        c.category = guess || "Other";
        b.notes.add(guess ? "Category guessed from description/tags" : "Companies with no category set to 'Other'", c.name);
      }
      if (!c.business_model) c.business_model = "Unknown";
      if (!c.target_customer) c.target_customer = "Unknown";
      if (!c.status) c.status = "Unknown";
    });
    return out;
  }

  // ---------- public: import ----------
  async function importBuffers(files) {
    const b = newBuilder(), sheets = [];
    const pending = [];
    for (const f of files) {
      const wb = XLSX.read(f.buffer, { type: "array", cellDates: true });
      for (const sn of wb.SheetNames) {
        const aoa = XLSX.utils.sheet_to_json(wb.Sheets[sn], { header: 1, raw: true, defval: null, blankrows: false });
        const det = detect(sn, aoa);
        const info = { file: f.name, sheet: sn, rows: Math.max(0, aoa.length - 1) };
        if (!det) { sheets.push({ ...info, table: null, reason: "No recognisable header row (need ≥2 known column names)" }); continue; }
        const mapped = det.mapping.map((m) => ({ header: m.header, field: m.field }));
        const ignored = det.headers.filter((h, i) => h && !det.mapping.some((m) => m.i === i));
        const entry = { ...info, table: det.table, headerRow: det.row + 1, mapped, ignored };
        sheets.push(entry);
        pending.push({ det, aoa, entry });
      }
    }
    pending.sort((a, b2) => TABLE_ORDER.indexOf(a.det.table) - TABLE_ORDER.indexOf(b2.det.table));
    pending.forEach((p) => { p.entry.rows = processSheet(b, p.det, p.aoa); });
    const tables = finish(b);
    return { tables, report: { sheets, notes: b.notes.list(), issues: validate(tables), files: files.map((f) => f.name), at: new Date().toISOString() } };
  }
  async function importFiles(fileList) {
    const files = await Promise.all([...fileList].map(async (f) => ({ name: f.name, buffer: await f.arrayBuffer() })));
    return importBuffers(files);
  }
  function shareLinkToDownload(url) {
    let u = url.trim(), m;
    if ((m = u.match(/docs\.google\.com\/spreadsheets\/d\/([^/]+)/)) && !/\/pub/.test(u)) return `https://docs.google.com/spreadsheets/d/${m[1]}/export?format=xlsx`;
    if (/dropbox\.com/.test(u)) return u.replace(/([?&])dl=0/, "$1dl=1") + (/[?&]dl=/.test(u) ? "" : (u.includes("?") ? "&" : "?") + "dl=1");
    if (/sharepoint\.com|1drv\.ms|onedrive\.live\.com/.test(u) && !/download=1/.test(u)) return u + (u.includes("?") ? "&" : "?") + "download=1";
    return u;
  }
  async function importUrl(url) {
    const dl = shareLinkToDownload(url);
    let res;
    try { res = await fetch(dl, { cache: "no-store", redirect: "follow" }); }
    catch (e) {
      throw new Error("The browser was not allowed to read that link (CORS). For Google Sheets use File → Share → Publish to web → Microsoft Excel (.xlsx) and paste that link. For OneDrive/SharePoint, download the file and drop it here, or commit it to data/excel/.");
    }
    if (!res.ok) throw new Error(`Link returned HTTP ${res.status}. Make sure it is shared publicly ("anyone with the link").`);
    const name = decodeURIComponent((dl.split("?")[0].split("/").pop() || "linked-workbook")) || "linked-workbook";
    return importBuffers([{ name: /\.(xlsx|xls|csv)$/i.test(name) ? name : name + ".xlsx", buffer: await res.arrayBuffer() }]);
  }

  // merge b into a (b wins on key collisions)
  function merge(a, b2) {
    const out = {};
    for (const t of Object.keys(S.tables)) {
      const m = new Map();
      (a[t] || []).forEach((r) => m.set(pkOf(t, r), r));
      (b2[t] || []).forEach((r) => m.set(pkOf(t, r), { ...(m.get(pkOf(t, r)) || {}), ...Object.fromEntries(Object.entries(r).filter(([, v]) => v !== "")) }));
      out[t] = [...m.values()];
    }
    return out;
  }

  // ---------- validation (same rules as scripts/validate.py) ----------
  const ID_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/, DATE_RE = /^\d{4}-\d{2}-\d{2}$/, URL_RE = /^https?:\/\/\S+$/;
  const splitList = (v) => String(v || "").split(";").map((s) => s.trim()).filter(Boolean);
  function checkValue(col, v) {
    const E = S.enums;
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
  // returns [{table, row, key, field, msg, kind}]; kind groups similar messages
  function validate(tables, { header = {} } = {}) {
    const issues = [];
    const ids = {};
    for (const [t, def] of Object.entries(S.tables)) if (!Array.isArray(def.primary_key)) ids[t] = new Set((tables[t] || []).map((r) => r[def.primary_key]));
    for (const [t, def] of Object.entries(S.tables)) {
      const rows = tables[t] || [];
      if (header[t]) {
        const expected = def.all_columns.map((c) => c.name);
        const missing = expected.filter((c) => !header[t].includes(c)), extra = header[t].filter((c) => !expected.includes(c));
        if (missing.length) issues.push({ table: t, row: 1, key: "header", field: "", msg: `missing columns: ${missing.join(", ")}`, kind: "Missing columns" });
        if (extra.length) issues.push({ table: t, row: 1, key: "header", field: "", msg: `unknown columns: ${extra.join(", ")}`, kind: "Unknown columns" });
      }
      const seen = new Map();
      rows.forEach((r, i) => {
        const key = pkOf(t, r) || `row ${i + 2}`;
        const push = (field, msg, kind) => issues.push({ table: t, row: i + 2, key, field, msg, kind });
        def.all_columns.forEach((c) => {
          const v = r[c.name] ?? "";
          if (!v) { if (c.required) push(c.name, `'${c.name}' is required`, `Missing ${c.name}`); return; }
          const m = checkValue(c, String(v));
          if (m) push(c.name, `${c.name}: ${m}`, `Invalid ${c.name}`);
          if (c.type === "ref" || c.type === "ref_list")
            (c.type === "ref" ? [v] : splitList(v)).forEach((x) => { if (!ids[c.ref].has(x)) push(c.name, `${c.name}: '${x}' not found in ${c.ref}`, `Broken link to ${c.ref}`); });
        });
        const k = pkOf(t, r);
        if (k) { if (seen.has(k)) push("", `duplicate key ${k} (first on line ${seen.get(k)})`, "Duplicate keys"); else seen.set(k, i + 2); }
        if (t === "companies" && r.status === "Acquired" && !r.acquirer) push("acquirer", "status is Acquired but 'acquirer' is empty", "Acquired without acquirer");
        if (t === "investors" && r.check_size_min_usd !== "" && r.check_size_max_usd !== "" && r.check_size_min_usd != null && r.check_size_max_usd != null && +r.check_size_min_usd > +r.check_size_max_usd)
          push("check_size_min_usd", "check_size_min_usd > check_size_max_usd", "Check size min > max");
      });
    }
    return issues;
  }

  // ---------- workbooks out ----------
  function templateWorkbook() {
    const wb = XLSX.utils.book_new();
    const readme = [
      ["AI Startup & VC Intelligence — data entry template"],
      [""],
      ["One sheet per table. Keep the header row. Add investors/programs before rounds that mention them (or just type their names; the importer creates them)."],
      ["Money: plain USD numbers or $3.5M / 500K style. Dates: YYYY-MM-DD (Excel dates also work). Lists: separate with ; or ,"],
      ["Every row should have source_url (public link), collected_by (your name), collected_at (date researched)."],
      ["Allowed values for dropdown-like columns are on the 'Allowed values' sheet."],
      ["Drop the finished file on the dashboard's Import tab, or commit it to data/excel/ and list it in data/sources.json."],
    ];
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(readme), "README");
    for (const [t, def] of Object.entries(S.tables)) {
      const ws = XLSX.utils.aoa_to_sheet([def.all_columns.map((c) => c.name)]);
      ws["!cols"] = def.all_columns.map((c) => ({ wch: Math.max(14, c.name.length + 2) }));
      XLSX.utils.book_append_sheet(wb, ws, def.label.slice(0, 31));
    }
    const enums = Object.entries(S.enums);
    const height = Math.max(...enums.map(([, v]) => v.length));
    const aoa = [enums.map(([k]) => k)];
    for (let i = 0; i < height; i++) aoa.push(enums.map(([, v]) => v[i] || ""));
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), "Allowed values");
    return wb;
  }
  function cleanedWorkbook(tables, issues = []) {
    const wb = XLSX.utils.book_new();
    for (const [t, def] of Object.entries(S.tables)) {
      const header = def.all_columns.map((c) => c.name);
      const ws = XLSX.utils.aoa_to_sheet([header, ...(tables[t] || []).map((r) => header.map((h) => r[h] ?? ""))]);
      XLSX.utils.book_append_sheet(wb, ws, def.label.slice(0, 31));
    }
    if (issues.length) XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["table", "row", "key", "problem"], ...issues.map((i) => [i.table, i.row, i.key, i.msg])]), "Issues to fix");
    return wb;
  }

  // ---------- browser persistence (IndexedDB) ----------
  const DB = "ai-vc-intel", STORE = "kv";
  function idb() {
    return new Promise((res, rej) => {
      const r = indexedDB.open(DB, 1);
      r.onupgradeneeded = () => r.result.createObjectStore(STORE);
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
  }
  async function idbDo(mode, fn) {
    const db = await idb();
    return new Promise((res, rej) => {
      const tx = db.transaction(STORE, mode), req = fn(tx.objectStore(STORE));
      tx.oncomplete = () => res(req && req.result);
      tx.onerror = () => rej(tx.error);
    });
  }
  const store = {
    async load() { try { return await idbDo("readonly", (s) => s.get("dataset")); } catch { return null; } },
    async save(v) { try { await idbDo("readwrite", (s) => s.put(v, "dataset")); return true; } catch { return false; } },
    async clear() { try { await idbDo("readwrite", (s) => s.delete("dataset")); } catch { /* storage unavailable */ } },
  };

  return { init, importFiles, importBuffers, importUrl, merge, validate, templateWorkbook, cleanedWorkbook, store, aliasesFor: (t) => {
    const al = { ...(R.column_aliases[t] || {}), ...R.column_aliases._provenance }; return al;
  }, LADDER, _test: { toNumber, toDate, toStage, toCategory, toEnum, toRange, unitFactor, headerKey } };
})();
