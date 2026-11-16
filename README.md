# AI Startup & VC Intelligence — MVP

Research database + analytics dashboard for the **Baylor AI Society × Kampus.vc** 30-day project.
Students enter public data on AI startups, funding rounds, investors and accelerators; the
dashboard turns it into the project deliverables.

There's no backend and no paid API. The data lives in CSV files in this repo, the rules live in one JSON schema, and the dashboard is a static page.

```
schema/schema.json        ← single source of truth: tables, columns, allowed values
data/*.csv                ← the real research data (starts empty: headers only)
data/sample/*.csv         ← FICTIONAL demo data, shown only while data/ is empty
scripts/validate.py       ← checks every CSV against the schema (also runs in CI)
index.html + assets/      ← dashboard: overview, startups, funding, success/failure, investors, programs, import
docs/WORKFLOW.md          ← team roles, 30-day plan, data rules, review process
docs/DATA_DICTIONARY.md   ← every column explained (generated from the schema)
```

## Data model

```
companies ──< funding_rounds >── investors      (lead_investor_ids / participant_investor_ids, ';'-separated)
    │
    └──< company_programs >── programs          (accelerators, incubators, venture studios)
```

Every row in every table also carries `source_url`, `collected_by`, `collected_at`, `notes`.

## Quick start

```bash
# 1. View the dashboard (needs a local server because it fetches the CSVs)
python3 -m http.server 8000         # then open http://localhost:8000
#    while data/ is empty you see fictional sample data, with a yellow banner
#    force sample data any time with  http://localhost:8000/?data=sample

# 2. Validate data before committing
python3 scripts/validate.py --summary
python3 scripts/validate.py data/sample

# 3. After changing schema/schema.json
python3 scripts/build_data_dictionary.py
```

No installs needed: Python 3.9+ standard library. The page loads Chart.js and PapaParse from cdnjs.

## Adding data

1. Copy the header row of the right `data/*.csv` into a Google Sheet tab (or download a blank template from the **Import / Validate** tab).
2. Fill rows following [`docs/DATA_DICTIONARY.md`](docs/DATA_DICTIONARY.md). Add investors and companies **before** the rounds that reference them.
3. Export CSV → check it on the **Import / Validate** tab → fix errors.
4. Put the rows in `data/<table>.csv` on a branch and open a pull request. CI must be green and one teammate reviews it.

Full process: [`docs/WORKFLOW.md`](docs/WORKFLOW.md).

## Publishing

Settings → Pages → *Deploy from branch* → `main` / root. The dashboard reads `data/` on every load,
so merged PRs show up after Pages redeploys (about a minute).

## Roadmap after the MVP

- Google Sheets → CSV sync with a GitHub Action, so researchers never touch git
- Per-person contribution stats and a review queue
- Cohort analysis (conversion by founding year / accelerator batch) to correct for young companies
- Move to SQLite/Postgres + a small admin UI if the data grows past ~10k rows or needs edit history per field
