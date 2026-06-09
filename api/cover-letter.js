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

// ── Template-based cover letter generator (randomised variants) ──────
function pick(arr, seed) { return arr[Math.abs(seed) % arr.length]; }

function generateTemplateLetter(cvText, jdText) {
  const name        = extractName(cvText);
  const jobTitle    = extractJobTitle(jdText);
  const company     = extractCompany(jdText);
  const cvTitle     = extractCvTitle(cvText);
  const topSkills   = extractTopSkills(cvText, jdText);
  const achievement = extractAchievement(cvText);
  const yearsExp    = extractYears(cvText);

  // Time-based seed — changes every call so regenerating gives a different letter
  const seed = Math.floor(Date.now() / 1000);

  const skillList = topSkills.length >= 2
    ? topSkills.slice(0, 3).join(', ')
    : 'relevant technical and business skills';
  const sk0  = topSkills[0] || 'my field';
  const sk1  = topSkills[1] || 'related areas';
  const sk2  = topSkills[2] || sk0;
  const ach  = achievement ? ` ${achievement}.` : '';
  const role = cvTitle || 'professional';

  // ── Opener variants ──
  const openers = company ? [
    `I am writing to express my strong interest in the ${jobTitle} role at ${company}.`,
    `I was excited to come across the ${jobTitle} opportunity at ${company}.`,
    `The ${jobTitle} position at ${company} immediately caught my attention.`,
    `I am applying with great enthusiasm for the ${jobTitle} role at ${company}.`,
  ] : [
    `I am writing to express my strong interest in the ${jobTitle} position.`,
    `I am excited to apply for the ${jobTitle} opportunity.`,
    `The ${jobTitle} role is a compelling match for my background and ambitions.`,
    `I am keen to be considered for the ${jobTitle} position.`,
  ];

  // ── Experience phrase variants ──
  const expPhrases = yearsExp ? [
    `With ${yearsExp}+ years of experience as a ${role}`,
    `Having spent over ${yearsExp} years working as a ${role}`,
    `As a ${role} with more than ${yearsExp} years of hands-on experience`,
    `Drawing on ${yearsExp}+ years as a ${role}`,
  ] : [
    `As an experienced ${role}`,
    `As a results-driven ${role}`,
    `As a skilled ${role}`,
    `With a strong background as a ${role}`,
  ];

  // ── P1 bridge variants (all start with "I ..." so joining is clean) ──
  const p1Bridges = [
    `I have developed a strong foundation in ${skillList} that aligns closely with the requirements outlined in your job description.${ach}`,
    `I bring deep expertise in ${skillList}, which maps directly to what you are looking for.${ach}`,
    `I have built proven capabilities in ${skillList} — each a core requirement for this role.${ach}`,
    `I offer a background spanning ${skillList}, giving me a strong fit with your requirements.${ach}`,
  ];

  // ── Middle paragraph variants ──
  const midParas = [
    `Throughout my career, I have consistently delivered results by applying my expertise in ${sk0} and ${sk1}. I thrive in collaborative environments and have a proven track record of taking ownership of complex challenges and delivering measurable outcomes. My background equips me with both the technical depth and the communication skills needed to make an immediate impact.`,
    `My experience with ${sk0} has allowed me to tackle complex problems and drive meaningful results. I am comfortable working across cross-functional teams and have a strong habit of translating technical work into tangible business value. Paired with my skills in ${sk1} and ${sk2}, I am confident I can contribute from day one.`,
    `I have a track record of using ${sk0} to solve real-world challenges — going beyond implementation to understand the wider business impact. Collaboration and clear communication are central to how I work, and my proficiency in ${sk1} has consistently helped me bridge technical and non-technical stakeholders.`,
    `What sets me apart is the combination of hands-on depth in ${sk0} with the ability to see the bigger picture. I approach problems methodically, bring structure to ambiguity, and consistently deliver. My experience with ${sk1} and ${sk2} rounds out a profile that I believe maps closely to what you need.`,
  ];

  // ── Closing paragraph variants ──
  const closings = company ? [
    `I am excited about the opportunity to bring my expertise to ${company} and contribute to your team's success. I welcome the chance to discuss how my background would benefit your organisation. Please find my CV attached, and I look forward to hearing from you.`,
    `Joining ${company} would be a genuine career highlight, and I am confident I can make a strong contribution from the outset. I would welcome the chance to discuss this further at your convenience. My CV is attached.`,
    `I am drawn to ${company} for the calibre of its work and the challenge of the ${jobTitle} role. I would be delighted to explore how I can add value — please do not hesitate to reach out. My CV is attached for your review.`,
    `The prospect of contributing to ${company} as a ${jobTitle} is one I find genuinely compelling. I am available for a conversation at any time and have attached my CV for your consideration.`,
  ] : [
    `I am excited about this opportunity and confident I would be a strong addition to your team. I welcome the chance to discuss how my experience aligns with your needs. Please find my CV attached.`,
    `This role feels like a natural next step in my career, and I am eager to bring my skills to your team. I would be happy to discuss further at your convenience. My CV is attached.`,
    `I believe I can make a meaningful contribution and would welcome the opportunity to discuss that in more detail. Please find my CV attached for your review.`,
    `I look forward to the possibility of discussing this role further. I am confident my background makes me a strong candidate, and I have attached my CV for your consideration.`,
  ];

  const opener  = pick(openers,    seed);
  const expPhrase = pick(expPhrases, seed + 1);
  const p1bridge  = pick(p1Bridges,  seed + 2);
  const midPara   = pick(midParas,   seed + 3);
  const closing   = pick(closings,   seed + 4);

  return `Dear Hiring Manager,

${opener} ${expPhrase}, ${p1bridge}

${midPara}

${closing}

Yours sincerely,
${name}`;
}

function extractName(cv) {
  // CV section headers to skip
  const SKIP = /^(summary|profile|objective|education|experience|skills|contact|references|about|cv|resume|curriculum)/i;
  for (const line of cv.split('\n').slice(0, 15)) {
    const t = line.trim();
    // Must look like a name: 2-5 words, title-case start, no special chars/digits, not a section header
    if (t.length > 4 && t.length < 55
      && /^[A-Z][a-z]/.test(t)
      && !/[@\d:|•\/\\(]/.test(t)
      && t.split(/\s+/).length >= 2
      && t.split(/\s+/).length <= 5
      && !SKIP.test(t))
      return t;
  }
  return '';
}

function extractJobTitle(jd) {
  // Blocklist words that look capitalised but aren't titles
  const BLOCK = /^(hands|on|the|a|an|our|we|us|you|your|this|that|about|join|apply|full|part|senior|junior|mid|level|based|required|preferred|plus|key|top|great|good|strong|new|all|any|each|both|role|team|work|working|job|position|opportunity|company|inc|ltd|llc|corp)$/i;

  const m = jd.match(/(?:hiring|looking for|seek(?:ing)?|role[:\s]+|position[:\s]+|job title[:\s]+)\s*(?:a|an)?\s*([A-Z][A-Za-z ]{3,60})/i)
           || jd.match(/^([A-Z][A-Za-z ]{3,60})\s*[-–|]/m);
  if (m) {
    const title = m[1].trim().replace(/[,.]$/, '');
    // Filter out single blocked words
    if (title.split(' ').length > 1 || !BLOCK.test(title)) return title;
  }
  // Fall back to first multi-word capitalised phrase in first 400 chars
  const first = jd.slice(0, 400);
  const candidates = [...first.matchAll(/\b([A-Z][a-z]+(?:\s[A-Z][a-z]+)+)\b/g)];
  for (const c of candidates) {
    const w = c[1].trim();
    if (w.length > 5 && w.split(' ').length >= 2) return w;
  }
  return 'this role';
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
