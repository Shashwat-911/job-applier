/**
 * bot/platforms/internshala.js
 * Internshala automation for internships & entry-level tech roles in India.
 * Exports: search(page, profile), apply(page, job, profile)
 */

const fs = require('fs');
const path = require('path');
const { fillField, uploadResume, humanDelay, detectCaptcha, safeClick, handleLoginIfPrompted } = require('../helpers/formFiller');
const { reviewPause } = require('../helpers/reviewPause');
const tracker = require('../../db/tracker');

const BASE_URL = 'https://internshala.com';
const SESSION_DIR = path.join(__dirname, '..', 'session');
const SESSION_PATH = path.join(SESSION_DIR, 'internshala.json');

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
    const slug = role.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    const searchUrl = `${BASE_URL}/jobs/${slug}-jobs`;

    console.log(`\n🔍 Internshala search: "${role}"`);
    console.log(`   URL: ${searchUrl}`);

    try {
      await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await humanDelay(2000, 3500);
      await handleLoginIfPrompted(page, profile?.credentials?.internshala || profile?.credentials?.default);

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

            const rawComp = companyEl ? companyEl.innerText.trim() : 'Unknown';
            const cleanComp = rawComp.replace(/Actively\s*hiring/gi, '').replace(/\s+/g, ' ').trim();

            results.push({
              title: titleEl.innerText.trim(),
              company: cleanComp || 'Unknown',
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
    await restoreSession(page);
    console.log(`\n📋 Opening: ${job.title} @ ${job.company}`);
    await page.goto(job.jobUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await humanDelay(2000, 3000);
    await handleLoginIfPrompted(page, profile?.credentials?.internshala || profile?.credentials?.default);

    if (await detectCaptcha(page)) return 'skipped';

    // Dismiss subscription alert, promotional overlays or popups
    try {
      const closeBtns = await page.$$('.subscription_alert .close, .subscription_alert button, .modal .close, button[aria-label="Close"], #close_popup');
      for (const btn of closeBtns) {
        if (await btn.isVisible().catch(() => false)) {
          await btn.click({ force: true }).catch(() => {});
        }
      }
    } catch (_) {}

    const applyNow = await page.$('button:has-text("Apply now"), a:has-text("Apply now"), #apply_now_button');
    if (!applyNow) {
      console.warn('  ⚠️ No Apply Now button found — skipping');
      return 'skipped';
    }

    await applyNow.scrollIntoViewIfNeeded().catch(() => {});
    await applyNow.click({ force: true }).catch(async () => {
      await applyNow.evaluate(b => b.click()).catch(() => {});
    });
    await humanDelay(1500, 2500);

    // Check if unauthenticated login prompt appeared
    const loginModal = await page.$('#login-modal, #registration-modal');
    if (loginModal && (await loginModal.isVisible().catch(() => false))) {
      console.warn('  ⚠️ Internshala requires login — session cookie unauthenticated');
      return 'skipped';
    }

    // Check for "Proceed to application" modal / step
    const proceedBtn = await page.$('#proceed_to_application, button:has-text("Proceed to application"), a:has-text("Proceed to application")');
    if (proceedBtn) {
      const isVis = await proceedBtn.isVisible().catch(() => false);
      if (isVis) {
        await proceedBtn.click({ timeout: 3000, force: true }).catch(async () => {
          await proceedBtn.evaluate(b => b.click()).catch(() => {});
        });
        await humanDelay(1500, 2500);
      }
    }

    // Cover letter / why should we hire you? (Only fill VISIBLE textareas with short timeout)
    const coverLetter = profile.coverLetterTemplate ||
      `I am a passionate software engineer with hands-on experience in ${(professional?.skills || []).slice(0, 4).join(', ') || 'distributed systems and AI'}. I am eager to apply my technical and problem-solving skills to help ${job.company} succeed.`;

    const textAreas = await page.$$('textarea');
    for (const ta of textAreas) {
      try {
        const isVis = await ta.isVisible().catch(() => false);
        if (isVis) {
          await ta.fill(coverLetter, { timeout: 2500 }).catch(() => {});
        }
      } catch (_) {}
    }

    // Auto-select affirmative radio buttons for availability & location
    try {
      const radioButtons = await page.$$('input[type="radio"]');
      for (const rb of radioButtons) {
        const isVis = await rb.isVisible().catch(() => false);
        if (isVis) {
          const val = (await rb.getAttribute('value') || '').toLowerCase();
          const name = (await rb.getAttribute('name') || '').toLowerCase();
          if (val === 'yes' || val === '1' || name.includes('avail') || name.includes('confirm') || name.includes('reloc')) {
            await rb.check({ force: true }).catch(() => {});
          }
        }
      }
    } catch (_) {}

    const action = await reviewPause(page, {
      jobTitle: job.title,
      company: job.company,
      platform: 'internshala',
    });

    if (action === 'submit') {
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight)).catch(() => {});
      await humanDelay(500, 1000);

      const submitSelectors = [
        'button:has-text("Submit application")',
        '#submit',
        'input[type="submit"]',
        'button[type="submit"]',
        'button:has-text("Submit")',
        '#submit_button',
      ];

      let submitted = false;
      for (const sel of submitSelectors) {
        try {
          const btn = await page.$(sel);
          if (btn) {
            const isVis = await btn.isVisible().catch(() => false);
            if (isVis) {
              await btn.scrollIntoViewIfNeeded().catch(() => {});
              await btn.click({ timeout: 3000, force: true }).catch(async () => {
                await btn.evaluate(b => b.click()).catch(() => {});
              });
              submitted = true;
              break;
            }
          }
        } catch (_) {}
      }

      if (!submitted) {
        // Fallback: evaluate form submit
        await page.evaluate(() => {
          const btn = document.querySelector('#submit, input[type="submit"], button[type="submit"], button.submit_button');
          if (btn) btn.click();
        }).catch(() => {});
      }

      await humanDelay(2000, 3000);

      // Verify actual submission acceptance
      const isConfirmed = await page.waitForSelector(
        '.application_submitted, .success_message, [class*="success"], text=Applied successfully, text=Application submitted, text=Your application has been submitted',
        { timeout: 5000 }
      ).catch(() => null);

      if (isConfirmed) {
        console.log(`  🎉 Confirmed: Application accepted by Internshala for ${job.title} @ ${job.company}`);
        tracker.insertApplication({
          job_title: job.title,
          company: job.company,
          platform: 'internshala',
          job_url: job.jobUrl,
          status: 'applied',
          notes: 'Confirmed by Internshala',
          salary_range: job.salary,
          location: job.location,
        });
        return 'applied';
      } else {
        console.warn(`  ⚠️ Internshala submission could not be verified for ${job.title} @ ${job.company}`);
        tracker.insertApplication({
          job_title: job.title,
          company: job.company,
          platform: 'internshala',
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
    console.error(`  ❌ Internshala apply failed:`, err.message);
    return 'error';
  }
}

module.exports = { search, apply, saveSession, loadSession: restoreSession };
