#!/usr/bin/env python3
"""Regenerate docs/DATA_DICTIONARY.md from schema/schema.json (run after any schema change)."""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
schema = json.loads((ROOT / "schema" / "schema.json").read_text(encoding="utf-8"))
E = schema["enums"]

out = [
    "# Data Dictionary",
    "",
    "_Generated from `schema/schema.json` by `scripts/build_data_dictionary.py`. Do not edit by hand._",
    "",
    "General rules: money is plain USD numbers (`3500000`, not `$3.5M`); dates are `YYYY-MM-DD`;",
    "lists are separated by `;`; ids are lowercase slugs (`acme-ai`) and never change once created.",
    "",
]
for name, t in schema["tables"].items():
    pk = t["primary_key"]
    out += [f"## `{t['file']}` — {t['label']}", "", f"Primary key: `{'` + `'.join(pk) if isinstance(pk, list) else pk}`", "",
            "| Column | Type | Required | Rules / notes |", "|---|---|---|---|"]
    for c in t["columns"] + schema["provenance"]:
        rules = []
        if c.get("enum"):
            rules.append("One of: " + ", ".join(f"`{v}`" for v in E[c["enum"]]))
        if c.get("ref"):
            rules.append(f"Must exist in `{c['ref']}`")
        if "min" in c or "max" in c:
            rules.append(f"Range {c.get('min', '')}–{c.get('max', '')}")
        if c.get("doc"):
            rules.append(c["doc"])
        out.append(f"| `{c['name']}` | {c['type']} | {'yes' if c.get('required') else ''} | {'<br>'.join(rules)} |")
    out.append("")
(ROOT / "docs" / "DATA_DICTIONARY.md").write_text("\n".join(out), encoding="utf-8")
print("wrote docs/DATA_DICTIONARY.md")
