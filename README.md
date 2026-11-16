# AI Startup & VC Intelligence — MVP

Research database + analytics dashboard for the **Baylor AI Society × Kampus.vc** 30-day project.
Students enter public data on AI startups, funding rounds, investors and accelerators; the
dashboard turns it into the project deliverables.

There's no backend and no paid API. The data lives in CSV files in this repo, the rules live in one JSON schema, and the dashboard is a static page.

```
schema/schema.json        ← single source of truth: tables, columns, allowed values
schema/import_rules.json  ← how messy Excel headers/values map onto the schema (extend freely)
data/*.csv                ← the real research data (starts empty: headers only)
data/excel/ + sources.json← team Excel files the dashboard auto-loads from the repo
data/sample/*.csv         ← FICTIONAL demo data, shown only while data/ is empty
scripts/validate.py       ← checks every CSV against the schema (also runs in CI)
index.html + assets/      ← dashboard: insights, startups, funding, success/failure, investors, programs, Excel import
examples/*.xlsx           ← FICTIONAL messy workbooks to try the importer with
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

No installs needed: Python 3.9+ standard library. The page loads Chart.js, PapaParse and SheetJS from cdnjs.

## Importing Excel (fastest way to see charts)

Open the **Import Excel** tab and drop one or more `.xlsx / .xls / .csv` files. Any of these work:

- one sheet per table (Startups / Funding Rounds / Investors / Accelerators), in any order and with any reasonable header names
- a single flat sheet, e.g. a Crunchbase export (`Organization Name`, `Last Funding Type`, `Total Funding Amount`, `Top 5 Investors`…)
- title rows above the header, Excel dates, `$3.5M`, `500K`, `Amount ($M)` columns, `7%`, `Series-A`, `seed round`, `Q3 2023`

The importer explains how it read every sheet (which column → which field), lists what it cleaned up automatically, and lists what's still
missing for the official database. The dashboard updates right away. **The import is saved in that browser and auto-loads next time.**

Ways to make it load automatically:

| Where the Excel lives | How |
|---|---|
| Your laptop | Drop it once; it stays in this browser (IndexedDB) until you click *Stop using it* |
| Google Sheets / OneDrive / Dropbox | Paste a public share link on the Import tab with *re-load on every visit* ticked. Google Sheets: *File → Share → Publish to web → .xlsx*. SharePoint often blocks browsers; download and drop instead |
| The repo (whole team sees it) | Commit it to `data/excel/` and add its path to `excel_files` in `data/sources.json` |

A header the importer doesn't know? Add it to `schema/import_rules.json`. Try it with `examples/example_team_tracker.xlsx`
or `examples/example_crunchbase_style_export.xlsx` (both fictional).

To make the import part of the official, reviewed dataset, click **Download cleaned workbook** or the per-table CSV buttons, fix what the
"things to fix" list says (usually `source_url` / `collected_by`), and commit the CSVs to `data/` in a pull request.

## Adding data

1. Fill the team workbook (download the template from the **Import Excel** tab, or keep your own layout). Column meanings: [`docs/DATA_DICTIONARY.md`](docs/DATA_DICTIONARY.md).
2. Drop it on the **Import Excel** tab and fix everything under *things to fix*.
3. Download the cleaned CSVs, put them in `data/` on a branch and open a pull request. CI must be green and one teammate reviews it.

Full process: [`docs/WORKFLOW.md`](docs/WORKFLOW.md).

## Publishing

Settings → Pages → *Deploy from branch* → `main` / root. The dashboard reads `data/` on every load,
so merged PRs show up after Pages redeploys (about a minute).

## Roadmap after the MVP

- Scheduled GitHub Action that pulls the team's shared workbook and opens a PR with the cleaned CSVs
- Per-person contribution stats and a review queue
- Cohort analysis (conversion by founding year / accelerator batch) to correct for young companies
- Move to SQLite/Postgres + a small admin UI if the data grows past ~10k rows or needs edit history per field
