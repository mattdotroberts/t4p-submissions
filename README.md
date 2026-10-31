# T4P × Thaura hackathon — submissions

Collects hackathon submissions: project name, team members (multiple), and the public URL where the project can be tried. Same brand system as the idea board (Manrope, white/warm paper, heavy black headlines, red accents, green banner).

## Run locally

```sh
PORT=3000 node server.js
# open http://localhost:3000
```

Data is stored in `data/submissions.json` (created on first run).

## Deploy

Deployed from this public GitHub repo through **build.happyoperators.com/deploy** (the platform builds the Dockerfile and points `t4p-submissions.build.happyoperators.com` at it). Redeploying is the same API call with the same repo and name.

- The platform sets `PORT` and `DATA_DIR` (persistent `/data`) — submissions in `/data/submissions.json` survive redeploys
- No env override for `ADMIN_KEY` through the platform: on first boot the server generates a key, stores it in `/data/admin.json` and uses it from then on. To read it, get a shell on the server (or the Coolify container) and `cat /data/admin.json`. Setting an `ADMIN_KEY` env var on the app in Coolify takes precedence instead.

## Admin

Add `?admin=<key>` to the URL once; the key is kept in sessionStorage. Admin view gets:

- **Download CSV** — all submissions for the judges (`time, project, members, url`)
- **delete** button on each card

Set the key when deploying as the env var `ADMIN_KEY`. If it is unset, admin endpoints answer "Not authorised" and the CSV/delete buttons do nothing useful.

## API

- `GET  /api/submissions` — `{ submissions: [...], cap }`
- `POST /api/submissions` — `{ name, members: [], url, hp }` → `{ submission }`
- `GET  /api/admin/export.csv` — header `X-Admin-Key`
- `DELETE /api/submissions/<id>` — header `X-Admin-Key`

Rate limits: 8 submissions per browser per hour, 60 per IP per hour, hard cap of 100 submissions on the board. A hidden honeypot field catches bots.
