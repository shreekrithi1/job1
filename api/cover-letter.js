const { cors } = require('./_utils');

const OLLAMA_HOST = process.env.OLLAMA_HOST || 'http://72.62.97.202:11434';
const MODEL       = process.env.OLLAMA_MODEL || 'gemma3:4b';

module.exports = async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST')    return res.status(405).json({ error: 'Method not allowed' });

  let { cvText, jdUrl, jdText } = req.body || {};

  if (!cvText || cvText.trim().length < 20)
    return res.status(400).json({ error: 'CV text is required (min 20 chars)' });

  // If a URL is provided, fetch and strip the JD HTML server-side
  if (!jdText && jdUrl) {
    try {
      const resp = await fetch(jdUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; iCareeer/1.0)',
          'Accept': 'text/html,application/xhtml+xml',
        },
        signal: AbortSignal.timeout(12000),
        redirect: 'follow',
      });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const html = await resp.text();
      // Strip tags, collapse whitespace, cap length
      jdText = html
        .replace(/<style[\s\S]*?<\/style>/gi, '')
        .replace(/<script[\s\S]*?<\/script>/gi, '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 4000);
    } catch (e) {
      return res.status(422).json({ error: `Could not fetch job URL: ${e.message}` });
    }
  }

  if (!jdText || jdText.trim().length < 20)
    return res.status(400).json({ error: 'Job description is required — provide a URL or paste text' });

  const cvSnip = cvText.slice(0, 3000);
  const jdSnip = jdText.slice(0, 2500);

  const prompt = `You are an expert career coach and professional cover letter writer.

Write a compelling, personalised cover letter for the candidate based on their CV and the job description below.

Guidelines:
- 3–4 paragraphs, professional but warm tone
- Opening: express genuine interest in the specific role/company
- Middle: match 3–4 key achievements/skills from the CV to the JD requirements
- Closing: confident call to action
- Do NOT use generic filler phrases like "I am writing to apply…"
- Do NOT include placeholder brackets like [Your Name] — write naturally
- Keep it under 350 words

---
CV / RESUME:
${cvSnip}

---
JOB DESCRIPTION:
${jdSnip}

---
COVER LETTER:`;

  try {
    const ollamaRes = await fetch(`${OLLAMA_HOST}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: MODEL,
        prompt,
        stream: false,
        options: { temperature: 0.6, num_predict: 800 },
      }),
      signal: AbortSignal.timeout(45000),
    });

    if (!ollamaRes.ok) {
      const errText = await ollamaRes.text().catch(() => '');
      throw new Error(`Ollama ${ollamaRes.status}: ${errText.slice(0, 200)}`);
    }

    const raw = await ollamaRes.json();
    const letter = (raw.response || '').trim();
    if (!letter) throw new Error('Empty response from Gemma');

    return res.status(200).json({ letter });

  } catch (err) {
    console.error('cover-letter error:', err.message);
    return res.status(500).json({ error: `AI generation failed: ${err.message}` });
  }
};
