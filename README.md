# Waco Family Guide

A resource website from the Baylor Center for Global Engagement (CGE) for spouses and dependents of Baylor faculty. It covers:

- **Updates board**: events, deadlines and notices posted by CGE staff
- **On-campus resources**: J-2 status, family benefits, spouse careers, recreation, friendship and English programs (from official baylor.edu pages)
- **In Waco**: schools, government services, health care, transit, English classes
- **Churches**: Baptist and non-denominational congregations from Baylor Spiritual Life's local church list, with filters for language and multicultural churches

## Editing

- **Updates board**: edit `data/announcements.json`. Each item needs `id`, `title`, `date` (YYYY-MM-DD), `category` (Event / Deadline / Notice / Urgent), and optionally `body` and `link`. Past items are hidden automatically.
- **Resources and churches**: edit the `CAMPUS`, `COMMUNITY` and `CHURCHES` arrays near the bottom of `index.html`.

## Running locally

```
python3 -m http.server 8000
```
Then open http://localhost:8000. To host it, enable GitHub Pages for this repository (Settings → Pages → deploy from branch).
