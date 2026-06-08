const { Pool }        = require('pg');
const { hashPassword } = require('./_utils');

let pool;
let initialized = false;

function getPool() {
  if (!pool) {
    const raw = process.env.POSTGRES_URL || '';
    const isLocal = raw.includes('localhost') || raw.includes('127.0.0.1');

    // Remove sslmode from query string so pg doesn't conflict with our ssl option
    let connStr = raw;
    try {
      const u = new URL(raw);
      u.searchParams.delete('sslmode');
      connStr = u.toString();
    } catch (_) { /* leave as-is if URL parse fails */ }

    pool = new Pool({
      connectionString: connStr,
      ssl: isLocal ? false : { rejectUnauthorized: false },
      max: 5,
    });
  }
  return pool;
}

async function query(sql, params = []) {
  const client = await getPool().connect();
  try {
    return await client.query(sql, params);
  } finally {
    client.release();
  }
}

async function initDB() {
  if (initialized) return;

  await query(`
    CREATE TABLE IF NOT EXISTS jf_users (
      id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      first_name   TEXT NOT NULL,
      last_name    TEXT NOT NULL,
      email        TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      country_code TEXT    DEFAULT '',
      phone        TEXT    DEFAULT '',
      is_admin     BOOLEAN DEFAULT FALSE,
      created_at   TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS jf_search_logs (
      id            SERIAL PRIMARY KEY,
      user_email    TEXT,
      user_name     TEXT,
      keyword       TEXT,
      location      TEXT,
      country       TEXT,
      job_type      TEXT,
      portals       TEXT,
      semantic      BOOLEAN DEFAULT FALSE,
      results_count INTEGER DEFAULT 0,
      searched_at   TIMESTAMPTZ DEFAULT NOW()
    );
  `);

  // Seed admin user (admin / Ch@rlott5)
  const adminHash = hashPassword('Ch@rlott5');
  await query(`
    INSERT INTO jf_users (first_name, last_name, email, password_hash, is_admin)
    VALUES ('Admin', 'Charlotte', 'admin', $1, TRUE)
    ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash, is_admin = TRUE
  `, [adminHash]);

  initialized = true;
}

module.exports = { query, initDB };
