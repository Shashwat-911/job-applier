/**
 * bot/platforms/glassdoor.js
 * Glassdoor Easy Apply job search and automation.
 * Exports: search(page, profile), apply(page, job, profile)
 */

const fs = require('fs');
const path = require('path');
const { fillField, uploadResume, humanDelay, detectCaptcha, safeClick, handleLoginIfPrompted } = require('../helpers/formFiller');
const { reviewPause } = require('../helpers/reviewPause');
const tracker = require('../../db/tracker');

const BASE_URL = 'https://www.glassdoor.com';
const SESSION_DIR = path.join(__dirname, '..', 'session');
const SESSION_PATH = path.join(SESSION_DIR, 'glassdoor.json');

const SENSITIVE_BOT_COOKIES = new Set(['_abck', 'ak_bmsc', 'bm_sz', 'bm_sv', 'bm_s', 'bm_so', 'bm_lso', '__cf_bm']);

async function handleGoogleLoginIfNeeded(page) {
  const url = page.url();
  if (url.includes('/login') || url.includes('/signin') || url.includes('accounts.google.com')) {
    console.log('👉 Please log in manually in the browser window...');
    await page.waitForFunction(
      () => !window.location.href.includes('/login') && 
            !window.location.href.includes('/signin') &&
            !window.location.href.includes('accounts.google.com'),
      { timeout: 120000 }
    );
    console.log('✅ Logged in successfully');

    if (!fs.existsSync(SESSION_DIR)) fs.mkdirSync(SESSION_DIR, { recursive: true });
    const allCookies = await page.context().cookies();
    const cookies = allCookies.filter(c => 
      (!c.domain || c.domain.includes('glassdoor.com') || c.domain.includes('glassdoor.co.in')) &&
      !SENSITIVE_BOT_COOKIES.has(c.name)
    );
    fs.writeFileSync(SESSION_PATH, JSON.stringify(cookies, null, 2));
  }
}

async function restoreSession(page) {
  if (fs.existsSync(SESSION_PATH)) {
    try {
      const cookies = JSON.parse(fs.readFileSync(SESSION_PATH, 'utf8'));
      const safeCookies = (Array.isArray(cookies) ? cookies : []).filter(c => !SENSITIVE_BOT_COOKIES.has(c.name));
      await page.context().addCookies(safeCookies);
    } catch (_) {}
  }
}



async function search(page, profile) {
  const { search: searchCfg } = profile;
  const jobs = [];
  const seenUrls = new Set();
  await restoreSession(page);

  let captchaCircuitBroken = false;  // Circuit breaker: skip all remaining roles after first WAF block

  for (const role of searchCfg.roles) {
    if (captchaCircuitBroken) {
      console.log(`  ⚡ Circuit breaker active — skipping "${role}" (Glassdoor is blocking this session)`);
      continue;
    }

    const encodedRole = encodeURIComponent(role);
    const encodedLoc = encodeURIComponent(searchCfg.location || '');
    const searchUrl = `${BASE_URL}/Job/jobs.htm?sc.keyword=${encodedRole}&locT=C&locKeyword=${encodedLoc}&fromAge=7&applicationType=1`;

    console.log(`\n🔍 Glassdoor search: "${role}"`);
    console.log(`   URL: ${searchUrl}`);

    try {
      await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await humanDelay(2500, 4000);
      await handleGoogleLoginIfNeeded(page);

      if (await detectCaptcha(page)) {
        console.warn('  🤖 CAPTCHA on Glassdoor — activating circuit breaker, skipping all remaining Glassdoor roles');
        captchaCircuitBroken = true;
        continue;
      }

      // Close modal / popup if one appears
      const closePopup = await page.$('button[class*="CloseButton"], button[aria-label="Close"]');
      if (closePopup) await closePopup.click();

      const extracted = await page.evaluate((maxPer) => {
        const cards = document.querySelectorAll('li[data-test="jobListing"], [class*="JobCard_jobCardContent"]');
        const results = [];
        cards.forEach(card => {
          if (results.length >= maxPer) return;
          try {
            const titleEl = card.querySelector('a[data-test="job-title"], a[class*="JobTitle"]');
            const companyEl = card.querySelector('span[class*="EmployerProfile_employerName"], [class*="EmployerName"]');
            const locEl = card.querySelector('[data-test="emp-location"], [class*="location"]');
            const salEl = card.querySelector('[data-test="detailSalary"], [class*="salary-estimate"]');

            if (!titleEl) return;

            const cardText = (card.innerText || '').toLowerCase();
            const hasEasyApply = card.querySelector('[data-test="easy-apply"], [class*="EasyApply"], [data-test*="easyApply"]') !== null ||
                                 cardText.includes('easy apply') ||
                                 cardText.includes('easily apply');
            if (!hasEasyApply) return; // Only collect Easy Apply jobs that the bot can submit!

            results.push({
              title: titleEl.innerText.trim(),
              company: companyEl ? companyEl.innerText.trim() : 'Company',
              location: locEl ? locEl.innerText.trim() : '',
              jobUrl: titleEl.href ? titleEl.href.split('?')[0] : '',
              salary: salEl ? salEl.innerText.trim() : '',
              platform: 'glassdoor',
              hasEasyApply: true,
            });
          } catch (_) {}
        });
        return results;
      }, searchCfg.maxPerRun);

      const skipKw = (searchCfg.skipKeywords || []).map(k => k.toLowerCase());
      const filtered = extracted.filter(j => {
        const combined = `${j.title} ${j.company}`.toLowerCase();
        if (skipKw.some(kw => combined.includes(kw))) return false;
        if (seenUrls.has(j.jobUrl)) return false;
        seenUrls.add(j.jobUrl);
        return true;
      });

      console.log(`  ✅ Found ${filtered.length} Glassdoor jobs`);
      jobs.push(...filtered);
    } catch (err) {
      console.warn(`  ⚠️ Glassdoor search error:`, err.message);
    }

    await humanDelay(2000, 3000);
  }

  return jobs;
}

async function apply(page, job, profile) {
  try {
    console.log(`\n📋 Opening: ${job.title} @ ${job.company}`);
    await restoreSession(page);
    await page.goto(job.jobUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await humanDelay(2000, 3500);
    await handleGoogleLoginIfNeeded(page);

    // Check if Glassdoor job is closed / expired ("Job is OOO") immediately
    const isClosedOrOOO = await page.evaluate(() => {
      const text = (document.body?.innerText || '').toLowerCase();
      const title = (document.title || '').toLowerCase();
      return text.includes('job is ooo') ||
             text.includes('just kidding') ||
             (text.includes('not here') && text.includes('search recently posted')) ||
             text.includes('this job is no longer available') ||
             text.includes('job has expired') ||
             text.includes('this job listing has expired') ||
             title.includes('job is ooo');
    }).catch(() => false);

    if (isClosedOrOOO) {
      console.warn(`  ⏭ Glassdoor job is no longer available ("Job is OOO" / expired) for ${job.title} @ ${job.company} — skipping`);
      return 'skipped';
    }

    if (await detectCaptcha(page)) return 'skipped';

    // Check location from detail page if present
    const { isAllowedLocation } = require('../helpers/jobFilter');
    const pageLoc = await page.evaluate(() => {
      const locEl = document.querySelector('[data-test="emp-location"], [class*="JobDetails_location"], [class*="location"]');
      return locEl ? locEl.innerText.trim() : '';
    }).catch(() => '');
    if (pageLoc) {
      const locCheck = isAllowedLocation(pageLoc, job.title);
      if (!locCheck.allowed) {
        console.warn(`  ⏭ Skipped location restricted Glassdoor role: ${job.title} @ ${job.company} [${locCheck.reason}]`);
        return 'skipped';
      }
    }

    // Handle login prompt if one appears
    await handleLoginIfPrompted(page, profile?.credentials?.glassdoor || profile?.credentials?.default);
    await handleGoogleLoginIfNeeded(page);

    const easyApplyBtn = await page.$(
      'button[data-easy-apply="true"], button:has-text("Easy Apply"), button[data-test="easy-apply-button"], button[data-test*="easyApply"], [data-test*="easy-apply"], button:has-text("Apply Now")'
    );
    if (!easyApplyBtn) {
      const isExternal = await page.$('button:has-text("Apply on employer site"), a:has-text("Apply on employer site"), button:has-text("Apply on Company Site")');
      if (isExternal) {
        console.log('  🌐 Glassdoor job links externally to employer career site — skipping');
      } else {
        console.warn('  ⚠️ No Easy Apply button on Glassdoor');
      }
      return 'skipped';
    }

    await easyApplyBtn.click({ force: true }).catch(() => {});
    await humanDelay(2000, 3000);

    // Check again if clicking Easy Apply opened a login modal or Google OAuth
    await handleLoginIfPrompted(page, profile?.credentials?.glassdoor || profile?.credentials?.default);
    await handleGoogleLoginIfNeeded(page);



    const action = await reviewPause(page, {
      jobTitle: job.title,
      company: job.company,
      platform: 'glassdoor',
    });

    if (action === 'submit') {
      // Step through multi-step Glassdoor Easy Apply form
      for (let step = 0; step < 5; step++) {
        const submitBtn = await page.$(
          'button:has-text("Submit Application"), button:has-text("Submit"), button[type="submit"]'
        );
        if (submitBtn && (await submitBtn.isVisible().catch(() => false))) {
          await submitBtn.click().catch(() => {});
          await humanDelay(2000, 3000);
          break;
        }

        const nextBtn = await page.$(
          'button:has-text("Continue"), button:has-text("Next"), button[data-test="continue-button"], button:has-text("Review")'
        );
        if (nextBtn && (await nextBtn.isVisible().catch(() => false))) {
          await nextBtn.click().catch(() => {});
          await humanDelay(1500, 2500);
        } else {
          break;
        }
      }

      const isConfirmed = await page.waitForSelector(
        'text=Application Submitted, text=Successfully Applied, text=Applied, [class*="Success"], [class*="success"]',
        { timeout: 8000 }
      ).catch(() => null);

      if (isConfirmed) {
        console.log(`  🎉 Confirmed: Applied via Glassdoor for ${job.title} @ ${job.company}`);
        tracker.insertApplication({
          job_title: job.title,
          company: job.company,
          platform: 'glassdoor',
          job_url: job.jobUrl,
          status: 'applied',
          notes: 'Easy Apply via Glassdoor',
          salary_range: job.salary,
          location: job.location,
        });
        return 'applied';
      } else {
        console.warn(`  ⚠️ Glassdoor submission unverified for ${job.title} @ ${job.company}`);
        tracker.insertApplication({
          job_title: job.title,
          company: job.company,
          platform: 'glassdoor',
          job_url: job.jobUrl,
          status: 'skipped',
          notes: 'Submission unverified',
          salary_range: job.salary,
          location: job.location,
        });
        return 'skipped';
      }
    } else if (action === 'skip') {
      return 'skipped';
    } else {
      return 'quit';
    }
  } catch (err) {
    console.error(`  ❌ Glassdoor apply error:`, err.message);
    return 'error';
  }
}

module.exports = { search, apply };
