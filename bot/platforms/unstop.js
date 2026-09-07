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
        const links = document.querySelectorAll('a[href*="/jobs/"], .single_opportunity, [class*="opportunity_card"]');
        const results = [];
        const seen = new Set();
        links.forEach(card => {
          if (results.length >= maxPer) return;
          try {
            const titleEl = card.querySelector('h3, h4, .title, a[class*="title"]') || (card.tagName === 'A' ? card : null);
            const compEl = card.querySelector('.organisation, .company_name, [class*="company"], [class*="org"]');
            const locEl = card.querySelector('.location, [class*="location"]');
            let jobUrl = card.tagName === 'A' ? card.href : (card.querySelector('a[href*="/jobs/"]')?.href || '');

            if (!titleEl || !jobUrl) return;

            let title = titleEl.querySelector('h3, h4')?.innerText || titleEl.innerText;
            title = title.split('\n')[0].trim();
            const cleanUrl = jobUrl.split('?')[0];
            if (!cleanUrl || seen.has(cleanUrl)) return;
            seen.add(cleanUrl);

            results.push({
              title,
              company: compEl ? compEl.innerText.trim() : 'Company',
              location: locEl ? locEl.innerText.trim() : 'India / Remote',
              jobUrl: cleanUrl,
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

    // Wait for dynamic Angular hydration on Unstop
    const applySelectors = [
      '#un-register-btn',
      '[id*="register-btn"]',
      'div.register_btn',
      '[aria-label*="Quick Apply" i]',
      '[aria-label*="Apply" i]',
      '[aria-label*="Register" i]',
      'div:has-text("Quick Apply")',
      'button:has-text("Quick Apply")',
      'button:has-text("Apply Now")',
      'button:has-text("Apply")',
      'button:has-text("Register")',
      'a:has-text("Apply Now")',
      'a:has-text("Apply")',
      'a:has-text("Register")',
      '[class*="apply_btn"]',
      '[class*="applyBtn"]',
      '.wave_btn',
    ];

    let regBtn = null;
    // Wait briefly for hydration
    await page.waitForSelector('#un-register-btn, [id*="register-btn"], div.register_btn, button:has-text("Apply")', { timeout: 8000 }).catch(() => null);

    for (const sel of applySelectors) {
      const elements = await page.$$(sel);
      for (const el of elements) {
        if (await el.isVisible().catch(() => false)) {
          regBtn = el;
          break;
        }
      }
      if (regBtn) break;
    }

    if (!regBtn) {
      console.warn('  ⚠️ No visible register/apply button found on Unstop');
      return 'skipped';
    }

    const action = await reviewPause(page, {
      jobTitle: job.title,
      company: job.company,
      platform: 'unstop',
    });

    if (action === 'submit') {
      await regBtn.scrollIntoViewIfNeeded().catch(() => {});
      await regBtn.click({ timeout: 4000, force: true }).catch(async () => {
        await regBtn.evaluate(b => b.click()).catch(() => {});
      });
      await humanDelay(2000, 3000);
      await handleGoogleLoginIfNeeded(page);

      // Check if registration modal or confirm button appears
      const modalSubmit = await page.$('.modal button:has-text("Submit"), button:has-text("Confirm & Submit"), button:has-text("Register"), button:has-text("Next")');
      if (modalSubmit && (await modalSubmit.isVisible().catch(() => false))) {
        await modalSubmit.click({ timeout: 4000, force: true }).catch(async () => {
          await modalSubmit.evaluate(b => b.click()).catch(() => {});
        });
        await humanDelay(2000, 3000);
      }

      // Check confirmation
      const isConfirmed = await page.waitForSelector(
        'text="Registered successfully", text="Application submitted", text="Already Registered", [class*="registered"], [class*="success"]',
        { timeout: 5000 }
      ).catch(() => null);

      if (isConfirmed) {
        console.log(`  🎉 Confirmed: Registered on Unstop for ${job.title} @ ${job.company}`);
        tracker.insertApplication({
          job_title: job.title,
          company: job.company,
          platform: 'unstop',
          job_url: job.jobUrl,
          status: 'applied',
          notes: 'Confirmed on Unstop',
          salary_range: job.salary,
          location: job.location,
        });
        return 'applied';
      } else {
        console.warn(`  ⚠️ Unstop submission confirmation unverified for ${job.title} @ ${job.company}`);
        tracker.insertApplication({
          job_title: job.title,
          company: job.company,
          platform: 'unstop',
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
    console.error(`  ❌ Unstop apply error:`, err.message);
    return 'error';
  }
}

module.exports = { search, apply };
