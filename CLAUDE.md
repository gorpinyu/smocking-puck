# Smocking Puck — Hockey Skills Booking Website

## Project Overview
Teenager-friendly website for booking and cancelling hockey shooting skills sessions for the **Smocking Puck** program. Built with vanilla HTML/CSS/JS pages bundled by Vite, backed by **AWS Amplify Gen 2** (Cognito auth + AppSync/DynamoDB data) — no localStorage, no hardcoded passwords.

---

## Design
- **Color palette:** Light blue (`#4FC3F7`, `#B3E5FC`, `#E1F5FE`), white backgrounds, dark-blue text (`#0D47A1`).
- **Style:** Clean, energetic, teenager-friendly. Bold headings, clear buttons, minimal clutter.
- **Layout:** Mobile-first responsive design — must look and work great on any phone screen.
- **Font:** System sans-serif stack (no external fonts needed).

---

## Pages & Files

| File | Purpose |
|---|---|
| `index.html` / `index.js` | Home / landing page |
| `sessions.html` / `sessions.js` | Browse & book available sessions |
| `my-bookings.html` / `my-bookings.js` | View and cancel own bookings (requires login) |
| `players.html` / `players.js` | Manage the user's saved players (requires login) |
| `admin.html` / `admin.js` | Admin dashboard (gated by Cognito `Admins` group) |
| `login.html` / `login.js` | Log in, Register (+ email verification), "Continue with Google" |
| `style.css` | Shared styles |
| `app.js` | Shared ES module (Amplify config, auth helpers, Data client, nav renderer, formatters) |
| `amplify/` | Backend-as-code: `auth/resource.ts`, `data/resource.ts`, `backend.ts` |
| `vite.config.js` | Multi-page build config (one entry per HTML page) |

All page scripts are ES modules (`<script type="module">`) that `import` from `./app.js`.

---

## Auth — Cognito (Amplify Auth)
- Email/password **and** "Sign in with Google" (federated), both configured in `amplify/auth/resource.ts`.
- Register flow: `signUp` → Cognito emails a confirmation code → `confirmSignUp` → auto `signIn` → redirect to `sessions.html`.
- Google flow: `signInWithRedirect({ provider: 'Google' })` → Cognito Hosted UI → redirected back to `sessions.html` already signed in.
- `app.js` exposes `getCurrentUser()` (returns `{ id, name, email }` or `null`, resolved from Cognito attributes — `sub`, `name`, `email`), `isLoggedIn()`, `logout()`.
- **Admin** = membership in the Cognito `Admins` group (checked via `isAdmin()` in `app.js`, reading `cognito:groups` off the access token). Add users to the group in the Cognito Console — no separate password.

---

## Data — Amplify Data (AppSync + DynamoDB)
Schema defined in `amplify/data/resource.ts`.

### `Session`
```
{ id, title, date('YYYY-MM-DD'), time('HH:MM'), duration, maxCapacity, bookedCount }
```
- Read: any authenticated user. Create/update/delete: `Admins` group only — **except** `bookedCount`, which any authenticated user can update (kept in sync client-side whenever a booking is created/cancelled, since regular users can't read every other user's `Booking` record to compute this themselves).
- **Session mode is derived, not stored:** `maxCapacity 1` → "1-on-1", `maxCapacity 2` → "1-on-2" (`sessionMode()` helper in `app.js`). The admin form only creates capacity-1 or capacity-2 sessions.

### `Booking`
```
{ id, sessionId, sessionDate, userName, userEmail, playerName, playerName2? }
```
- Owner-based auth: each user can only create/read/delete their **own** bookings. `Admins` group can additionally read/delete any booking (needed for the admin "Who" list and cascading deletes when a session is removed).
- `userName`/`userEmail` (the booking guardian) and `playerName`/`playerName2` (who's on the ice) are denormalized onto the booking at creation time so the admin dashboard doesn't need a separate user-lookup function.
- **Spots rule:** a booking consumes `playerName2 ? 2 : 1` spots — this single rule drives both the capacity check + `bookedCount` increment on book and the decrement on cancel.

### `Player`
```
{ id, name }
```
- Owner-only auth (`allow.owner()`): each user manages their own players via `players.html`; the coach sees player names through the denormalized `Booking` fields, so Admins don't need Player read access.
- Booking requires at least one saved player (the primary player is picked from a select); the optional 2nd player on a 1-on-2 booking is free text, not a saved Player record.

**Known trade-off:** booking capacity is enforced with a read-then-write client-side check, not an atomic transaction — acceptable at this app's expected scale (a hockey club, not high-concurrency ticketing), but a simultaneous double-click race could theoretically over-book by one seat. A custom AppSync resolver/Lambda would close this gap if it ever becomes a real problem.

---

## Page Details

### `index.html` — Home
- Sticky nav: logo "Smocking Puck", links to Sessions, My Bookings, My Players, Login/Register (or user name + Logout).
- Hero section (private 1-on-1 / 1-on-2 framing), "Next Up" preview cards with mode badge, "How It Works" 3-step section, footer.

### `sessions.html` — Browse Sessions
- Loads all `Session` records + (if logged in) the current user's `Booking` and `Player` records.
- Each card: date, time, duration, mode badge (1-on-1 / 1-on-2), `maxCapacity - bookedCount` spots left.
- Book Now reveals an inline form: required player `<select>` (saved players) + — on a 1-on-2 session with ≥2 spots free — an optional free-text 2nd-player input. Zero saved players → message linking to `players.html`.
- Confirm → creates a `Booking` with `playerName` (+ `playerName2`) + increments `Session.bookedCount` by the spots rule.
- Not logged in → Book button links to `login.html`.

### `login.html` — Login / Register / Verify
- Login tab, Register tab, and a Verify-code panel shown after registering (Cognito requires email confirmation).
- "Continue with Google" button above the tabs.

### `my-bookings.html` — My Bookings (auth-gated)
- Lists the current user's upcoming bookings (joined against `Session` for display), showing the player name(s) booked.
- Cancel → deletes the `Booking` + decrements `Session.bookedCount` by the spots rule.

### `players.html` — My Players (auth-gated)
- Add-player form (name only) + list of the user's saved players with Remove buttons.
- Players are picked in the booking form on `sessions.html`; removing a player doesn't touch existing bookings (names are denormalized).

### `admin.html` — Admin Dashboard (Cognito `Admins` group gated)
- Add Session form (Mode dropdown: 1-on-1 / 1-on-2 instead of a free capacity input), All Sessions table (date/time/mode/booked-count/Who/Delete).
- The Who column lists player name(s) per booking with the guardian email.
- Deleting a session also deletes its `Booking` records (no orphaned bookings).

---

## Local Development
1. `npm install`
2. `npx ampx sandbox` — deploys a personal cloud backend and writes `amplify_outputs.json` (gitignored; required before `npm run dev` will work, since `app.js` imports it to configure Amplify).
3. `npm run dev` — Vite dev server.

## Deployment
- **Amplify Hosting** connected to the project's GitHub repo — pushes to the tracked branch trigger a build (`npm run build` via the Vite multi-page config) and backend deploy.
- Google OAuth Client ID/secret are stored as Amplify secrets (`GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`), referenced via `secret(...)` in `amplify/auth/resource.ts` — never hardcoded.
- After the Hosting domain is known, update the placeholder callback/logout URLs in `amplify/auth/resource.ts` and the Google Cloud OAuth Client's authorized redirect URI to match.

## Implementation Notes
- All rendered user-supplied strings (names, emails, session titles) are passed through `escapeHtml()` in `app.js` before being inserted via `innerHTML` — prevents stored XSS.
- Dates are compared as plain `'YYYY-MM-DD'` strings (`todayISO()` / `isPastDate()` in `app.js`) rather than constructing `Date` objects, avoiding timezone-related off-by-one-day bugs.
- CSS uses flexbox / CSS grid for layout; no external dependencies beyond `aws-amplify`.
