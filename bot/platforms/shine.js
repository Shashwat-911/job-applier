/**
 * bot/platforms/shine.js
 * Shine.com job search and application automation.
 * Exports: search(page, profile), apply(page, job, profile)
 */

const fs = require('fs');
const path = require('path');
const { fillField, uploadResume, humanDelay, detectCaptcha, safeClick, handleLoginIfPrompted } = require('../helpers/formFiller');
const { reviewPause } = require('../helpers/reviewPause');
const tracker = require('../../db/tracker');

const BASE_URL = 'https://www.shine.com';
const SESSION_DIR = path.join(__dirname, '..', 'session');
const SESSION_PATH = path.join(SESSION_DIR, 'shine.json');

async function restoreSession(page) {
  if (fs.existsSync(SESSION_PATH)) {
    try {
      const cookies = JSON.parse(fs.readFileSync(SESSION_PATH, 'utf8'));
      await page.context().addCookies(cookies);
    } catch (_) {}
  }
}

async function saveSession(context) {
  if (!fs.existsSync(SESSION_DIR)) fs.mkdirSync(SESSION_DIR, { recursive: true });
  const cookies = await context.cookies();
  fs.writeFileSync(SESSION_PATH, JSON.stringify(cookies, null, 2));
}

async function search(page, profile) {
  const { search: searchCfg } = profile;
  const jobs = [];
  await restoreSession(page);

  for (const role of searchCfg.roles) {
    const query = encodeURIComponent(role);
    const loc = encodeURIComponent(searchCfg.location || '');
    const searchUrl = `${BASE_URL}/job-search/${query}-jobs${loc ? '-in-' + loc : ''}`;

    console.log(`\n🔍 Shine search: "${role}"`);
    console.log(`   URL: ${searchUrl}`);

    try {
      await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await humanDelay(2000, 3500);
      await handleLoginIfPrompted(page, profile?.credentials?.shine || profile?.credentials?.default);

      if (await detectCaptcha(page)) {
        console.warn('  🤖 CAPTCHA on Shine — skipping');
        continue;
      }

      const extracted = await page.evaluate((maxPer) => {
        const cards = document.querySelectorAll('div[class*="jobCard"], .search_result_item');
        const results = [];
        cards.forEach(card => {
          if (results.length >= maxPer) return;
          try {
            const titleEl = card.querySelector('h2 a, strong a, a[class*="jobCard_p1"]');
            const companyEl = card.querySelector('.jobCard_jobCard_cName__mYnow, span[class*="companyName"]');
            const locEl = card.querySelector('.jobCard_jobCard_lists__CR4cL, span[class*="location"]');
            const salEl = card.querySelector('span[class*="salary"]');

            if (!titleEl) return;

            results.push({
              title: titleEl.innerText.trim(),
              company: companyEl ? companyEl.innerText.trim() : 'Company',
              location: locEl ? locEl.innerText.trim() : 'India',
              jobUrl: titleEl.href ? titleEl.href.split('?')[0] : '',
              salary: salEl ? salEl.innerText.trim() : '',
              platform: 'shine',
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

      console.log(`  ✅ Found ${filtered.length} Shine jobs`);
      jobs.push(...filtered);
    } catch (err) {
      console.warn(`  ⚠️ Shine search error:`, err.message);
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
    await handleLoginIfPrompted(page, profile?.credentials?.shine || profile?.credentials?.default);

    if (await detectCaptcha(page)) return 'skipped';

    const applyBtn = await page.$('button:has-text("Apply"), button:has-text("Apply on Company Site"), a:has-text("Apply")');
    if (!applyBtn) {
      console.warn('  ⚠️ No apply button found on Shine');
      return 'skipped';
    }

    const btnText = (await applyBtn.innerText().catch(() => '')).toLowerCase();
    if (btnText.includes('company site') || btnText.includes('external')) {
      console.log('  🌐 Shine job links externally to company site — skipping');
      return 'skipped';
    }

    const action = await reviewPause(page, {
      jobTitle: job.title,
      company: job.company,
      platform: 'shine',
    });

    if (action === 'submit') {
      await applyBtn.scrollIntoViewIfNeeded().catch(() => {});
      await applyBtn.click({ timeout: 4000, force: true }).catch(async () => {
        await applyBtn.evaluate(b => b.click()).catch(() => {});
      });
      await humanDelay(2000, 3000);

      // Check confirmation
      const isConfirmed = await page.waitForSelector(
        'text="Applied successfully", text="Application submitted", text="Already Applied", [class*="applied"]',
        { timeout: 5000 }
      ).catch(() => null);

      if (isConfirmed) {
        console.log(`  🎉 Confirmed: Application accepted by Shine for ${job.title} @ ${job.company}`);
        tracker.insertApplication({
          job_title: job.title,
          company: job.company,
          platform: 'shine',
          job_url: job.jobUrl,
          status: 'applied',
          notes: 'Confirmed by Shine',
          salary_range: job.salary,
          location: job.location,
        });
        return 'applied';
      } else {
        console.warn(`  ⚠️ Shine submission confirmation unverified for ${job.title} @ ${job.company}`);
        tracker.insertApplication({
          job_title: job.title,
          company: job.company,
          platform: 'shine',
          job_url: job.jobUrl,
          status: 'skipped',
          notes: 'Submission confirmation unverified',
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
    console.error(`  ❌ Shine apply error:`, err.message);
    return 'error';
  }
}

module.exports = { search, apply, saveSession, loadSession: restoreSession };
