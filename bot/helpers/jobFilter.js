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
  'team lead', 'tech lead', 'sde 2', 'sde 3', 'sde-2', 'sde-3', 'sde-ii', 'sde-iii',
  'sde ii', 'sde iii', 'level 2', 'level 3', 'l2', 'l3', 'l4', 'l5', 'l6',
  'specialist iii', 'engineer iii', 'engineer iv', 'expert', 'chapter lead'
];

const ENGINEERING_WHITELIST = [
  'software', 'sde', 'developer', 'engineer', 'programmer', 'coder',
  'backend', 'frontend', 'full stack', 'fullstack', 'web developer',
  'ai', 'ml', 'machine learning', 'artificial intelligence', 'deep learning',
  'nlp', 'llm', 'generative ai', 'genai', 'computer vision', 'vision', 'agentic',
  'data scientist', 'data engineer', 'data science', 'mlops',
  'python', 'java', 'golang', 'c++', 'node', 'react', 'mern', 'angular', 'rust'
];

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
 * Shashwat is a fresher with 9 months of internship experience.
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

  // 2. Check explicit experience ranges (e.g. "Exp - 6+yrs", "3-5 years", "4+ years")
  const expMatch = s.match(/(?:exp(?:erience)?\s*[:\-]?\s*)?(\d+)\s*(?:\+|-\s*(\d+)|\s*to\s*(\d+))?\s*(?:years?|yrs?)/i);
  if (expMatch) {
    const minYears = parseInt(expMatch[1], 10);
    if (minYears > 2) {
      return { isHigh: true, reason: `Requires ${minYears}+ years experience (Fresher filter: max 2 years)` };
    }
  }

  // 3. Check standalone "X+ yrs"
  const plusYrsMatch = s.match(/\b([3-9]|\d{2,})\s*\+\s*(?:years?|yrs?)/i);
  if (plusYrsMatch) {
    return { isHigh: true, reason: `Requires ${plusYrsMatch[1]}+ years experience (Fresher filter: max 2 years)` };
  }

  return { isHigh: false };
}

/**
 * Validates whether a job posting is a genuine pure Software / AI / ML job
 * and satisfies the user's role, fresher experience, and salary requirements.
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

  // 2. High-experience / Senior check (Fresher with 9mo experience requirement)
  const expCheck = isHighExperienceJob(job.title + ' ' + (job.salary || '') + ' ' + (job.notes || ''));
  if (expCheck.isHigh) {
    return { valid: false, reason: expCheck.reason };
  }

  // 3. Must match pure software / AI / ML engineering keywords (strictly word-bounded for single words / acronyms)
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

  // 4. Must have a valid URL
  if (!job.jobUrl || typeof job.jobUrl !== 'string' || !job.jobUrl.startsWith('http')) {
    return { valid: false, reason: 'Missing or invalid job posting URL' };
  }

  // 5. Check for closed postings
  if (title.includes('closed') || company.includes('closed')) {
    return { valid: false, reason: 'Job is marked as closed' };
  }

  // 6. Salary check (at least 6 LPA)
  if (job.salary && !isSalaryAboveThreshold(job.salary, minLpa)) {
    return { valid: false, reason: `Salary "${job.salary}" is below ${minLpa} LPA threshold` };
  }

  return { valid: true };
}

module.exports = {
  isDesiredEngineeringJob,
  isSalaryAboveThreshold,
  isHighExperienceJob,
  NON_ENGINEERING_BLACKLIST,
  ENGINEERING_WHITELIST,
  HIGH_EXPERIENCE_TITLE_BLACKLIST,
};
