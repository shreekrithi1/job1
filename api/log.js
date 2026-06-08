// Stores search logs in-memory per serverless instance (survives warm invocations).
// For durable storage across cold starts, swap the in-memory store for Vercel KV / a DB.
const logs = global._jf_logs || (global._jf_logs = []);

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-gateway-token');

  if (req.method === 'OPTIONS') return res.status(200).end();

  const token = req.headers['x-gateway-token'];
  if (token !== process.env.GATEWAY_TOKEN) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  // POST — record a search event
  if (req.method === 'POST') {
    const { email, name, keyword, location, country, jobType, portals, semantic, resultsCount } = req.body || {};
    const entry = {
      id:           Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      ts:           new Date().toISOString(),
      email:        email || 'unknown',
      name:         name  || 'unknown',
      keyword:      keyword   || '',
      location:     location  || '',
      country:      country   || '',
      jobType:      jobType   || '',
      portals:      Array.isArray(portals) ? portals.join(', ') : '',
      semantic:     !!semantic,
      resultsCount: resultsCount || 0,
    };
    logs.push(entry);
    // Keep last 5000 entries
    if (logs.length > 5000) logs.splice(0, logs.length - 5000);
    return res.status(200).json({ ok: true });
  }

  // GET — return logs (admin only, verified by admin password header)
  if (req.method === 'GET') {
    const adminPass = req.headers['x-admin-password'];
    if (adminPass !== process.env.ADMIN_PASSWORD) {
      return res.status(403).json({ error: 'Admin access denied' });
    }
    const limit  = Math.min(parseInt(req.query.limit || '500', 10), 5000);
    const offset = parseInt(req.query.offset || '0', 10);
    const search = (req.query.q || '').toLowerCase();

    let filtered = search
      ? logs.filter(l =>
          l.email.includes(search) || l.keyword.includes(search) ||
          l.country.includes(search) || l.name.toLowerCase().includes(search))
      : logs;

    filtered = [...filtered].reverse(); // newest first
    const page = filtered.slice(offset, offset + limit);

    return res.status(200).json({
      total: filtered.length,
      logs: page,
      stats: {
        totalSearches: logs.length,
        uniqueUsers:   [...new Set(logs.map(l => l.email))].length,
        todaySearches: logs.filter(l => l.ts.startsWith(new Date().toISOString().slice(0,10))).length,
      }
    });
  }

  return res.status(405).json({ error: 'Method not allowed' });
};
