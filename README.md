# Smocking Puck — Hockey Skills Booking

Mobile-first website for booking and cancelling private hockey shooting-skills sessions for the **Smocking Puck** program. Players and parents browse sessions, book a 1-on-1 or 1-on-2 slot, manage saved players, and cancel bookings. Admins manage sessions, book on behalf of users, grant or revoke admin access, and review a full activity log.

**Live:** https://hockey.gorpyniuk.com

Built with Claude Code from a three-sentence brief (see `instructions.md`). Originally built on AWS Amplify, then re-platformed to a self-hosted Express + PostgreSQL backend on a home server when the AWS free tier ended. Both versions live in this repository, see [Deployments and branches](#deployments-and-branches).

---

## Deployments and branches

| Branch | Status | Backend |
|---|---|---|
| `t480-selfhosted` | **Production** (what https://hockey.gorpyniuk.com serves) | Express + PostgreSQL API in `server/`, Docker containers behind Caddy on a home server (Lenovo T480), published through a Cloudflare Tunnel |
| `main` | Original AWS architecture, kept as reference | AWS Amplify Gen 2: Cognito auth (email + Google), AppSync GraphQL + DynamoDB, two Lambda functions for admin operations, Amplify Hosting |

The page code is the same on both branches. Only `app.js` and `login.js` ever touched the AWS SDK, so the self-hosted rewrite swapped those two files for a `fetch`-based API client with the same call shape and left every other page byte-for-byte identical.

---

## Features

### Players and parents
- Browse upcoming sessions without logging in; booking requires an account
- Register with email and password, or continue with Google
- Book a session as 1-on-1 or 1-on-2, choosing from saved players (optional second player on 1-on-2)
- View upcoming bookings and cancel them
- "My History" audit trail of every booking and cancellation
- Unbooked sessions drop off the list within one hour of start time

### Admins
- Add, edit, and delete sessions (date, time, duration, title)
- Cancel any booking, or book a session on behalf of a user by email
- Separate Expired Sessions view for cleanup
- Activity Log of every booking and cancellation across all users
- Access Management page: grant or revoke admin rights for any user, with a self-revoke guard

### Design
- Mobile-first layout, light-blue palette, no external CSS or JS frameworks
- All user-supplied strings are HTML-escaped before rendering (stored-XSS protection)
- Dates handled as plain `YYYY-MM-DD` strings to avoid timezone off-by-one bugs

---

## Tech Stack

### Frontend (both branches)

| Layer | Technology |
|---|---|
| Pages | Vanilla HTML, CSS, and JavaScript ES modules |
| Build | Vite multi-page build (one entry per HTML page), `pnpm` |
| Shared code | `app.js`: API client, auth helpers, nav/footer/admin-tabs renderer, formatters |

### Backend, `t480-selfhosted` (production)

| Layer | Technology |
|---|---|
| API | Express 4, raw SQL via `pg` (no ORM) |
| Database | PostgreSQL, schema in `server/migrations/001_init.sql`, applied automatically on startup |
| Auth | `bcryptjs` + `jsonwebtoken`; session JWT in an `httpOnly`, `Secure`, `SameSite=Lax` cookie |
| Google sign-in | Server-side OAuth authorization-code flow (`/api/auth/google` → `/api/auth/google/callback`) |
| Admin bootstrap | `ADMIN_EMAILS` env var grants admin on first sign-in; later changes go through Access Management |
| Container | `server/Dockerfile`, `node:20-alpine` |
| Edge | Caddy reverse proxy in Docker, published through a Cloudflare Tunnel (no open inbound ports) |
| Deploy | `git push` to `t480-selfhosted` picked up by a systemd timer that rebuilds and restarts the containers |

Two things the rewrite fixed rather than ported:

- **Double-booking race.** The AWS version enforced "one booking per session" with a client-side read-then-write check. The self-hosted schema makes `bookings.session_id` `UNIQUE`, so a concurrent second booking is rejected by the database with a `409`.
- **Admin My Bookings scope.** On AWS, an admin's own bookings page listed every user's bookings as a side effect of the Cognito group read rule. `GET /api/bookings` now always scopes to the caller; the admin-wide read exists only via `?sessionId=`.

Trade-off accepted for a demo-stage app: no email verification on registration (Cognito used to send a confirmation code). Add it before any commercial use.

### Backend, `main` (original AWS architecture)

| Layer | Technology |
|---|---|
| Auth | Amazon Cognito user pool, email/password and Google federation via Hosted UI |
| Data | AWS AppSync GraphQL + DynamoDB, owner-based and group-based authorization rules |
| Admin operations | Two Lambda functions: `book-for-user` (writes bookings owned by the guardian) and `manage-users` (list users, grant/revoke admin) |
| Infrastructure | AWS Amplify Gen 2 backend-as-code in `amplify/` |
| Hosting | Amplify Hosting, continuous deployment on push to `main` |

---

## Project Structure

```
smocking-puck/
├── index.html / index.js                  # Home
├── sessions.html / sessions.js            # Browse and book
├── my-bookings.html / my-bookings.js      # Own bookings + history (login required)
├── players.html / players.js              # Saved players (login required)
├── session-management.html / .js          # Admin: sessions, bookings, activity log
├── access-management.html / .js           # Admin: grant/revoke admin
├── login.html / login.js                  # Login, register, Google
├── app.js                                 # Shared module
├── style.css
├── vite.config.js
├── server/                                # t480-selfhosted only: Express + Postgres API
│   ├── src/index.js, db.js, middleware.js
│   ├── src/routes/{auth,sessions,bookings,players,history,admin}.js
│   ├── migrations/001_init.sql
│   └── Dockerfile
└── amplify/                               # main only: Amplify Gen 2 backend
    ├── auth/resource.ts
    ├── data/resource.ts
    ├── backend.ts
    └── functions/{book-for-user,manage-users}/
```

---

## Local Development

### Frontend
```bash
pnpm install
pnpm run dev       # Vite dev server
pnpm run build     # production build to dist/
pnpm run preview
```

### Backend (`t480-selfhosted`)
```bash
cd server
npm install
npm start          # needs DATABASE_URL, JWT_SECRET, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, ADMIN_EMAILS
```

There is no Vite dev proxy configured, so run the API on the same origin or expect `/api/*` calls to 404 in local dev.

### Backend (`main`, AWS)
```bash
npx ampx sandbox   # deploys a personal cloud backend and writes amplify_outputs.json
pnpm run dev
```

---

## Deploy

**Self-hosted (`t480-selfhosted`):** push the branch. A systemd timer on the server pulls it, builds the frontend and the `server/` image, and restarts the containers behind Caddy.

```bash
git push origin t480-selfhosted
```

**AWS (`main`):** push to `main`. Amplify Hosting runs `amplify.yml`, which deploys the backend with `ampx pipeline-deploy` and then builds the frontend.
