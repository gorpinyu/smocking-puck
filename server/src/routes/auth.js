import { Router } from 'express';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { query } from '../db.js';
import { setSessionCookie, clearSessionCookie, requireAuth } from '../middleware.js';

const router = Router();

// A registering (or first Google-signing-in) user whose email is in this
// list is made admin automatically — bootstraps the very first admin on an
// empty database (nobody can reach Access Management to grant one otherwise).
// Only ever upgrades, never downgrades: an admin later removed from this env
// var keeps their access, which now lives in the database and is managed
// through the Access Management page like any other grant/revoke.
const ADMIN_EMAILS = (process.env.ADMIN_EMAILS || '')
  .split(',')
  .map((e) => e.trim().toLowerCase())
  .filter(Boolean);

// `username` here is just the user's id — unlike Cognito, there's no
// separate Username-vs-sub distinction to preserve (that split only existed
// because a Google-federated Cognito user's Username differs from their
// sub). Kept as a field name for frontend-shape compatibility (app.js /
// access-management.js still ask for `username`).
function toPublicUser(row) {
  return {
    id: row.id,
    username: row.id,
    name: row.name,
    email: row.email,
    isAdmin: row.is_admin,
  };
}

router.post('/register', async (req, res, next) => {
  try {
    const { email, password, name } = req.body || {};
    if (!email || !password || !name) {
      return res.status(400).json({ error: 'Name, email and password are required.' });
    }
    if (String(password).length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters.' });
    }
    const normalizedEmail = String(email).trim().toLowerCase();

    const { rows: existing } = await query('SELECT id FROM users WHERE email = $1', [normalizedEmail]);
    if (existing.length) {
      return res.status(409).json({ error: 'An account with this email already exists.' });
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const isAdmin = ADMIN_EMAILS.includes(normalizedEmail);
    const { rows } = await query(
      `INSERT INTO users (email, name, password_hash, is_admin)
       VALUES ($1, $2, $3, $4)
       RETURNING id, email, name, is_admin`,
      [normalizedEmail, String(name).trim(), passwordHash, isAdmin],
    );

    setSessionCookie(res, rows[0].id);
    res.status(201).json(toPublicUser(rows[0]));
  } catch (err) {
    next(err);
  }
});

router.post('/login', async (req, res, next) => {
  try {
    const { email, password } = req.body || {};
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required.' });
    }
    const normalizedEmail = String(email).trim().toLowerCase();

    const { rows } = await query('SELECT * FROM users WHERE email = $1', [normalizedEmail]);
    const user = rows[0];
    if (!user || !user.password_hash || !(await bcrypt.compare(password, user.password_hash))) {
      return res.status(401).json({ error: 'Incorrect email or password.' });
    }

    setSessionCookie(res, user.id);
    res.json(toPublicUser(user));
  } catch (err) {
    next(err);
  }
});

router.post('/logout', (req, res) => {
  clearSessionCookie(res);
  res.status(204).end();
});

router.get('/me', requireAuth, (req, res) => {
  res.json({
    id: req.user.id,
    username: req.user.id,
    name: req.user.name,
    email: req.user.email,
    isAdmin: req.user.isAdmin,
  });
});

// --- Google OAuth: server-side authorization-code flow, replacing Cognito's
// Hosted UI. Reuses the same Google Cloud OAuth client the AWS/Cognito path
// already used — this app just adds itself as another authorized redirect
// URI on that client.

const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const STATE_COOKIE = 'oauth_state';
const STATE_COOKIE_MAX_AGE_MS = 5 * 60 * 1000;

function googleRedirectUri(req) {
  return process.env.GOOGLE_REDIRECT_URI || `https://${req.get('host')}/api/auth/google/callback`;
}

router.get('/google', (req, res) => {
  const state = crypto.randomBytes(16).toString('hex');
  res.cookie(STATE_COOKIE, state, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    maxAge: STATE_COOKIE_MAX_AGE_MS,
    path: '/',
  });
  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID,
    redirect_uri: googleRedirectUri(req),
    response_type: 'code',
    scope: 'openid email profile',
    state,
    prompt: 'select_account',
  });
  res.redirect(`${GOOGLE_AUTH_URL}?${params.toString()}`);
});

router.get('/google/callback', async (req, res) => {
  const { code, state } = req.query;
  const cookieState = req.cookies?.[STATE_COOKIE];
  res.clearCookie(STATE_COOKIE, { path: '/' });

  if (!code || !state || !cookieState || state !== cookieState) {
    return res.redirect('/login.html?error=google_state_mismatch');
  }

  try {
    const tokenRes = await fetch(GOOGLE_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: process.env.GOOGLE_CLIENT_ID,
        client_secret: process.env.GOOGLE_CLIENT_SECRET,
        redirect_uri: googleRedirectUri(req),
        grant_type: 'authorization_code',
      }),
    });
    const tokenBody = await tokenRes.json();
    if (!tokenRes.ok || !tokenBody.id_token) {
      console.error('Google token exchange failed:', tokenBody);
      return res.redirect('/login.html?error=google_token_exchange');
    }

    // The id_token's claims are trusted here without re-verifying its JWT
    // signature: it was returned directly to THIS SERVER by Google's token
    // endpoint over a server-to-server HTTPS call authenticated with our own
    // client secret — never touched by the browser. An attacker cannot forge
    // a response from Google's token endpoint, so decoding the payload
    // segment is sufficient; a JWKS-verification library would add
    // dependency weight for no real security gain in this trust model.
    const payloadB64 = tokenBody.id_token.split('.')[1];
    const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'));
    const { sub: googleSub, email, name, email_verified: emailVerified } = payload;
    if (!email || !emailVerified) {
      return res.redirect('/login.html?error=google_email_unverified');
    }
    const normalizedEmail = String(email).trim().toLowerCase();

    let user;
    let found = await query('SELECT * FROM users WHERE google_sub = $1', [googleSub]);
    user = found.rows[0];

    if (!user) {
      // Account-linking: an existing email/password user signing in with
      // Google for the first time gets google_sub attached to their existing
      // row instead of creating a duplicate account for the same email.
      found = await query('SELECT * FROM users WHERE email = $1', [normalizedEmail]);
      user = found.rows[0];
      if (user) {
        const updated = await query(
          'UPDATE users SET google_sub = $1 WHERE id = $2 RETURNING *',
          [googleSub, user.id],
        );
        user = updated.rows[0];
      } else {
        const isAdmin = ADMIN_EMAILS.includes(normalizedEmail);
        const created = await query(
          `INSERT INTO users (email, name, google_sub, is_admin)
           VALUES ($1, $2, $3, $4)
           RETURNING *`,
          [normalizedEmail, name || normalizedEmail, googleSub, isAdmin],
        );
        user = created.rows[0];
      }
    }

    setSessionCookie(res, user.id);
    res.redirect('/sessions.html');
  } catch (err) {
    console.error('Google OAuth callback error:', err);
    res.redirect('/login.html?error=google_unexpected');
  }
});

export default router;
