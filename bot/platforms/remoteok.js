/**
 * bot/platforms/remoteok.js
 * RemoteOK remote tech job search and application automation.
 * Exports: search(page, profile), apply(page, job, profile)
 */

const { fillField, uploadResume, humanDelay, detectCaptcha, safeClick } = require('../helpers/formFiller');
const { reviewPause } = require('../helpers/reviewPause');
const tracker = require('../../db/tracker');

const BASE_URL = 'https://remoteok.com';

async function search(page, profile) {
  const { search: searchCfg } = profile;
  const jobs = [];

  for (const role of searchCfg.roles) {
    const slug = role.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    const searchUrl = `${BASE_URL}/remote-${slug}-jobs`;

    console.log(`\n🔍 RemoteOK search: "${role}"`);
    console.log(`   URL: ${searchUrl}`);

    try {
      await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await humanDelay(2500, 4000);

      if (await detectCaptcha(page)) {
        console.warn('  🤖 CAPTCHA on RemoteOK — skipping');
        continue;
      }

      const extracted = await page.evaluate((maxPer) => {
        const rows = document.querySelectorAll('tr.job');
        const results = [];
        rows.forEach(row => {
          if (results.length >= maxPer) return;
          try {
            const titleEl = row.querySelector('h2[itemprop="title"], .jobCard h2, a.preventLink h2');
            const compEl = row.querySelector('h3[itemprop="name"], .company h3');
            const locEl = row.querySelector('.location');
            const salEl = row.querySelector('.salary');
            const linkEl = row.querySelector('a.preventLink, a[itemprop="url"]');

            if (!titleEl) return;

            const relativeUrl = linkEl ? linkEl.getAttribute('href') : '';
            const fullUrl = relativeUrl.startsWith('http') ? relativeUrl : `https://remoteok.com${relativeUrl}`;

            results.push({
              title: titleEl.innerText.trim(),
              company: compEl ? compEl.innerText.trim() : 'Remote Company',
              location: locEl ? locEl.innerText.trim() : 'Worldwide Remote',
              jobUrl: fullUrl.split('?')[0],
              salary: salEl ? salEl.innerText.trim() : '',
              platform: 'remoteok',
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

      console.log(`  ✅ Found ${filtered.length} RemoteOK jobs`);
      jobs.push(...filtered);
    } catch (err) {
      console.warn(`  ⚠️ RemoteOK search error:`, err.message);
    }

    await humanDelay(2000, 3000);
  }

  return jobs;
}

async function apply(page, job, profile) {
  try {
    console.log(`\n📋 Opening: ${job.title} @ ${job.company}`);
    await page.goto(job.jobUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await humanDelay(2000, 3500);

    if (await detectCaptcha(page)) return 'skipped';

    const applyBtn = await page.$('a.action-apply, a:has-text("Apply for this job"), button:has-text("Apply")');
    if (!applyBtn) {
      console.warn('  ⚠️ No direct apply button on RemoteOK');
      return 'skipped';
    }

    const action = await reviewPause(page, {
      jobTitle: job.title,
      company: job.company,
      platform: 'remoteok',
    });

    if (action === 'submit') {
      await applyBtn.click();
      await humanDelay(2000, 3000);

      tracker.insertApplication({
        job_title: job.title,
        company: job.company,
        platform: 'remoteok',
        job_url: job.jobUrl,
        status: 'applied',
        notes: 'Applied via RemoteOK',
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
    console.error(`  ❌ RemoteOK apply error:`, err.message);
    return 'error';
  }
}

module.exports = { search, apply };
