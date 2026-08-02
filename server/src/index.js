import express from 'express';
import cookieParser from 'cookie-parser';
import { runMigrations, query } from './db.js';
import { attachUser } from './middleware.js';
import authRoutes from './routes/auth.js';
import sessionsRoutes from './routes/sessions.js';
import bookingsRoutes from './routes/bookings.js';
import playersRoutes from './routes/players.js';
import historyRoutes from './routes/history.js';
import adminRoutes from './routes/admin.js';

const app = express();
app.disable('x-powered-by');
app.use(express.json());
app.use(cookieParser());
app.use(attachUser);

app.get('/api/health', async (req, res) => {
  try {
    await query('SELECT 1');
    res.json({ status: 'ok' });
  } catch (err) {
    res.status(500).json({ status: 'error', error: err.message });
  }
});

app.use('/api/auth', authRoutes);
app.use('/api/sessions', sessionsRoutes);
app.use('/api/bookings', bookingsRoutes);
app.use('/api/players', playersRoutes);
app.use('/api/booking-history', historyRoutes);
app.use('/api/admin', adminRoutes);

// Keeps every /api response JSON, matching what the frontend's fetch-based
// client shim (app.js) expects — an HTML error page here would break its
// `{ data, errors }` parsing.
app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
});

const PORT = process.env.PORT || 3000;

runMigrations()
  .then(() => {
    app.listen(PORT, () => console.log(`hockey-api listening on :${PORT}`));
  })
  .catch((err) => {
    console.error('Migration failed, exiting:', err);
    process.exit(1);
  });
