/**
 * bot/platforms/wellfound.js
 * Wellfound (formerly AngelList Talent) job search and application automation.
 * Focus: High-growth tech startups and early-stage companies.
 * Exports: search(page, profile), apply(page, job, profile)
 */

const fs = require('fs');
const path = require('path');
const { fillField, uploadResume, humanDelay, detectCaptcha, safeClick, handleLoginIfPrompted } = require('../helpers/formFiller');
const { reviewPause } = require('../helpers/reviewPause');
const tracker = require('../../db/tracker');

const BASE_URL = 'https://wellfound.com';
const SESSION_DIR = path.join(__dirname, '..', 'session');
const SESSION_PATH = path.join(SESSION_DIR, 'wellfound.json');

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

function buildFieldMap(profile) {
  const { personal, professional } = profile;
  return {
    name: ['input[name*="name"]', 'input[id*="name"]'],
    email: ['input[type="email"]', 'input[name*="email"]'],
    phone: ['input[type="tel"]', 'input[name*="phone"]'],
    linkedin: ['input[placeholder*="linkedin.com"]', 'input[name*="linkedin"]'],
    github: ['input[placeholder*="github.com"]', 'input[name*="github"]'],
    portfolio: ['input[placeholder*="portfolio"]', 'input[name*="website"]'],
    note: ['textarea[name*="note"]', 'textarea[placeholder*="note"]', 'textarea[id*="note"]'],
  };
}

async function search(page, profile) {
  const { search: searchCfg } = profile;
  const jobs = [];
  const seenUrls = new Set();
  await restoreSession(page);

  for (const role of searchCfg.roles) {
    const slug = role.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    const searchUrl = `${BASE_URL}/role/${slug}`;

    console.log(`\n🔍 Wellfound search: "${role}"`);
    console.log(`   URL: ${searchUrl}`);

    try {
      await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await humanDelay(2500, 4000);
      await handleGoogleLoginIfNeeded(page);

      if (await detectCaptcha(page)) {
        console.warn('  🤖 CAPTCHA on Wellfound — skipping this role');
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

            const card = linkEl.closest('[data-test="StartupResult"], div[class*="styles_resultContainer"], div[class*="styles_jobListing"], div[class*="job"], article') || linkEl;
            const companyEl = card.querySelector('h2, [class*="styles_startupName"], [class*="company"]');
            const locationEl = card.querySelector('[class*="styles_location"], [class*="location"]');
            const salaryEl = card.querySelector('[class*="styles_compensation"], [class*="salary"]');

            results.push({
              title,
              company: companyEl ? companyEl.innerText.trim() : 'Startup',
              location: locationEl ? locationEl.innerText.trim() : '',
              jobUrl: href,
              salary: salaryEl ? salaryEl.innerText.trim() : '',
              platform: 'wellfound',
            });
          } catch (_) {}
        });
        return results;
      }, searchCfg.maxPerRun);

      const skipKw = (searchCfg.skipKeywords || []).map(k => k.toLowerCase());
      const filtered = extracted.filter(j => {
        const combined = `${j.title} ${j.company} ${j.location}`.toLowerCase();
        if (skipKw.some(kw => combined.includes(kw))) return false;
        if (seenUrls.has(j.jobUrl)) return false;
        seenUrls.add(j.jobUrl);
        return true;
      });

      console.log(`  ✅ Found ${filtered.length} Wellfound jobs`);
      jobs.push(...filtered);
    } catch (err) {
      console.warn(`  ⚠️ Wellfound search error:`, err.message);
    }

    await humanDelay(2000, 3000);
  }

  return jobs;
}

async function apply(page, job, profile) {
  const { personal, professional } = profile;
  const fieldMap = buildFieldMap(profile);
  const { isAllowedLocation } = require('../helpers/jobFilter');

  try {
    console.log(`\n📋 Opening: ${job.title} @ ${job.company}`);
    await restoreSession(page);
    await page.goto(job.jobUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await humanDelay(2000, 3500);
    await handleGoogleLoginIfNeeded(page);

    if (await detectCaptcha(page)) {
      return 'skipped';
    }

    await handleLoginIfPrompted(page, profile?.credentials?.wellfound || profile?.credentials?.default);
    await handleGoogleLoginIfNeeded(page);

    // Deep check detail page metadata: Location, Visa sponsorship, Relocation, Federal clearance
    const pageMeta = await page.evaluate(() => {
      const bText = (document.body?.innerText || '');
      let locText = '';
      let visaText = '';
      let relocText = '';

      const allElements = Array.from(document.querySelectorAll('div, span, h3, h4, p, label'));
      for (const el of allElements) {
        const t = (el.innerText || '').trim().toLowerCase();
        if (t === 'location' && el.nextElementSibling) {
          locText = (el.nextElementSibling.innerText || '').trim();
        }
        if (t === 'visa sponsorship' && el.nextElementSibling) {
          visaText = (el.nextElementSibling.innerText || '').trim();
        }
        if (t === 'relocation' && el.nextElementSibling) {
          relocText = (el.nextElementSibling.innerText || '').trim();
        }
      }

      return {
        bText: bText.slice(0, 4000),
        locText,
        visaText,
        relocText,
      };
    });

    const fullLoc = `${pageMeta.locText} ${job.location || ''}`.trim();
    const fullNotes = `${pageMeta.visaText} ${pageMeta.relocText} ${pageMeta.bText}`;
    const locCheck = isAllowedLocation(fullLoc, job.title, fullNotes);

    if (!locCheck.allowed) {
      console.warn(`  ⏭ Skipped location/visa restricted Wellfound role: ${job.title} @ ${job.company} [${locCheck.reason}]`);
      return 'skipped';
    }

    const applyBtn = await page.$('button:has-text("Apply"), button:has-text("Quick Apply"), [data-test="ApplyButton"]');
    if (!applyBtn) {
      console.warn('  ⚠️ No instant apply button found — skipping');
      return 'skipped';
    }

    // Check if the Apply button is disabled (prevents 30s click timeout)
    const isBtnDisabled = await applyBtn.evaluate(b => 
      b.disabled || 
      b.getAttribute('aria-disabled') === 'true' || 
      b.classList.contains('disabled')
    ).catch(() => false);

    if (isBtnDisabled) {
      console.warn(`  ⚠️ Wellfound apply button is disabled (location/eligibility restriction) for ${job.title} @ ${job.company} — skipping`);
      return 'skipped';
    }

    await applyBtn.click({ timeout: 2500 }).catch(async () => {
      await applyBtn.evaluate(b => b.click()).catch(() => {});
    });
    await humanDelay(2000, 3000);

    await handleLoginIfPrompted(page, profile?.credentials?.wellfound || profile?.credentials?.default);

    // Note to founder / note to recruiter
    const noteText = profile.coverLetterTemplate ||
      `Hi, I am excited about the ${job.title} role at ${job.company}. With my background in ${professional.skills.slice(0, 3).join(', ')}, I would love to contribute!`;

    await fillField(page, fieldMap.note, noteText);
    await uploadResume(page, profile.resumePath || profile.resume_path);

    // Human Review Pause
    const action = await reviewPause(page, {
      jobTitle: job.title,
      company: job.company,
      platform: 'wellfound',
    });

    if (action === 'submit') {
      const submitBtn = await page.$('button[type="submit"], button:has-text("Submit Application"), button:has-text("Send")');
      if (submitBtn) {
        const isSubmitDisabled = await submitBtn.evaluate(b => 
          b.disabled || 
          b.getAttribute('aria-disabled') === 'true' || 
          b.classList.contains('disabled')
        ).catch(() => false);

        if (isSubmitDisabled) {
          console.warn(`  ⚠️ Wellfound submit button is disabled (missing required fields / eligibility restriction) for ${job.title} @ ${job.company} — skipping`);
          return 'skipped';
        }

        await submitBtn.click({ timeout: 2500 }).catch(async () => {
          await submitBtn.evaluate(b => b.click()).catch(() => {});
        });
      }
      await humanDelay(2000, 3000);

      tracker.insertApplication({
        job_title: job.title,
        company: job.company,
        platform: 'wellfound',
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
    console.error(`  ❌ Wellfound apply failed:`, err.message);
    return 'error';
  }
}

module.exports = { search, apply };
