# Waco Family Guide

A website from the Baylor Center for Global Engagement (CGE) for spouses and dependents of Baylor faculty.
**New here and not technical? Open `START-HERE.html` in your browser** for a guided tour with screenshots and a demo video.

## Parts

| Part | URL when running | Who uses it |
|---|---|---|
| Public site (frontend) | `/` | Families: events, campus and Waco resources, church directory |
| Events admin (backend) | `/admin/` | CGE staff: add, edit, delete and feature events (staff code required) |
| API (backend) | `/api/...` | Used by the two pages above |

## Project layout

```
START-HERE.html            plain-language guide with screenshots and demo video
frontend/                  public site, plain HTML/CSS/JS, no build step
  index.html
  css/style.css
  js/app.js                events, resource tabs, church filters
  js/resources.js          resource and church lists (edit these to change links)
  data/events.json         fallback events when no backend is running
backend/                   Node.js server, no dependencies
  server.js                serves frontend/ at /, admin/ at /admin, and the API
  admin/                   staff events console (index.html, admin.css, admin.js)
  data/events.json         event storage
  .env.example             settings
docs/                      screenshots and demo video
```

## Run it

Requires Node.js 18 or newer.

```
cd backend
ADMIN_TOKEN=pick-a-long-staff-code npm start
```

- Public site: http://localhost:3000/
- Staff admin: http://localhost:3000/admin/ (sign in with the `ADMIN_TOKEN` value, at least 12 characters)

Windows PowerShell: `$env:ADMIN_TOKEN="pick-a-long-staff-code"; npm start`

## API

| Method | Path | Who | Purpose |
|---|---|---|---|
| GET | `/api/events` | anyone | list events |
| GET | `/api/events/stream` | anyone | live feed (Server-Sent Events), sends the full list on every change |
| GET | `/api/session` | staff | check the staff code |
| POST | `/api/events` | staff | add an event |
| PUT | `/api/events/:id` | staff | replace an event |
| DELETE | `/api/events/:id` | staff | delete an event |

Event fields: `title`, `date` (YYYY-MM-DD), `startTime`/`endTime` (HH:MM, optional), `location`, `category` (Event, Trip, Workshop, Deadline, Notice), `description`, `link` (http/https), `featured` (only one event is featured at a time).

Staff requests send `Authorization: Bearer <ADMIN_TOKEN>`. Five wrong codes from one address lock it out for five minutes.

## Hosting

- Deploy `backend/` (with `frontend/` beside it) to any Node host, such as a Baylor ITS server, Azure App Service, Render or Railway.
- Set `ADMIN_TOKEN` as a secret environment variable and keep `backend/data/` on persistent storage.
- Serve it over HTTPS so the staff code is encrypted in transit.
- Static-only option: publish just `frontend/`. Events then come from `frontend/data/events.json`, edited by hand, and there is no admin page.

## Editing content

- Events: use the admin page.
- Resource links and churches: edit `frontend/js/resources.js`. The church list holds Baptist and non-denominational congregations from Baylor Spiritual Life's local church list; CGE should review it before launch.
