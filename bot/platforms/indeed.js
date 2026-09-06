/**
 * bot/platforms/indeed.js
 * Indeed "Easily Apply" automation.
 * Exports: search(page, profile), apply(page, job, profile)
 */

const { fillField, uploadResume, humanDelay, detectCaptcha, safeClick } = require('../helpers/formFiller');
const { reviewPause } = require('../helpers/reviewPause');
const tracker = require('../../db/tracker');
const fs      = require('fs');
const path    = require('path');

const BASE_URL    = 'https://www.indeed.com';
const SESSION_DIR = path.join(__dirname, '..', 'session');
const SESSION_PATH = path.join(SESSION_DIR, 'indeed.json');

async function handleGoogleLoginIfNeeded(page) {
  const url = page.url();
  if (url.includes('/login') || url.includes('/signin') || url.includes('accounts.google.com') || url.includes('secure.indeed.com/auth')) {
    console.log('👉 Please log in manually in the browser window...');
    await page.waitForFunction(
      () => !window.location.href.includes('/login') && 
            !window.location.href.includes('/signin') &&
            !window.location.href.includes('accounts.google.com'),
      { timeout: 120000 }
    );
    console.log('✅ Logged in successfully');

    if (!fs.existsSync(SESSION_DIR)) fs.mkdirSync(SESSION_DIR, { recursive: true });
    const cookies = await page.context().cookies();
    fs.writeFileSync(SESSION_PATH, JSON.stringify(cookies, null, 2));
  }
}

async function restoreSession(page) {
  if (fs.existsSync(SESSION_PATH)) {
    try {
      const cookies = JSON.parse(fs.readFileSync(SESSION_PATH, 'utf8'));
      await page.context().addCookies(cookies);
    } catch (_) {}
  }
}

// ── search() ─────────────────────────────────────────────────────────────────

/**
 * Search Indeed for "Easily Apply" jobs.
 * @param {import('playwright').Page} page
 * @param {Object} profile
 * @returns {Promise<Array>}
 */
async function search(page, profile) {
  const { search: searchCfg } = profile;
  const jobs = [];
  await restoreSession(page);

  for (const role of searchCfg.roles) {
    const q   = encodeURIComponent(role);
    const l   = encodeURIComponent(searchCfg.location || '');

    // fromage: 1=day, 7=week, 14=2weeks
    const fromageMap = { day: '1', week: '7', month: '30' };
    const fromage    = fromageMap[searchCfg.postedWithin] || '7';

    const searchUrl = `${BASE_URL}/jobs?q=${q}&l=${l}&fromage=${fromage}&sort=date`;

    console.log(`\n🔍 Indeed search: "${role}" in "${searchCfg.location}"`);

    await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await humanDelay(2000, 4000);
    await handleGoogleLoginIfNeeded(page);

    if (await detectCaptcha(page)) {
      console.warn('  🤖 CAPTCHA on Indeed search — skipping this role');
      continue;
    }

    try {
      await page.waitForSelector('[data-jk], .job_seen_beacon, .tapItem', { timeout: 10000 });
    } catch {
      console.warn('  ⚠️  No job cards found for:', role);
      continue;
    }

    const skipKw  = (searchCfg.skipKeywords || []).map(k => k.toLowerCase());
    const maxPer  = searchCfg.maxPerRun || 20;

    // Scroll and extract — Indeed paginates; grab first page
    const extracted = await page.evaluate((max, skip) => {
      const cards = document.querySelectorAll('[data-jk], .job_seen_beacon');
      const results = [];

      cards.forEach(card => {
        if (results.length >= max) return;
        try {
          // Only "Easily Apply" jobs
          const easyApplyBadge = card.querySelector('[class*="indeedApply"], .iaLabel, [data-indeed-apply]');
          if (!easyApplyBadge) return;

          const titleEl   = card.querySelector('.jobTitle a, h2 a, [data-jk] a');
          const companyEl = card.querySelector('[data-testid="company-name"], .companyName');
          const locEl     = card.querySelector('[data-testid="text-location"], .companyLocation');
          const salaryEl  = card.querySelector('[data-testid="attribute_snippet_testid"], .salaryText, .salary-snippet');
          const jk        = card.dataset.jk || card.closest('[data-jk]')?.dataset.jk;

          if (!titleEl || !jk) return;

          const title   = titleEl.innerText.trim();
          const company = companyEl?.innerText.trim() || 'Unknown';
          const combined = `${title} ${company}`.toLowerCase();
          if (skip.some(kw => combined.includes(kw))) return;

          results.push({
            title,
            company,
            location: locEl?.innerText.trim() || '',
            jobUrl:   `https://www.indeed.com/viewjob?jk=${jk}`,
            salary:   salaryEl?.innerText.trim() || '',
            platform: 'indeed',
            jk,
          });
        } catch (_) {}
      });
      return results;
    }, maxPer, skipKw);

    console.log(`  ✅ Found ${extracted.length} Easily Apply jobs`);
    jobs.push(...extracted);
    await humanDelay(1500, 3000);
  }

  return jobs;
}

// ── apply() ──────────────────────────────────────────────────────────────────

/**
 * Apply to a single Indeed job via Easily Apply flow.
 * @param {import('playwright').Page} page
 * @param {Object} job
 * @param {Object} profile
 * @returns {Promise<'applied'|'skipped'|'quit'|'error'>}
 */
async function apply(page, job, profile) {
  const { personal, professional, qa } = profile;

  try {
    await restoreSession(page);
    console.log(`\n📋 Opening: ${job.title} @ ${job.company}`);
    await page.goto(job.jobUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await humanDelay(2000, 3000);
    await handleGoogleLoginIfNeeded(page);

    if (await detectCaptcha(page)) {
      console.warn('  🤖 CAPTCHA — skipping');
      return 'skipped';
    }

    // Click Apply / Easily Apply button
    const applyBtn = await page.$(
      '#indeedApplyButton, [data-indeed-apply], button:has-text("Apply now"), .indeed-apply-button'
    );
    if (!applyBtn) {
      console.warn('  ⚠️  No Apply button found — skipping');
      return 'skipped';
    }

    await applyBtn.click();
    await humanDelay(2000, 3500);

    // Indeed apply flow opens in a new page or modal
    let applyPage = page;

    // Check if a popup / new page was opened
    const [popup] = await Promise.all([
      page.context().waitForEvent('page', { timeout: 3000 }).catch(() => null),
    ]);
    if (popup) {
      applyPage = popup;
      await applyPage.waitForLoadState('domcontentloaded');
      await handleGoogleLoginIfNeeded(applyPage);
    }

    // Multi-step form (up to 6 steps)
    const MAX_STEPS = 6;
    let step = 0;

    while (step < MAX_STEPS) {
      step++;
      console.log(`  📝 Form step ${step}/${MAX_STEPS}`);

      if (await detectCaptcha(applyPage)) {
        console.warn('  🤖 CAPTCHA during apply — skipping');
        return 'skipped';
      }

      // Common field selectors for Indeed
      await fillField(applyPage, ['input[name="applicant.name"], input[id*="name"]'],          personal.name);
      await fillField(applyPage, ['input[type="email"], input[name="applicant.emailAddress"]'], personal.email);
      await fillField(applyPage, ['input[type="tel"], input[name="applicant.phoneNumber"]'],    personal.phone);
      await fillField(applyPage, ['input[name*="location"], input[id*="location"]'],            personal.location);
      await fillField(applyPage, ['textarea[name*="coverLetter"], textarea[id*="cover"]'],      professional.summary);
      await fillField(applyPage, ['select[name*="education"], select[id*="education"]'],        qa.education);
      await fillField(applyPage, ['select[name*="experience"], input[id*="years"]'],            String(professional.yearsExperience));
      await fillField(applyPage, ['input[name*="salary"], input[id*="salary"]'],                professional.expectedSalary);
      await fillField(applyPage, ['select[name*="authorized"], input[id*="authorized"]'],       qa.authorized);

      // Resume upload
      const fileInput = await applyPage.$('input[type="file"]');
      if (fileInput && professional.resumePath) {
        await uploadResume(applyPage, professional.resumePath);
        await humanDelay(1000, 2000);
      }

      await humanDelay(800, 1500);

      // Determine next action
      const continueBtn = await applyPage.$('button:has-text("Continue"), button[data-testid*="continue"]');
      const submitBtn   = await applyPage.$('button:has-text("Submit"), button[data-testid*="submit"], #form-action-submit');
      const reviewBtn   = await applyPage.$('button:has-text("Review"), button[data-testid*="review"]');

      if (reviewBtn) {
        await reviewBtn.click();
        await humanDelay(1000, 2000);
        continue;
      }

      if (continueBtn) {
        await continueBtn.click();
        await humanDelay(1000, 2000);
        continue;
      }

      if (submitBtn) {
        // ── HUMAN REVIEW PAUSE ───────────────────────────────────────────────
        const decision = await reviewPause(job.title, job.company, {
          location: job.location,
          salary:   job.salary,
          url:      job.jobUrl,
        });

        if (decision === 'quit') return 'quit';

        if (decision === 'skip') {
          tracker.insertApplication({ ...job, job_title: job.title, job_url: job.jobUrl, status: 'skipped' });
          return 'skipped';
        }

        // Submit
        await submitBtn.click();
        await humanDelay(2000, 4000);
        console.log(`  🎉 Applied to ${job.title} @ ${job.company}`);
        tracker.insertApplication({ ...job, job_title: job.title, job_url: job.jobUrl, status: 'applied' });
        return 'applied';
      }

      console.warn('  ⚠️  No Continue/Submit button found at step', step);
      break;
    }

    return 'skipped';

  } catch (err) {
    console.error(`  ❌ Error applying to ${job.title} @ ${job.company}:`, err.message);
    return 'error';
  }
}

// ── Session helpers ──────────────────────────────────────────────────────────

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

module.exports = { search, apply, saveSession, loadSession };
