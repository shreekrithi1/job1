const { query, initDB } = require('./_db');
const { cors }          = require('./_utils');

module.exports = async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST')    return res.status(405).json({ error: 'Method not allowed' });

  if (req.headers['x-gateway-token'] !== process.env.GATEWAY_TOKEN)
    return res.status(401).json({ error: 'Unauthorized' });

  const apiKey = process.env.PARALLEL_API_KEY;
  if (!apiKey)
    return res.status(500).json({ error: 'PARALLEL_API_KEY not set in Vercel environment variables.' });

  const { _log, ...searchBody } = req.body || {};

  try {
    const response = await fetch('https://api.parallel.ai/v1/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey },
      body: JSON.stringify(searchBody),
    });

    const data = await response.json();
    if (!response.ok) return res.status(response.status).json(data);

    // Fire-and-forget log to Postgres
    if (_log) {
      initDB()
        .then(() => query(`
          INSERT INTO jf_search_logs
            (user_email, user_name, keyword, location, country, job_type, portals, semantic, results_count)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
        `, [
          _log.email    || '',
          _log.name     || '',
          _log.keyword  || '',
          _log.location || '',
          _log.country  || '',
          _log.jobType  || '',
          _log.portals  || '',
          !!_log.semantic,
          (data.results || []).length,
        ]))
        .catch(err => console.error('Log insert failed:', err.message));
    }

    return res.status(200).json(data);
  } catch (err) {
    console.error('Parallel API error:', err);
    return res.status(500).json({ error: err.message || 'Internal server error' });
  }
};
