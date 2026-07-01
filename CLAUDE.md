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

### `Booking`
```
{ id, sessionId, sessionDate, userName, userEmail }
```
- Owner-based auth: each user can only create/read/delete their **own** bookings. `Admins` group can additionally read/delete any booking (needed for the admin "Who" list and cascading deletes when a session is removed).
- `userName`/`userEmail` are denormalized onto the booking at creation time so the admin dashboard doesn't need a separate user-lookup function.

**Known trade-off:** booking capacity is enforced with a read-then-write client-side check, not an atomic transaction — acceptable at this app's expected scale (a hockey club, not high-concurrency ticketing), but a simultaneous double-click race could theoretically over-book by one seat. A custom AppSync resolver/Lambda would close this gap if it ever becomes a real problem.

---

## Page Details

### `index.html` — Home
- Sticky nav: logo "Smocking Puck", links to Sessions, My Bookings, Login/Register (or user name + Logout).
- Hero section, "How It Works" 3-step section, footer.

### `sessions.html` — Browse Sessions
- Loads all `Session` records + (if logged in) the current user's `Booking` records.
- Each card: date, time, duration, `maxCapacity - bookedCount` spots left.
- Book → creates a `Booking` + increments `Session.bookedCount`.
- Not logged in → Book button links to `login.html`.

### `login.html` — Login / Register / Verify
- Login tab, Register tab, and a Verify-code panel shown after registering (Cognito requires email confirmation).
- "Continue with Google" button above the tabs.

### `my-bookings.html` — My Bookings (auth-gated)
- Lists the current user's upcoming bookings (joined against `Session` for display).
- Cancel → deletes the `Booking` + decrements `Session.bookedCount`.

### `admin.html` — Admin Dashboard (Cognito `Admins` group gated)
- Add Session form, All Sessions table (date/time/booked-count/Who/Delete).
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
