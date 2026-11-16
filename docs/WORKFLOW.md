# Team Workflow

How up to 10 students research, enter, review and publish data in 30 days.

## 1. What this project is (and isn't)

It is a **research database plus analytics**. Students collect public facts about AI startups,
investors, rounds and accelerators, and enter them by hand. The dashboard turns those rows into
the deliverables (database, investor list, accelerator report, market report, dashboard).

It is **not** an API integration. Nothing is pulled automatically from Crunchbase, PitchBook or
LinkedIn: most of those need paid licences and their terms forbid bulk scraping. So data quality
depends on the process below: a fixed schema, a source for every row, automatic checks, and peer review.

```
 research (web)  →  Google Sheet / CSV  →  Pull request  →  CI validate  →  peer review  →  merge  →  dashboard
                     (one tab per table)                   (schema.json)   (1 reviewer)              (GitHub Pages)
```

## 2. Roles

| Role | People | Owns |
|---|---|---|
| Project lead | 1 | Scope, schedule, weekly check-in, final report |
| Data steward | 1 | `schema/schema.json`, merges PRs, dedup, enum changes |
| Pod 1 – Startup Landscape | 2–3 | `companies.csv`, `company_programs.csv` |
| Pod 2 – Funding & Investors | 2–3 | `funding_rounds.csv`, `investors.csv` |
| Pod 3 – Success & Failure | 1–2 | `status`, `status_date`, `acquirer`; follow-on rounds for older cohorts |
| Pod 4 – Accelerators & Studios | 1–2 | `programs.csv`, the comparison write-up for Kampus.vc |

One person can hold two roles. Every PR needs one reviewer from a **different** pod.

## 3. 30-day plan

| Week | Goal | Exit criteria |
|---|---|---|
| **0 (days 1–3)** Setup | Everyone has repo access, reads this doc + `DATA_DICTIONARY.md`, makes one practice PR with 3 rows | 10 practice PRs merged; schema frozen v0.1 |
| **1 (days 4–10)** Seed list | Pod 1 builds the startup universe (e.g. recent YC AI batches + 2–3 other accelerators); Pod 4 lists 10–15 programs | ≥150 companies, ≥10 programs, all with source |
| **2 (days 11–17)** Funding | Pod 2 adds every known round for those companies and creates investors as they appear | ≥300 rounds, ≥100 investors; coverage panel ≥70% disclosed |
| **3 (days 18–24)** Outcomes + QA | Pod 3 fills status/exits; everyone does cross-checks (§6) | No Low-confidence rows without a note; duplicates resolved |
| **4 (days 25–30)** Analysis | Freeze data (tag `v1.0`), write the market report and accelerator report from the dashboard | Report + dashboard link delivered to Kampus.vc |

Targets are guides; adjust in the week 1 check-in once you know the pace (a good rate is ~15–25 rows per person-hour after practice).

## 4. Daily loop for a researcher

1. Pick a batch from the tracker (GitHub Issues, one issue per batch, e.g. *"YC W24 AI companies 1–25"*). Assign yourself.
2. Research. Preferred sources, in order: company press release / blog → SEC Form D → reputable press (TechCrunch, Axios Pro Rata) → Crunchbase/PitchBook **public** pages → YC directory / accelerator sites.
3. Enter rows in the team workbook (Excel / Google Sheets). Start from the template on the dashboard's **Import Excel** tab, or keep your own layout; the importer maps common header names automatically.
4. Drop the workbook on the **Import Excel** tab. Check *How each sheet was read*, then fix everything under *things to fix*.
5. Click the per-table CSV buttons, put the files in `data/` on a branch `data/<your-name>/<batch>`, and open a PR with the template filled in.
   (The data steward can do this step for the whole team once a day if researchers prefer to stay in Excel.)
6. CI runs `scripts/validate.py`. Red = fix it. Green = ask a reviewer.

## 5. Data rules (the ones that matter most)

- **No source, no row.** `source_url` must be a public page that states the fact.
- **Never guess numbers.** Undisclosed amount → leave blank. Estimate from a reliable outlet → fill it, `confidence = Low`, explain in `notes`.
- **USD integers.** `3500000`, not `$3.5M` or `3,500,000`. Convert foreign currency at the announcement-date rate and note it.
- **Dates are `YYYY-MM-DD`.** Only month known → use the 1st and write "month only" in `notes`.
- **IDs are permanent.** `company_id` = lowercase name slug (`acme-ai`). If two companies collide, add a suffix (`acme-ai-2`). Rounds: `<company_id>-<stage>` (`acme-ai-series-a`); second round of the same stage gets `-2`.
- **One primary category.** Use `sub_category` for detail. Need a new category? Open an issue for the data steward; don't use one the schema doesn't have.
- **Public business information only.** No personal emails, phone numbers or home addresses of founders/angels.
- **Respect site terms.** Don't run scrapers against Crunchbase, PitchBook or LinkedIn; copy facts by hand and cite the page.

## 6. Quality checks (week 3, and before every report)

| Check | How |
|---|---|
| Schema / types / foreign keys | CI (`scripts/validate.py`) — automatic |
| Duplicates | Sort `companies.csv` by name and website; merge, keep the older id |
| Spot-check | Each reviewer opens 10% of `source_url`s in the PR and confirms the number |
| Coverage | Dashboard → Overview → *Data coverage*. Fill gaps before analysis |
| Outliers | Dashboard → Funding → stage × category table; anything 10× the median gets re-checked |

## 7. Git conventions

- `main` is always valid and is what the dashboard shows. Nobody pushes to it directly; enable branch protection with "require status checks".
- Branch names: `data/<name>/<batch>`, `feat/<thing>` for dashboard/code, `schema/<change>` for schema changes.
- Small PRs (≤ ~50 rows) review fast. Several people adding rows to the same CSV at once can cause merge conflicts; if you get one, keep **both** sides' rows and re-run the validator.
- Schema changes (new column or enum value) only through the data steward: edit `schema/schema.json`, run `python3 scripts/build_data_dictionary.py`, add the new header column to every CSV in `data/` and `data/sample/`.

## 8. Definition of done per deliverable

| Deliverable (from the brief) | Where it lives | Done when |
|---|---|---|
| AI Startup Intelligence Database | `data/companies.csv` + `funding_rounds.csv`, Startups tab (search, filter, export) | Target counts hit, CI green, QA checks done |
| Investor Intelligence Database | `data/investors.csv`, Investors tab | Every investor referenced in a round exists; check sizes filled for ≥60% |
| Accelerator & Venture Studio Report | `programs.csv`, Accelerators tab + 2–3 page write-up | ≥10 programs with terms; studio vs accelerator comparison written |
| AI Market Intelligence Report | Written from the Funding + Success & Failure tabs | Each claim cites a chart or table; sample size stated |
| Interactive Analytics Dashboard | `index.html` on GitHub Pages | Loads real data, no sample banner |
