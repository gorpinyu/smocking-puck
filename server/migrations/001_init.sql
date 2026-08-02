-- Schema for the self-hosted hockey-api backend (replaces Cognito/AppSync/DynamoDB).
-- Applied idempotently on every API startup — see src/db.js's runMigrations().
--
-- date/time on sessions/bookings/booking_history are kept as plain TEXT
-- ('YYYY-MM-DD' / 'HH:MM'), deliberately matching the frontend's plain-string
-- date comparisons (todayISO()/isPastDate() in app.js), which exist
-- specifically to dodge timezone off-by-one bugs. booking_history.created_at
-- is a real timestamptz because formatDateTime() in app.js parses it as a
-- JS Date (it's a genuine instant, not a wall-clock session date/time).

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS citext;

CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email citext UNIQUE NOT NULL,
  name text NOT NULL,
  password_hash text,               -- null for a Google-only account
  google_sub text UNIQUE,           -- null for an email/password-only account
  is_admin boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  date text NOT NULL,
  time text NOT NULL,
  duration integer NOT NULL,
  booked boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS players (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- UNIQUE(session_id): one booking takes the whole slot. This is a real fix
-- over the original app, which only had a client-side read-then-write check
-- (documented in CLAUDE.md as a known, accepted double-booking race) — here
-- the database itself refuses a second booking for the same session.
CREATE TABLE IF NOT EXISTS bookings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL UNIQUE REFERENCES sessions(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  session_date text NOT NULL,
  user_name text NOT NULL,
  user_email text NOT NULL,
  mode text,
  player_name text NOT NULL,
  player_name2 text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_bookings_user ON bookings(user_id);

-- Append-only audit trail — never updated/deleted, same as the original
-- BookingHistory model. user_id is nullable (ON DELETE SET NULL) since the
-- row must survive even if the user it's about is ever removed; user_name/
-- user_email are denormalized so the row stays meaningful either way.
CREATE TABLE IF NOT EXISTS booking_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  action text NOT NULL,
  session_id uuid NOT NULL,
  session_date text NOT NULL,
  session_time text NOT NULL,
  session_title text NOT NULL,
  user_name text NOT NULL,
  user_email text NOT NULL,
  mode text,
  player_name text,
  player_name2 text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_booking_history_user ON booking_history(user_id);
