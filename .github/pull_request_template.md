## What this PR adds

- [ ] New rows / [ ] Corrections / [ ] Schema change / [ ] Dashboard change
- Tables touched: <!-- companies, investors, funding_rounds, programs, company_programs -->
- Rows added / changed: <!-- e.g. +12 companies, +20 rounds -->
- Research area: <!-- 1 Landscape · 2 Funding · 3 Success & Failure · 4 Accelerators -->

## Checklist

- [ ] `python3 scripts/validate.py` passes locally (or the Import tab shows ✓)
- [ ] Every new row has a public `source_url`, my `collected_by`, and today's `collected_at`
- [ ] Undisclosed amounts are left **blank**, not guessed
- [ ] I searched for duplicates (same company under a different id) before adding
- [ ] Anything uncertain is marked `confidence = Low` and explained in `notes`

## Notes for the reviewer
