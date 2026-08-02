import { Router } from 'express';
import { query, withTransaction, isUniqueViolation } from '../db.js';
import { requireAdmin } from '../middleware.js';

const router = Router();
router.use(requireAdmin);

// Replaces amplify/functions/manage-users' listAppUsers.
router.get('/users', async (req, res, next) => {
  try {
    const { rows } = await query('SELECT id, email, name, is_admin FROM users ORDER BY name');
    res.json(rows.map((u) => ({ username: u.id, email: u.email, name: u.name, isAdmin: u.is_admin })));
  } catch (err) {
    next(err);
  }
});

// Replaces amplify/functions/manage-users' setAdminRole. `username` in the
// URL is the user's id (see auth.js's toPublicUser comment — no separate
// username/sub split needed without Cognito). Keeps the same self-revoke
// guard: a documented safety net against accidental self-lockout, not a
// hard permission boundary (an admin could still revoke themselves via
// direct DB access — same as the original Lambda's comment noted).
router.post('/users/:username/admin-role', async (req, res, next) => {
  try {
    const targetId = req.params.username;
    const { makeAdmin } = req.body || {};
    if (typeof makeAdmin !== 'boolean') {
      return res.status(400).json({ error: 'makeAdmin (boolean) is required.' });
    }
    if (makeAdmin === false && targetId === req.user.id) {
      return res.status(400).json({ error: 'You cannot revoke your own admin access.' });
    }

    const { rows } = await query(
      'UPDATE users SET is_admin = $1 WHERE id = $2 RETURNING id, is_admin',
      [makeAdmin, targetId],
    );
    if (!rows[0]) return res.status(404).json({ error: 'User not found.' });
    res.json({ username: rows[0].id, isAdmin: rows[0].is_admin });
  } catch (err) {
    next(err);
  }
});

// Replaces amplify/functions/book-for-user. Looks the guardian up by email;
// if found, the booking/history rows are owned by them (so they show up on
// their own My Bookings/My History); if not, falls back to the calling
// admin's own identity and reports attributedToGuardian:false so the
// frontend can surface its one-time alert — same fallback as the original
// Lambda. Does NOT touch sessions.booked — session-management.js does that
// itself via a follow-up PATCH, exactly like the original flow.
router.post('/book-for-user', async (req, res, next) => {
  try {
    const {
      sessionId, sessionDate, sessionTime, sessionTitle,
      guardianEmail, guardianName, mode, playerName, playerName2,
    } = req.body || {};
    if (!sessionId || !sessionDate || !sessionTime || !sessionTitle || !guardianEmail || !guardianName || !playerName) {
      return res.status(400).json({ error: 'Missing required fields for booking.' });
    }
    const normalizedEmail = String(guardianEmail).trim().toLowerCase();

    const result = await withTransaction(async (client) => {
      const { rows: guardianRows } = await client.query('SELECT id FROM users WHERE email = $1', [normalizedEmail]);
      const guardianId = guardianRows[0]?.id || null;
      const attributedToGuardian = Boolean(guardianId);
      const ownerId = guardianId || req.user.id;

      const { rows: bookingRows } = await client.query(
        `INSERT INTO bookings (session_id, user_id, session_date, user_name, user_email, mode, player_name, player_name2)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING id`,
        [sessionId, ownerId, sessionDate, guardianName, guardianEmail, mode || null, playerName, playerName2 || null],
      );

      await client.query(
        `INSERT INTO booking_history
           (user_id, action, session_id, session_date, session_time, session_title, user_name, user_email, mode, player_name, player_name2)
         VALUES ($1, 'BOOKED', $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [ownerId, sessionId, sessionDate, sessionTime, sessionTitle, guardianName, guardianEmail, mode || null, playerName, playerName2 || null],
      );

      return {
        id: bookingRows[0].id,
        userName: guardianName,
        userEmail: guardianEmail,
        mode: mode || null,
        playerName,
        playerName2: playerName2 || null,
        attributedToGuardian,
      };
    });

    res.status(201).json(result);
  } catch (err) {
    if (isUniqueViolation(err)) {
      return res.status(409).json({ error: 'This session is already booked.' });
    }
    next(err);
  }
});

export default router;
