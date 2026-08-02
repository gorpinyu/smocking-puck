import { Router } from 'express';
import { query } from '../db.js';
import { requireAuth } from '../middleware.js';

const router = Router();

function toPublic(row) {
  return { id: row.id, name: row.name, createdAt: row.created_at };
}

// Owner-only, no admin override at all — matches the original Player model
// (allow.owner() only; admins cannot read other users' players).
router.get('/', requireAuth, async (req, res, next) => {
  try {
    const { rows } = await query('SELECT * FROM players WHERE user_id = $1 ORDER BY name', [req.user.id]);
    res.json(rows.map(toPublic));
  } catch (err) {
    next(err);
  }
});

router.post('/', requireAuth, async (req, res, next) => {
  try {
    const { name } = req.body || {};
    if (!name || !String(name).trim()) return res.status(400).json({ error: 'name is required.' });
    const { rows } = await query(
      'INSERT INTO players (user_id, name) VALUES ($1, $2) RETURNING *',
      [req.user.id, String(name).trim()],
    );
    res.status(201).json(toPublic(rows[0]));
  } catch (err) {
    next(err);
  }
});

router.delete('/:id', requireAuth, async (req, res, next) => {
  try {
    const { rowCount } = await query(
      'DELETE FROM players WHERE id = $1 AND user_id = $2',
      [req.params.id, req.user.id],
    );
    if (!rowCount) return res.status(404).json({ error: 'Player not found.' });
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

export default router;
