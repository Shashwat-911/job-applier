/**
 * bot/platforms/internshala.js
 * Internshala automation for internships & entry-level tech roles in India.
 * Exports: search(page, profile), apply(page, job, profile)
 */

const { fillField, uploadResume, humanDelay, detectCaptcha, safeClick } = require('../helpers/formFiller');
const { reviewPause } = require('../helpers/reviewPause');
const tracker = require('../../db/tracker');

const BASE_URL = 'https://internshala.com';

async function search(page, profile) {
  const { search: searchCfg } = profile;
  const jobs = [];

  for (const role of searchCfg.roles) {
    const slug = role.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    const searchUrl = `${BASE_URL}/jobs/${slug}-jobs`;

    console.log(`\n🔍 Internshala search: "${role}"`);
    console.log(`   URL: ${searchUrl}`);

    try {
      await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await humanDelay(2000, 3500);

      if (await detectCaptcha(page)) {
        console.warn('  🤖 CAPTCHA on Internshala — skipping');
        continue;
      }

      const extracted = await page.evaluate((maxPer) => {
        const cards = document.querySelectorAll('.individual_internship, .job_card');
        const results = [];
        cards.forEach(card => {
          if (results.length >= maxPer) return;
          try {
            const titleEl = card.querySelector('.job-internship-name, h3.heading_4_5, .profile');
            const companyEl = card.querySelector('.company_name, .company-name');
            const locationEl = card.querySelector('.locations, .row-1-item.locations');
            const stipendEl = card.querySelector('.stipend, .salary');
            const linkEl = card.querySelector('a.view_detail_button, a[href*="/job/detail/"]');

            if (!titleEl || !linkEl) return;

            results.push({
              title: titleEl.innerText.trim(),
              company: companyEl ? companyEl.innerText.trim() : 'Unknown',
              location: locationEl ? locationEl.innerText.trim() : 'India',
              jobUrl: linkEl.href ? linkEl.href.split('?')[0] : '',
              salary: stipendEl ? stipendEl.innerText.trim() : '',
              platform: 'internshala',
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

      console.log(`  ✅ Found ${filtered.length} Internshala jobs`);
      jobs.push(...filtered);
    } catch (err) {
      console.warn(`  ⚠️ Internshala search error:`, err.message);
    }

    await humanDelay(1500, 2500);
  }

  return jobs;
}

async function apply(page, job, profile) {
  const { personal, professional } = profile;

  try {
    console.log(`\n📋 Opening: ${job.title} @ ${job.company}`);
    await page.goto(job.jobUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await humanDelay(2000, 3500);

    if (await detectCaptcha(page)) return 'skipped';

    const applyNow = await page.$('button:has-text("Apply now"), a:has-text("Apply now"), #apply_now_button');
    if (!applyNow) {
      console.warn('  ⚠️ No Apply Now button found — skipping');
      return 'skipped';
    }

    await applyNow.click();
    await humanDelay(2000, 3000);

    // Cover letter / why should we hire you?
    const coverLetter = profile.coverLetterTemplate ||
      `I am a passionate software engineer with hands-on experience in ${professional.skills.slice(0, 4).join(', ')}. I am eager to apply my technical and problem-solving skills to help ${job.company} succeed.`;

    const textAreas = await page.$$('textarea');
    for (const ta of textAreas) {
      try {
        await ta.fill(coverLetter);
      } catch (_) {}
    }

    const action = await reviewPause(page, {
      jobTitle: job.title,
      company: job.company,
      platform: 'internshala',
    });

    if (action === 'submit') {
      const submitBtn = await page.$('input[type="submit"], button:has-text("Submit"), #submit');
      if (submitBtn) await submitBtn.click();
      await humanDelay(2000, 3000);

      tracker.insertApplication({
        job_title: job.title,
        company: job.company,
        platform: 'internshala',
        job_url: job.jobUrl,
        status: 'applied',
        notes: 'Submitted via JobFlow',
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
    console.error(`  ❌ Internshala apply failed:`, err.message);
    return 'error';
  }
}

module.exports = { search, apply };
