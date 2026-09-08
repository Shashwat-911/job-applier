/**
 * bot/platforms/workatastartup.js
 * Y Combinator Work at a Startup job search and application automation.
 * Exports: search(page, profile), apply(page, job, profile)
 */

const fs = require('fs');
const path = require('path');
const { fillField, uploadResume, humanDelay, detectCaptcha, safeClick, handleLoginIfPrompted } = require('../helpers/formFiller');
const { reviewPause } = require('../helpers/reviewPause');
const tracker = require('../../db/tracker');

const BASE_URL = 'https://www.workatastartup.com';
const SESSION_DIR = path.join(__dirname, '..', 'session');
const SESSION_PATH = path.join(SESSION_DIR, 'workatastartup.json');

const SENSITIVE_BOT_COOKIES = new Set(['_abck', 'ak_bmsc', 'bm_sz', 'bm_sv', 'bm_s', 'bm_so', 'bm_lso', '__cf_bm']);

async function handleGoogleLoginIfNeeded(page) {
  const url = page.url();
  if (url.includes('/login') || url.includes('/signin') || url.includes('/sign_in') || url.includes('accounts.google.com')) {
    console.log('👉 Please log in manually in the browser window...');
    await page.waitForFunction(
      () => !window.location.href.includes('/login') && 
            !window.location.href.includes('/signin') &&
            !window.location.href.includes('/sign_in') &&
            !window.location.href.includes('accounts.google.com'),
      { timeout: 120000 }
    );
    console.log('✅ Logged in successfully');

    if (!fs.existsSync(SESSION_DIR)) fs.mkdirSync(SESSION_DIR, { recursive: true });
    const cookies = await page.context().cookies();
    const safeCookies = cookies.filter(c => !SENSITIVE_BOT_COOKIES.has(c.name));
    fs.writeFileSync(SESSION_PATH, JSON.stringify(safeCookies, null, 2));
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
  await restoreSession(page);

  for (const role of searchCfg.roles) {
    const slug = role.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    const searchUrl = `${BASE_URL}/jobs/l/${slug}`;

    console.log(`\n🔍 Work at a Startup search: "${role}"`);
    console.log(`   URL: ${searchUrl}`);

    try {
      await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await humanDelay(2500, 4000);
      await handleGoogleLoginIfNeeded(page);

      if (await detectCaptcha(page)) {
        console.warn('  🤖 CAPTCHA on Work at a Startup — skipping');
        continue;
      }

      const extracted = await page.evaluate((maxPer) => {
        const links = document.querySelectorAll('a[href*="/jobs/"]');
        const results = [];
        const seen = new Set();
        links.forEach(linkEl => {
          if (results.length >= maxPer) return;
          try {
            const href = linkEl.href ? linkEl.href.split('?')[0] : '';
            if (!href || seen.has(href) || href.endsWith('/jobs') || href.endsWith('/jobs/')) return;
            seen.add(href);

            const title = (linkEl.innerText || '').split('\n')[0].trim();
            if (!title || title.length < 3) return;

            const card = linkEl.closest('.job-card, [class*="JobCard"], .company-card, tr, li, div[class*="card"], article') || linkEl;
            const compEl = card.querySelector('.company-name, h3, h4, [class*="company-title"], [class*="company"]');
            const locEl = card.querySelector('.job-details, [class*="location"]');
            const salEl = card.querySelector('.compensation, [class*="salary"]');

            results.push({
              title,
              company: compEl ? compEl.innerText.trim() : 'YC Startup',
              location: locEl ? locEl.innerText.trim() : 'Remote / Global',
              jobUrl: href,
              salary: salEl ? salEl.innerText.trim() : '',
              platform: 'workatastartup',
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

      console.log(`  ✅ Found ${filtered.length} Work at a Startup jobs`);
      jobs.push(...filtered);
    } catch (err) {
      console.warn(`  ⚠️ Work at a Startup search error:`, err.message);
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

    await handleLoginIfPrompted(page, profile?.credentials?.workatastartup || profile?.credentials?.default);
    await handleGoogleLoginIfNeeded(page);

    const applyBtn = await page.$('a:has-text("Apply"), button:has-text("Apply"), button:has-text("Interested")');
    if (!applyBtn) {
      console.warn('  ⚠️ No apply button on Work at a Startup');
      return 'skipped';
    }

    const action = await reviewPause(page, {
      jobTitle: job.title,
      company: job.company,
      platform: 'workatastartup',
    });

    if (action === 'submit') {
      await applyBtn.click();
      await humanDelay(2000, 3000);
      await handleGoogleLoginIfNeeded(page);


      tracker.insertApplication({
        job_title: job.title,
        company: job.company,
        platform: 'workatastartup',
        job_url: job.jobUrl,
        status: 'applied',
        notes: 'Applied via YC Work at a Startup',
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
    console.error(`  ❌ Work at a Startup apply error:`, err.message);
    return 'error';
  }
}

module.exports = { search, apply };
