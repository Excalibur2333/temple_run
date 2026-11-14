# Waco Family Guide

A resource website from the Baylor Center for Global Engagement (CGE) for spouses and dependents of Baylor faculty.

- **Updates board**: events, deadlines and notices posted live by CGE staff
- **On-campus resources**: J-2 status, family benefits, spouse careers, recreation, friendship and English programs (from official baylor.edu pages)
- **In Waco**: schools, government services, health care, transit, English classes
- **Churches**: Baptist and non-denominational congregations from Baylor Spiritual Life's local church list, filterable by type and language

## Project layout

```
frontend/                  the website (one HTML page, no build step)
  index.html
  data/announcements.json  fallback updates, used when no backend is running
backend/                   Node.js server, no dependencies
  server.js                serves frontend/ and the /api endpoints
  data/announcements.json  live updates storage
  .env.example             settings
```

## Run it

Requires Node.js 18 or newer.

```
cd backend
ADMIN_TOKEN=pick-a-long-secret-code npm start
```

Open http://localhost:3000. Staff click **Staff sign in** on the updates board, enter the `ADMIN_TOKEN` code, and can then post or remove updates. Everyone with the page open sees changes immediately.

On Windows PowerShell: `$env:ADMIN_TOKEN="pick-a-long-secret-code"; npm start`

## API

| Method | Path | Who | Purpose |
|---|---|---|---|
| GET | `/api/announcements` | anyone | list updates |
| GET | `/api/announcements/stream` | anyone | live feed (Server-Sent Events) |
| GET | `/api/session` | staff | check the staff code |
| POST | `/api/announcements` | staff | add an update: `{title, date: "YYYY-MM-DD", category, body, link}` |
| DELETE | `/api/announcements/:id` | staff | remove an update |

Staff requests send `Authorization: Bearer <ADMIN_TOKEN>`.

## Hosting

- **With live updates**: deploy `backend/` to any Node host (a Baylor ITS server, Render, Railway, Azure App Service). Keep `backend/data/` on persistent storage and set `ADMIN_TOKEN` as an environment variable. Serve it over HTTPS.
- **Static only**: publish `frontend/` on any web host. The updates board then shows `frontend/data/announcements.json`, which you edit by hand.

## Editing content

Resources and churches are the `CAMPUS`, `COMMUNITY` and `CHURCHES` lists near the bottom of `frontend/index.html`. Church selection: Baptist and non-denominational congregations from Baylor Spiritual Life's list; please have CGE staff review before launch.
