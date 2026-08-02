import { Router } from 'express';
import { query } from '../db.js';
import { requireAdmin } from '../middleware.js';

const router = Router();

function toPublic(row) {
  return {
    id: row.id,
    title: row.title,
    date: row.date,
    time: row.time,
    duration: row.duration,
    booked: row.booked,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// Public — guest browsing is allowed (was the `identityPool` guest auth mode
// on the Session model's `allow.guest().to(['read'])` rule).
router.get('/', async (req, res, next) => {
  try {
    const { rows } = await query('SELECT * FROM sessions ORDER BY date, time');
    res.json(rows.map(toPublic));
  } catch (err) {
    next(err);
  }
});

router.get('/:id', async (req, res, next) => {
  try {
    const { rows } = await query('SELECT * FROM sessions WHERE id = $1', [req.params.id]);
    if (!rows[0]) return res.status(404).json({ error: 'Session not found.' });
    res.json(toPublic(rows[0]));
  } catch (err) {
    next(err);
  }
});

router.post('/', requireAdmin, async (req, res, next) => {
  try {
    const { title, date, time, duration, booked } = req.body || {};
    if (!title || !date || !time || !duration) {
      return res.status(400).json({ error: 'title, date, time and duration are required.' });
    }
    const { rows } = await query(
      `INSERT INTO sessions (title, date, time, duration, booked)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [title, date, time, duration, Boolean(booked)],
    );
    res.status(201).json(toPublic(rows[0]));
  } catch (err) {
    next(err);
  }
});

// Field-level rule ported from the original schema's Session.booked
// override: an ordinary authenticated user may update ONLY `booked` (needed
// to book/cancel their own slot); any other field requires admin. This is
// enforced here rather than by requireAdmin on the whole route.
const ADMIN_ONLY_FIELDS = ['title', 'date', 'time', 'duration'];

router.patch('/:id', async (req, res, next) => {
  try {
    if (!req.user) return res.status(401).json({ error: 'Not signed in.' });

    const body = req.body || {};
    const keys = Object.keys(body);
    const touchesAdminOnlyField = keys.some((k) => ADMIN_ONLY_FIELDS.includes(k));
    if (touchesAdminOnlyField && !req.user.isAdmin) {
      return res.status(403).json({ error: 'Only admins can change session details.' });
    }
    if (keys.length === 0) {
      return res.status(400).json({ error: 'No fields to update.' });
    }

    const sets = [];
    const values = [];
    let i = 1;
    for (const [field, column] of [
      ['title', 'title'], ['date', 'date'], ['time', 'time'],
      ['duration', 'duration'], ['booked', 'booked'],
    ]) {
      if (field in body) {
        sets.push(`${column} = $${i}`);
        values.push(body[field]);
        i += 1;
      }
    }
    sets.push('updated_at = now()');
    values.push(req.params.id);

    const { rows } = await query(
      `UPDATE sessions SET ${sets.join(', ')} WHERE id = $${i} RETURNING *`,
      values,
    );
    if (!rows[0]) return res.status(404).json({ error: 'Session not found.' });
    res.json(toPublic(rows[0]));
  } catch (err) {
    next(err);
  }
});

router.delete('/:id', requireAdmin, async (req, res, next) => {
  try {
    const { rowCount } = await query('DELETE FROM sessions WHERE id = $1', [req.params.id]);
    if (!rowCount) return res.status(404).json({ error: 'Session not found.' });
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

export default router;
