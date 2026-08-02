import pg from 'pg';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const { Pool } = pg;
const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const pool = new Pool({ connectionString: process.env.DATABASE_URL });

export const query = (text, params) => pool.query(text, params);

// Runs the (idempotent, CREATE ... IF NOT EXISTS) migration file on every
// startup. Fine for this app's size — a dedicated migration-tracking table
// would be overkill for one file.
export async function runMigrations() {
  const sql = fs.readFileSync(path.join(__dirname, '..', 'migrations', '001_init.sql'), 'utf8');
  await pool.query(sql);
}

// Runs `fn` inside a BEGIN/COMMIT transaction on a single dedicated client,
// rolling back on any error. Used by endpoints that must write more than one
// table atomically (currently just POST /api/admin/book-for-user).
export async function withTransaction(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// Postgres unique_violation. Routes use this to turn a UNIQUE-constraint hit
// (e.g. two concurrent bookings on the same session) into a clean 409
// instead of a generic 500.
export const isUniqueViolation = (err) => err && err.code === '23505';
