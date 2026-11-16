#!/usr/bin/env python3
"""Validate the research CSVs against schema/schema.json.

Checks: headers, required fields, types, enums, primary-key uniqueness,
and foreign keys across tables. Standard library only.

Usage:
    python3 scripts/validate.py                 # validate data/
    python3 scripts/validate.py data/sample     # validate another folder
    python3 scripts/validate.py --summary       # also print row counts
Exit code is 1 if any error is found (used by CI).
"""
from __future__ import annotations

import csv
import json
import re
import sys
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SCHEMA_PATH = ROOT / "schema" / "schema.json"

ID_RE = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")
DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
URL_RE = re.compile(r"^https?://\S+$")


def load_schema() -> dict:
    schema = json.loads(SCHEMA_PATH.read_text(encoding="utf-8"))
    for table in schema["tables"].values():
        table["all_columns"] = table["columns"] + schema["provenance"]
    return schema


def split_list(value: str) -> list[str]:
    return [v.strip() for v in value.split(";") if v.strip()]


def check_value(col: dict, value: str, enums: dict) -> str | None:
    """Return an error message, or None if the (non-empty) value is valid."""
    t = col["type"]
    if t == "id":
        if not ID_RE.match(value):
            return f"'{value}' is not a lowercase slug (a-z, 0-9, hyphens)"
    elif t in ("int", "number"):
        try:
            num = int(value) if t == "int" else float(value)
        except ValueError:
            return f"'{value}' is not a{'n integer' if t == 'int' else ' number'} (no $, commas or 'M')"
        if "min" in col and num < col["min"]:
            return f"{value} is below minimum {col['min']}"
        if "max" in col and num > col["max"]:
            return f"{value} is above maximum {col['max']}"
    elif t == "date":
        if not DATE_RE.match(value):
            return f"'{value}' is not YYYY-MM-DD"
        try:
            d = date.fromisoformat(value)
        except ValueError:
            return f"'{value}' is not a real date"
        if d > date.today():
            return f"{value} is in the future"
    elif t == "url":
        if not URL_RE.match(value):
            return f"'{value}' is not an http(s) URL"
    elif t == "enum":
        allowed = enums[col["enum"]]
        if value not in allowed:
            return f"'{value}' not in {col['enum']} {allowed}"
    elif t == "enum_list":
        allowed = enums[col["enum"]]
        bad = [v for v in split_list(value) if v not in allowed]
        if bad:
            return f"{bad} not in {col['enum']} {allowed}"
    elif t == "ref_list":
        bad = [v for v in split_list(value) if not ID_RE.match(v)]
        if bad:
            return f"{bad} are not valid ids"
    return None


def read_table(folder: Path, name: str, table: dict, errors: list[str]) -> list[dict]:
    path = folder / table["file"]
    if not path.exists():
        errors.append(f"{path}: file missing")
        return []
    with path.open(newline="", encoding="utf-8-sig") as fh:
        reader = csv.DictReader(fh)
        header = reader.fieldnames or []
        expected = [c["name"] for c in table["all_columns"]]
        missing = [c for c in expected if c not in header]
        extra = [c for c in header if c not in expected]
        if missing:
            errors.append(f"{table['file']}: missing columns {missing}")
        if extra:
            errors.append(f"{table['file']}: unknown columns {extra}")
        rows = []
        for i, row in enumerate(reader, start=2):  # line 1 is the header
            row = {k: (v or "").strip() for k, v in row.items() if k is not None}
            if not any(row.values()):
                continue
            row["__line"] = i
            rows.append(row)
        return rows


def validate(folder: Path) -> tuple[list[str], dict[str, list[dict]]]:
    schema = load_schema()
    enums = schema["enums"]
    errors: list[str] = []
    data: dict[str, list[dict]] = {}

    for name, table in schema["tables"].items():
        rows = read_table(folder, name, table, errors)
        data[name] = rows
        pk = table["primary_key"]
        pk_cols = pk if isinstance(pk, list) else [pk]
        seen: dict[tuple, int] = {}
        for row in rows:
            where = f"{table['file']}:{row['__line']}"
            for col in table["all_columns"]:
                value = row.get(col["name"], "")
                if not value:
                    if col.get("required"):
                        errors.append(f"{where}: '{col['name']}' is required")
                    continue
                msg = check_value(col, value, enums)
                if msg:
                    errors.append(f"{where}: {col['name']}: {msg}")
            key = tuple(row.get(c, "") for c in pk_cols)
            if all(key):
                if key in seen:
                    errors.append(f"{where}: duplicate key {key} (first on line {seen[key]})")
                else:
                    seen[key] = row["__line"]

    # Foreign keys + cross-field rules
    ids = {
        name: {r.get(t["primary_key"]) for r in data[name]}
        for name, t in schema["tables"].items()
        if isinstance(t["primary_key"], str)
    }
    for name, table in schema["tables"].items():
        for row in data[name]:
            where = f"{table['file']}:{row['__line']}"
            for col in table["all_columns"]:
                value = row.get(col["name"], "")
                if not value or col["type"] not in ("ref", "ref_list"):
                    continue
                targets = [value] if col["type"] == "ref" else split_list(value)
                for target in targets:
                    if target not in ids[col["ref"]]:
                        errors.append(f"{where}: {col['name']} '{target}' not found in {col['ref']}")

    for row in data.get("investors", []):
        lo, hi = row.get("check_size_min_usd"), row.get("check_size_max_usd")
        try:
            if lo and hi and float(lo) > float(hi):
                errors.append(f"investors.csv:{row['__line']}: check_size_min_usd > check_size_max_usd")
        except ValueError:
            pass  # already reported as a type error
    for row in data.get("companies", []):
        if row.get("status") == "Acquired" and not row.get("acquirer"):
            errors.append(f"companies.csv:{row['__line']}: status is Acquired but 'acquirer' is empty")

    return errors, data


def main(argv: list[str]) -> int:
    args = [a for a in argv if not a.startswith("--")]
    folder = Path(args[0]) if args else ROOT / "data"
    errors, data = validate(folder)
    if "--summary" in argv:
        for name, rows in data.items():
            print(f"  {name:<18} {len(rows):>5} rows")
    if errors:
        print(f"\n{len(errors)} problem(s) in {folder}:")
        for e in errors:
            print(f"  - {e}")
        return 1
    print(f"OK: {folder} passes all checks.")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
