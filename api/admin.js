const { query, initDB }       = require('./_db');
const { verifyJWT, getBearer, cors } = require('./_utils');

module.exports = async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET')     return res.status(405).json({ error: 'Method not allowed' });

  const payload = verifyJWT(getBearer(req));
  if (!payload || !payload.isAdmin)
    return res.status(403).json({ error: 'Admin access required' });

  await initDB();

  const page   = Math.max(0, parseInt(req.query.page  || '0',   10));
  const limit  = 50;
  const offset = page * limit;
  const q      = (req.query.q || '').toLowerCase();

  const logsResult = q
    ? await query(`
        SELECT * FROM jf_search_logs
        WHERE LOWER(user_email) LIKE $1 OR LOWER(user_name) LIKE $1
           OR LOWER(keyword) LIKE $1 OR LOWER(country) LIKE $1
        ORDER BY searched_at DESC LIMIT $2 OFFSET $3
      `, [`%${q}%`, limit, offset])
    : await query(
        'SELECT * FROM jf_search_logs ORDER BY searched_at DESC LIMIT $1 OFFSET $2',
        [limit, offset]
      );

  const [totalLogs, uniqueUsers, todayLogs, users] = await Promise.all([
    query('SELECT COUNT(*) FROM jf_search_logs'),
    query('SELECT COUNT(DISTINCT user_email) FROM jf_search_logs'),
    query(`SELECT COUNT(*) FROM jf_search_logs WHERE searched_at >= CURRENT_DATE`),
    query('SELECT id, first_name, last_name, email, country_code, is_admin, created_at FROM jf_users ORDER BY created_at DESC LIMIT 200'),
  ]);

  return res.status(200).json({
    stats: {
      totalSearches:   parseInt(totalLogs.rows[0].count,  10),
      uniqueSearchers: parseInt(uniqueUsers.rows[0].count, 10),
      todaySearches:   parseInt(todayLogs.rows[0].count,  10),
      totalUsers:      users.rows.length,
    },
    logs:  logsResult.rows,
    users: users.rows,
    page, limit,
  });
};
