const { query, initDB }               = require('../_db');
const { hashPassword, signJWT, cors } = require('../_utils');

// Hardcoded admin fallback — works even without a database
const ADMIN_USER = 'admin';
const ADMIN_PASS = 'Ch@rlott5';

module.exports = async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST')    return res.status(405).json({ error: 'Method not allowed' });

  const { email, password } = req.body || {};
  if (!email || !password)
    return res.status(400).json({ error: 'Email and password required' });

  const id = email.toLowerCase().trim();

  // ── Hardcoded admin check (no DB needed) ──
  if (id === ADMIN_USER && password === ADMIN_PASS) {
    const token = signJWT({ id: 'admin', email: ADMIN_USER, name: 'Admin Charlotte', isAdmin: true });
    return res.status(200).json({ token, name: 'Admin Charlotte', email: ADMIN_USER, isAdmin: true });
  }

  // ── DB check (when POSTGRES_URL is configured) ──
  if (!process.env.POSTGRES_URL)
    return res.status(401).json({ error: 'Invalid email or password' });

  try {
    await initDB();

    const result = await query(`
      SELECT id, first_name, last_name, email, is_admin
      FROM jf_users
      WHERE email = $1 AND password_hash = $2
    `, [id, hashPassword(password)]);

    if (result.rows.length === 0)
      return res.status(401).json({ error: 'Invalid email or password' });

    const user  = result.rows[0];
    const token = signJWT({
      id: user.id, email: user.email,
      name: `${user.first_name} ${user.last_name}`,
      isAdmin: user.is_admin
    });

    return res.status(200).json({
      token,
      name:    `${user.first_name} ${user.last_name}`,
      email:   user.email,
      isAdmin: user.is_admin
    });
  } catch (err) {
    console.error('Login error:', err.message);
    return res.status(500).json({ error: 'Login failed: ' + err.message });
  }
};
