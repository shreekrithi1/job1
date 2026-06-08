const { query, initDB }             = require('../_db');
const { hashPassword, signJWT, cors } = require('../_utils');

module.exports = async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST')    return res.status(405).json({ error: 'Method not allowed' });

  await initDB();

  const { email, password } = req.body || {};
  if (!email || !password)
    return res.status(400).json({ error: 'Email and password required' });

  const result = await query(`
    SELECT id, first_name, last_name, email, is_admin
    FROM jf_users
    WHERE email = $1 AND password_hash = $2
  `, [email.toLowerCase().trim(), hashPassword(password)]);

  if (result.rows.length === 0)
    return res.status(401).json({ error: 'Invalid credentials' });

  const user  = result.rows[0];
  const token = signJWT({ id: user.id, email: user.email, name: `${user.first_name} ${user.last_name}`, isAdmin: user.is_admin });

  return res.status(200).json({ token, name: `${user.first_name} ${user.last_name}`, email: user.email, isAdmin: user.is_admin });
};
