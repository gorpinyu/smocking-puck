# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

# Smocking Puck — Hockey Skills Booking Website

## Project Overview
Teenager-friendly website for booking and cancelling hockey shooting skills sessions for the **Smocking Puck** program. Vanilla HTML/CSS/JS pages bundled by Vite. Mobile-first, light-blue palette (`#4FC3F7`, `#B3E5FC`, `#E1F5FE`), dark-blue text (`#0D47A1`).

**This is the `t480-selfhosted` branch.** The backend here is a self-hosted Express + Postgres API (`server/`), deployed on a home server (the T480) — no AWS at runtime. `main` is a different, AWS-backed version (Cognito auth + AppSync/DynamoDB data + 2 Lambda functions, deployed via AWS Amplify Hosting) — that branch is kept running unmodified; this one is a from-scratch backend rewrite that intentionally preserves the exact same frontend behavior and page code. **If you need to change site behavior, decide first which branch it belongs on** — a fix that applies to both needs to be ported to both branches by hand (there's no shared backend layer between them).

---

## Commands

Frontend (repo root, `pnpm`):
- `pnpm install` — install dependencies (`pnpm-lock.yaml` is the source of truth).
- `pnpm run dev` — Vite dev server. Needs the API running separately (see below) — `vite.config.js` has no dev proxy configured, so in local dev either run the API on the same origin some other way or expect `/api/*` calls to 404.
- `pnpm run build` — production build (`vite build`, multi-page — see `vite.config.js`), output in `dist/`.
- `pnpm run preview` — preview the production build locally.
- No test suite, no lint script.

Backend (`server/`, `npm`, deliberately a separate lockfile/tree from the frontend — it's a standalone Docker-deployed service, not bundled by Vite):
- `npm install` — install API dependencies.
- `npm start` (or `node src/index.js`) — run the API. Needs `DATABASE_URL`, `JWT_SECRET`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `ADMIN_EMAILS` in the environment (see `~/services/sites/hockey/.env` on the server, or `03_Setup/SITES.md` in the ops repo for the full list).
- Migrations (`server/migrations/001_init.sql`, plain `CREATE TABLE IF NOT EXISTS`) run automatically on every API startup — no separate migrate step, no migration-tracking table (fine at this app's size; revisit if migrations stop being purely additive).

---

## Architecture

### Pages & Files (unchanged from the AWS version — see "What changed" below)

| File | Purpose |
|---|---|
| `index.html` / `index.js` | Home / landing page |
| `sessions.html` / `sessions.js` | Browse & book available sessions |
| `my-bookings.html` / `my-bookings.js` | View and cancel own bookings (requires login) |
| `players.html` / `players.js` | Manage the user's saved players (requires login) |
| `session-management.html` / `session-management.js` | Admin: sessions/bookings (gated by admin) |
| `access-management.html` / `access-management.js` | Admin: grant/revoke Admin access (gated by admin) |
| `login.html` / `login.js` | Log in, Register, "Continue with Google" |
| `style.css` | Shared styles |
| `app.js` | Shared ES module — fetch-based API client + auth helpers + nav/footer/admin-tabs renderer + formatters |
| `server/` | The self-hosted backend — Express API + Postgres |
| `vite.config.js` | Multi-page build config (one entry per HTML page) |

### What changed vs. the AWS (`main`) version

`app.js` and `login.js` were the **only** two frontend files that imported `aws-amplify` directly — every other page went through helpers `app.js` exported. So the rewrite kept every other page script **byte-for-byte identical**: `app.js` now exports a `client` object that is a thin `fetch` shim over the same shape the AWS SDK's `generateClient()` gave (`client.models.Session.list/get/create/update/delete`, `client.queries.listAppUsers()`, `client.mutations.bookForUser()/setAdminRole()`, all still resolving to a non-throwing `{ data, errors }`). If you're tempted to "clean up" a page script to `await`/`try`/`catch` a real fetch call directly, don't — it'll drift from `main`'s copy of the same file for no benefit, and the `{ data, errors }` contract is deliberate (see `app.js`'s comments).

`getCurrentUser()`/`isAdmin()`/`getCurrentUsername()`/`logout()` now hit `/api/auth/me` and `/api/auth/logout` instead of Cognito SDK calls. There's no Cognito sub/Username split to preserve — a user's `id` (uuid) doubles as `username` everywhere (see `getCurrentUsername()`'s comment in `app.js`).

`login.js` now calls `/api/auth/register`, `/api/auth/login`, and redirects to `/api/auth/google` for the Google button — no email-verification step (see below).

Deleted entirely: `amplify/` (backend-as-code), `amplify.yml` (Amplify Hosting build spec), `amplify_outputs.json`, `tsconfig.json` (only ever covered `amplify/**/*.ts` — there's no TypeScript left in this branch), and the AWS SDK deps from `package.json`.

**No email verification.** Registering signs you in immediately — no confirmation-code step (Cognito used to email one). Explicit trade-off for a demo-stage app: keeping this branch free of any SMTP/email-sending dependency. **Add real email verification before any commercial use.**

**One deliberate behavior fix vs. AWS:** on `main`, `GET Booking.list()` with no filter returns *every user's* bookings when the caller is an admin (a side effect of the Cognito-groups read rule applying regardless of filter) — meaning an admin's own My Bookings page silently listed everyone's bookings. Here, `GET /api/bookings` (no `sessionId` query param) always scopes to the caller, admin or not; the admin-wide read only exists via `GET /api/bookings?sessionId=` (what Session Management actually needs). `BookingHistory`/`GET /api/booking-history` intentionally keeps the AWS behavior (admin sees all, unscoped) — that one wasn't flagged as a bug, just ported as-is.

**Real fix, not just a port:** `bookings.session_id` is `UNIQUE` at the database level. The AWS version's "one booking per session" rule was only a client-side read-then-write check (a known, accepted race documented in the original version of this file) — a genuine double-book was possible under concurrent requests. Here the database rejects the second one (`POST /api/bookings` / `POST /api/admin/book-for-user` return `409` on the race).

Left in as harmless no-ops (not worth the diff to remove, and doing no harm against a database that can't actually produce the inconsistency they were guarding against): `checkBrokenSessions`/`cleanupBrokenSessions` in `session-management.js` (existed only because AppSync could null out individual list items on a schema-violating legacy row — Postgres just won't have such rows), the `.filter(Boolean)` calls scattered through every page (same reason), and the "just-created"/"just-booked" splice-into-the-list workarounds (existed only because DynamoDB Scan wasn't strongly consistent — Postgres reads are).

### Backend (`server/`)

Express + `pg` (raw SQL, no ORM — the schema is small and stable enough that an ORM would add more indirection than value) + `bcryptjs` (pure JS, no native compile step — matters for a small Alpine Docker image) + `jsonwebtoken` + `cookie-parser`.

- **Auth:** session = JWT in an `httpOnly`, `Secure`, `SameSite=Lax` cookie (`hp_session`) — not `localStorage`, which is what the AWS/Amplify version used and is vulnerable to XSS token theft. `SameSite=Lax` (not `Strict`) is required so the cookie survives the top-level-navigation redirect back from Google.
- **Admin bootstrap:** `ADMIN_EMAILS` env var (comma-separated). A user registering — or first signing in with Google — with a listed email is made admin automatically. Only ever upgrades, never downgrades (removing an email from the list later doesn't revoke anyone who already got admin). This exists purely to bootstrap the very first admin on an empty database; every subsequent grant/revoke goes through the Access Management page, same as before.
- **Google OAuth:** real server-side authorization-code flow (`/api/auth/google` → Google consent → `/api/auth/google/callback`), replacing Cognito's Hosted UI. Reuses the **same** Google Cloud OAuth client the AWS version uses — this app is just another authorized redirect URI on it, not a separate client. The callback trusts the `id_token`'s claims **without** re-verifying its JWT signature — see the code comment in `server/src/routes/auth.js` for why that's safe here (the token came directly from Google's token endpoint over a server-to-server call authenticated with our own client secret, never touched by the browser).
- **Field-level authorization for `PATCH /api/sessions/:id`:** an ordinary authenticated user may update *only* `booked` (needed to book/cancel their own slot); touching `title`/`date`/`time`/`duration` requires admin. This ports the AWS schema's field-level override on `Session.booked` — get it wrong in either direction and you either break booking or let any signed-in user rewrite session details.
- **`POST /api/admin/book-for-user`** replicates the old Lambda's guardian-lookup-by-email + fallback-to-admin-if-not-found behavior (`attributedToGuardian` in the response), now as one Postgres transaction (`withTransaction` in `server/src/db.js`) instead of a hand-rolled DynamoDB `PutCommand` pair.

See `03_Setup/SITES.md` in the ops repo (`N8N_Server_Setup_with_Claude`, not this repo) for the full deployment topology — Postgres container, Caddy routing, systemd auto-deploy timer, environment variables.

---

## Implementation Notes
- All rendered user-supplied strings (names, emails, session titles) go through `escapeHtml()` in `app.js` before `innerHTML` insertion — prevents stored XSS.
- Dates are compared as plain `'YYYY-MM-DD'` strings (`todayISO()` / `isPastDate()` in `app.js`), not `Date` objects, to avoid timezone-related off-by-one-day bugs — the Postgres schema keeps `sessions.date`/`time` and `bookings`/`booking_history`'s date/time columns as plain `text` for the same reason. `booking_history.created_at` is the one exception (a real `timestamptz`), rendered via `formatDateTime()`'s normal `Date` object.
- No external CSS/JS dependencies in the frontend at all now (previously just `aws-amplify`); layout is flexbox/CSS grid.
- `pnpm-workspace.yaml`'s `allowBuilds`/`supportedArchitectures` pinning still matters even without Amplify Hosting in the picture — the lockfile is generated on Windows, and the frontend Docker build stage (Linux) needs the `linux`+`x64` `esbuild` binary resolved too, or `vite build` silently fails inside the container.
- `public/logo.png` is a generous (not tight) crop: full artwork kept with margin, just the mostly-empty outer canvas trimmed. Two rejected alternatives, don't reintroduce: (1) the raw multi-megabyte source scaled down as-is — reads as an illegible smudge at nav-icon height; (2) a CSS `overflow:hidden` "zoom window" over an uncropped source — visually clips real artwork off the sides. `.nav-logo-img`/`.footer-logo-img` use `height` + `width: auto` (true aspect-ratio scaling) — keep it that way if the logo is swapped.
