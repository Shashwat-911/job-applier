/**
 * bot/platforms/naukri.js
 * Naukri.com one-click apply automation with login flow.
 * Exports: search(page, profile), apply(page, job, profile)
 */

const { fillField, humanDelay, detectCaptcha, safeClick } = require('../helpers/formFiller');
const { reviewPause } = require('../helpers/reviewPause');
const tracker = require('../../db/tracker');
const fs      = require('fs');
const path    = require('path');

const BASE_URL    = 'https://www.naukri.com';
const SESSION_DIR = path.join(__dirname, '..', 'session');
const COOKIES_PATH= path.join(SESSION_DIR, 'naukri_cookies.json');

// ── login() ──────────────────────────────────────────────────────────────────

/**
 * Log into Naukri with credentials from profile.
 * Saves cookies on success.
 * @param {import('playwright').Page} page
 * @param {Object} profile
 * @returns {Promise<boolean>}
 */
async function login(page, profile) {
  const creds = profile?.credentials?.naukri;
  if (!creds?.email || !creds?.password) {
    console.error('  ❌ Naukri credentials missing in profile.json → credentials.naukri');
    return false;
  }

  console.log('  🔐 Logging into Naukri…');
  await page.goto(`${BASE_URL}/nlogin`, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await humanDelay(1500, 2500);

  if (await detectCaptcha(page)) {
    console.warn('  🤖 CAPTCHA on Naukri login — cannot proceed');
    return false;
  }

  try {
    await fillField(page,
      ['input[type="email"]', '#usernameField', 'input[placeholder*="email"]', 'input[name="username"]'],
      creds.email
    );
    await humanDelay(500, 1000);
    await fillField(page,
      ['input[type="password"]', '#passwordField', 'input[placeholder*="password"]', 'input[name="password"]'],
      creds.password
    );
    await humanDelay(500, 1000);

    const loginBtn = await page.$('button[type="submit"], .loginButton, button:has-text("Login")');
    if (loginBtn) await loginBtn.click();

    await page.waitForLoadState('domcontentloaded', { timeout: 15000 });
    await humanDelay(2000, 3000);

    // Check if login was successful by looking for user-specific elements
    const loggedIn = await page.$('.nI-gNb-header__name, .user-name, [class*="username"]').then(Boolean).catch(() => false);

    if (loggedIn) {
      console.log('  ✅ Naukri login successful');
      // Save session
      if (!fs.existsSync(SESSION_DIR)) fs.mkdirSync(SESSION_DIR, { recursive: true });
      const cookies = await page.context().cookies();
      fs.writeFileSync(COOKIES_PATH, JSON.stringify(cookies, null, 2));
      return true;
    } else {
      console.warn('  ⚠️  Naukri login may have failed — continuing anyway');
      return true; // optimistic
    }
  } catch (err) {
    console.error('  ❌ Naukri login error:', err.message);
    return false;
  }
}

// ── ensureLoggedIn() ─────────────────────────────────────────────────────────

async function ensureLoggedIn(page, profile) {
  // Try loading session cookies first
  if (fs.existsSync(COOKIES_PATH)) {
    try {
      const cookies = JSON.parse(fs.readFileSync(COOKIES_PATH, 'utf8'));
      await page.context().addCookies(cookies);

      // Quick check
      await page.goto(`${BASE_URL}/`, { waitUntil: 'domcontentloaded', timeout: 20000 });
      await humanDelay(1000, 2000);
      const loggedIn = await page.$('.nI-gNb-header__name, [class*="username"]').then(Boolean).catch(() => false);
      if (loggedIn) {
        console.log('  ✅ Naukri session restored from cookies');
        return true;
      }
    } catch (_) {}
  }

  // Fresh login
  return login(page, profile);
}

// ── search() ─────────────────────────────────────────────────────────────────

/**
 * Search Naukri for jobs.
 * @param {import('playwright').Page} page
 * @param {Object} profile
 * @returns {Promise<Array>}
 */
async function search(page, profile) {
  const { search: searchCfg } = profile;
  const jobs = [];

  const loggedIn = await ensureLoggedIn(page, profile);
  if (!loggedIn) return jobs;

  for (const role of searchCfg.roles) {
    // Naukri URL format: /role-jobs-in-location
    const roleSlug = role.toLowerCase().replace(/\s+/g, '-');
    const locSlug  = (searchCfg.location || '').toLowerCase().replace(/\s+/g, '-');

    const searchUrl = locSlug
      ? `${BASE_URL}/${roleSlug}-jobs-in-${locSlug}?jobAge=${_naukiAgeParam(searchCfg.postedWithin)}`
      : `${BASE_URL}/${roleSlug}-jobs?jobAge=${_naukiAgeParam(searchCfg.postedWithin)}`;

    console.log(`\n🔍 Naukri search: "${role}" in "${searchCfg.location}"`);

    await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await humanDelay(2000, 4000);

    if (await detectCaptcha(page)) {
      console.warn('  🤖 CAPTCHA on Naukri search — skipping this role');
      continue;
    }

    try {
      await page.waitForSelector('.jobTuple, [class*="jobTupleHeader"], .srp-jobtuple-wrapper', { timeout: 10000 });
    } catch {
      console.warn('  ⚠️  No job cards found for:', role);
      continue;
    }

    const skipKw = (searchCfg.skipKeywords || []).map(k => k.toLowerCase());
    const maxPer = searchCfg.maxPerRun || 20;

    const extracted = await page.evaluate((max, skip) => {
      const cards = document.querySelectorAll('.jobTuple, .srp-jobtuple-wrapper, [class*="jobTupleHeader"]');
      const results = [];

      cards.forEach(card => {
        if (results.length >= max) return;
        try {
          const titleEl   = card.querySelector('.title, h2 a, [class*="jobTitle"]');
          const companyEl = card.querySelector('.companyInfo a, [class*="companyName"]');
          const locEl     = card.querySelector('.location li, [class*="location"]');
          const salaryEl  = card.querySelector('.salary, [class*="salary"]');
          const linkEl    = card.querySelector('a[href*="job-listings"]') || titleEl;

          if (!titleEl) return;

          const title   = titleEl.innerText.trim();
          const company = companyEl?.innerText.trim() || 'Unknown';
          const combined = `${title} ${company}`.toLowerCase();
          if (skip.some(kw => combined.includes(kw))) return;

          results.push({
            title,
            company,
            location: locEl?.innerText.trim() || '',
            jobUrl:   linkEl?.href || window.location.href,
            salary:   salaryEl?.innerText.trim() || '',
            platform: 'naukri',
          });
        } catch (_) {}
      });
      return results;
    }, maxPer, skipKw);

    console.log(`  ✅ Found ${extracted.length} jobs`);
    jobs.push(...extracted);
    await humanDelay(1500, 3000);
  }

  return jobs;
}

// ── apply() ──────────────────────────────────────────────────────────────────

/**
 * Apply to a Naukri job using the one-click Apply pattern.
 * @param {import('playwright').Page} page
 * @param {Object} job
 * @param {Object} profile
 * @returns {Promise<'applied'|'skipped'|'quit'|'error'>}
 */
async function apply(page, job, profile) {
  const { professional } = profile;

  try {
    console.log(`\n📋 Opening: ${job.title} @ ${job.company}`);
    await page.goto(job.jobUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await humanDelay(2000, 3000);

    if (await detectCaptcha(page)) {
      console.warn('  🤖 CAPTCHA — skipping');
      return 'skipped';
    }

    // Naukri's apply button selectors
    const applyBtn = await page.$(
      '#apply-button, .apply-button, button:has-text("Apply"), [class*="applyBtn"], .ia-apply-button'
    );

    if (!applyBtn) {
      console.warn('  ⚠️  No Apply button found — skipping');
      return 'skipped';
    }

    // ── HUMAN REVIEW PAUSE (before clicking Apply on Naukri) ────────────────
    const decision = await reviewPause(job.title, job.company, {
      location: job.location,
      salary:   job.salary,
      url:      job.jobUrl,
    });

    if (decision === 'quit')  return 'quit';
    if (decision === 'skip') {
      tracker.insertApplication({ ...job, job_title: job.title, job_url: job.jobUrl, status: 'skipped' });
      return 'skipped';
    }

    // Submit → click Apply
    await applyBtn.click();
    await humanDelay(2000, 4000);

    // Handle post-click modal (cover letter, etc.)
    const coverTextarea = await page.$('textarea[name*="cover"], #coverLetter, textarea[placeholder*="cover"]');
    if (coverTextarea && professional.summary) {
      await coverTextarea.fill(professional.summary);
      await humanDelay(500, 1000);
    }

    const modalSubmit = await page.$('button:has-text("Apply"), button:has-text("Submit"), #submit-apply');
    if (modalSubmit) {
      await modalSubmit.click();
      await humanDelay(2000, 3000);
    }

    // Confirm success
    const successIndicator = await page.$('[class*="success"], [class*="applied"], .checkmark').catch(() => null);
    if (successIndicator) {
      console.log(`  🎉 Applied to ${job.title} @ ${job.company}`);
    } else {
      console.log(`  ✅ Apply clicked for ${job.title} @ ${job.company} (verify manually)`);
    }

    tracker.insertApplication({ ...job, job_title: job.title, job_url: job.jobUrl, status: 'applied' });
    return 'applied';

  } catch (err) {
    console.error(`  ❌ Error applying to ${job.title} @ ${job.company}:`, err.message);
    return 'error';
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function _naukiAgeParam(postedWithin) {
  const map = { day: '1', week: '7', month: '30' };
  return map[postedWithin] || '7';
}

async function saveSession(context) {
  if (!fs.existsSync(SESSION_DIR)) fs.mkdirSync(SESSION_DIR, { recursive: true });
  const cookies = await context.cookies();
  fs.writeFileSync(COOKIES_PATH, JSON.stringify(cookies, null, 2));
}

async function loadSession(context) {
  if (fs.existsSync(COOKIES_PATH)) {
    const cookies = JSON.parse(fs.readFileSync(COOKIES_PATH, 'utf8'));
    await context.addCookies(cookies);
    return true;
  }
  return false;
}

module.exports = { search, apply, login, saveSession, loadSession };
