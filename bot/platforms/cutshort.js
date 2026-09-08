/**
 * bot/platforms/cutshort.js
 * Cutshort.io tech job search and application automation.
 * Exports: search(page, profile), apply(page, job, profile)
 */

const fs = require('fs');
const path = require('path');
const { fillField, uploadResume, humanDelay, detectCaptcha, safeClick, handleLoginIfPrompted } = require('../helpers/formFiller');
const { reviewPause } = require('../helpers/reviewPause');
const tracker = require('../../db/tracker');

const BASE_URL = 'https://cutshort.io';
const SESSION_DIR = path.join(__dirname, '..', 'session');
const SESSION_PATH = path.join(SESSION_DIR, 'cutshort.json');

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
    const locSlug = (searchCfg.location || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    const searchUrl = `${BASE_URL}/jobs/${slug}-jobs${locSlug ? '-in-' + locSlug : ''}`;

    console.log(`\n🔍 Cutshort search: "${role}"`);
    console.log(`   URL: ${searchUrl}`);

    try {
      await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await humanDelay(2500, 4000);
      await handleGoogleLoginIfNeeded(page);

      if (await detectCaptcha(page)) {
        console.warn('  🤖 CAPTCHA on Cutshort — skipping');
        continue;
      }

      const extracted = await page.evaluate((maxPer) => {
        const links = document.querySelectorAll('a[href*="/job/"]');
        const results = [];
        const seen = new Set();
        links.forEach(linkEl => {
          if (results.length >= maxPer) return;
          try {
            const href = linkEl.href ? linkEl.href.split('?')[0] : '';
            if (!href || seen.has(href) || href.endsWith('/jobs') || href.endsWith('/jobs/')) return;
            seen.add(href);

            const card = linkEl.closest('[class*="JobCard"], .job-item, [class*="job-listing"], div[class*="custom"], div[class*="card"], article') || linkEl;
            const titleEl = card.querySelector('h2, [class*="title"]') || linkEl;
            const compEl = card.querySelector('[class*="company"], .company-name');
            const locEl = card.querySelector('[class*="location"]');
            const salEl = card.querySelector('[class*="salary"]');

            const title = (titleEl.innerText || linkEl.innerText || '').split('\n')[0].trim();
            if (!title || title.length < 3) return;

            results.push({
              title,
              company: compEl ? compEl.innerText.trim() : 'Tech Company',
              location: locEl ? locEl.innerText.trim() : 'India / Remote',
              jobUrl: href,
              salary: salEl ? salEl.innerText.trim() : '',
              platform: 'cutshort',
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

      console.log(`  ✅ Found ${filtered.length} Cutshort jobs`);
      jobs.push(...filtered);
    } catch (err) {
      console.warn(`  ⚠️ Cutshort search error:`, err.message);
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

    await handleLoginIfPrompted(page, profile?.credentials?.cutshort || profile?.credentials?.default);
    await handleGoogleLoginIfNeeded(page);

    const expressBtn = await page.$('button:has-text("Interested"), button:has-text("Apply"), button:has-text("Fast Track")');
    if (!expressBtn) {
      console.warn('  ⚠️ No apply button on Cutshort');
      return 'skipped';
    }

    const action = await reviewPause(page, {
      jobTitle: job.title,
      company: job.company,
      platform: 'cutshort',
    });

    if (action === 'submit') {
      await expressBtn.click();
      await humanDelay(2000, 3000);
      await handleGoogleLoginIfNeeded(page);


      tracker.insertApplication({
        job_title: job.title,
        company: job.company,
        platform: 'cutshort',
        job_url: job.jobUrl,
        status: 'applied',
        notes: 'Expressed interest on Cutshort',
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
    console.error(`  ❌ Cutshort apply error:`, err.message);
    return 'error';
  }
}

module.exports = { search, apply };
