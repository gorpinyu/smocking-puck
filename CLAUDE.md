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
{ id, title, date('YYYY-MM-DD'), time('HH:MM'), duration, booked }
```
- Read: any authenticated user (plus guests, see below). Create/update/delete: `Admins` group only — **except** `booked`, which any authenticated user can update (kept in sync client-side whenever a booking is created/cancelled, since regular users can't read every other user's `Booking` record to compute this themselves).
- A session has **no fixed format** — it's just a coach time-slot. Whoever books it picks 1-on-1 or 1-on-2 at booking time (see `Booking.mode` below), and that one booking takes the whole slot (`booked` flips to `true`). The admin "Add Session" form only sets date/time/duration/title.

### `Booking`
```
{ id, sessionId, sessionDate, userName, userEmail, mode('ONE_ON_ONE'|'ONE_ON_TWO'), playerName, playerName2? }
```
- Owner-based auth: each user can only create/read/delete their **own** bookings. `Admins` group can additionally read/create/delete any booking (read+delete for the admin "Who" list and cascading deletes when a session is removed; create for the admin "Book for User" flow below).
- **Known trade-off:** a booking the admin creates via "Book for User" is owned by the admin's own Cognito identity, not the guardian's — there's no client-reachable directory API to look up another user's real `sub`. It shows up correctly in the admin "Who" list, but not on that guardian's own My Bookings page. Fine for "coach takes a booking over the phone"; a real fix needs an admin-only user-lookup Lambda.
- `userName`/`userEmail` (the booking guardian) and `mode`/`playerName`/`playerName2` (the booked format and who's on the ice) are denormalized onto the booking at creation time so the admin dashboard doesn't need a separate user-lookup function.
- `mode` is the booker's explicit choice in the booking form (`bookingModeLabel()` in `app.js` renders it) — `playerName2` stays optional even for a `ONE_ON_TWO` booking (a booker might reserve the 1-on-2 format but only bring one player).

### `Player`
```
{ id, name }
```
- Owner-only auth (`allow.owner()`): each user manages their own players via `players.html`; the coach sees player names through the denormalized `Booking` fields, so Admins don't need Player read access.
- Booking requires at least one saved player (the primary player is picked from a select); the optional 2nd player on a 1-on-2 booking is free text, not a saved Player record.

**Known trade-off:** booking availability (`Session.booked`) is enforced with a read-then-write client-side check, not an atomic transaction — acceptable at this app's expected scale (a hockey club, not high-concurrency ticketing), but a simultaneous double-click race could theoretically double-book a slot. A custom AppSync resolver/Lambda would close this gap if it ever becomes a real problem.

---

## Page Details

### `index.html` — Home
- Sticky nav: logo "Smocking Puck", links to Sessions, My Bookings, My Players, Login/Register (or user name + Logout).
- Hero section (private 1-on-1 / 1-on-2 framing), "Next Up" preview cards (a "Booked" badge if taken, otherwise nothing — no spots count), "How It Works" 3-step section, footer.

### `sessions.html` — Browse Sessions
- Loads all `Session` records + (if logged in) the current user's `Booking` and `Player` records.
- Each card: date, time, duration, and either a "Booked ✓"/"Booked" badge or a Book Now button — no spots-left count, since a session is simply open or taken.
- Book Now reveals an inline form: a Format `<select>` (1-on-1 / 1-on-2, the booker's choice), a required player `<select>` (saved players), and — only when 1-on-2 is selected — an optional free-text 2nd-player input. Zero saved players → message linking to `players.html`.
- Confirm → creates a `Booking` with `mode`, `playerName` (+ `playerName2`) + sets `Session.booked = true`.
- Not logged in → Book button links to `login.html`.

### `login.html` — Login / Register / Verify
- Login tab, Register tab, and a Verify-code panel shown after registering (Cognito requires email confirmation).
- "Continue with Google" button above the tabs.

### `my-bookings.html` — My Bookings (auth-gated)
- Lists the current user's upcoming bookings (joined against `Session` for display), showing the booked format (1-on-1 / 1-on-2) and player name(s).
- Cancel → deletes the `Booking` + sets `Session.booked = false`.

### `players.html` — My Players (auth-gated)
- Add-player form (name only) + list of the user's saved players with Remove buttons.
- Players are picked in the booking form on `sessions.html`; removing a player doesn't touch existing bookings (names are denormalized).

### `admin.html` — Admin Dashboard (Cognito `Admins` group gated)
- Add Session form (date/time/duration/title only — no mode/capacity field, since format is the booker's choice), All Sessions table (date/time/title/Status "Open"/"Booked"/Who/Actions).
- The Who column lists the booked format + player name(s) per booking with the guardian email.
- Per-row actions, each an inline expando row (not a modal) toggled open below that session's row:
  - **Edit** — always available; updates date/time/duration/title on the `Session`, even if it's booked (re-scheduling a booked slot doesn't touch its `Booking`).
  - **Cancel Booking** (shown when booked) — deletes the session's `Booking` record(s) and flips `booked` back to `false`, freeing the slot without deleting the `Session` itself.
  - **Book for User** (shown when open) — lets the admin create a `Booking` directly (guardian name/email + format + player name(s), typed in manually — there's no user directory to pick from). See the Booking trade-off note above.
  - **Delete** — unchanged: removes the `Session` and cascades to its `Booking` records.

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
- `app.js` holds a real (unused-looking but load-bearing) reference to `signInWithRedirect` from `aws-amplify/auth`. Vite's per-page code-splitting will tree-shake Amplify's OAuth-redirect-completion code out of any page bundle that doesn't reference it — `sessions.html` (the actual Google OAuth callback page) previously had no such reference since only `login.js` imported it, which made Google sign-in hang forever with no error. Don't remove this reference as "dead code."
- `public/logo.png` is a generous (not tight) crop of the source art: 100% of the visible mark (full flame trail, full puck) is kept with a comfortable margin on every side, just the mostly-empty outer canvas trimmed. Two earlier approaches both got explicitly rejected and shouldn't be reintroduced: (1) using the raw multi-megabyte source canvas as-is scaled down — the mark reads as a tiny illegible smudge at nav-icon height because of how much dead space surrounds it; (2) a CSS `overflow:hidden` "zoom window" (oversized `img` absolutely positioned inside a small fixed box) to make an uncropped source fill the header — this visually clips real artwork (flame tail, puck edge) off the sides, which reads as a broken/cut-off logo. `.nav-logo-img`/`.footer-logo-img` just set `height` with `width: auto` (true aspect-ratio scaling, nothing cropped) — keep it that way if the logo is swapped again.
