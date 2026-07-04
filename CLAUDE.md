# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

# Smocking Puck — Hockey Skills Booking Website

## Project Overview
Teenager-friendly website for booking and cancelling hockey shooting skills sessions for the **Smocking Puck** program. Built with vanilla HTML/CSS/JS pages bundled by Vite, backed by **AWS Amplify Gen 2** (Cognito auth + AppSync/DynamoDB data) — no localStorage, no hardcoded passwords. Mobile-first, light-blue palette (`#4FC3F7`, `#B3E5FC`, `#E1F5FE`), dark-blue text (`#0D47A1`).

---

## Commands

- `pnpm install` — install dependencies (this repo uses **pnpm**, not npm — `pnpm-lock.yaml` is the source of truth; a stray `package-lock.json` may appear locally but isn't committed).
- `npx ampx sandbox` — deploy a personal cloud backend and write `amplify_outputs.json` (gitignored, required before `pnpm run dev` works — `app.js` imports it directly to configure Amplify).
- `pnpm run dev` — Vite dev server.
- `pnpm run build` — production build (`vite build`, multi-page — see `vite.config.js`).
- `pnpm run preview` — preview the production build locally.
- There is no test suite and no lint script configured in `package.json`.

---

## Architecture

### Pages & Files

| File | Purpose |
|---|---|
| `index.html` / `index.js` | Home / landing page |
| `sessions.html` / `sessions.js` | Browse & book available sessions |
| `my-bookings.html` / `my-bookings.js` | View and cancel own bookings (requires login) |
| `players.html` / `players.js` | Manage the user's saved players (requires login) |
| `admin.html` / `admin.js` | Admin dashboard (gated by Cognito `Admins` group) |
| `login.html` / `login.js` | Log in, Register (+ email verification), "Continue with Google" |
| `style.css` | Shared styles |
| `app.js` | Shared ES module (Amplify config, auth helpers, Data client, nav/footer renderer, formatters) |
| `amplify/` | Backend-as-code: `auth/resource.ts`, `data/resource.ts`, `backend.ts`, `functions/book-for-user/` |
| `vite.config.js` | Multi-page build config (one entry per HTML page) |

All page scripts are ES modules (`<script type="module">`) that `import` from `./app.js`.

### Dependency split — frontend vs. backend (`package.json`)

The frontend (plain JS, no `.ts` files outside `amplify/`) and the CDK backend share one `package.json`, but **`amplify.yml` installs them separately with different flags**:
- Backend phase: plain `pnpm install --frozen-lockfile` (needs everything, including `aws-cdk-lib`/`constructs`/`@aws-amplify/backend*` in `devDependencies`, since `amplify/backend.ts` imports directly from `aws-cdk-lib`/`constructs`).
- Frontend phase: `pnpm install --frozen-lockfile --prod` — installs **only** the `dependencies` section. `vite` therefore lives in `dependencies` (not `devDependencies`), even though it's a build tool, specifically so the frontend install can skip `devDependencies` entirely.

This split exists because `aws-cdk-lib` is one of the largest packages on npm (tens of thousands of files) — installing it needlessly in the frontend phase (which never uses it) was tipping the Amplify Hosting build container's memory over the edge and causing OOM build failures. **If you add a new backend-only package, put it in `devDependencies`. If the frontend needs a new build-time package, put it in `dependencies`** (or the frontend's `--prod` install will silently miss it).

### Auth — Cognito (Amplify Auth)
- Email/password **and** "Sign in with Google" (federated), both configured in `amplify/auth/resource.ts`. Google OAuth Client ID/secret are Amplify secrets (`GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`) via `secret(...)` — never hardcoded. If the Hosting domain changes, update the callback/logout URLs in `auth/resource.ts` and the Google Cloud OAuth Client's authorized redirect URI to match.
- Register flow: `signUp` → Cognito emails a confirmation code → `confirmSignUp` → auto `signIn` → redirect to `sessions.html`.
- Google flow: `signInWithRedirect({ provider: 'Google' })` → Cognito Hosted UI → redirected back to `sessions.html` already signed in.
- `app.js` exposes `getCurrentUser()` (returns `{ id, name, email }` or `null`, resolved from Cognito attributes — `sub`, `name`, `email`), `isLoggedIn()`, `logout()`.
- **Admin** = membership in the Cognito `Admins` group (checked via `isAdmin()` in `app.js`, reading `cognito:groups` off the access token). Add users to the group in the Cognito Console — no separate password.
- `app.js` holds a real (load-bearing, not dead code) reference to `signInWithRedirect`. Vite's per-page code-splitting will otherwise tree-shake the OAuth-redirect-completion code out of any page bundle that doesn't reference it — `sessions.html` is the actual Google OAuth callback target (per `callbackUrls`) but only `login.js` used to reference this import, which made Google sign-in hang forever with no error. Don't remove it.

### Data — Amplify Data (AppSync + DynamoDB)
Schema defined in `amplify/data/resource.ts`.

**`Session`** — `{ id, title, date('YYYY-MM-DD'), time('HH:MM'), duration, booked }`. Read: any authenticated user or guest. Create/update/delete: `Admins` group only — **except** `booked`, which any authenticated user can update (kept in sync client-side on booking/cancel, since regular users can't read every other user's `Booking` to compute it themselves). A session is a single coach time-slot with no fixed format — whoever books it picks 1-on-1 or 1-on-2 at booking time, and that one booking takes the whole slot.

**`Booking`** — `{ id, sessionId, sessionDate, userName, userEmail, mode('ONE_ON_ONE'|'ONE_ON_TWO'), playerName, playerName2? }`. Owner-based: each user creates/reads/deletes only their own. `Admins` can additionally `read`/`delete` any booking — **not** `create` (see `bookForUser` below). `userName`/`userEmail`/`mode`/player names are denormalized at creation so the admin dashboard needs no separate user-lookup.

**`Player`** — `{ id, name }`. Owner-only. Booking requires at least one saved player; an optional 2nd player on a 1-on-2 booking is free text, not a saved `Player`.

**`BookingHistory`** — `{ id, action('BOOKED'|'CANCELLED'), sessionId, sessionDate, sessionTime, sessionTitle, userName, userEmail, mode?, playerName?, playerName2?, createdAt }`. Append-only audit trail, written alongside every booking/cancellation — never updated/deleted. Kept separate from `Booking` (rather than a soft-delete flag) because a cancelled `Booking` is actually deleted; the log is what survives. Owner can `create`/`read` their own (rendered as "My History" on `my-bookings.html`); `Admins` can additionally `create`/`read` any entry (rendered as "Activity Log" on `admin.html`). A CANCELLED entry from the admin's "Cancel Booking" is owned by the admin, not the guardian — a known, accepted trade-off (not worth a second Lambda for this one remaining case).

**`bookForUser`** (custom mutation, `Admins` group only) — backs the admin dashboard's "Book for User" action, handled by the `book-for-user` Lambda (`amplify/functions/book-for-user/`). A normal API `create` is always owned by the caller, so an admin-created `Booking` would be owned by the admin, not the guardian it's actually for — invisible on that guardian's own My Bookings/My History. This mutation fixes that: the Lambda looks the guardian up in Cognito by email (`ListUsers`) and writes the `Booking`/`BookingHistory` rows **directly to DynamoDB** (via table grants in `backend.ts`, bypassing the model rules) with `owner` set to the guardian's real Cognito identity (the plain `cognito:username` claim — a plain-email user's Username/sub, or `google_<id>` for a Google user). **Fallback:** if no Cognito user exists for that email, the Lambda attributes the record to the admin's own identity instead of blocking the booking, and returns `attributedToGuardian: false` so `admin.js` can surface a one-time alert.

**Backend stack wiring** (`amplify/backend.ts`, `amplify/functions/book-for-user/resource.ts`) — `bookForUserFn` is deliberately grouped into `resourceGroupName: 'data'`, and its `cognito-idp:ListUsers` grant is attached directly to its role in `backend.ts` (not via `auth/resource.ts`'s `access` config). Both choices avoid a CloudFormation nested-stack circular dependency: the function is simultaneously a data-mutation handler (data→function) and a grantee of the data tables (function→data), and AppSync's `userPool` auth mode already creates an inherent data→auth edge — granting the Cognito permission from auth's side instead would create an opposing auth→data edge and cycle. **If you add another Lambda that needs both data-table access and a Cognito/auth-side permission, follow this same pattern** (group it with `data`, grant auth-side permissions directly on its role from `backend.ts`, not through `auth/resource.ts`'s `access`).

**Known trade-off:** `Session.booked` is enforced via a read-then-write client-side check, not an atomic transaction — acceptable at this app's scale (a hockey club, not high-concurrency ticketing), but a simultaneous double-click race could theoretically double-book a slot.

### Page Details

- **`index.html`** — Home: nav, hero, "Next Up" preview cards (Booked badge or nothing — no spots count), "How It Works", footer.
- **`sessions.html`** — Browse & book. Loads all `Session`s + (if logged in) the user's `Booking`/`Player` records. An **unbooked** session drops off the list once within 1hr of start (`isWithinBookingCutoff()` in `app.js`) — a booked session keeps showing regardless. Book Now reveals a format `<select>`, required player `<select>`, and (only for 1-on-2) an optional free-text 2nd player. Not logged in → Book links to `login.html`.
- **`login.html`** — Login tab, Register tab (+ post-register Verify-code panel), "Continue with Google".
- **`my-bookings.html`** (auth-gated) — Upcoming bookings + Cancel action; "My History" table of the user's own `BookingHistory`.
- **`players.html`** (auth-gated) — Add/remove saved players (name only); removing one doesn't touch existing bookings (names are denormalized).
- **`admin.html`** (Cognito `Admins`-gated) — Add Session form (date/time/duration/title; no mode/capacity — format is the booker's choice at booking time). Time fields are Hour (00-23) / Minute (00/05/.../55) `<select>`s built from `hourSelectOptionsHTML()`/`minuteSelectOptionsHTML()` in `app.js`, not a native `<input type="time">` — a `step` attribute alone doesn't stop browsers' native pickers from producing off-grid values. All Sessions table + a separate **Expired Sessions** card (hidden when empty, for unbooked sessions past the 1hr cutoff) share the same row-building/action code (`buildSessionsTable()`/`wireSessionRowActions()` in `admin.js`). Per-row actions (inline expando, not a modal): **Edit** (always available, even on expired/booked sessions), **Cancel Booking** (deletes the `Booking`, flips `booked` false, logs a CANCELLED entry), **Book for User** (shown when open; via the `bookForUser` mutation), **Delete** (removes the `Session`, cascades its `Booking`s). Below: "Activity Log" of every `BookingHistory` entry across all users.

---

## Deployment

- **Amplify Hosting**, connected to `github.com/gorpinyu/smocking-puck`, branch `main` → live at `https://main.d17nxebfgblbv7.amplifyapp.com`. Push to `main` triggers `amplify.yml`'s backend deploy (`ampx pipeline-deploy`) then frontend build.
- See the dependency-split note above before adding new top-level dependencies — a misplaced backend-only package in the frontend's install path can OOM the build container.
- After the Hosting domain changes, update `amplify/auth/resource.ts`'s callback/logout URLs and the Google Cloud OAuth Client's redirect URI to match.

---

## Implementation Notes
- All rendered user-supplied strings (names, emails, session titles) go through `escapeHtml()` in `app.js` before `innerHTML` insertion — prevents stored XSS.
- Dates are compared as plain `'YYYY-MM-DD'` strings (`todayISO()` / `isPastDate()` in `app.js`), not `Date` objects, to avoid timezone-related off-by-one-day bugs. `BookingHistory.createdAt` is the one exception (a real `AWSDateTime` instant), rendered via `formatDateTime()`'s normal `Date` object.
- No external CSS/JS dependencies beyond `aws-amplify`; layout is flexbox/CSS grid.
- `pnpm-workspace.yaml` exists only for `allowBuilds`/`supportedArchitectures` config (the lockfile was generated on Windows; without pinning `linux`+`win32`/`x64`, Amplify Hosting's Linux build only resolves the Windows-native `esbuild` binary and silently fails when Vite invokes it) — it is not an actual multi-package workspace.
- `public/logo.png` is a generous (not tight) crop: full artwork kept with margin, just the mostly-empty outer canvas trimmed. Two rejected alternatives, don't reintroduce: (1) the raw multi-megabyte source scaled down as-is — reads as an illegible smudge at nav-icon height; (2) a CSS `overflow:hidden` "zoom window" over an uncropped source — visually clips real artwork off the sides. `.nav-logo-img`/`.footer-logo-img` use `height` + `width: auto` (true aspect-ratio scaling) — keep it that way if the logo is swapped.
