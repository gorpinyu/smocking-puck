import { Router } from 'express';
import { query, isUniqueViolation } from '../db.js';
import { requireAuth } from '../middleware.js';

const router = Router();

function toPublic(row) {
  return {
    id: row.id,
    sessionId: row.session_id,
    sessionDate: row.session_date,
    userName: row.user_name,
    userEmail: row.user_email,
    mode: row.mode,
    playerName: row.player_name,
    playerName2: row.player_name2,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// GET /api/bookings            -> caller's own bookings only (any authenticated user)
// GET /api/bookings?sessionId= -> ALL bookings for that session (admin only) — this is
//   the one deliberate behavior change from the original AWS app: there, an admin's
//   *unfiltered* Booking.list() (used by their own My Bookings page) accidentally
//   returned every user's bookings, because `allow.group('Admins').to(['read'])` applies
//   regardless of filter. Session Management's admin use case (list bookings for one
//   session) only ever needs the filtered form, so scoping the unfiltered form to "mine"
//   for everyone — including admins — fixes the leak without breaking anything that was
//   actually relied on.
router.get('/', requireAuth, async (req, res, next) => {
  try {
    const { sessionId } = req.query;
    if (sessionId) {
      if (!req.user.isAdmin) return res.status(403).json({ error: 'Admins only.' });
      const { rows } = await query('SELECT * FROM bookings WHERE session_id = $1', [sessionId]);
      return res.json(rows.map(toPublic));
    }
    const { rows } = await query('SELECT * FROM bookings WHERE user_id = $1', [req.user.id]);
    res.json(rows.map(toPublic));
  } catch (err) {
    next(err);
  }
});

router.post('/', requireAuth, async (req, res, next) => {
  try {
    const { sessionId, sessionDate, userName, userEmail, mode, playerName, playerName2 } = req.body || {};
    if (!sessionId || !sessionDate || !userName || !userEmail || !playerName) {
      return res.status(400).json({ error: 'sessionId, sessionDate, userName, userEmail and playerName are required.' });
    }
    const { rows } = await query(
      `INSERT INTO bookings (session_id, user_id, session_date, user_name, user_email, mode, player_name, player_name2)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      [sessionId, req.user.id, sessionDate, userName, userEmail, mode || null, playerName, playerName2 || null],
    );
    res.status(201).json(toPublic(rows[0]));
  } catch (err) {
    if (isUniqueViolation(err)) {
      return res.status(409).json({ error: 'This session is already booked.' });
    }
    next(err);
  }
});

// Owner, or an admin (matches allow.owner() + allow.group('Admins').to(['read','delete'])
// — admins can read/delete any booking, but never create one directly; that's what
// POST /api/admin/book-for-user is for).
router.delete('/:id', requireAuth, async (req, res, next) => {
  try {
    const { rows } = await query('SELECT user_id FROM bookings WHERE id = $1', [req.params.id]);
    if (!rows[0]) return res.status(404).json({ error: 'Booking not found.' });
    if (rows[0].user_id !== req.user.id && !req.user.isAdmin) {
      return res.status(403).json({ error: 'Not allowed to cancel this booking.' });
    }
    await query('DELETE FROM bookings WHERE id = $1', [req.params.id]);
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

export default router;
