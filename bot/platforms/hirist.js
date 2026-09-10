/**
 * bot/platforms/hirist.js
 * Hirist.com tech job portal automation for developers in India.
 * Exports: search(page, profile), apply(page, job, profile)
 */

const fs = require('fs');
const path = require('path');
const { fillField, uploadResume, humanDelay, detectCaptcha, safeClick, handleLoginIfPrompted } = require('../helpers/formFiller');
const { reviewPause } = require('../helpers/reviewPause');
const { isHighExperienceJob } = require('../helpers/jobFilter');
const tracker = require('../../db/tracker');

const BASE_URL = 'https://www.hirist.tech';
const SESSION_DIR = path.join(__dirname, '..', 'session');
const SESSION_PATH = path.join(SESSION_DIR, 'hirist.json');

const SENSITIVE_BOT_COOKIES = new Set(['_abck', 'ak_bmsc', 'bm_sz', 'bm_sv', 'bm_s', 'bm_so', 'bm_lso', '__cf_bm']);

async function restoreSession(page) {
  if (fs.existsSync(SESSION_PATH)) {
    try {
      const cookies = JSON.parse(fs.readFileSync(SESSION_PATH, 'utf8'));
      const safeCookies = (Array.isArray(cookies) ? cookies : []).filter(c => !SENSITIVE_BOT_COOKIES.has(c.name));
      await page.context().addCookies(safeCookies);
    } catch (_) {}
  }
}

async function saveSession(context) {
  if (!fs.existsSync(SESSION_DIR)) fs.mkdirSync(SESSION_DIR, { recursive: true });
  const allCookies = await context.cookies();
  const cookies = allCookies.filter(c => (!c.domain || c.domain.includes('hirist.tech') || c.domain.includes('hirist.com')) && !SENSITIVE_BOT_COOKIES.has(c.name));
  fs.writeFileSync(SESSION_PATH, JSON.stringify(cookies, null, 2));
}

async function search(page, profile) {
  const { search: searchCfg } = profile;
  const jobs = [];
  const seenUrls = new Set();
  await restoreSession(page);

  for (const role of searchCfg.roles) {
    const slug = role.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    // Append minexp=0&maxexp=2 to restrict Hirist results to Fresher / 0-2 years entry-level positions
    const searchUrl = `${BASE_URL}/search/${slug}?minexp=0&maxexp=2&ref=homepage`;

    console.log(`\n🔍 Hirist search: "${role}"`);
    console.log(`   URL: ${searchUrl}`);

    try {
      await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await humanDelay(2000, 3500);
      await handleLoginIfPrompted(page, profile?.credentials?.hirist || profile?.credentials?.default);

      if (await detectCaptcha(page)) {
        console.warn('  🤖 CAPTCHA on Hirist — skipping');
        continue;
      }

      const extracted = await page.evaluate((maxPer) => {
        const links = document.querySelectorAll('a[href*="/j/"]');
        const results = [];
        const seen = new Set();
        links.forEach(linkEl => {
          if (results.length >= maxPer) return;
          try {
            const href = linkEl.href ? linkEl.href.split('?')[0] : '';
            if (!href || seen.has(href)) return;
            seen.add(href);

            const card = linkEl.closest('div[class*="job"], div[class*="card"], li, article') || linkEl;
            const titleEl = card.querySelector('.job-title, a[class*="title"], h3, h4') || linkEl;
            const compEl = card.querySelector('.company-name, [class*="company"], [class*="recruiter"]');
            const locEl = card.querySelector('.location, [class*="location"]');
            const expEl = card.querySelector('.experience, [class*="experience"], [class*="exp"], span.years, [class*="years"], .c-badge, [class*="salary"]');

            const title = (titleEl.innerText || '').split('\n')[0].trim();
            if (!title || title.length < 3) return;

            const cardText = (card.innerText || '').trim();

            results.push({
              title,
              company: compEl ? compEl.innerText.trim() : 'Tech Company',
              location: locEl ? locEl.innerText.trim() : 'India',
              jobUrl: href,
              salary: expEl ? expEl.innerText.trim() : '',
              notes: cardText,
              platform: 'hirist',
            });
          } catch (_) {}
        });
        return results;
      }, searchCfg.maxPerRun);

      const skipKw = (searchCfg.skipKeywords || []).map(k => k.toLowerCase());
      const filtered = extracted.filter(j => {
        const combined = `${j.title} ${j.company} ${j.notes}`.toLowerCase();
        if (skipKw.some(kw => combined.includes(kw))) return false;
        if (seenUrls.has(j.jobUrl)) return false;
        seenUrls.add(j.jobUrl);
        return true;
      });

      console.log(`  ✅ Found ${filtered.length} Hirist jobs`);
      jobs.push(...filtered);
    } catch (err) {
      console.warn(`  ⚠️ Hirist search error:`, err.message);
    }

    await humanDelay(1500, 2500);
  }

  return jobs;
}

async function apply(page, job, profile) {
  try {
    await restoreSession(page);
    console.log(`\n📋 Opening: ${job.title} @ ${job.company}`);
    await page.goto(job.jobUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await humanDelay(2000, 3500);
    await handleLoginIfPrompted(page, profile?.credentials?.hirist || profile?.credentials?.default);

    if (await detectCaptcha(page)) return 'skipped';

    // Safety guard: Verify experience requirement on the job detail page before clicking apply
    const detailPageInfo = await page.evaluate(() => {
      const pageTitle = document.title || '';
      const heading = document.querySelector('h1, .job-title, [class*="title"]')?.innerText || '';
      const expBadge = document.querySelector('[class*="experience"], [class*="exp"], span.years, [class*="years"], .c-badge')?.innerText || '';
      const firstSection = (document.body?.innerText || '').slice(0, 1500);
      return `${pageTitle} ${heading} ${expBadge} ${firstSection}`;
    });

    const expCheck = isHighExperienceJob(detailPageInfo);
    if (expCheck.isHigh) {
      console.warn(`  ⏭ Skipped high-experience Hirist role on detail page: ${expCheck.reason} for ${job.title} @ ${job.company}`);
      return 'skipped';
    }

    const applyBtn = await page.$('button:has-text("Apply"), a:has-text("Apply"), .apply-button');
    if (!applyBtn) {
      console.warn('  ⚠️ No apply button on Hirist');
      return 'skipped';
    }

    const action = await reviewPause(page, {
      jobTitle: job.title,
      company: job.company,
      platform: 'hirist',
    });

    if (action === 'submit') {
      await applyBtn.click();
      await humanDelay(2000, 3000);

      tracker.insertApplication({
        job_title: job.title,
        company: job.company,
        platform: 'hirist',
        job_url: job.jobUrl,
        status: 'applied',
        notes: 'Applied via Hirist',
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
    console.error(`  ❌ Hirist apply error:`, err.message);
    return 'error';
  }
}

module.exports = { search, apply, saveSession, loadSession: restoreSession };
