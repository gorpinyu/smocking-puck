import jwt from 'jsonwebtoken';
import { query } from './db.js';

export const COOKIE_NAME = 'hp_session';
const COOKIE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

export function signToken(userId) {
  return jwt.sign({ sub: userId }, process.env.JWT_SECRET, { expiresIn: '30d' });
}

// secure:true is always correct here — the site is only ever reached over
// HTTPS (Cloudflare terminates TLS at the edge; Caddy talks plain HTTP to
// this API only inside the private Docker network). sameSite:'lax' (not
// 'strict') is required for the Google OAuth redirect back from
// accounts.google.com to still carry the cookie on landing.
export function setSessionCookie(res, userId) {
  res.cookie(COOKIE_NAME, signToken(userId), {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    maxAge: COOKIE_MAX_AGE_MS,
    path: '/',
  });
}

export function clearSessionCookie(res) {
  res.clearCookie(COOKIE_NAME, { path: '/' });
}

// Populates req.user (or null) from the session cookie on every request.
// Never rejects — routes that require a signed-in user use requireAuth/
// requireAdmin below on top of this.
export async function attachUser(req, res, next) {
  const token = req.cookies?.[COOKIE_NAME];
  if (!token) {
    req.user = null;
    return next();
  }
  try {
    const { sub } = jwt.verify(token, process.env.JWT_SECRET);
    const { rows } = await query(
      'SELECT id, email, name, is_admin FROM users WHERE id = $1',
      [sub],
    );
    req.user = rows[0]
      ? { id: rows[0].id, email: rows[0].email, name: rows[0].name, isAdmin: rows[0].is_admin }
      : null;
  } catch {
    req.user = null;
  }
  next();
}

export function requireAuth(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Not signed in.' });
  next();
}

export function requireAdmin(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Not signed in.' });
  if (!req.user.isAdmin) return res.status(403).json({ error: 'Admins only.' });
  next();
}
