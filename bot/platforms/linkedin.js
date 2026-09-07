/**
 * bot/platforms/linkedin.js
 * LinkedIn Easy Apply automation.
 * Exports: search(page, profile), apply(page, job, profile)
 */

const fs = require('fs');
const path = require('path');
const { fillField, uploadResume, humanDelay, detectCaptcha, safeClick, handleLoginIfPrompted } = require('../helpers/formFiller');
const { reviewPause } = require('../helpers/reviewPause');
const tracker = require('../../db/tracker');

const BASE_URL = 'https://www.linkedin.com';
const SESSION_DIR = path.join(__dirname, '..', 'session');
const SESSION_PATH = path.join(SESSION_DIR, 'linkedin.json');

async function handleGoogleLoginIfNeeded(page) {
  const url = page.url();
  if (url.includes('/login') || url.includes('/signin') || url.includes('/uas/') || url.includes('accounts.google.com')) {
    console.log('👉 Please log in manually in the browser window...');
    await page.waitForFunction(
      () => !window.location.href.includes('/login') && 
            !window.location.href.includes('/signin') &&
            !window.location.href.includes('/uas/') &&
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

async function loginLinkedIn(page, profile) {
  const creds = profile?.credentials?.linkedin || profile?.credentials?.default || {
    email: 'shashwatyadav101@gmail.com',
    password: '9380743710@Aa',
  };

  console.log(`  🔐 Attempting LinkedIn automatic login for: ${creds.email}`);
  try {
    await page.goto('https://www.linkedin.com/login', { waitUntil: 'domcontentloaded', timeout: 35000 });
    await humanDelay(1500, 2500);

    const userField = await page.$('input#username, input[name="session_key"], input#session_key');
    const passField = await page.$('input#password, input[name="session_password"], input#session_password');

    if (userField && passField) {
      await userField.click({ clickCount: 3 });
      await userField.fill(creds.email);
      await humanDelay(400, 800);
      await passField.click({ clickCount: 3 });
      await passField.fill(creds.password);
      await humanDelay(500, 900);

      const submitBtn = await page.$('button[type="submit"], button:has-text("Sign in")');
      if (submitBtn) await submitBtn.click();

      await page.waitForLoadState('domcontentloaded').catch(() => {});
      await humanDelay(3000, 5000);
    }

    // Check if security challenge or OTP was triggered
    const currentUrl = page.url();
    if (currentUrl.includes('/checkpoint') || currentUrl.includes('/challenge') || (await detectCaptcha(page))) {
      console.warn('  🤖 LinkedIn security check or verification code required.');
      console.warn('  👉 Please complete the challenge or enter the code in the browser window (waiting up to 90s)...');
      try {
        await page.waitForFunction(
          () => !window.location.href.includes('/checkpoint') &&
                !window.location.href.includes('/challenge') &&
                !window.location.href.includes('/login') &&
                !window.location.href.includes('/uas/'),
          { timeout: 90000 }
        );
        console.log('  ✅ Challenge passed in browser window!');
      } catch (_) {
        console.warn('  ⚠️ Verification window timed out.');
      }
    }

    const finalUrl = page.url();
    const loggedIn = !finalUrl.includes('/login') && !finalUrl.includes('/uas/') && !finalUrl.includes('/authwall');
    if (loggedIn) {
      console.log('  ✅ LinkedIn logged in successfully!');
      if (!fs.existsSync(SESSION_DIR)) fs.mkdirSync(SESSION_DIR, { recursive: true });
      const cookies = await page.context().cookies();
      fs.writeFileSync(SESSION_PATH, JSON.stringify(cookies, null, 2));
      return true;
    }

    return false;
  } catch (err) {
    console.error('  ❌ LinkedIn login error:', err.message);
    return false;
  }
}

async function verifySession(page, profile) {
  try {
    console.log('🔍 Verifying LinkedIn session...');
    await page.goto('https://www.linkedin.com/feed', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await humanDelay(1500, 2500);

    const currentUrl = page.url();
    if (currentUrl.includes('/login') || currentUrl.includes('/checkpoint') || currentUrl.includes('/uas/') || currentUrl.includes('/authwall')) {
      console.warn('⚠️  LinkedIn session expired or redirected to login/authwall.');
      console.log('🔄 Falling back to automatic email & password login…');
      return await loginLinkedIn(page, profile);
    }
    console.log('✅ LinkedIn session verified (/feed active)');
    return true;
  } catch (err) {
    console.warn('⚠️  LinkedIn session verification check failed:', err.message);
    if (page.url().includes('/login') || page.url().includes('/authwall')) {
      return await loginLinkedIn(page, profile);
    }
    return true;
  }
}


// ── Field selector maps ──────────────────────────────────────────────────────

function buildFieldMap(profile) {
  const { personal, professional, qa } = profile;
  return {
    // Name
    firstName:        ['input[id*="firstName"]', 'input[name*="firstName"]', 'input[placeholder*="First"]'],
    lastName:         ['input[id*="lastName"]',  'input[name*="lastName"]',  'input[placeholder*="Last"]'],
    email:            ['input[type="email"]', 'input[id*="email"]'],
    phone:            ['input[type="tel"]',   'input[id*="phone"]', 'input[name*="phone"]'],
    location:         ['input[id*="location"]', 'input[name*="location"]', 'input[placeholder*="ocation"]'],
    linkedin:         ['input[id*="linkedin"]', 'input[name*="linkedin"]'],
    website:          ['input[id*="website"]', 'input[id*="portfolio"]'],
    // Professional
    currentTitle:     ['input[id*="title"]', 'input[id*="position"]', 'input[name*="title"]'],
    yearsExp:         ['input[id*="year"]', 'input[id*="experience"]', 'select[id*="experience"]'],
    summary:          ['textarea[id*="summary"]', 'textarea[id*="about"]'],
    salary:           ['input[id*="salary"]', 'input[id*="compensation"]'],
    // Q&A
    authorized:       ['select[id*="authorized"]', 'input[id*="authorized"]'],
    education:        ['select[id*="education"]', 'input[id*="education"]', 'select[id*="degree"]'],
    relocation:       ['select[id*="relocat"]', 'input[id*="relocat"]'],
  };
}

// ── search() ─────────────────────────────────────────────────────────────────

const JOB_CARD_SELECTORS = [
  '.job-card-container',
  '.jobs-search-results__list-item',
  '.scaffold-layout__list-item',
  '[data-job-id]',
  '.job-card-list',
];

/**
 * Search LinkedIn Jobs with Easy Apply filter.
 * @param {import('playwright').Page} page
 * @param {Object} profile
 * @returns {Promise<Array>} Array of job objects
 */
async function search(page, profile) {
  const { search: searchCfg } = profile;
  const jobs = [];
  await restoreSession(page);

  const sessionOk = await verifySession(page, profile);
  if (!sessionOk) {
    console.warn('⚠️  Skipping LinkedIn for this run: unauthenticated session.');
    return [];
  }

  for (const role of searchCfg.roles) {
    const encodedRole = encodeURIComponent(role);
    const encodedLoc  = encodeURIComponent(searchCfg.location || '');

    // f_LF=f_AL = Easy Apply filter; f_TPR = time posted
    const tprMap = { day: 'r86400', week: 'r604800', month: 'r2592000' };
    const tpr    = tprMap[searchCfg.postedWithin] || 'r604800';

    const searchUrl = `${BASE_URL}/jobs/search/?keywords=${encodedRole}&location=${encodedLoc}&f_LF=f_AL&f_TPR=${tpr}&sortBy=DD`;

    console.log(`\n🔍 LinkedIn search: "${role}" in "${searchCfg.location}"`);
    console.log(`   URL: ${searchUrl}`);

    await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(3000);
    await page.waitForLoadState('networkidle').catch(() => {});
    await handleGoogleLoginIfNeeded(page);

    if (await detectCaptcha(page)) {
      console.warn('  🤖 CAPTCHA on LinkedIn search — skipping this role');
      continue;
    }

    let activeSelector = null;
    for (const selector of JOB_CARD_SELECTORS) {
      const count = await page.$$eval(selector, els => els.length).catch(() => 0);
      if (count > 0) {
        activeSelector = selector;
        break;
      }
    }

    console.log(`   Page title: ${await page.title()}`);
    console.log(`   Current URL: ${page.url()}`);

    if (!activeSelector) {
      console.warn('  ⚠️  No job cards found for:', role);
      continue;
    }

    // Extract up to maxPerRun jobs
    const extracted = await page.evaluate(({ selector, maxPer }) => {
      const cards = document.querySelectorAll(selector);
      const results = [];
      cards.forEach(card => {
        if (results.length >= maxPer) return;
        try {
          const titleEl   = card.querySelector('.job-card-list__title, .job-card-container__link, [class*="job-title"], a.base-card__full-link, .base-search-card__title');
          const companyEl = card.querySelector('.job-card-container__company-name, .artdeco-entity-lockup__subtitle, .base-search-card__subtitle');
          const locationEl= card.querySelector('.job-card-container__metadata-item, [class*="location"], .job-search-card__location');
          const linkEl    = card.querySelector('a[href*="/jobs/view/"], a.base-card__full-link, a[href*="linkedin.com/jobs"]');
          const salaryEl  = card.querySelector('.job-card-container__salary-info, [class*="salary"]');

          if (!titleEl || !linkEl) return;

          results.push({
            title:    titleEl.innerText.trim(),
            company:  companyEl?.innerText.trim() || 'Unknown',
            location: locationEl?.innerText.trim() || '',
            jobUrl:   linkEl.href.split('?')[0],
            salary:   salaryEl?.innerText.trim() || '',
            platform: 'linkedin',
          });
        } catch (_) {}
      });
      return results;
    }, { selector: activeSelector, maxPer: searchCfg.maxPerRun });

    // Filter skip keywords
    const skipKw = (searchCfg.skipKeywords || []).map(k => k.toLowerCase());
    const filtered = extracted.filter(job => {
      const combined = `${job.title} ${job.company}`.toLowerCase();
      return !skipKw.some(kw => combined.includes(kw));
    });

    console.log(`  ✅ Found ${filtered.length} Easy Apply jobs`);
    jobs.push(...filtered);

    await humanDelay(1500, 3000);
  }

  return jobs;
}

// ── apply() ──────────────────────────────────────────────────────────────────

/**
 * Apply to a single LinkedIn job via Easy Apply.
 * @param {import('playwright').Page} page
 * @param {Object} job
 * @param {Object} profile
 * @returns {Promise<'applied'|'skipped'|'quit'|'error'>}
 */
async function apply(page, job, profile) {
  const { personal, professional, qa } = profile;
  const fieldMap = buildFieldMap(profile);

  try {
    await restoreSession(page);
    console.log(`\n📋 Opening: ${job.title} @ ${job.company}`);
    await page.goto(job.jobUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await humanDelay(2000, 3500);
    await handleGoogleLoginIfNeeded(page);
    if (page.url().includes('/login') || page.url().includes('/authwall') || page.url().includes('/uas/')) {
      await loginLinkedIn(page, profile);
      await page.goto(job.jobUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await humanDelay(1500, 2500);
    }

    if (await detectCaptcha(page)) {
      console.warn('  🤖 CAPTCHA — skipping');
      return 'skipped';
    }

    // Click Easy Apply button
    const easyApplyBtn = await page.$('button[aria-label*="Easy Apply"], .jobs-apply-button, button:has-text("Easy Apply")');
    if (!easyApplyBtn) {
      console.warn('  ⚠️  No Easy Apply button found — skipping');
      return 'skipped';
    }
    await easyApplyBtn.click();
    await humanDelay(1500, 2500);

    // Fill the modal — up to 5 steps
    let step = 0;
    const MAX_STEPS = 5;

    while (step < MAX_STEPS) {
      step++;
      console.log(`  📝 Form step ${step}/${MAX_STEPS}`);

      if (await detectCaptcha(page)) {
        console.warn('  🤖 CAPTCHA during apply — skipping');
        await safeClick(page, 'button[aria-label="Dismiss"], button:has-text("Dismiss")');
        return 'skipped';
      }

      // Fill all known fields
      await fillField(page, fieldMap.firstName,  personal.name.split(' ')[0] || personal.name);
      await fillField(page, fieldMap.lastName,   personal.name.split(' ').slice(1).join(' ') || '');
      await fillField(page, fieldMap.email,      personal.email);
      await fillField(page, fieldMap.phone,      personal.phone);
      await fillField(page, fieldMap.location,   personal.location);
      await fillField(page, fieldMap.linkedin,   personal.linkedin);
      await fillField(page, fieldMap.website,    personal.portfolio);

      await fillField(page, fieldMap.currentTitle, professional.title);
      await fillField(page, fieldMap.yearsExp,     String(professional.yearsExperience));
      await fillField(page, fieldMap.summary,       professional.summary);
      await fillField(page, fieldMap.salary,        professional.expectedSalary);

      await fillField(page, fieldMap.authorized, qa.authorized);
      await fillField(page, fieldMap.education,  qa.education);
      await fillField(page, fieldMap.relocation, qa.relocation);

      // Upload resume if file input visible
      const fileInput = await page.$('input[type="file"]');
      if (fileInput && professional.resumePath) {
        await uploadResume(page, professional.resumePath);
      }

      await humanDelay(800, 1500);

      // Check for Next button vs Submit button
      const nextBtn   = await page.$('button[aria-label="Continue to next step"], button:has-text("Next"), button[data-easy-apply-next-button]');
      const submitBtn = await page.$('button[aria-label="Submit application"], button:has-text("Submit application"), button:has-text("Submit")');
      const reviewBtn = await page.$('button[aria-label="Review your application"], button:has-text("Review")');

      if (reviewBtn) {
        await reviewBtn.click();
        await humanDelay(1000, 2000);
        continue;
      }

      if (nextBtn) {
        await nextBtn.click();
        await humanDelay(1000, 2000);
        continue;
      }

      if (submitBtn) {
        // ── HUMAN REVIEW PAUSE ──────────────────────────────────────────────
        const decision = await reviewPause(job.title, job.company, {
          location: job.location,
          salary:   job.salary,
          url:      job.jobUrl,
        });

        if (decision === 'quit') {
          await safeClick(page, 'button[aria-label="Dismiss"]');
          return 'quit';
        }

        if (decision === 'skip') {
          await safeClick(page, 'button[aria-label="Dismiss"]');
          tracker.insertApplication({ ...job, job_title: job.title, job_url: job.jobUrl, status: 'skipped' });
          return 'skipped';
        }

        // decision === 'submit'
        await submitBtn.click();
        await humanDelay(2000, 3000);
        console.log(`  🎉 Applied to ${job.title} @ ${job.company}`);
        tracker.insertApplication({ ...job, job_title: job.title, job_url: job.jobUrl, status: 'applied' });
        return 'applied';
      }

      // No recognized button — break to avoid infinite loop
      console.warn('  ⚠️  No Next/Submit/Review button found at step', step);
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
  fs.writeFileSync(SESSION_PATH, JSON.stringify(cookies, null, 2));
}

async function loadSession(context) {
  if (fs.existsSync(SESSION_PATH)) {
    const cookies = JSON.parse(fs.readFileSync(SESSION_PATH, 'utf8'));
    await context.addCookies(cookies);
    return true;
  }
  return false;
}

module.exports = { search, apply, saveSession, loadSession };
