#!/usr/bin/env python3
"""Generate FICTIONAL demo data in data/sample/ and empty templates in data/.

Every company, investor and program here is made up. Sample rows point at
example.com so nobody mistakes them for research. Use them only to try the
dashboard before the team has entered real data.

    python3 scripts/generate_sample_data.py            # sample + missing templates
    python3 scripts/generate_sample_data.py --templates-only
"""
from __future__ import annotations

import csv
import json
import random
import sys
from datetime import date, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SCHEMA = json.loads((ROOT / "schema" / "schema.json").read_text(encoding="utf-8"))
COLLECTED_AT = "2026-11-01"


def columns(table: str) -> list[str]:
    t = SCHEMA["tables"][table]
    return [c["name"] for c in t["columns"] + SCHEMA["provenance"]]


def write(folder: Path, table: str, rows: list[dict]) -> None:
    folder.mkdir(parents=True, exist_ok=True)
    path = folder / SCHEMA["tables"][table]["file"]
    with path.open("w", newline="", encoding="utf-8") as fh:
        w = csv.DictWriter(fh, fieldnames=columns(table))
        w.writeheader()
        for r in rows:
            w.writerow({k: r.get(k, "") for k in columns(table)})


def write_templates() -> None:
    for table, t in SCHEMA["tables"].items():
        if not (ROOT / "data" / t["file"]).exists():
            write(ROOT / "data", table, [])


def slug(s: str) -> str:
    return "-".join("".join(ch.lower() if ch.isalnum() else " " for ch in s).split())


def prov(kind: str, ident: str) -> dict:
    return {
        "source_url": f"https://example.com/sample/{kind}/{ident}",
        "collected_by": "sample-bot",
        "collected_at": COLLECTED_AT,
        "notes": "FICTIONAL SAMPLE ROW",
    }


def make_sample() -> None:
    rng = random.Random(42)
    E = SCHEMA["enums"]
    cats = [c for c in E["category"] if c != "Other"]

    programs = [
        dict(name="Launchpad Alpha", type="Accelerator", investment_usd=500000, equity_pct=7, program_length_weeks=12,
             cohorts_per_year=2, avg_batch_size=200, support_offered="Mentorship;Demo Day;Cloud Credits;Follow-on Fund",
             model_summary="Standard deal for a fixed % plus uncapped SAFE; large batches; demo day."),
        dict(name="Signal Forge Studio", type="Venture Studio", investment_usd=750000, equity_pct=30, program_length_weeks=52,
             cohorts_per_year=1, avg_batch_size=4, support_offered="Co-founder Matching;Shared Services;Recruiting;Customer Intros",
             model_summary="Studio originates ideas, recruits founders, provides shared engineering/design; takes large founding equity."),
        dict(name="Prairie AI Lab", type="University Program", investment_usd=50000, equity_pct=0, program_length_weeks=16,
             cohorts_per_year=2, avg_batch_size=12, support_offered="Mentorship;Office Space;Demo Day",
             model_summary="Non-dilutive grants and mentorship for student founders."),
        dict(name="Northbeam Accelerator", type="Accelerator", investment_usd=120000, equity_pct=6, program_length_weeks=13,
             cohorts_per_year=3, avg_batch_size=15, support_offered="Mentorship;Demo Day;Customer Intros",
             model_summary="Small cohorts, corporate partner network, 6% for 120k."),
        dict(name="Keystone Incubator", type="Incubator", investment_usd=0, equity_pct=0, program_length_weeks=26,
             cohorts_per_year=1, avg_batch_size=20, support_offered="Office Space;Mentorship",
             model_summary="Membership fee for space and office hours; no investment."),
    ]
    for p in programs:
        p["program_id"] = slug(p["name"])
        p["hq_country"] = "US"
        p["website"] = f"https://example.com/{p['program_id']}"
        p.update(prov("program", p["program_id"]))

    inv_specs = [
        ("Granite Peak Ventures", "VC", ["Series A", "Series B"], 3e6, 15e6, 400e6),
        ("Copperline Capital", "VC", ["Seed", "Series A"], 1e6, 5e6, 150e6),
        ("Tinyseed Partners", "Micro-VC", ["Pre-Seed", "Seed"], 100e3, 750e3, 30e6),
        ("Riverbend Angels", "Syndicate", ["Pre-Seed", "Seed"], 25e3, 250e3, None),
        ("Orbit Growth Fund", "VC", ["Series B", "Series C", "Series D+"], 10e6, 60e6, 1.2e9),
        ("Helix Corporate Ventures", "Corporate VC", ["Series A", "Series B", "Series C"], 2e6, 20e6, 300e6),
        ("Maple & Oak Seed", "Micro-VC", ["Pre-Seed", "Seed"], 250e3, 1.5e6, 60e6),
        ("Quarry Fund", "VC", ["Seed", "Series A", "Series B"], 1e6, 12e6, 250e6),
        ("Lantern Health Ventures", "VC", ["Seed", "Series A"], 500e3, 6e6, 120e6),
        ("Vector Security Partners", "VC", ["Seed", "Series A", "Series B"], 1e6, 10e6, 200e6),
        ("Ledgerline Ventures", "VC", ["Seed", "Series A"], 750e3, 8e6, 180e6),
        ("Jane Example (angel)", "Angel", ["Pre-Seed", "Seed"], 10e3, 100e3, None),
        ("Sam Placeholder (angel)", "Angel", ["Pre-Seed"], 5e3, 50e3, None),
        ("Summit Late Stage", "VC", ["Series C", "Series D+"], 20e6, 100e6, 2e9),
        ("Launchpad Alpha Fund", "Accelerator", ["Pre-Seed"], 500e3, 500e3, 100e6),
        ("Signal Forge Capital", "Venture Studio", ["Pre-Seed", "Seed"], 750e3, 2e6, 40e6),
    ]
    investors = []
    for name, typ, stages, lo, hi, fund in inv_specs:
        iid = slug(name.replace("(angel)", ""))
        focus = rng.sample(cats, k=rng.randint(1, 4))
        if "Health" in name:
            focus = ["Healthcare AI"]
        if "Security" in name:
            focus = ["Cybersecurity AI"]
        if "Ledger" in name:
            focus = ["FinTech AI"]
        investors.append(dict(
            investor_id=iid, name=name, type=typ, website=f"https://example.com/{iid}",
            hq_city=rng.choice(["San Francisco", "New York", "Austin", "Boston", "Dallas", "Seattle"]), hq_country="US",
            focus_categories=";".join(focus), stages=";".join(stages),
            check_size_min_usd=int(lo), check_size_max_usd=int(hi), fund_size_usd=int(fund) if fund else "",
            **prov("investor", iid)))
    by_stage = {s: [i for i, spec in zip(investors, inv_specs) if s in spec[2]] for s in E["stage"]}

    prefixes = ["Nimbus", "Quill", "Atlas", "Kestrel", "Lumen", "Ferro", "Harbor", "Cinder", "Mosaic", "Tandem",
                "Vireo", "Basalt", "Sable", "Juniper", "Cobalt", "Meridian", "Pylon", "Wren", "Orchid", "Talon",
                "Ember", "Glacier", "Halcyon", "Indigo", "Kiln", "Loom", "Marrow", "Nova", "Onyx", "Pique",
                "Quasar", "Rook", "Sorrel", "Thistle", "Umber", "Vellum", "Willow", "Xylo", "Yarrow", "Zephyr",
                "Aster", "Briar", "Corvid", "Dune", "Eddy"]
    suffix = {"AI Agents": "Agents", "Enterprise AI": "Works", "Healthcare AI": "Health", "Cybersecurity AI": "Shield",
              "FinTech AI": "Ledger", "Developer Tools": "Dev", "AI Infrastructure": "Compute", "Vertical AI": "Labs",
              "Consumer AI": "App"}
    model_for = {"Developer Tools": ["Usage-based API", "Open Core", "B2B SaaS"], "AI Infrastructure": ["Usage-based API", "Open Core"],
                 "Consumer AI": ["B2C Subscription"], "Healthcare AI": ["B2B SaaS", "Services"]}
    cust_for = {"Developer Tools": "Developers", "AI Infrastructure": "Developers", "Consumer AI": "Consumers",
                "Healthcare AI": "Healthcare Providers", "FinTech AI": "Financial Institutions"}
    ladder = ["Pre-Seed", "Seed", "Series A", "Series B", "Series C"]
    median_amt = {"Pre-Seed": 0.8e6, "Seed": 3.5e6, "Series A": 14e6, "Series B": 35e6, "Series C": 80e6}
    step_up = {"Pre-Seed": 8, "Seed": 5, "Series A": 4, "Series B": 3.5, "Series C": 3}

    companies, rounds, participation = [], [], []
    for n, prefix in enumerate(prefixes):
        cat = rng.choices(cats, weights=[9, 7, 5, 4, 4, 6, 3, 5, 2])[0]
        name = f"{prefix} {suffix[cat]}"
        cid = slug(name)
        founded = rng.randint(2016, 2024)
        start = date(founded, rng.randint(1, 12), 1) + timedelta(days=rng.randint(60, 300))
        # how far up the ladder this company gets (fewer survive each step)
        depth = 1
        while depth < len(ladder) and rng.random() < [0.85, 0.6, 0.5, 0.4][depth - 1]:
            depth += 1
        if rng.random() < 0.25:  # some skip pre-seed
            stages = ladder[1:depth + 1] if depth < len(ladder) else ladder[1:]
        else:
            stages = ladder[:depth]
        d = start
        for k, stage in enumerate(stages):
            if d > date(2026, 10, 1):
                break
            amt = median_amt[stage] * rng.lognormvariate(0, 0.5)
            amt = round(amt, -4 if amt < 1e6 else -5)
            disclosed = rng.random() > 0.12
            leads = rng.sample(by_stage[stage], k=1) if by_stage[stage] else []
            pool = [i for i in by_stage[stage] + by_stage.get(ladder[max(k - 1, 0)], []) if i not in leads]
            parts = rng.sample(pool, k=min(len(pool), rng.randint(0, 3)))
            rid = f"{cid}-{slug(stage)}"
            rounds.append(dict(
                round_id=rid, company_id=cid, stage=stage, announced_date=d.isoformat(),
                amount_usd=int(amt) if disclosed else "",
                post_money_valuation_usd=int(amt * step_up[stage]) if disclosed and rng.random() < 0.6 else "",
                lead_investor_ids=";".join(i["investor_id"] for i in leads),
                participant_investor_ids=";".join(sorted({i["investor_id"] for i in parts})),
                confidence=rng.choice(["High", "High", "Medium", "Low"]) if disclosed else "Medium",
                **prov("round", rid)))
            last = d
            d = d + timedelta(days=int(rng.gauss(560, 170)))
        # status
        roll = rng.random()
        status, status_date, acquirer = "Active", "", ""
        if len(stages) <= 2 and roll < 0.35:
            status, status_date = rng.choice(["Shut Down", "Inactive"]), (last + timedelta(days=rng.randint(300, 700))).isoformat()
        elif roll > 0.88:
            status, status_date, acquirer = "Acquired", (last + timedelta(days=rng.randint(200, 600))).isoformat(), "Example Acquirer Corp"
        if status_date and status_date > "2026-10-31":
            status, status_date, acquirer = "Active", "", ""
        companies.append(dict(
            company_id=cid, name=name, website=f"https://example.com/{cid}", category=cat,
            sub_category="", business_model=rng.choice(model_for.get(cat, ["B2B SaaS", "Usage-based API"])),
            target_customer=cust_for.get(cat, rng.choice(["Enterprise", "SMB"])), founded_year=founded,
            hq_city=rng.choice(["San Francisco", "New York", "Austin", "Waco", "Boston", "Seattle", "Toronto"]),
            hq_country="US", status=status, status_date=status_date, acquirer=acquirer,
            description=f"Fictional {cat.lower()} startup used to demo the dashboard.",
            **prov("company", cid)))
        if rng.random() < 0.45:
            prog = rng.choices(programs, weights=[6, 2, 2, 3, 1])[0]
            year = min(founded + rng.randint(0, 2), 2026)
            participation.append(dict(company_id=cid, program_id=prog["program_id"],
                                      batch=f"{rng.choice('WS')}{str(year)[2:]}", year=year,
                                      **prov("participation", f"{cid}-{prog['program_id']}")))

    out = ROOT / "data" / "sample"
    write(out, "companies", companies)
    write(out, "investors", investors)
    write(out, "funding_rounds", rounds)
    write(out, "programs", programs)
    write(out, "company_programs", participation)
    print(f"sample: {len(companies)} companies, {len(investors)} investors, {len(rounds)} rounds, "
          f"{len(programs)} programs, {len(participation)} participations -> {out}")


if __name__ == "__main__":
    write_templates()
    if "--templates-only" not in sys.argv:
        make_sample()
