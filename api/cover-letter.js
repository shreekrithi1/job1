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
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; iCareeer/1.0)', 'Accept': 'text/html' },
        signal: AbortSignal.timeout(8000),
        redirect: 'follow',
      });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const html = await resp.text();
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

  const prompt = `You are an expert career coach. Write a compelling, personalised cover letter.

Rules:
- 3 paragraphs, professional but warm tone
- Opening: genuine interest in the specific role/company
- Middle: match 3 key achievements/skills from the CV to the JD requirements
- Closing: confident call to action
- Under 300 words
- Do NOT include placeholder brackets like [Your Name]

CV:
${cvSnip}

JOB DESCRIPTION:
${jdSnip}

COVER LETTER:`;

  // Try Gemma first — tight timeout so Vercel function stays alive
  try {
    const ollamaRes = await fetch(`${OLLAMA_HOST}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: MODEL,
        prompt,
        stream: false,
        options: { temperature: 0.6, num_predict: 600 },
      }),
      signal: AbortSignal.timeout(9000),
    });

    if (ollamaRes.ok) {
      const raw = await ollamaRes.json();
      const letter = (raw.response || '').trim();
      if (letter && letter.length > 100) {
        return res.status(200).json({ letter, _source: 'gemma' });
      }
    }
  } catch (_) {
    // Ollama unavailable or timed out — fall through to template
  }

  // ── Template fallback (always works without Gemma) ──
  const letter = generateTemplateLetter(cvText, jdText);
  return res.status(200).json({ letter, _source: 'template' });
};

// ── Template-based cover letter generator ─────────────────────────
function generateTemplateLetter(cvText, jdText) {
  const name        = extractName(cvText);
  const jobTitle    = extractJobTitle(jdText);
  const company     = extractCompany(jdText);
  const cvTitle     = extractCvTitle(cvText);
  const topSkills   = extractTopSkills(cvText, jdText);
  const achievement = extractAchievement(cvText);
  const yearsExp    = extractYears(cvText);

  const intro = company
    ? `I am writing to express my strong interest in the ${jobTitle} role at ${company}.`
    : `I am writing to express my strong interest in the ${jobTitle} position.`;

  const expPhrase = yearsExp
    ? `With ${yearsExp}+ years of experience as a ${cvTitle || 'professional'}`
    : `As an experienced ${cvTitle || 'professional'}`;

  const skillList = topSkills.length >= 2
    ? topSkills.slice(0, 3).join(', ')
    : 'relevant technical and business skills';

  const ach = achievement
    ? ` ${achievement}.`
    : '';

  const closing = company
    ? `I am excited about the opportunity to bring my expertise to ${company} and contribute to your team's success.`
    : `I am excited about this opportunity and confident I would be a strong addition to your team.`;

  return `Dear Hiring Manager,

${intro} ${expPhrase}, I have developed a strong foundation in ${skillList} that aligns closely with the requirements outlined in your job description.${ach}

Throughout my career, I have consistently delivered results by applying my expertise in ${topSkills[0] || 'my field'} and ${topSkills[1] || 'related areas'}. I thrive in collaborative environments and have a proven track record of taking ownership of complex challenges and delivering measurable outcomes. My background equips me with both the technical depth and the communication skills needed to make an immediate impact.

${closing} I welcome the opportunity to discuss how my background and skills would benefit your organisation. Please find my CV attached, and I look forward to hearing from you.

Yours sincerely,
${name}`;
}

function extractName(cv) {
  // First non-empty line that looks like a name (short, no symbols, title-case)
  for (const line of cv.split('\n').slice(0, 10)) {
    const t = line.trim();
    if (t.length > 3 && t.length < 50 && /^[A-Z][a-z]/.test(t) && !/[@\d:|•]/.test(t) && t.split(' ').length <= 5)
      return t;
  }
  return 'Your Name';
}

function extractJobTitle(jd) {
  const m = jd.match(/(?:hiring|looking for|seek(?:ing)?|role[:\s]+|position[:\s]+|job title[:\s]+)\s*(?:a|an)?\s*([A-Z][A-Za-z ]{3,60})/i)
           || jd.match(/^([A-Z][A-Za-z ]{3,60})\s*[-–|]/m);
  if (m) return m[1].trim().replace(/[,.]$/, '');
  // Try first capitalised phrase in first 300 chars
  const first = jd.slice(0, 300);
  const m2 = first.match(/\b([A-Z][a-zA-Z ]{4,40})\b/);
  return m2 ? m2[1].trim() : 'this role';
}

function extractCompany(jd) {
  const m = jd.match(/(?:at|join(?:ing)?|company[:\s]+|about us[:\s]*)\s+([A-Z][A-Za-z0-9&]{2,30}(?:\s[A-Z][A-Za-z0-9&]{1,20}){0,3})/);
  if (m) {
    // Stop at punctuation or stop words
    const raw = m[1].trim();
    return raw.split(/[.,!?;:]| we | is | was | are | has /i)[0].trim();
  }
  return '';
}

function extractCvTitle(cv) {
  // Look for a job title pattern in the first 30 lines
  const TITLES = ['Engineer','Developer','Manager','Designer','Analyst','Architect','Consultant','Director','Lead','Specialist','Scientist','Officer','Coordinator'];
  for (const line of cv.split('\n').slice(0, 30)) {
    const t = line.trim();
    if (t.length < 80 && TITLES.some(tt => t.includes(tt))) return t.replace(/[|•·]/g, '').trim();
  }
  return '';
}

function extractTopSkills(cv, jd) {
  const SKILLS = ['Python','JavaScript','TypeScript','Java','C#','C++','Go','React','Angular','Vue',
    'Node.js','AWS','Azure','GCP','Docker','Kubernetes','SQL','PostgreSQL','MongoDB','Redis',
    'Machine Learning','AI','Data Science','DevOps','Agile','Scrum','REST','GraphQL','TensorFlow',
    'Spark','Tableau','Power BI','Salesforce','Product Management','Leadership','Communication',
    'Project Management','Risk Management','Testing','QA','Security','Cloud','Microservices'];
  const cvLow = cv.toLowerCase(), jdLow = jd.toLowerCase();
  // Prefer skills that appear in BOTH cv and jd
  const both = SKILLS.filter(s => cvLow.includes(s.toLowerCase()) && jdLow.includes(s.toLowerCase()));
  const cvOnly = SKILLS.filter(s => cvLow.includes(s.toLowerCase()) && !both.includes(s));
  return [...both, ...cvOnly].slice(0, 5);
}

function extractAchievement(cv) {
  const m = cv.match(/(?:led|built|developed|delivered|reduced|increased|improved|managed|launched|created)\s[^.!?\n]{20,120}/i);
  return m ? m[0].trim() : '';
}

function extractYears(cv) {
  const m = cv.match(/(\d{1,2})\+?\s*years?\s*(?:of\s*)?experience/i);
  if (m) return m[1];
  // Try counting unique year numbers mentioned in dates
  const years = (cv.match(/\b(19|20)\d{2}\b/g) || []).map(Number);
  if (years.length >= 2) {
    const span = Math.max(...years) - Math.min(...years);
    if (span >= 1) return String(span);
  }
  return '';
}
