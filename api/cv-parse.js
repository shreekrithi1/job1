const { cors } = require('./_utils');

const OLLAMA_HOST = process.env.OLLAMA_HOST || 'http://72.62.97.202:11434';
const MODEL       = process.env.OLLAMA_MODEL || 'gemma3:4b';

module.exports = async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST')    return res.status(405).json({ error: 'Method not allowed' });

  const { text } = req.body || {};
  if (!text || text.trim().length < 20)
    return res.status(400).json({ error: 'CV text is required (min 20 chars)' });

  const snippet = text.slice(0, 6000); // cap to avoid token overflow

  const prompt = `You are a resume parser. Extract structured data from this CV/resume text.

Return ONLY a valid JSON object (no markdown, no explanation) with these fields:
{
  "title": "most recent or target job title",
  "skills": ["skill1", "skill2", ...],
  "location": "city/country if mentioned, else empty string",
  "experience": "entry level | mid level | senior | manager | executive",
  "yearsExp": number or null,
  "summary": "2-sentence professional summary of the candidate"
}

Rules:
- skills: list the top 15 most marketable technical and professional skills
- experience: infer from total years or most recent role seniority
- title: if no clear title, infer the best-fit job title from the skills
- location: only if explicitly stated in the resume

CV TEXT:
---
${snippet}
---

JSON:`;

  try {
    const ollamaRes = await fetch(`${OLLAMA_HOST}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: MODEL,
        prompt,
        stream: false,
        options: { temperature: 0.1, num_predict: 512 },
      }),
      signal: AbortSignal.timeout(25000),
    });

    if (!ollamaRes.ok) {
      const errText = await ollamaRes.text().catch(() => '');
      throw new Error(`Ollama error ${ollamaRes.status}: ${errText.slice(0,200)}`);
    }

    const raw = await ollamaRes.json();
    const responseText = raw.response || '';

    // Extract JSON from response (Gemma sometimes wraps in markdown)
    const jsonMatch = responseText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('No JSON found in Gemma response');

    let parsed;
    try {
      parsed = JSON.parse(jsonMatch[0]);
    } catch {
      throw new Error('Invalid JSON from Gemma: ' + jsonMatch[0].slice(0, 200));
    }

    // Sanitize & return
    return res.status(200).json({
      title:      String(parsed.title      || '').slice(0, 120),
      skills:     Array.isArray(parsed.skills) ? parsed.skills.slice(0, 20).map(s => String(s).slice(0, 60)) : [],
      location:   String(parsed.location   || '').slice(0, 80),
      experience: String(parsed.experience || '').slice(0, 40),
      yearsExp:   typeof parsed.yearsExp === 'number' ? parsed.yearsExp : null,
      summary:    String(parsed.summary    || '').slice(0, 500),
    });

  } catch (err) {
    // Graceful degradation — return empty but valid structure
    console.error('cv-parse error:', err.message);

    // Try lightweight fallback: keyword extraction from text
    const fallbackSkills = extractSkillsFallback(text);
    const titleFallback  = extractTitleFallback(text);

    return res.status(200).json({
      title:      titleFallback,
      skills:     fallbackSkills,
      location:   '',
      experience: '',
      yearsExp:   null,
      summary:    'Parsed from CV (AI unavailable — using keyword extraction).',
      _fallback:  true,
      _error:     err.message,
    });
  }
};

// ── Fallback keyword extractors (no AI needed) ──
function extractSkillsFallback(text) {
  const SKILLS = ['Python','JavaScript','TypeScript','Java','C++','C#','Go','Rust','PHP','Ruby',
    'React','Angular','Vue','Node.js','Django','Flask','Spring','AWS','Azure','GCP',
    'Docker','Kubernetes','Terraform','Git','SQL','PostgreSQL','MongoDB','Redis',
    'GraphQL','REST','Machine Learning','TensorFlow','PyTorch','Spark','Agile','Scrum',
    'Figma','Tableau','Power BI','Salesforce','HTML','CSS','DevOps','Product Management'];
  const lower = text.toLowerCase();
  return SKILLS.filter(s => lower.includes(s.toLowerCase())).slice(0, 15);
}

function extractTitleFallback(text) {
  const m = text.match(/(?:job title|position|role|currently|i am a|working as)[:\s]+([A-Za-z ]{5,60})/i);
  if (m) return m[1].trim();
  // Try to find a line that looks like a job title (short, title-case, near top)
  const lines = text.split('\n').slice(0, 20);
  for (const line of lines) {
    const t = line.trim();
    if (t.length > 5 && t.length < 60 && /^[A-Z]/.test(t) && !/[@\d,;]/.test(t)) return t;
  }
  return '';
}
