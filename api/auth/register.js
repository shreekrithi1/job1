const { query, initDB }          = require('../_db');
const { hashPassword, signJWT, cors } = require('../_utils');

module.exports = async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST')    return res.status(405).json({ error: 'Method not allowed' });

  if (req.headers['x-gateway-token'] !== process.env.GATEWAY_TOKEN)
    return res.status(401).json({ error: 'Unauthorized' });

  if (!process.env.POSTGRES_URL)
    return res.status(500).json({ error: 'POSTGRES_URL not configured' });

  try {
    await initDB();
  } catch (e) {
    return res.status(500).json({ error: 'DB init failed: ' + e.message });
  }

  const { firstName, lastName, email, password, countryCode, phone } = req.body || {};

  if (!firstName || !lastName || !email || !password)
    return res.status(400).json({ error: 'Missing required fields' });
  if (password.length < 8)
    return res.status(400).json({ error: 'Password must be at least 8 characters' });

  try {
    const lowerEmail = email.toLowerCase().trim();
    const exists     = await query('SELECT id FROM jf_users WHERE email = $1', [lowerEmail]);
    if (exists.rows.length > 0)
      return res.status(409).json({ error: 'An account with this email already exists' });

    const result = await query(`
      INSERT INTO jf_users (first_name, last_name, email, password_hash, country_code, phone)
      VALUES ($1,$2,$3,$4,$5,$6)
      RETURNING id, first_name, last_name, email, is_admin
    `, [firstName, lastName, lowerEmail, hashPassword(password), countryCode||'', phone||'']);

    const user  = result.rows[0];
    const token = signJWT({ id: user.id, email: user.email, name: `${user.first_name} ${user.last_name}`, isAdmin: user.is_admin });

    return res.status(201).json({ token, name: `${user.first_name} ${user.last_name}`, email: user.email, isAdmin: user.is_admin });
  } catch (e) {
    return res.status(500).json({ error: 'Registration failed: ' + e.message });
  }
};
