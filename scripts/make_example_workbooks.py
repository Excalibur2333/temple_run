#!/usr/bin/env python3
"""Build two deliberately messy, FICTIONAL example workbooks in examples/ to show the importer.

  examples/example_crunchbase_style_export.xlsx  one flat sheet, title rows, Crunchbase-like headers
  examples/example_team_tracker.xlsx             4 sheets the way students usually build them

Requires openpyxl (pip install openpyxl). All names are made up; links point to example.com.
"""
from datetime import date
from pathlib import Path

from openpyxl import Workbook
from openpyxl.styles import Font

OUT = Path(__file__).resolve().parent.parent / "examples"
OUT.mkdir(exist_ok=True)
bold = Font(bold=True)


def sheet(wb, title, header, rows, title_rows=()):
    ws = wb.create_sheet(title)
    for t in title_rows:
        ws.append(t)
    ws.append(header)
    for c in ws[ws.max_row]:
        c.font = bold
    for r in rows:
        ws.append(r)
    for col in ws.columns:
        ws.column_dimensions[col[0].column_letter].width = 18
    return ws


# 1. Crunchbase-style flat export
wb = Workbook()
wb.remove(wb.active)
sheet(wb, "Export", [
    "Organization Name", "Website", "Industries", "Headquarters Location", "Founded Date", "Operating Status",
    "Last Funding Type", "Last Funding Date", "Last Funding Amount (in USD)", "Total Funding Amount", "Top 5 Investors", "Description",
], [
    ["Pinecrest Robotics AI", "pinecrest-robotics.example.com", "Artificial Intelligence (AI), Robotics, Manufacturing", "Austin, Texas, United States", date(2021, 4, 1), "Operating", "Seed", date(2023, 2, 14), 4200000, "$5.1M", "Northgate Ventures, Ana Example", "Vision models for factory QA."],
    ["Clearwater Health Copilot", "www.clearwater-health.example.com", "Health Care, Generative AI", "Boston, Massachusetts, United States", date(2020, 9, 1), "Operating", "Series A", date(2024, 5, 2), "18,000,000", "$24M", "Harborlight Capital, Northgate Ventures", "Ambient scribe for clinics."],
    ["Ledgerfox", "https://ledgerfox.example.com", "FinTech, Accounting, Machine Learning", "New York, New York, United States", 2019, "Closed", "Seed", "2020-11-03", "2.5M", "2.5M", "Small Batch Fund", "AI bookkeeping for SMBs."],
    ["Agentry", "agentry.example.com", "Artificial Intelligence (AI), Workflow Automation, SaaS", "San Francisco, California, United States", "2022", "Operating", "Pre-Seed", "Mar 2023", "$900K", "$900K", "Y Combinator, Ana Example", "Autonomous agents for back-office ops."],
    ["Shieldmind", "shieldmind.example.com", "Cyber Security, Artificial Intelligence (AI)", "Tel Aviv, Tel Aviv, Israel", date(2018, 1, 1), "Was Acquired", "Series B", date(2022, 8, 30), 32000000, "$51M", "Harborlight Capital, Granite Ridge Partners", "AI threat detection."],
    ["Promptforge", "promptforge.example.com", "Developer Tools, Generative AI, Open Source", "Seattle, Washington, United States", date(2023, 3, 1), "Operating", "Seed", date(2024, 1, 20), "$6.5M", "$7.0M", "Small Batch Fund, Northgate Ventures", "Testing framework for LLM apps."],
    ["Gridwise AI", "", "Energy, Machine Learning", "Waco, Texas, United States", date(2021, 6, 1), "Operating", "Venture - Series Unknown", date(2023, 9, 12), "undisclosed", "", "Prairie Angels", "Load forecasting for utilities."],
    ["Lexa Legal", "lexalegal.example.com", "Legal Tech, Artificial Intelligence (AI)", "Chicago, Illinois, United States", date(2019, 2, 1), "Operating", "Series C", date(2025, 3, 3), "€40M", "$75M", "Granite Ridge Partners, Harborlight Capital", "Contract review copilot."],
], title_rows=[["Crunchbase-style export (FICTIONAL EXAMPLE)"], ["Exported 2026-11-01"]])
wb.save(OUT / "example_crunchbase_style_export.xlsx")

# 2. Team tracker with several sheets
wb = Workbook()
wb.remove(wb.active)
sheet(wb, "Startups", ["Company", "Industry", "Business Model", "Customer", "Founded", "City", "Status", "Accelerator", "Source", "Researcher", "Date Added"], [
    ["Tallgrass AI", "Agriculture / crop analytics", "SaaS", "Enterprise", 2021, "Lincoln", "Active", "YC W22", "https://example.com/tallgrass", "jd", date(2026, 10, 20)],
    ["Beacon Agents", "AI Agents", "API", "Developers", 2023, "San Francisco", "active", "YC S23", "https://example.com/beacon", "jd", date(2026, 10, 20)],
    ["MedLoop", "healthcare", "subscription", "Hospitals", 2020, "Houston", "Active", "", "https://example.com/medloop", "ak", date(2026, 10, 21)],
    ["Quantleaf", "Fintech", "B2B", "Banks", 2019, "New York", "shut down", "Northbeam", "https://example.com/quantleaf", "ak", date(2026, 10, 21)],
    ["Sentrygate", "Cybersecurity", "SaaS", "Enterprise", 2022, "Austin", "Active", "Northbeam", "https://example.com/sentrygate", "mm", date(2026, 10, 22)],
    ["Codewright", "dev tools", "open source", "developers", 2022, "Remote", "Acquired", "YC W23", "https://example.com/codewright", "mm", date(2026, 10, 22)],
])
sheet(wb, "Funding Rounds", ["Startup", "Round", "Date", "Amount ($M)", "Valuation", "Lead Investor", "Investors", "Source", "Confidence"], [
    ["Tallgrass AI", "Pre-seed", "2021-09-01", 0.75, "", "Ana Example", "", "https://example.com/r1", "high"],
    ["Tallgrass AI", "Seed Round", "Jun 2022", 3.2, "$16M", "Small Batch Fund", "Northgate Ventures, Prairie Angels", "https://example.com/r2", "Medium"],
    ["Tallgrass AI", "Series-A", date(2024, 4, 9), 15, "$70M", "Northgate Ventures", "Small Batch Fund", "https://example.com/r3", "high"],
    ["Beacon Agents", "Seed", "Q3 2023", 5, "", "Harborlight Capital", "Y Combinator; Ana Example", "https://example.com/r4", "H"],
    ["MedLoop", "Seed", "3/15/2021", 2.8, "", "Clinic Partners Fund", "", "https://example.com/r5", "medium"],
    ["MedLoop", "Series A", "2023-02-01", 12.5, "$55M", "Harborlight Capital", "Clinic Partners Fund", "https://example.com/r6", "High"],
    ["Quantleaf", "Seed", "2019-12-01", 1.9, "", "Small Batch Fund", "", "https://example.com/r7", "Low"],
    ["Sentrygate", "Seed", "2023-05-20", 4.1, "", "Granite Ridge Partners", "Northbeam Fund", "https://example.com/r8", "High"],
    ["Codewright", "Seed", "2023-07-10", 3.0, "", "Northgate Ventures", "Y Combinator", "https://example.com/r9", "High"],
    ["Brightwell Labs", "Series B", "2025-01-15", 30, "$180M", "Granite Ridge Partners", "Harborlight Capital", "https://example.com/r10", "Medium"],
])
sheet(wb, "Investors", ["Firm", "Type", "Check Size", "Stage Focus", "Sectors", "Website"], [
    ["Northgate Ventures", "venture capital", "$1M - $8M", "Seed, Series A", "AI agents, developer tools", "northgate.example.com"],
    ["Small Batch Fund", "micro vc", "$250K-1.5M", "Pre-seed; Seed", "fintech, vertical", "smallbatch.example.com"],
    ["Harborlight Capital", "VC", "$5M to $25M", "Series A, Series B", "health, security", "harborlight.example.com"],
    ["Granite Ridge Partners", "Growth VC", "10M-50M", "Series B, Series C", "enterprise", "graniteridge.example.com"],
    ["Ana Example", "angel", "25K", "pre-seed", "", ""],
])
sheet(wb, "Accelerators", ["Program", "Type", "Standard Deal", "Equity", "Duration (weeks)", "Batch Size", "Perks"], [
    ["YC", "accelerator", "$500K", "7%", 12, 250, "mentors, demo day, AWS credits"],
    ["Northbeam", "Accelerator", "120000", 0.06, 13, 15, "mentorship; customer intros"],
    ["Forge Studio", "startup studio", "$750K", "30%", 52, 4, "cofounder matching, shared services, hiring"],
])
wb.save(OUT / "example_team_tracker.xlsx")
print("wrote", *sorted(p.name for p in OUT.glob("*.xlsx")))
