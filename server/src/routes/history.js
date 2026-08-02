import { Router } from 'express';
import { query } from '../db.js';
import { requireAuth } from '../middleware.js';

const router = Router();

function toPublic(row) {
  return {
    id: row.id,
    action: row.action,
    sessionId: row.session_id,
    sessionDate: row.session_date,
    sessionTime: row.session_time,
    sessionTitle: row.session_title,
    userName: row.user_name,
    userEmail: row.user_email,
    mode: row.mode,
    playerName: row.player_name,
    playerName2: row.player_name2,
    createdAt: row.created_at,
  };
}

// Own rows only for a regular user; ALL rows for an admin — ported as-is
// from the original schema (allow.owner().to(['create','read']) +
// allow.group('Admins').to(['create','read'])), including the same quirk
// that an admin's own "My History" page (my-bookings.html) shows everyone's
// history, same as it did on AWS. Unlike Booking.list(), this wasn't flagged
// as something to fix — kept for exact parity.
router.get('/', requireAuth, async (req, res, next) => {
  try {
    if (req.user.isAdmin) {
      const { rows } = await query('SELECT * FROM booking_history ORDER BY created_at DESC');
      return res.json(rows.map(toPublic));
    }
    const { rows } = await query(
      'SELECT * FROM booking_history WHERE user_id = $1 ORDER BY created_at DESC',
      [req.user.id],
    );
    res.json(rows.map(toPublic));
  } catch (err) {
    next(err);
  }
});

// Any authenticated user may log their own BOOKED/CANCELLED event — this is
// how sessions.js/my-bookings.js/session-management.js each record history
// as a follow-up call after their own booking/cancel action, not something
// only the server does internally. The row is always owned by the caller,
// even when an admin is cancelling someone else's booking on their behalf
// (matches the original's allow.owner() behavior, and the documented,
// accepted trade-off that such a CANCELLED entry is owned by the admin, not
// the guardian).
router.post('/', requireAuth, async (req, res, next) => {
  try {
    const {
      action, sessionId, sessionDate, sessionTime, sessionTitle,
      userName, userEmail, mode, playerName, playerName2,
    } = req.body || {};
    if (!action || !sessionId || !sessionDate || !sessionTime || !sessionTitle || !userName || !userEmail) {
      return res.status(400).json({ error: 'Missing required booking-history fields.' });
    }
    const { rows } = await query(
      `INSERT INTO booking_history
         (user_id, action, session_id, session_date, session_time, session_title, user_name, user_email, mode, player_name, player_name2)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       RETURNING *`,
      [req.user.id, action, sessionId, sessionDate, sessionTime, sessionTitle, userName, userEmail, mode || null, playerName || null, playerName2 || null],
    );
    res.status(201).json(toPublic(rows[0]));
  } catch (err) {
    next(err);
  }
});

export default router;
