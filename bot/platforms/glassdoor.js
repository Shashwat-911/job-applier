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



async function search(page, profile) {
  const { search: searchCfg } = profile;
  const jobs = [];
  await restoreSession(page);

  for (const role of searchCfg.roles) {
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
        console.warn('  🤖 CAPTCHA on Glassdoor — skipping');
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
        return !skipKw.some(kw => combined.includes(kw));
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

    if (await detectCaptcha(page)) return 'skipped';

    // Handle login prompt if one appears
    await handleLoginIfPrompted(page, profile?.credentials?.glassdoor || profile?.credentials?.default);
    await handleGoogleLoginIfNeeded(page);

    const easyApplyBtn = await page.$('button[data-easy-apply="true"], button:has-text("Easy Apply"), button[data-test="easy-apply-button"]');
    if (!easyApplyBtn) {
      console.warn('  ⚠️ No Easy Apply button on Glassdoor');
      return 'skipped';
    }

    await easyApplyBtn.click();
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
      const submitBtn = await page.$('button[type="submit"], button:has-text("Submit Application")');
      if (submitBtn) await submitBtn.click();
      await humanDelay(2000, 3000);

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
