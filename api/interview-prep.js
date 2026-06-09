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

  // Fetch JD from URL if no text provided
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

  const cvSnip = cvText.slice(0, 2500);
  const jdSnip = jdText.slice(0, 2000);

  const prompt = `You are an expert interview coach. Generate 8 tailored interview questions for this candidate.

Return ONLY a JSON array (no markdown, no explanation) with this shape:
[
  {"q": "interview question text", "a": "2-3 sentence suggested answer approach using candidate's actual experience", "category": "Technical|Behavioural|Experience|Motivation"}
]

Rules:
- Mix categories: 3 Technical, 2 Behavioural, 2 Experience, 1 Motivation
- Technical: reference specific skills/tools from BOTH the CV and JD
- Behavioural: use STAR format hints, reference actual achievements from CV
- Experience: probe depth in most relevant past roles
- Answers must reference specific details from the CV — no generic advice
- Questions should feel like they were written by a real interviewer for this exact role

CV:
${cvSnip}

JOB DESCRIPTION:
${jdSnip}

JSON:`;

  // Try Gemma first with tight timeout
  try {
    const ollamaRes = await fetch(`${OLLAMA_HOST}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: MODEL,
        prompt,
        stream: false,
        options: { temperature: 0.5, num_predict: 800 },
      }),
      signal: AbortSignal.timeout(9000),
    });

    if (ollamaRes.ok) {
      const raw = await ollamaRes.json();
      const responseText = (raw.response || '').trim();
      const jsonMatch = responseText.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        try {
          const questions = JSON.parse(jsonMatch[0]);
          if (Array.isArray(questions) && questions.length >= 3) {
            return res.status(200).json({ questions, _source: 'gemma' });
          }
        } catch (_) { /* fall through */ }
      }
    }
  } catch (_) {
    // Ollama timed out or unavailable — fall through to template
  }

  // Template fallback
  const questions = generateTemplateQuestions(cvText, jdText);
  return res.status(200).json({ questions, _source: 'template' });
};

// ── Template-based question generator ────────────────────────────────
function generateTemplateQuestions(cvText, jdText) {
  const skills    = extractMatchedSkills(cvText, jdText);
  const jobTitle  = extractJobTitle(jdText);
  const cvTitle   = extractCvTitle(cvText);
  const company   = extractCompany(jdText);
  const yearsExp  = extractYears(cvText);
  const achievement = extractAchievement(cvText);
  const role = cvTitle || 'this role';

  const questions = [];

  // Technical questions (skills-based)
  if (skills[0] && skills[1]) {
    questions.push({
      q: `Can you walk us through your experience with ${skills[0]} and how you've applied it in a production environment?`,
      a: `Draw on your hands-on work with ${skills[0]} mentioned in your CV. Be specific about the scale, the problem you solved, and the outcome. If you have metrics (performance gains, cost savings), lead with those.`,
      category: 'Technical',
    });
  }
  if (skills[1]) {
    questions.push({
      q: `This role requires strong ${skills[1]} skills. Describe a challenging problem you solved using ${skills[1]}.`,
      a: `Pick a concrete example from your most recent role. Structure it as: the problem → your technical approach using ${skills[1]} → the result. Avoid vague generalities — name the actual system or project.`,
      category: 'Technical',
    });
  }
  if (skills[2] || skills[0]) {
    const sk = skills[2] || skills[0];
    questions.push({
      q: `How do you stay current with developments in ${sk}? What's something new you've learned recently?`,
      a: `Mention a specific recent update, framework version, or technique you've adopted. Reference how you applied it or plan to. Shows you're proactive about learning — important for fast-moving tech roles.`,
      category: 'Technical',
    });
  }

  // Behavioural questions
  const achPhrase = achievement || 'a complex project';
  questions.push({
    q: `Tell me about a time you had to deliver under a tight deadline. How did you manage it?`,
    a: `Use the STAR framework. Situation: describe the deadline pressure. Task: your responsibility. Action: prioritisation decisions you made${achievement ? ` (e.g., when you ${achPhrase})` : ''}. Result: what you delivered and what you'd do differently.`,
    category: 'Behavioural',
  });
  questions.push({
    q: `Describe a situation where you disagreed with a technical decision made by your team. What did you do?`,
    a: `Show you can advocate for your view professionally while being a team player. Describe the disagreement, how you raised your concern with data or reasoning, and how it was resolved — whether or not you got your way.`,
    category: 'Behavioural',
  });

  // Experience questions
  const expPhrase = yearsExp ? `${yearsExp}+ years` : 'your time';
  questions.push({
    q: `You've spent ${expPhrase} as a ${role}. What's the most technically complex project you've led or contributed to?`,
    a: `Choose your most impressive example that's relevant to this ${jobTitle} role. Explain the complexity (scale, ambiguity, technical depth), your specific contribution, and the measurable impact. Don't undersell scope.`,
    category: 'Experience',
  });
  questions.push({
    q: `Looking at your CV, I see experience in ${skills[0] || role}. How have your responsibilities evolved over your career?`,
    a: `Walk through your progression from IC to higher-impact work. Highlight increased scope, ownership, and the skills you developed. Connect the trajectory to why you're a strong fit for this ${jobTitle} role.`,
    category: 'Experience',
  });

  // Motivation question
  const companyPhrase = company ? `${company}` : 'our company';
  questions.push({
    q: `Why are you interested in this ${jobTitle} role at ${companyPhrase}, and what do you hope to contribute?`,
    a: `Be specific about what drew you to the role and company — not generic reasons. Connect something in the JD to a strength or goal of yours. End with a concrete contribution you'd make in the first 90 days.`,
    category: 'Motivation',
  });

  return questions;
}

// ── Helpers ──────────────────────────────────────────────────────────
const SKILLS_LIST = [
  'Python','JavaScript','TypeScript','Java','C#','C++','Go','React','Angular','Vue',
  'Node.js','AWS','Azure','GCP','Docker','Kubernetes','SQL','PostgreSQL','MongoDB','Redis',
  'Machine Learning','AI','Data Science','DevOps','Agile','Scrum','REST','GraphQL','TensorFlow',
  'Spark','Tableau','Power BI','Salesforce','Product Management','Leadership','Project Management',
  'Risk Management','Testing','QA','Security','Cloud','Microservices','CI/CD','Git',
];

function extractMatchedSkills(cv, jd) {
  const cvLow = cv.toLowerCase(), jdLow = jd.toLowerCase();
  const both  = SKILLS_LIST.filter(s => cvLow.includes(s.toLowerCase()) && jdLow.includes(s.toLowerCase()));
  const cvOnly = SKILLS_LIST.filter(s => cvLow.includes(s.toLowerCase()) && !both.includes(s));
  return [...both, ...cvOnly].slice(0, 5);
}

function extractJobTitle(jd) {
  const m = jd.match(/(?:hiring|looking for|seek(?:ing)?|role[:\s]+|position[:\s]+)\s*(?:a|an)?\s*([A-Z][A-Za-z ]{3,60})/i)
           || jd.match(/^([A-Z][A-Za-z ]{3,60})\s*[-–|]/m);
  if (m) return m[1].trim().replace(/[,.]$/, '');
  const m2 = jd.slice(0, 300).match(/\b([A-Z][a-zA-Z ]{4,40})\b/);
  return m2 ? m2[1].trim() : 'this role';
}

function extractCompany(jd) {
  const m = jd.match(/(?:at|join(?:ing)?|company[:\s]+|about us[:\s]*)\s+([A-Z][A-Za-z0-9&]{2,30}(?:\s[A-Z][A-Za-z0-9&]{1,20}){0,3})/);
  if (m) return m[1].trim().split(/[.,!?;:]| we | is | was | are | has /i)[0].trim();
  return '';
}

function extractCvTitle(cv) {
  const TITLES = ['Engineer','Developer','Manager','Designer','Analyst','Architect','Consultant','Director','Lead','Specialist','Scientist','Officer'];
  for (const line of cv.split('\n').slice(0, 30)) {
    const t = line.trim();
    if (t.length < 80 && TITLES.some(tt => t.includes(tt))) return t.replace(/[|•·]/g,'').trim();
  }
  return '';
}

function extractAchievement(cv) {
  const m = cv.match(/(?:led|built|developed|delivered|reduced|increased|improved|managed|launched|created)\s[^.!?\n]{20,100}/i);
  return m ? m[0].trim() : '';
}

function extractYears(cv) {
  const m = cv.match(/(\d{1,2})\+?\s*years?\s*(?:of\s*)?experience/i);
  if (m) return m[1];
  const years = (cv.match(/\b(19|20)\d{2}\b/g) || []).map(Number);
  if (years.length >= 2) {
    const span = Math.max(...years) - Math.min(...years);
    if (span >= 1) return String(span);
  }
  return '';
}
