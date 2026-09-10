/**
 * bot/helpers/jobFilter.js
 * Strict filtering for Pure Software / AI & ML engineering jobs (>= 6 LPA).
 */

const NON_ENGINEERING_BLACKLIST = [
  'counsellor', 'counselor', 'counseling', 'counselling',
  'academic', 'admission', 'admissions', 'advisor', 'advisory',
  'customer service', 'customer support', 'customer care', 'client support',
  'technical support', 'tech support', 'helpdesk', 'service desk', 'desktop support',
  'service specialist', 'service interface', 'logistics', 'supply chain',
  'bpo', 'kpo', 'call center', 'telecaller', 'telemarketing', 'telesales',
  'voice process', 'non voice', 'non-voice', 'chat support', 'operations executive',
  'data entry', 'back office', 'sales', 'business development', 'bde', 'bda',
  'inside sales', 'field sales', 'marketing', 'recruiter', 'talent acquisition', 'hr',
  'content writer', 'seo', 'copywriter', 'social media',
  'hardware', 'embedded', 'vlsi', 'pcb', 'mechanical', 'civil', 'electrical',
  'dataannotation', 'data annotation', 'teacher', 'faculty', 'trainer',
  'technician', 'consultant', 'infra pm', 'network consultant',
  'detailer', 'detailing', 'vehicle detailer', 'car detailer',
  'cma', 'cma trainee', 'ca trainee', 'accountant', 'accounting', 'audit', 'taxation', 'finance',
  'apprentice trainee', 'graduate apprentice trainee', 'gat',
  'cleaner', 'driver', 'cashier', 'cook', 'carpenter', 'porter', 'fitter', 'operator'
];

const HIGH_EXPERIENCE_TITLE_BLACKLIST = [
  'senior', 'sr.', 'sr ', 'lead', 'principal', 'staff',
  'manager', 'architect', 'director', 'head of', 'vp', 'vice president',
  'team lead', 'tech lead', 'sde 2', 'sde 3', 'sde 4', 'sde-2', 'sde-3', 'sde-4',
  'sde-ii', 'sde-iii', 'sde-iv', 'sde ii', 'sde iii', 'sde iv',
  'level 2', 'level 3', 'level 4', 'l2', 'l3', 'l4', 'l5', 'l6',
  'specialist iii', 'engineer iii', 'engineer iv', 'expert', 'chapter lead',
  'lead engineer', 'lead developer', 'principal engineer', 'staff engineer',
  'engineering manager', 'solution architect', 'system architect', 'enterprise architect',
  'data architect', 'cloud architect', 'chief architect', 'distinguished engineer', 'fellow'
];

const ENGINEERING_WHITELIST = [
  'software', 'sde', 'developer', 'engineer', 'programmer', 'coder',
  'backend', 'frontend', 'full stack', 'fullstack', 'web developer',
  'ai', 'ml', 'machine learning', 'artificial intelligence', 'deep learning',
  'nlp', 'llm', 'generative ai', 'genai', 'computer vision', 'vision', 'agentic',
  'data scientist', 'data engineer', 'data science', 'mlops',
  'python', 'java', 'golang', 'c++', 'node', 'react', 'mern', 'angular', 'rust'
];

const INDIA_LOCATIONS = [
  'india', 'bengaluru', 'bangalore', 'delhi', 'new delhi', 'ncr', 'gurgaon', 'gurugram',
  'noida', 'mumbai', 'pune', 'hyderabad', 'chennai', 'kolkata', 'ahmedabad', 'jaipur',
  'kochi', 'coimbatore', 'chandigarh', 'indore', 'kerala', 'karnataka', 'maharashtra',
  'telangana', 'tamil nadu', 'haryana', 'uttar pradesh', 'mysore', 'mysuru', 'bhubaneswar',
  'lucknow', 'nagpur', 'surat', 'visakhapatnam', 'remote in india', 'india / remote',
  'remote / india', 'pan india', 'anywhere in india'
];

const REMOTE_KEYWORDS = [
  'remote', 'work from home', 'wfh', 'work from anywhere', 'telecommute',
  'virtual', 'distributed', 'home-based', 'anywhere', 'worldwide remote', 'remote / global'
];

const FOREIGN_RESTRICTIONS = [
  'relocation: not allowed', 'relocation not allowed',
  'visa sponsorship: not available', 'visa sponsorship not available',
  'no visa sponsorship', 'visa not sponsored',
  'must reside in the us', 'must reside in the united states',
  'must be located in the us', 'must be authorized to work in the us',
  'authorized to work in the us', 'us only', 'u.s. only', 'usa only',
  'united states only', 'north america only', 'europe only', 'eu only',
  'uk only', 'canada only'
];

const FOREIGN_RESTRICTION_REGEXES = [
  /(?:visa\s*(?:sponsorship)?|sponsorship)\s*[:\-\n•\s]*not\s*available/i,
  /(?:no\s*visa\s*sponsorship|visa\s*(?:is\s*)?not\s*sponsored)/i,
  /relocation\s*[:\-\n•\s]*not\s*(?:allowed|covered|provided|sponsored)/i,
  /must\s*(?:reside|be\s*located)\s*in\s*(?:the\s*)?(?:us|usa|united\s*states|u\.s\.)/i,
  /authorized\s*to\s*work\s*in\s*(?:the\s*)?(?:us|usa|united\s*states|u\.s\.)\s*without\s*sponsorship/i,
  /\b(?:us|u\.s\.)\s*citizen(?:ship)?\s*(?:only|required)\b/i,
  /\b(?:security\s*clearance|secret\s*clearance|top\s*secret|ts\/sci|public\s*trust)\b/i,
];

const FOREIGN_CITIES_COUNTRIES = [
  'san francisco', 'new york', 'nyc', 'seattle', 'austin', 'california', 'los angeles',
  'chicago', 'boston', 'united states', 'usa', 'canada', 'toronto', 'vancouver',
  'united kingdom', 'london', 'germany', 'berlin', 'munich', 'netherlands',
  'amsterdam', 'france', 'paris', 'singapore', 'australia', 'sydney', 'melbourne',
  'ireland', 'dublin', 'switzerland', 'zurich', 'tokyo', 'japan', 'israel',
  'tysons', 'tysons corner', 'virginia', 'arlington', 'reston', 'mclean', 'alexandria',
  'washington dc', 'washington d.c.', 'dallas', 'houston', 'atlanta', 'denver',
  'miami', 'philadelphia', 'phoenix', 'san diego', 'san jose', 'sunnyvale',
  'mountain view', 'palo alto', 'santa clara', 'redmond', 'bellevue', 'boulder',
  'cambridge', 'texas', 'florida', 'maryland', 'massachusetts', 'colorado',
  'illinois', 'north carolina', 'ohio', 'pennsylvania'
];

/**
 * Validates work location: user can only work remotely or anywhere within India.
 * Rejects foreign on-site/hybrid positions and positions with visa/relocation restrictions.
 */
function isAllowedLocation(location, title = '', notes = '') {
  const combined = `${location || ''} ${title || ''} ${notes || ''}`.toLowerCase();

  // 1. Check for explicit relocation/visa blocks or US/EU-only geographic restrictions
  for (const restr of FOREIGN_RESTRICTIONS) {
    if (combined.includes(restr)) {
      return {
        allowed: false,
        reason: `Matches location/visa restriction: "${restr}"`
      };
    }
  }

  for (const regex of FOREIGN_RESTRICTION_REGEXES) {
    const match = combined.match(regex);
    if (match) {
      return {
        allowed: false,
        reason: `Matches location/visa restriction: "${match[0].trim()}"`
      };
    }
  }

  // Check for US Federal / Government clearance roles (e.g. "Data Scientist (Federal)")
  if (/\b(?:federal|clearance|security\s*clearance|public\s*trust|ts\/sci)\b/i.test(title)) {
    return {
      allowed: false,
      reason: `Role requires US Federal / Government clearance: "${title}"`
    };
  }

  // 2. Check if explicitly marked Remote
  const isRemote = REMOTE_KEYWORDS.some(kw => combined.includes(kw));

  // 3. Check if located in India
  const isIndia = INDIA_LOCATIONS.some(kw => {
    const escaped = kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`(?:^|[^a-zA-Z0-9])${escaped}(?:[^a-zA-Z0-9]|$)`, 'i');
    return regex.test(combined);
  });

  // If both Remote and foreign restriction are present, the restriction check above already rejected it.
  if (isRemote || isIndia) {
    // Double check that it's not a foreign-only remote role (e.g. "Remote - US Only", "Remote (Tysons, VA)")
    for (const place of FOREIGN_CITIES_COUNTRIES) {
      const regex = new RegExp(`(?:^|[^a-zA-Z0-9])${place}(?:[^a-zA-Z0-9]|$)`, 'i');
      if (regex.test(combined) && !isIndia && (combined.includes('only') || combined.includes('hybrid') || combined.includes('onsite') || combined.includes('on-site'))) {
        return {
          allowed: false,
          reason: `Location is restricted to foreign region: "${place}"`
        };
      }
    }
    return { allowed: true };
  }

  // 4. Check for foreign cities/countries without Remote indicator
  for (const place of FOREIGN_CITIES_COUNTRIES) {
    const regex = new RegExp(`(?:^|[^a-zA-Z0-9])${place}(?:[^a-zA-Z0-9]|$)`, 'i');
    if (regex.test(combined)) {
      return {
        allowed: false,
        reason: `Location is foreign non-remote: "${place}" (only Remote or India allowed)`
      };
    }
  }

  // If location is blank and not explicitly foreign, allow if from domestic portal
  return { allowed: true };
}

/**
 * Checks if a posting specifies ineligibility criteria (e.g. College students not allowed).
 */
function isEligibleJob(text) {
  if (!text || typeof text !== 'string') return { eligible: true };
  const s = text.toLowerCase();

  const ineligiblePhrases = [
    'college students are not allowed',
    'college students not allowed',
    'no college students',
    'working professionals only',
    'only for working professionals',
    'only working professionals',
    'experienced professionals only',
    'only 2022/2023',
    'only 2023 batch',
    'only 2024 batch'
  ];

  for (const phrase of ineligiblePhrases) {
    if (s.includes(phrase)) {
      return { eligible: false, reason: `Ineligible criteria: "${phrase}"` };
    }
  }

  return { eligible: true };
}

/**
 * Checks if a salary string represents at least minLpa (default 6 LPA).
 * Returns true if salary meets or exceeds minLpa, OR if salary is unstated.
 * Returns false ONLY if an explicitly stated salary is below minLpa.
 */
function isSalaryAboveThreshold(salaryStr, minLpa = 6) {
  if (!salaryStr || typeof salaryStr !== 'string') return true;
  const s = salaryStr.trim().toLowerCase();
  if (!s || s.includes('not disclosed') || s.includes('competitive') || s.includes('best in industry')) {
    return true;
  }

  // Check for foreign currencies ($ / £ / €) -> typically well above 6 LPA
  if (s.includes('$') || s.includes('€') || s.includes('£') || s.includes('usd') || s.includes('eur')) {
    return true;
  }

  // 1. Lakhs / LPA formats: e.g. "3-5 lacs p.a.", "6 - 12 lpa", "8.5 lakhs", "₹3L - ₹7L"
  const lpaMatch = s.match(/([\d.]+)\s*(?:-|to)\s*([\d.]+)\s*(?:lacs|lakh|lakhs|lpa|l\b)/i) ||
                   s.match(/([\d.]+)\s*(?:lacs|lakh|lakhs|lpa|l\b)/i);
  if (lpaMatch) {
    const minVal = parseFloat(lpaMatch[1]);
    const maxVal = parseFloat(lpaMatch[2] || lpaMatch[1]);
    // If the top of the range is below minLpa, reject
    if (!isNaN(maxVal) && maxVal < minLpa) {
      return false;
    }
    return true;
  }

  // 2. Full numbers: e.g. "₹3,00,000 - ₹5,00,000" or "₹600,000 - ₹1,200,000"
  const numbers = s.replace(/,/g, '').match(/\d{5,8}/g);
  if (numbers && numbers.length > 0) {
    const maxNum = Math.max(...numbers.map(n => parseInt(n, 10)));
    const targetInRupees = minLpa * 100000;
    return maxNum >= targetInRupees;
  }

  // 3. Monthly salary: e.g. "₹25,000 - ₹35,000 a month"
  if (s.includes('month') || s.includes('/mo') || s.includes('p.m')) {
    const monthlyNumbers = s.replace(/,/g, '').match(/\d{4,6}/g);
    if (monthlyNumbers && monthlyNumbers.length > 0) {
      const maxMonthly = Math.max(...monthlyNumbers.map(n => parseInt(n, 10)));
      const annual = (maxMonthly * 12) / 100000; // in LPA
      return annual >= minLpa;
    }
  }

  return true;
}

/**
 * Checks if the text requires high experience (> 2 years) or senior seniority.
 * Shashwat is a fresher / entry-level engineer with internship experience.
 */
function isHighExperienceJob(text) {
  if (!text || typeof text !== 'string') return { isHigh: false };
  const s = text.toLowerCase();

  // 1. Check title seniority keywords
  for (const kw of HIGH_EXPERIENCE_TITLE_BLACKLIST) {
    const regex = new RegExp(`\\b${kw.replace('.', '\\.')}\\b`, 'i');
    if (regex.test(s)) {
      return { isHigh: true, reason: `Matches senior/high-experience title keyword: "${kw}"` };
    }
  }

  // 2. Check parenthesized experience ranges: e.g. "(10-12 yrs)", "(5-10 yrs)", "(4-10 yrs)", "(5-7 yrs)", "(10-13 yrs)"
  const parenMatch = s.match(/\(\s*(\d+)\s*(?:-|to|\+)\s*(\d+)?\s*(?:years?|yrs?)\s*\)/i);
  if (parenMatch) {
    const minYears = parseInt(parenMatch[1], 10);
    const maxYears = parenMatch[2] ? parseInt(parenMatch[2], 10) : minYears;
    if (minYears > 2 || maxYears > 3) {
      return { isHigh: true, reason: `Requires ${minYears}-${maxYears} years experience (Fresher filter: max 2 years)` };
    }
  }

  // 3. Check explicit experience ranges: e.g. "5-10 yrs", "10-12 yrs", "2-5 years", "Exp - 6+yrs", "3-5 years"
  const expMatch = s.match(/(?:exp(?:erience)?\s*[:\-]?\s*)?(\d+)\s*(?:\+|-\s*(\d+)|\s*to\s*(\d+))\s*(?:years?|yrs?)/i);
  if (expMatch) {
    const minYears = parseInt(expMatch[1], 10);
    const maxYears = parseInt(expMatch[2] || expMatch[3] || expMatch[1], 10);
    if (minYears > 2 || maxYears > 3) {
      return { isHigh: true, reason: `Requires ${minYears}-${maxYears} years experience (Fresher filter: max 2 years)` };
    }
  }

  // 4. Check standalone "X+ yrs" / "X+ years" (e.g. "3+ yrs", "5+ years")
  const plusYrsMatch = s.match(/\b([3-9]|\d{2,})\s*\+\s*(?:years?|yrs?)/i);
  if (plusYrsMatch) {
    return { isHigh: true, reason: `Requires ${plusYrsMatch[1]}+ years experience (Fresher filter: max 2 years)` };
  }

  // 5. Check "minimum X years" / "at least X years"
  const minYearsMatch = s.match(/\b(?:min(?:imum)?|at\s*least)\s*([3-9]|\d{2,})\s*(?:years?|yrs?)/i);
  if (minYearsMatch) {
    return { isHigh: true, reason: `Requires at least ${minYearsMatch[1]} years experience (Fresher filter: max 2 years)` };
  }

  // 6. Check "X years of experience"
  const ofExpMatch = s.match(/\b([3-9]|\d{2,})\s*(?:years?|yrs?)\s*(?:of\s*)?exp/i);
  if (ofExpMatch) {
    return { isHigh: true, reason: `Requires ${ofExpMatch[1]}+ years experience (Fresher filter: max 2 years)` };
  }

  return { isHigh: false };
}

/**
 * Validates whether a job posting is a genuine pure Software / AI / ML job
 * and satisfies the user's role, fresher experience, salary, and location requirements.
 */
function isDesiredEngineeringJob(job, options = {}) {
  const minLpa = options.minLpa || 6;
  const customSkip = (options.skipKeywords || []).map(k => k.toLowerCase());

  const title = (job.title || '').toLowerCase();
  const company = (job.company || '').toLowerCase();
  const combined = `${title} ${company}`;

  // 1. Check blacklist (counsellor, customer service, support, etc.)
  for (const kw of NON_ENGINEERING_BLACKLIST) {
    if (kw.length <= 3) {
      const regex = new RegExp(`\\b${kw}\\b`, 'i');
      if (regex.test(combined)) {
        return { valid: false, reason: `Matches non-engineering keyword: "${kw}"` };
      }
    } else if (combined.includes(kw)) {
      return { valid: false, reason: `Matches non-engineering keyword: "${kw}"` };
    }
  }

  for (const kw of customSkip) {
    if (kw.length <= 3) {
      const regex = new RegExp(`\\b${kw}\\b`, 'i');
      if (regex.test(combined)) {
        return { valid: false, reason: `Matches custom skip keyword: "${kw}"` };
      }
    } else if (combined.includes(kw)) {
      return { valid: false, reason: `Matches custom skip keyword: "${kw}"` };
    }
  }

  // 2. High-experience / Senior check (Fresher with 0-2 yrs max requirement)
  const expCheck = isHighExperienceJob(
    (job.title || '') + ' ' + (job.salary || '') + ' ' + (job.notes || '') + ' ' + (job.location || '')
  );
  if (expCheck.isHigh) {
    return { valid: false, reason: expCheck.reason };
  }

  // 3. Location filter (Remote anywhere, or anywhere within India only)
  const locCheck = isAllowedLocation(job.location, job.title, job.notes);
  if (!locCheck.allowed) {
    return { valid: false, reason: locCheck.reason };
  }

  // 4. Eligibility check (e.g. College students not allowed)
  const eligCheck = isEligibleJob((job.title || '') + ' ' + (job.notes || ''));
  if (!eligCheck.eligible) {
    return { valid: false, reason: eligCheck.reason };
  }

  // 5. Must match pure software / AI / ML engineering keywords (strictly word-bounded for single words / acronyms)
  const isEng = ENGINEERING_WHITELIST.some(kw => {
    if (kw.includes(' ')) {
      return title.includes(kw);
    }
    const escaped = kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`(?:^|[^a-zA-Z0-9])${escaped}(?:[^a-zA-Z0-9]|$)`, 'i');
    return regex.test(title);
  });

  if (!isEng) {
    return { valid: false, reason: `Title "${job.title}" does not contain software / AI / ML engineering role keywords` };
  }

  // 6. Must have a valid URL
  if (!job.jobUrl || typeof job.jobUrl !== 'string' || !job.jobUrl.startsWith('http')) {
    return { valid: false, reason: 'Missing or invalid job posting URL' };
  }

  // 7. Check for closed postings
  if (title.includes('closed') || company.includes('closed')) {
    return { valid: false, reason: 'Job is marked as closed' };
  }

  // 8. Salary check (at least 6 LPA)
  if (job.salary && !isSalaryAboveThreshold(job.salary, minLpa)) {
    return { valid: false, reason: `Salary "${job.salary}" is below ${minLpa} LPA threshold` };
  }

  return { valid: true };
}

module.exports = {
  isDesiredEngineeringJob,
  isSalaryAboveThreshold,
  isHighExperienceJob,
  isAllowedLocation,
  isEligibleJob,
  NON_ENGINEERING_BLACKLIST,
  ENGINEERING_WHITELIST,
  HIGH_EXPERIENCE_TITLE_BLACKLIST,
  INDIA_LOCATIONS,
  REMOTE_KEYWORDS,
};

