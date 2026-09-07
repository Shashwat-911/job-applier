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
function getCookiesPath() {
  const primary = path.join(SESSION_DIR, 'naukri.json');
  const legacy = path.join(SESSION_DIR, 'naukri_cookies.json');
  return fs.existsSync(primary) ? primary : (fs.existsSync(legacy) ? legacy : primary);
}
const COOKIES_PATH = getCookiesPath();

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

    const extracted = await page.evaluate(({ max, skip }) => {
      const cards = document.querySelectorAll('.jobTuple, .srp-jobtuple-wrapper, [class*="jobTupleHeader"]');
      const results = [];

      cards.forEach(card => {
        if (results.length >= max) return;
        try {
          const titleEl   = card.querySelector('a.title, .title, [class*="jobTitle"], h2 a');
          const companyEl = card.querySelector('a.comp-name, .comp-name, [class*="comp-name"], a[class*="company"], .subTitle, a.subTitle, [title*="Career"]');
          const locEl     = card.querySelector('span.loc-wrap, .loc-wrap, .location, [class*="location"]');
          const salaryEl  = card.querySelector('span.sal-wrap, .sal-wrap, .salary, [class*="salary"]');
          const linkEl    = card.querySelector('a.title, a[href*="job-listings"], a[href*="/job-"]') || titleEl;

          if (!titleEl) return;

          const title   = titleEl.innerText.trim();
          const company = companyEl?.innerText.trim() || 'Company';
          const combined = `${title} ${company}`.toLowerCase();
          if (skip && skip.some(kw => combined.includes(kw))) return;

          const jobHref = (linkEl && linkEl.href) ? linkEl.href : (titleEl && titleEl.href ? titleEl.href : '');
          if (!jobHref || jobHref === window.location.href) return;

          results.push({
            title,
            company,
            location: locEl?.innerText.trim() || '',
            jobUrl:   jobHref,
            salary:   salaryEl?.innerText.trim() || '',
            platform: 'naukri',
          });
        } catch (_) {}
      });
      return results;
    }, { max: maxPer, skip: skipKw });

    const freshJobs = extracted.filter(j => !tracker.isJobAlreadyProcessed(j.jobUrl, j.company, j.title));
    console.log(`  ✅ Found ${freshJobs.length} new jobs (${extracted.length - freshJobs.length} already tracked)`);
    jobs.push(...freshJobs);
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
    if (!page || page.isClosed()) return 'error';
    await loadSession(page.context());
    console.log(`\n📋 Opening: ${job.title} @ ${job.company}`);
    await page.goto(job.jobUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await humanDelay(2000, 3000);

    if (await detectCaptcha(page)) {
      console.warn('  🤖 CAPTCHA — skipping');
      return 'skipped';
    }

    // Check if already applied
    const alreadyApplied = await page.$('text=Already Applied, .already-applied, [class*="already-applied"], button:has-text("Already Applied")').catch(() => null);
    if (alreadyApplied) {
      console.log(`  🎉 Already applied previously to ${job.title} @ ${job.company}`);
      tracker.insertApplication({ ...job, job_title: job.title, job_url: job.jobUrl, status: 'applied', notes: 'Already applied on Naukri' });
      return 'applied';
    }

    // Naukri's apply button selectors (support direct apply, company apply, links, custom classes)
    const applyBtn = await page.$(
      '#apply-button, .apply-button, button:has-text("Apply"), a:has-text("Apply"), [class*="applyBtn"], [class*="apply-button"], [class*="apply-btn"], [class*="btn_apply"], [data-automation-id="apply-btn"], button[id*="apply"], a[id*="apply"], button[title*="Apply"]'
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

    if (!page || page.isClosed()) {
      console.warn('  ⚠️ Page was closed during review pause.');
      return 'skipped';
    }

    // Re-query fresh apply button in case DOM shifted during review pause
    const freshBtn = await page.$(
      '#apply-button, .apply-button, button:has-text("Apply"), a:has-text("Apply"), [class*="applyBtn"], [class*="apply-button"], [class*="apply-btn"], [class*="btn_apply"], [data-automation-id="apply-btn"], button[id*="apply"], a[id*="apply"], button[title*="Apply"]'
    );
    if (!freshBtn) {
      console.warn('  ⚠️ Apply button no longer found after review pause.');
      return 'skipped';
    }

    // Submit → click Apply (handle potential new tab)
    const popupPromise = page.context().waitForEvent('page', { timeout: 3000 }).catch(() => null);
    await freshBtn.click().catch(() => {});
    const popup = await popupPromise;
    const targetScope = (popup && !popup.isClosed()) ? popup : page;

    await humanDelay(2000, 4000);

    // Handle post-click modal (cover letter, etc.)
    const coverTextarea = await targetScope.$('textarea[name*="cover"], #coverLetter, textarea[placeholder*="cover"]').catch(() => null);
    if (coverTextarea && professional.summary) {
      await coverTextarea.fill(professional.summary).catch(() => {});
      await humanDelay(500, 1000);
    }

    const modalSubmit = await targetScope.$('button:has-text("Apply"), button:has-text("Submit"), #submit-apply').catch(() => null);
    if (modalSubmit) {
      await modalSubmit.click().catch(() => {});
      await humanDelay(2000, 3000);
    }

    // Confirm success
    const successIndicator = await targetScope.$('[class*="success"], [class*="applied"], .checkmark').catch(() => null);
    if (successIndicator) {
      console.log(`  🎉 Applied to ${job.title} @ ${job.company}`);
      tracker.insertApplication({ ...job, job_title: job.title, job_url: job.jobUrl, status: 'applied' });
      return 'applied';
    } else {
      console.warn(`  ⚠️ Apply unverified on Naukri (requires external site completion or questionnaire) — recording as skipped`);
      tracker.insertApplication({ ...job, job_title: job.title, job_url: job.jobUrl, status: 'skipped', notes: 'Requires manual verification or external site completion' });
      return 'skipped';
    }

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
  const allCookies = await context.cookies();
  const cookies = allCookies.filter(c => !c.domain || c.domain.includes('naukri.com'));
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
