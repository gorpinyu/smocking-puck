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
| `amplify/` | Backend-as-code: `auth/resource.ts`, `data/resource.ts`, `backend.ts`, `functions/book-for-user/` |
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
- Owner-based auth: each user can only create/read/delete their **own** bookings. `Admins` group can additionally `read`/`delete` any booking (for the admin "Who" list and cascading deletes when a session is removed) — **not** `create`: see `bookForUser` below for how the admin dashboard creates one instead.
- `userName`/`userEmail` (the booking guardian) and `mode`/`playerName`/`playerName2` (the booked format and who's on the ice) are denormalized onto the booking at creation time so the admin dashboard doesn't need a separate user-lookup function.
- `mode` is the booker's explicit choice in the booking form (`bookingModeLabel()` in `app.js` renders it) — `playerName2` stays optional even for a `ONE_ON_TWO` booking (a booker might reserve the 1-on-2 format but only bring one player).

### `Player`
```
{ id, name }
```
- Owner-only auth (`allow.owner()`): each user manages their own players via `players.html`; the coach sees player names through the denormalized `Booking` fields, so Admins don't need Player read access.
- Booking requires at least one saved player (the primary player is picked from a select); the optional 2nd player on a 1-on-2 booking is free text, not a saved Player record.

### `BookingHistory`
```
{ id, action('BOOKED'|'CANCELLED'), sessionId, sessionDate, sessionTime, sessionTitle, userName, userEmail, mode?, playerName?, playerName2?, createdAt }
```
- Append-only audit trail, written alongside every booking/cancellation (`sessions.js`, `my-bookings.js`, and admin's "Book for User"/"Cancel Booking" in `admin.js`) — never updated or deleted by the client. Session/session-time fields are denormalized because the `Session` (or the `Booking` itself) may be deleted later; `createdAt` (auto-added by every Amplify Data model) is the event timestamp.
- Owner can `create`/`read` their own entries (rendered as "My History" on `my-bookings.html`); `Admins` group can additionally `create`/`read` **any** entry (rendered as "Activity Log" on `admin.html`). A CANCELLED entry from the admin's "Cancel Booking" action is written through this rule and is therefore owned by the admin, not the guardian — same trade-off as below, just not worth a second Lambda for the one remaining case (it still appears in the global Admin log either way).

### `bookForUser` (custom mutation, `Admins` group only)
Backs the admin dashboard's "Book for User" action. Defined in `data/resource.ts`, backed by the `book-for-user` Lambda (`amplify/functions/book-for-user/`). A normal API `create` can only ever be owned by the caller — so a `Booking`/`BookingHistory` created that way by an admin was always owned by the admin, not the guardian it was actually for, meaning it never showed up on that guardian's own My Bookings/My History. This mutation fixes that: the Lambda looks the guardian up in Cognito by email (`ListUsers`, granted via `access: (allow) => [allow.resource(bookForUserFn).to(['listUsers'])]` in `auth/resource.ts`) and writes the `Booking`/`BookingHistory` rows **directly to DynamoDB** (via table grants in `backend.ts`, bypassing the model rules above entirely) with `owner` set to that guardian's real Cognito identity.
- **Owner string format:** confirmed empirically against the deployed backend — it's just the `cognito:username` claim value as-is (a plain-email user's is their Cognito Username/sub; a Google user's is `google_<id>`), not a composite string.
- **Fallback:** if no Cognito user exists for that email (e.g. a phone booking for someone who's never signed up), the Lambda falls back to attributing the record to the *admin's own* identity instead of blocking the booking — same old behavior, just now the exception rather than the rule. The mutation returns `attributedToGuardian: false` in that case and `admin.js` surfaces a one-time `alert()` explaining it.

**Known trade-off:** booking availability (`Session.booked`) is enforced with a read-then-write client-side check, not an atomic transaction — acceptable at this app's expected scale (a hockey club, not high-concurrency ticketing), but a simultaneous double-click race could theoretically double-book a slot. A custom AppSync resolver/Lambda would close this gap if it ever becomes a real problem.

---

## Page Details

### `index.html` — Home
- Sticky nav: logo "Smocking Puck", links to Sessions, My Bookings, My Players, Login/Register (or user name + Logout).
- Hero section (private 1-on-1 / 1-on-2 framing), "Next Up" preview cards (a "Booked" badge if taken, otherwise nothing — no spots count), "How It Works" 3-step section, footer.

### `sessions.html` — Browse Sessions
- Loads all `Session` records + (if logged in) the current user's `Booking` and `Player` records.
- Each card: date, time, duration, and either a "Booked ✓"/"Booked" badge or a Book Now button — no spots-left count, since a session is simply open or taken.
- An **unbooked** session drops off the list entirely once it's within an hour of its start time (`isWithinBookingCutoff()` in `app.js`) — same treatment as a past-dated session, since a walk-in booking that close to start isn't realistic. A booked session keeps showing (with its badge) regardless.
- Book Now reveals an inline form: a Format `<select>` (1-on-1 / 1-on-2, the booker's choice), a required player `<select>` (saved players), and — only when 1-on-2 is selected — an optional free-text 2nd-player input. Zero saved players → message linking to `players.html`.
- Confirm → creates a `Booking` with `mode`, `playerName` (+ `playerName2`) + sets `Session.booked = true` + logs a `BookingHistory` `BOOKED` entry.
- Not logged in → Book button links to `login.html`.

### `login.html` — Login / Register / Verify
- Login tab, Register tab, and a Verify-code panel shown after registering (Cognito requires email confirmation).
- "Continue with Google" button above the tabs.

### `my-bookings.html` — My Bookings (auth-gated)
- Lists the current user's upcoming bookings (joined against `Session` for display), showing the booked format (1-on-1 / 1-on-2) and player name(s).
- Cancel → deletes the `Booking` + sets `Session.booked = false` + logs a `BookingHistory` `CANCELLED` entry.
- Below that, a "My History" table lists the user's own `BookingHistory` entries (booked + cancelled), newest first.

### `players.html` — My Players (auth-gated)
- Add-player form (name only) + list of the user's saved players with Remove buttons.
- Players are picked in the booking form on `sessions.html`; removing a player doesn't touch existing bookings (names are denormalized).

### `admin.html` — Admin Dashboard (Cognito `Admins` group gated)
- Add Session form (date/time/duration/title only — no mode/capacity field, since format is the booker's choice). Time is two `<select>`s (Hour 00-23, Minute 00/05/10.../55, built by `hourSelectOptionsHTML()`/`minuteSelectOptionsHTML()` in `app.js`) rather than a native `<input type="time">` — a `step="300"` attribute only hints at 5-minute increments and most browsers' native pickers let you scroll/type past it anyway, where two constrained selects can't ever produce an off-grid value in the first place.
- All Sessions table (date/time/title/Status "Open"/"Booked"/Who/Actions) shows only sessions that are still bookable or already booked. An **Expired Sessions** card below it (hidden entirely when empty) holds unbooked sessions that are past their 1hr-before-start booking cutoff (`isWithinBookingCutoff()`, same check `sessions.html` uses to drop them from the public list) — Status reads "Expired" there instead of "Open". Both tables share the same row-building/action-wiring code (`buildSessionsTable()`/`wireSessionRowActions()` in `admin.js`), so every action below works identically in either section.
- The Who column lists the booked format + player name(s) per booking with the guardian email.
- Per-row actions, each an inline expando row (not a modal) toggled open below that session's row:
  - **Edit** — always available (including on an expired session); updates date/time/duration/title on the `Session`, even if it's booked (re-scheduling a booked slot doesn't touch its `Booking`). Same Hour/Minute selects as Add Session.
  - **Cancel Booking** (shown when booked) — deletes the session's `Booking` record(s), flips `booked` back to `false`, and logs a `BookingHistory` `CANCELLED` entry per deleted booking (owned by the admin — see the trade-off note above).
  - **Book for User** (shown when open, including expired-but-open sessions) — lets the admin create a `Booking` (guardian name/email + format + player name(s), typed in manually — there's no user directory to pick from) via the `bookForUser` custom mutation, which owns the record correctly by the guardian's own Cognito identity. See `bookForUser` above.
  - **Delete** — unchanged: removes the `Session` and cascades to its `Booking` records.
- Below that, an "Activity Log" table lists **every** `BookingHistory` entry (all users), newest first — the admin-side counterpart to each user's own "My History" on `my-bookings.html`.

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
