/**
 * bot/platforms/unstop.js
 * Unstop (formerly Dare2Compete) job and hiring challenge search & automation.
 * Exports: search(page, profile), apply(page, job, profile)
 */

const fs = require('fs');
const path = require('path');
const { fillField, uploadResume, humanDelay, detectCaptcha, safeClick, handleLoginIfPrompted } = require('../helpers/formFiller');
const { reviewPause } = require('../helpers/reviewPause');
const tracker = require('../../db/tracker');

const BASE_URL = 'https://unstop.com';
const SESSION_DIR = path.join(__dirname, '..', 'session');
const SESSION_PATH = path.join(SESSION_DIR, 'unstop.json');

async function handleGoogleLoginIfNeeded(page) {
  const url = page.url();
  if (url.includes('/login') || url.includes('/signin') || url.includes('/auth') || url.includes('accounts.google.com')) {
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
    const searchUrl = `${BASE_URL}/jobs?searchTerm=${encodedRole}`;

    console.log(`\n🔍 Unstop search: "${role}"`);
    console.log(`   URL: ${searchUrl}`);

    try {
      await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await humanDelay(2500, 4000);
      await handleGoogleLoginIfNeeded(page);


      if (await detectCaptcha(page)) {
        console.warn('  🤖 CAPTCHA on Unstop — skipping');
        continue;
      }

      const extracted = await page.evaluate((maxPer) => {
        const cards = document.querySelectorAll('.single_opportunity, [class*="opportunity_card"]');
        const results = [];
        cards.forEach(card => {
          if (results.length >= maxPer) return;
          try {
            const titleEl = card.querySelector('h3, .title, a[class*="title"]');
            const compEl = card.querySelector('.organisation, .company_name');
            const locEl = card.querySelector('.location, [class*="location"]');
            const linkEl = card.querySelector('a[href*="/jobs/"], a[href*="/competitions/"]');

            if (!titleEl || !linkEl) return;

            results.push({
              title: titleEl.innerText.trim(),
              company: compEl ? compEl.innerText.trim() : 'Company',
              location: locEl ? locEl.innerText.trim() : 'India / Remote',
              jobUrl: linkEl.href ? linkEl.href.split('?')[0] : '',
              salary: '',
              platform: 'unstop',
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

      console.log(`  ✅ Found ${filtered.length} Unstop jobs`);
      jobs.push(...filtered);
    } catch (err) {
      console.warn(`  ⚠️ Unstop search error:`, err.message);
    }

    await humanDelay(1500, 2500);
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

    await handleLoginIfPrompted(page, profile?.credentials?.unstop || profile?.credentials?.default);
    await handleGoogleLoginIfNeeded(page);

    const regBtn = await page.$('button:has-text("Register"), button:has-text("Apply Now"), a:has-text("Apply")');
    if (!regBtn) {
      console.warn('  ⚠️ No register/apply button found on Unstop');
      return 'skipped';
    }

    const action = await reviewPause(page, {
      jobTitle: job.title,
      company: job.company,
      platform: 'unstop',
    });

    if (action === 'submit') {
      await regBtn.click();
      await humanDelay(2000, 3000);
      await handleGoogleLoginIfNeeded(page);


      tracker.insertApplication({
        job_title: job.title,
        company: job.company,
        platform: 'unstop',
        job_url: job.jobUrl,
        status: 'applied',
        notes: 'Registered on Unstop',
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
    console.error(`  ❌ Unstop apply error:`, err.message);
    return 'error';
  }
}

module.exports = { search, apply };
