/**
 * bot/platforms/indeed.js
 * Indeed "Easily Apply" automation.
 * Exports: search(page, profile), apply(page, job, profile)
 */

const { fillField, uploadResume, humanDelay, detectCaptcha, safeClick, dismissCookieBanners } = require('../helpers/formFiller');
const { reviewPause } = require('../helpers/reviewPause');
const tracker = require('../../db/tracker');
const fs      = require('fs');
const path    = require('path');

const SESSION_DIR  = path.join(__dirname, '..', 'session');
const SESSION_PATH = path.join(SESSION_DIR, 'indeed.json');

function getBaseUrl(location = '') {
  const loc = (location || '').toLowerCase();
  const indianLocations = [
    'india', 'bengaluru', 'bangalore', 'mumbai', 'delhi', 'noida', 'gurgaon',
    'gurugram', 'hyderabad', 'pune', 'chennai', 'kolkata', 'ahmedabad'
  ];
  if (indianLocations.some(k => loc.includes(k))) {
    return 'https://in.indeed.com';
  }
  return 'https://www.indeed.com';
}

function filterEphemeralCookies(cookies) {
  if (!Array.isArray(cookies)) return [];
  return cookies.filter(c => {
    if (c.domain && !c.domain.includes('indeed.com')) return false;
    const name = (c.name || '').toLowerCase();
    if (name.startsWith('__cf') || name.startsWith('cf_') || name.includes('cfuvid') || name.includes('_cf_')) {
      return false;
    }
    return true;
  });
}

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
    const clean = filterEphemeralCookies(cookies);
    fs.writeFileSync(SESSION_PATH, JSON.stringify(clean, null, 2));
  }
}

async function restoreSession(page) {
  if (fs.existsSync(SESSION_PATH)) {
    try {
      const cookies = JSON.parse(fs.readFileSync(SESSION_PATH, 'utf8'));
      const clean = filterEphemeralCookies(cookies);
      if (clean.length > 0) {
        await page.context().addCookies(clean);
      }
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

  const baseUrl = getBaseUrl(searchCfg.location);
  const maxPer  = searchCfg.maxPerRun || 20;
  const skipKw  = (searchCfg.skipKeywords || []).map(k => k.toLowerCase());

  let captchaCircuitBroken = false;  // Circuit breaker: skip all remaining roles after first CAPTCHA

  for (const role of searchCfg.roles) {
    if (jobs.length >= maxPer) {
      console.log(`  🎯 Target limit of ${maxPer} jobs reached. Finishing search early.`);
      break;
    }

    if (captchaCircuitBroken) {
      console.log(`  ⚡ Circuit breaker active — skipping "${role}" (Indeed is blocking this session)`);
      continue;
    }

    const q = encodeURIComponent(role);
    const l = encodeURIComponent(searchCfg.location || '');

    // fromage: 1=day, 7=week, 14=2weeks
    const fromageMap = { day: '1', week: '7', month: '30' };
    const fromage    = fromageMap[searchCfg.postedWithin] || '7';

    // &iafilter=1 filters exclusively to "Easily Apply" jobs directly on Indeed
    const searchUrl = `${baseUrl}/jobs?q=${q}&l=${l}&fromage=${fromage}&sort=date&iafilter=1`;

    console.log(`\n🔍 Indeed search: "${role}" in "${searchCfg.location || 'Any'}" (${baseUrl})`);

    try {
      await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 35000 });
    } catch (navErr) {
      console.warn(`  ⚠️ Navigation error: ${navErr.message}`);
    }

    await humanDelay(2000, 3500);
    await dismissCookieBanners(page);
    await handleGoogleLoginIfNeeded(page);

    if (await detectCaptcha(page)) {
      console.warn('  🤖 Challenge/Verification detected on Indeed.');
      console.warn('  👉 Please solve the verification challenge in the browser window if prompted...');
      let solved = false;
      for (let i = 0; i < 3; i++) {
        await humanDelay(4000, 5000);
        if (!(await detectCaptcha(page))) {
          console.log('  ✅ Challenge cleared! Resuming search...');
          solved = true;
          break;
        }
      }
      if (!solved) {
        console.warn('  ⚠️ Challenge not resolved — activating circuit breaker, skipping all remaining Indeed roles');
        captchaCircuitBroken = true;
        continue;
      }
    }

    try {
      await page.waitForSelector(
        '[data-jk], .job_seen_beacon, .tapItem, div.cardOutline, div[data-testid="jobsearch-SearchResults"]',
        { timeout: 10000 }
      );
    } catch {
      console.warn('  ⚠️  No job cards found for:', role);
      continue;
    }

    // Scroll down slightly to trigger lazy-loaded cards
    await page.evaluate(() => window.scrollBy(0, 600)).catch(() => {});
    await humanDelay(1000, 1500);
    await dismissCookieBanners(page);

    const remainingSlots = maxPer - jobs.length;

    // Scroll and extract — strictly only "Easily Apply" jobs
    const extracted = await page.evaluate(({ max, skip, domainUrl }) => {
      const cards = document.querySelectorAll('[data-jk], .job_seen_beacon, div.cardOutline');
      const results = [];
      const seenJks = new Set();

      cards.forEach(card => {
        if (results.length >= max) return;
        try {
          const jk = card.dataset.jk ||
            card.getAttribute('data-jk') ||
            card.querySelector('[data-jk]')?.dataset.jk ||
            card.closest('[data-jk]')?.dataset.jk;

          if (!jk || seenJks.has(jk)) return;

          // Check easily apply badge or text
          const hasEasyApply =
            card.querySelector('[class*="indeedApply"], .iaLabel, [data-indeed-apply], [data-testid="indeedApply"], [aria-label*="Easily apply"]') ||
            card.innerText.toLowerCase().includes('easily apply') ||
            card.innerText.toLowerCase().includes('apply with indeed');

          // STRICT: Only collect jobs that can be applied to via Indeed Easy Apply
          if (!hasEasyApply) return;

          const titleEl   = card.querySelector('.jobTitle a, h2 a, [data-jk] a, a[data-mobtk]');
          const companyEl = card.querySelector('[data-testid="company-name"], .companyName, span[data-testid="company-name"]');
          const locEl     = card.querySelector('[data-testid="text-location"], .companyLocation');
          const salaryEl  = card.querySelector('[data-testid="attribute_snippet_testid"], .salaryText, .salary-snippet');

          if (!titleEl) return;

          const title   = titleEl.innerText.trim();
          const company = companyEl?.innerText.trim() || 'Unknown';
          const combined = `${title} ${company}`.toLowerCase();
          if (skip.some(kw => combined.includes(kw))) return;

          seenJks.add(jk);
          results.push({
            title,
            company,
            location: locEl?.innerText.trim() || '',
            jobUrl:   `${domainUrl}/viewjob?jk=${jk}`,
            salary:   salaryEl?.innerText.trim() || '',
            platform: 'indeed',
            jk,
            hasEasyApply: true,
          });
        } catch (_) {}
      });
      return results;
    }, { max: remainingSlots, skip: skipKw, domainUrl: baseUrl });

    const freshJobs = extracted.filter(j => !tracker.isJobAlreadyProcessed(j.jobUrl, j.company, j.title));
    console.log(`  ✅ Found ${freshJobs.length} new Easily Apply job(s) for "${role}" (${extracted.length - freshJobs.length} already tracked)`);
    jobs.push(...freshJobs);

    if (jobs.length >= maxPer) {
      console.log(`  🎯 Reached target limit of ${maxPer} jobs. Finished search.`);
      break;
    }

    await humanDelay(1200, 2200);
  }

  return jobs;
}

// ── apply() ──────────────────────────────────────────────────────────────────

/**
 * Find the first truly visible element from an array of selectors.
 */
async function findFirstVisible(scope, selectors) {
  for (const sel of selectors) {
    try {
      const elements = await scope.$$(sel);
      for (const el of elements) {
        const isVis = await el.isVisible().catch(() => false);
        if (isVis) return el;
      }
    } catch (_) {}
  }
  return null;
}

/**
 * Safely click a button element with short timeout, fallback to force click and JS evaluate click.
 */
async function clickButtonSafely(el) {
  if (!el) return false;
  try {
    await el.scrollIntoViewIfNeeded().catch(() => {});
    await el.click({ timeout: 3500 });
    return true;
  } catch (_) {
    try {
      await el.click({ timeout: 2000, force: true });
      return true;
    } catch (_) {
      try {
        await el.evaluate(btn => btn.click());
        return true;
      } catch (_) {
        return false;
      }
    }
  }
}

/**
 * Helper to find the active frame or page containing the application form.
 */
async function getApplyScope(targetPage) {
  try {
    const frames = targetPage.frames ? targetPage.frames() : [];
    // Prioritize child frames (non-main frame) that look like Indeed Apply / SmartApply frames
    for (const f of frames) {
      if (f === (targetPage.mainFrame ? targetPage.mainFrame() : null)) continue;
      const url = f.url() || '';
      if (url.includes('smartapply') || url.includes('apply') || url.includes('indeed')) {
        const hasInputs = await f.$('input, button, select, textarea').catch(() => null);
        if (hasInputs) return f;
      }
    }
    // Check all frames for SmartApply form elements
    for (const f of frames) {
      const hasForm = await f.$('#form-action-continue, button[data-testid*="continue"], .ia-BasePage, .ia-JobApplication, [data-testid="JobSeekerResume"]').catch(() => null);
      if (hasForm) return f;
    }
  } catch (_) {}
  return targetPage;
}

/**
 * Handle resume upload and radio selection if multiple options/uploaded resume are shown.
 */
async function handleResumeStep(scope, professional) {
  try {
    const fileInput = await scope.$('input[type="file"]').catch(() => null);
    if (fileInput && professional.resumePath) {
      await uploadResume(scope, professional.resumePath);
      await humanDelay(1500, 2500); // Allow file processing to settle
    }

    // Ensure at least one resume radio button is selected if radio options exist
    const radios = await scope.$$('input[type="radio"]').catch(() => []);
    if (radios.length > 0) {
      let anyChecked = false;
      for (const r of radios) {
        if (await r.isChecked().catch(() => false)) {
          anyChecked = true;
          break;
        }
      }
      if (!anyChecked) {
        for (const r of radios) {
          const isVis = await r.isVisible().catch(() => false);
          if (isVis) {
            await r.click({ force: true }).catch(() => r.check().catch(() => {}));
            await humanDelay(400, 800);
            break;
          }
        }
      }
    }
  } catch (_) {}
}

/**
 * Automatically fill common Indeed screener questions and form fields.
 */
async function fillIndeedFieldsAndQuestions(scope, profile) {
  const { personal, professional, qa } = profile;

  // 1. Common standard fields
  await fillField(scope, ['input[name="applicant.name"]', 'input[id*="name"]', 'input[aria-label*="name" i]'], personal.name);
  await fillField(scope, ['input[type="email"]', 'input[name="applicant.emailAddress"]', 'input[id*="email"]'], personal.email);
  await fillField(scope, ['input[type="tel"]', 'input[name="applicant.phoneNumber"]', 'input[id*="phone"]'], personal.phone);
  await fillField(scope, ['input[name*="location"]', 'input[id*="location"]', 'input[aria-label*="location" i]'], personal.location || 'Bengaluru');
  await fillField(scope, ['textarea[name*="coverLetter"]', 'textarea[id*="cover"]', 'textarea[aria-label*="cover" i]'], professional.summary);
  await fillField(scope, ['select[name*="education"]', 'select[id*="education"]'], qa.education || 'Bachelor\'s');
  await fillField(scope, ['select[name*="experience"]', 'input[id*="years"]', 'input[aria-label*="years" i]'], String(professional.yearsExperience || '1'));
  await fillField(scope, ['input[name*="salary"]', 'input[id*="salary"]'], professional.expectedSalary || '600000');
  await fillField(scope, ['select[name*="authorized"]', 'input[id*="authorized"]'], qa.authorized || 'Yes');

  // 2. Dynamic handling of unfilled visible text & numeric inputs
  try {
    const inputs = await scope.$$('input:not([type="hidden"]):not([type="radio"]):not([type="checkbox"]):not([type="file"])').catch(() => []);
    for (const inp of inputs) {
      const isVis = await inp.isVisible().catch(() => false);
      if (!isVis) continue;
      const val = await inp.inputValue().catch(() => '');
      if (val && val.trim().length > 0) continue;

      const meta = await inp.evaluate(el => {
        let label = el.getAttribute('aria-label') || el.getAttribute('placeholder') || el.getAttribute('name') || '';
        if (el.id) {
          const l = document.querySelector(`label[for="${el.id}"]`);
          if (l) label += ' ' + l.innerText;
        }
        const parentLabel = el.closest('label');
        if (parentLabel) label += ' ' + parentLabel.innerText;
        const fieldset = el.closest('fieldset');
        if (fieldset) {
          const legend = fieldset.querySelector('legend');
          if (legend) label += ' ' + legend.innerText;
        }
        return label.toLowerCase();
      }).catch(() => '');

      if (meta.includes('experience') || meta.includes('year')) {
        await inp.fill(String(professional.yearsExperience || '1')).catch(() => {});
      } else if (meta.includes('salary') || meta.includes('ctc') || meta.includes('pay') || meta.includes('compensation')) {
        await inp.fill(String(professional.expectedSalary || '600000')).catch(() => {});
      } else if (meta.includes('notice')) {
        await inp.fill(String(professional.noticePeriod || '0')).catch(() => {});
      } else if (meta.includes('city') || meta.includes('location')) {
        await inp.fill(personal.location || 'Bengaluru').catch(() => {});
      } else if (meta.includes('phone') || meta.includes('mobile')) {
        await inp.fill(personal.phone || '').catch(() => {});
      } else if (meta.includes('email')) {
        await inp.fill(personal.email || '').catch(() => {});
      } else if (meta.includes('name')) {
        await inp.fill(personal.name || '').catch(() => {});
      } else {
        const type = await inp.getAttribute('type').catch(() => 'text');
        if (type === 'number') {
          await inp.fill(String(professional.yearsExperience || '1')).catch(() => {});
        } else {
          await inp.fill(String(professional.yearsExperience || '1')).catch(() => {});
        }
      }
    }

    // 3. Dynamic handling of unfilled textareas
    const textareas = await scope.$$('textarea').catch(() => []);
    for (const ta of textareas) {
      const isVis = await ta.isVisible().catch(() => false);
      if (!isVis) continue;
      const val = await ta.inputValue().catch(() => '');
      if (val && val.trim().length > 0) continue;
      await ta.fill(professional.summary || "I have strong hands-on experience and am excited to contribute effectively to this role.").catch(() => {});
    }

    // 4. Dynamic handling of select dropdowns
    const selects = await scope.$$('select').catch(() => []);
    for (const sel of selects) {
      const isVis = await sel.isVisible().catch(() => false);
      if (!isVis) continue;
      const val = await sel.inputValue().catch(() => '');
      if (!val || val === '0' || val === '-1' || val === '') {
        await sel.evaluate(s => {
          const opts = Array.from(s.options).filter(o => o.value && o.value !== '0' && o.value !== '-1');
          if (opts.length > 0) s.value = opts[0].value;
        }).catch(() => {});
        await sel.dispatchEvent('change').catch(() => {});
      }
    }

    // 5. Dynamic handling of unselected radio groups (e.g. Yes/No screener questions)
    const unselectedGroupNames = await scope.evaluate(() => {
      const groups = {};
      document.querySelectorAll('input[type="radio"]').forEach(r => {
        const name = r.name || 'default';
        if (!groups[name]) groups[name] = false;
        if (r.checked) groups[name] = true;
      });
      return Object.keys(groups).filter(name => !groups[name]);
    }).catch(() => []);

    for (const name of unselectedGroupNames) {
      const radioEls = await scope.$$(`input[type="radio"][name="${name}"]`).catch(() => []);
      let clicked = false;
      for (const r of radioEls) {
        const isVis = await r.isVisible().catch(() => false);
        if (!isVis) continue;
        const text = await r.evaluate(el => {
          const lbl = el.closest('label') || document.querySelector(`label[for="${el.id}"]`);
          return (lbl ? lbl.innerText : el.value || '').toLowerCase();
        }).catch(() => '');
        if (text.includes('yes')) {
          await r.click({ force: true }).catch(() => r.check().catch(() => {}));
          clicked = true;
          break;
        }
      }
      if (!clicked && radioEls.length > 0) {
        const firstVis = await radioEls[0].isVisible().catch(() => false);
        if (firstVis) {
          await radioEls[0].click({ force: true }).catch(() => radioEls[0].check().catch(() => {}));
        }
      }
    }
  } catch (_) {}
}

/**
 * Apply to a single Indeed job via Easily Apply flow.
 * @param {import('playwright').Page} page
 * @param {Object} job
 * @param {Object} profile
 * @returns {Promise<'applied'|'skipped'|'quit'|'error'>}
 */
async function apply(page, job, profile) {
  const { professional } = profile;
  let applyPage = page;

  try {
    await restoreSession(page);
    console.log(`\n📋 Opening: ${job.title} @ ${job.company}`);
    await page.goto(job.jobUrl, { waitUntil: 'domcontentloaded', timeout: 35000 });
    await humanDelay(1500, 2500);
    await dismissCookieBanners(page);
    await handleGoogleLoginIfNeeded(page);

    if (await detectCaptcha(page)) {
      console.warn('  🤖 Challenge / CAPTCHA detected — skipping');
      return 'skipped';
    }

    // Dismiss any cookie banners or overlays before clicking apply
    await dismissCookieBanners(page);

    // Look for Apply / Easily Apply button with wait to allow React hydration
    const applyBtnSelector = '#indeedApplyButton, [data-indeed-apply], button:has-text("Apply now"), .indeed-apply-button, [data-testid="indeedApplyButton"], button:has-text("Easily apply")';
    let applyBtn = await page.waitForSelector(applyBtnSelector, { timeout: 6000 }).catch(() => null);
    if (!applyBtn) {
      // Check frames in case it's in a viewjob subframe
      for (const f of page.frames()) {
        applyBtn = await f.$(applyBtnSelector).catch(() => null);
        if (applyBtn) break;
      }
    }

    if (!applyBtn) {
      console.warn('  ⚠️  No Easily Apply button found — skipping');
      return 'skipped';
    }

    // Concurrently listen for popup BEFORE clicking
    const popupPromise = page.context().waitForEvent('page', { timeout: 6000 }).catch(() => null);
    await applyBtn.click({ force: true }).catch(() => applyBtn.click());
    const popup = await popupPromise;

    if (popup) {
      applyPage = popup;
      await applyPage.waitForLoadState('domcontentloaded').catch(() => {});
      await humanDelay(1500, 2500);
      await dismissCookieBanners(applyPage);
      await handleGoogleLoginIfNeeded(applyPage);
    } else {
      await humanDelay(1500, 2500);
      await dismissCookieBanners(applyPage);
    }

    // Multi-step form (up to 15 steps)
    const MAX_STEPS = 15;
    let step = 0;

    while (step < MAX_STEPS) {
      step++;
      console.log(`  📝 Form step ${step}/${MAX_STEPS}`);

      const scope = await getApplyScope(applyPage);
      await dismissCookieBanners(scope);
      if (scope !== applyPage) {
        await dismissCookieBanners(applyPage);
      }

      if (await detectCaptcha(applyPage)) {
        console.warn('  🤖 Challenge / CAPTCHA during apply — skipping');
        return 'skipped';
      }

      // Check if already completed
      const completionText = await scope.$('text=Application submitted, text=Your application has been submitted, text=Application sent, [data-testid*="application-submitted"]').catch(() => null);
      if (completionText) {
        console.log(`  🎉 Application confirmed for ${job.title} @ ${job.company}`);
        tracker.insertApplication({ ...job, job_title: job.title, job_url: job.jobUrl, status: 'applied' });
        return 'applied';
      }

      // 1. Fill standard fields and handle screener questions
      await fillIndeedFieldsAndQuestions(scope, profile);

      // 2. Handle resume upload and radio selection
      await handleResumeStep(scope, professional);

      await humanDelay(800, 1500);

      // Scroll down so buttons in view
      await scope.evaluate(() => window.scrollTo(0, document.body.scrollHeight)).catch(() => {});
      await humanDelay(400, 800);

      // 3. Determine next action: Submit -> Review -> Continue
      // Check Submit button
      const submitBtn = await findFirstVisible(scope, [
        '#form-action-submit',
        'button[data-testid="submit-button"]',
        'button[data-testid="Review-submitButton"]',
        'button[data-testid*="submit"]',
        'button[data-testid*="Submit"]',
        '.ia-SubmitButton',
        'button:has-text("Submit your application")',
        'button:has-text("Submit application")',
        'button:has-text("Submit")',
        'button:has-text("Apply")',
        'button[type="submit"]',
      ]);

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

        const clicked = await clickButtonSafely(submitBtn);
        if (clicked) {
          await humanDelay(2500, 4500);
          console.log(`  🎉 Applied to ${job.title} @ ${job.company}`);
          tracker.insertApplication({ ...job, job_title: job.title, job_url: job.jobUrl, status: 'applied' });
          return 'applied';
        }
      }

      // Check Review button
      const reviewBtn = await findFirstVisible(scope, [
        '#form-action-review',
        'button[data-testid="review-button"]',
        'button[data-testid*="review"]',
        'button[data-testid*="Review"]',
        'button:has-text("Review your application")',
        'button:has-text("Review application")',
        'button:has-text("Review")',
      ]);

      if (reviewBtn) {
        const clicked = await clickButtonSafely(reviewBtn);
        if (clicked) {
          await humanDelay(1500, 2500);
          continue;
        }
      }

      // Check Continue / Next button
      const continueBtn = await findFirstVisible(scope, [
        '#form-action-continue',
        'button[data-testid="continue-button"]',
        'button[data-testid="continueButton"]',
        'button[data-testid*="continue"]',
        'button[data-testid*="Continue"]',
        'button:has-text("Continue")',
        'button[data-testid*="next"]',
        'button[data-testid*="Next"]',
        'button:has-text("Next")',
        '.ia-continueButton',
        'button[class*="Continue"]',
        'button[class*="continue"]',
        'button[aria-label*="Continue"]',
        'button[aria-label*="Next"]',
        '[data-testid*="form-footer"] button:not([disabled])',
        '.ia-BasePage-footer button:not([disabled])',
        'main footer button:not([disabled])',
      ]);

      if (continueBtn) {
        const clicked = await clickButtonSafely(continueBtn);
        if (clicked) {
          await humanDelay(1500, 2500);
          continue;
        }
      }

      // If no button clicked, wait briefly and retry finding visible action button once
      await humanDelay(1000, 1500);
      const retryContinue = await findFirstVisible(scope, [
        '#form-action-continue',
        'button[data-testid*="continue"]',
        'button:has-text("Continue")',
        'button:has-text("Next")',
        '#form-action-submit',
        'button:has-text("Submit")',
        'button:has-text("Apply")',
        'button[type="submit"]',
      ]);

      if (retryContinue && (await clickButtonSafely(retryContinue))) {
        await humanDelay(1500, 2500);
        continue;
      }

      console.warn('  ⚠️  No active Continue/Submit button found at step', step);
      break;
    }

    return 'skipped';

  } catch (err) {
    console.error(`  ❌ Error applying to ${job.title} @ ${job.company}:`, err.message);
    return 'error';
  } finally {
    if (applyPage && applyPage !== page && !applyPage.isClosed()) {
      await applyPage.close().catch(() => {});
    }
  }
}

// ── Session helpers ──────────────────────────────────────────────────────────

async function saveSession(context) {
  if (!fs.existsSync(SESSION_DIR)) fs.mkdirSync(SESSION_DIR, { recursive: true });
  const cookies = await context.cookies();
  const clean = filterEphemeralCookies(cookies);
  fs.writeFileSync(SESSION_PATH, JSON.stringify(clean, null, 2));
}

async function loadSession(context) {
  if (fs.existsSync(SESSION_PATH)) {
    try {
      const cookies = JSON.parse(fs.readFileSync(SESSION_PATH, 'utf8'));
      const clean = filterEphemeralCookies(cookies);
      if (clean.length > 0) {
        await context.addCookies(clean);
        return true;
      }
    } catch (_) {}
  }
  return false;
}

module.exports = { search, apply, saveSession, loadSession };

