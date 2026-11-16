# Data Dictionary

_Generated from `schema/schema.json` by `scripts/build_data_dictionary.py`. Do not edit by hand._

General rules: money is plain USD numbers (`3500000`, not `$3.5M`); dates are `YYYY-MM-DD`;
lists are separated by `;`; ids are lowercase slugs (`acme-ai`) and never change once created.

## `companies.csv` — AI Startups

Primary key: `company_id`

| Column | Type | Required | Rules / notes |
|---|---|---|---|
| `company_id` | id | yes | Lowercase slug, e.g. acme-ai. Never changes once created. |
| `name` | string | yes |  |
| `website` | url |  |  |
| `category` | enum | yes | One of: `AI Agents`, `Enterprise AI`, `Healthcare AI`, `Cybersecurity AI`, `FinTech AI`, `Developer Tools`, `AI Infrastructure`, `Vertical AI`, `Consumer AI`, `Other`<br>Primary category. Pick one. |
| `sub_category` | string |  | Free text, e.g. 'legal AI', 'code review'. |
| `business_model` | enum | yes | One of: `B2B SaaS`, `Usage-based API`, `Open Core`, `Marketplace`, `B2C Subscription`, `Services`, `Hardware`, `Other`, `Unknown` |
| `target_customer` | enum | yes | One of: `Enterprise`, `SMB`, `Developers`, `Consumers`, `Government`, `Healthcare Providers`, `Financial Institutions`, `Other`, `Unknown` |
| `founded_year` | int |  | Range 1990–2030 |
| `hq_city` | string |  |  |
| `hq_country` | string |  | ISO-3166 alpha-2, e.g. US. |
| `status` | enum | yes | One of: `Active`, `Acquired`, `Shut Down`, `Inactive`, `IPO`, `Unknown` |
| `status_date` | date |  | When status last changed (acquisition / shutdown date). |
| `acquirer` | string |  |  |
| `description` | string |  | One sentence: what they sell to whom. |
| `total_funding_usd` | number |  | Range 0–<br>Reported total raised (e.g. from a Crunchbase export). The dashboard uses the larger of this and the sum of known rounds. |
| `source_url` | url | yes | Public page that backs the row (press release, Crunchbase/PitchBook page, company blog, SEC filing). |
| `collected_by` | string | yes | GitHub handle or initials of the student who entered the row. |
| `collected_at` | date | yes | Date the row was researched, YYYY-MM-DD. |
| `notes` | string |  | Anything a reviewer should know (conflicting sources, estimates). |

## `investors.csv` — Investors

Primary key: `investor_id`

| Column | Type | Required | Rules / notes |
|---|---|---|---|
| `investor_id` | id | yes |  |
| `name` | string | yes |  |
| `type` | enum | yes | One of: `Angel`, `Syndicate`, `Micro-VC`, `VC`, `Corporate VC`, `Accelerator`, `Venture Studio`, `Other` |
| `website` | url |  |  |
| `hq_city` | string |  |  |
| `hq_country` | string |  |  |
| `focus_categories` | enum_list |  | One of: `AI Agents`, `Enterprise AI`, `Healthcare AI`, `Cybersecurity AI`, `FinTech AI`, `Developer Tools`, `AI Infrastructure`, `Vertical AI`, `Consumer AI`, `Other`<br>Semicolon-separated, e.g. AI Agents;Developer Tools |
| `stages` | enum_list |  | One of: `Pre-Seed`, `Seed`, `Series A`, `Series B`, `Series C`, `Series D+`, `Bridge`, `Grant`, `Unknown`<br>Stages they typically invest in. |
| `check_size_min_usd` | number |  | Range 0– |
| `check_size_max_usd` | number |  | Range 0– |
| `fund_size_usd` | number |  | Range 0– |
| `source_url` | url | yes | Public page that backs the row (press release, Crunchbase/PitchBook page, company blog, SEC filing). |
| `collected_by` | string | yes | GitHub handle or initials of the student who entered the row. |
| `collected_at` | date | yes | Date the row was researched, YYYY-MM-DD. |
| `notes` | string |  | Anything a reviewer should know (conflicting sources, estimates). |

## `funding_rounds.csv` — Funding Rounds

Primary key: `round_id`

| Column | Type | Required | Rules / notes |
|---|---|---|---|
| `round_id` | id | yes | Convention: <company_id>-<stage-slug>[-n], e.g. acme-ai-seed |
| `company_id` | ref | yes | Must exist in `companies` |
| `stage` | enum | yes | One of: `Pre-Seed`, `Seed`, `Series A`, `Series B`, `Series C`, `Series D+`, `Bridge`, `Grant`, `Unknown` |
| `announced_date` | date | yes | YYYY-MM-DD; use YYYY-MM-01 if only the month is known and say so in notes. |
| `amount_usd` | number |  | Range 0–<br>Leave blank if undisclosed. Never guess. |
| `post_money_valuation_usd` | number |  | Range 0– |
| `lead_investor_ids` | ref_list |  | Must exist in `investors` |
| `participant_investor_ids` | ref_list |  | Must exist in `investors` |
| `confidence` | enum | yes | One of: `High`, `Medium`, `Low` |
| `source_url` | url | yes | Public page that backs the row (press release, Crunchbase/PitchBook page, company blog, SEC filing). |
| `collected_by` | string | yes | GitHub handle or initials of the student who entered the row. |
| `collected_at` | date | yes | Date the row was researched, YYYY-MM-DD. |
| `notes` | string |  | Anything a reviewer should know (conflicting sources, estimates). |

## `programs.csv` — Accelerators & Venture Studios

Primary key: `program_id`

| Column | Type | Required | Rules / notes |
|---|---|---|---|
| `program_id` | id | yes |  |
| `name` | string | yes |  |
| `type` | enum | yes | One of: `Accelerator`, `Incubator`, `Venture Studio`, `University Program`, `Other` |
| `website` | url |  |  |
| `hq_country` | string |  |  |
| `investment_usd` | number |  | Range 0–<br>Standard check per company. |
| `equity_pct` | number |  | Range 0–100<br>Standard equity taken, 0-100. |
| `program_length_weeks` | int |  | Range 0–520 |
| `cohorts_per_year` | number |  | Range 0– |
| `avg_batch_size` | int |  | Range 0– |
| `support_offered` | enum_list |  | One of: `Mentorship`, `Demo Day`, `Cloud Credits`, `Office Space`, `Co-founder Matching`, `Shared Services`, `Recruiting`, `Customer Intros`, `Follow-on Fund` |
| `model_summary` | string |  | How they make money / how the studio model works. |
| `source_url` | url | yes | Public page that backs the row (press release, Crunchbase/PitchBook page, company blog, SEC filing). |
| `collected_by` | string | yes | GitHub handle or initials of the student who entered the row. |
| `collected_at` | date | yes | Date the row was researched, YYYY-MM-DD. |
| `notes` | string |  | Anything a reviewer should know (conflicting sources, estimates). |

## `company_programs.csv` — Program Participation

Primary key: `company_id` + `program_id`

| Column | Type | Required | Rules / notes |
|---|---|---|---|
| `company_id` | ref | yes | Must exist in `companies` |
| `program_id` | ref | yes | Must exist in `programs` |
| `batch` | string |  | e.g. W24, S25, Cohort 3 |
| `year` | int |  | Range 1990–2030 |
| `source_url` | url | yes | Public page that backs the row (press release, Crunchbase/PitchBook page, company blog, SEC filing). |
| `collected_by` | string | yes | GitHub handle or initials of the student who entered the row. |
| `collected_at` | date | yes | Date the row was researched, YYYY-MM-DD. |
| `notes` | string |  | Anything a reviewer should know (conflicting sources, estimates). |
