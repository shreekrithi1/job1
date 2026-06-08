module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-gateway-token');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const token = req.headers['x-gateway-token'];
  if (token !== process.env.GATEWAY_TOKEN) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { query, location, country, jobType } = req.body;
  if (!query) return res.status(400).json({ error: 'Query required' });

  const OLLAMA_HOST    = process.env.OLLAMA_HOST    || 'http://72.62.97.202:11434';
  const OLLAMA_MODEL   = process.env.OLLAMA_MODEL   || 'gemma3:4b';
  const OLLAMA_TIMEOUT = parseInt(process.env.OLLAMA_TIMEOUT || '25', 10) * 1000;

  const context = [query, location, country, jobType].filter(Boolean).join(', ');

  const prompt = `You are a job search expert. Given this job search context: "${context}"
Generate exactly 3 diverse and specific job board search queries to find relevant job postings.
Vary the terminology (title synonyms, skills, seniority levels).
Return ONLY a valid JSON array of 3 strings. No explanation, no markdown, just the array.
Example: ["senior software engineer remote", "backend developer python aws", "software developer full stack"]
JSON:`;

  try {
    const controller = new AbortController();
    const tid = setTimeout(() => controller.abort(), OLLAMA_TIMEOUT);

    const response = await fetch(`${OLLAMA_HOST}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: OLLAMA_MODEL,
        prompt,
        stream: false,
        options: { temperature: 0.4, num_predict: 150 }
      }),
      signal: controller.signal
    });

    clearTimeout(tid);
    if (!response.ok) throw new Error(`Ollama HTTP ${response.status}`);

    const data = await response.json();
    const text = (data.response || '').trim();
    const match = text.match(/\[[\s\S]*?\]/);
    if (!match) throw new Error('No JSON array in Ollama response');

    const queries = JSON.parse(match[0]);
    if (!Array.isArray(queries) || queries.length === 0) throw new Error('Empty queries');

    return res.status(200).json({ queries: queries.slice(0, 3), enhanced: true });
  } catch (err) {
    console.error('Ollama error:', err.message);
    // Graceful fallback — build queries without Ollama
    const base = query;
    const loc  = location || country || '';
    const fallback = [
      `${base}${loc ? ' ' + loc : ''} job opening`,
      `${base} career opportunity${jobType ? ' ' + jobType : ''}`,
      `${base} hiring now${loc ? ' ' + loc : ''}`
    ];
    return res.status(200).json({ queries: fallback, enhanced: false, fallback: true });
  }
};
