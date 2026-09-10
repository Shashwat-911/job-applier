/**
 * bot/platforms/foundit.js
 * Foundit.in (formerly Monster India & SEA) job search and application automation.
 * Exports: search(page, profile), apply(page, job, profile)
 */

const fs = require('fs');
const path = require('path');
const { fillField, uploadResume, humanDelay, detectCaptcha, safeClick, handleLoginIfPrompted } = require('../helpers/formFiller');
const { reviewPause } = require('../helpers/reviewPause');
const tracker = require('../../db/tracker');

const BASE_URL = 'https://www.foundit.in';
const SESSION_DIR = path.join(__dirname, '..', 'session');
const SESSION_PATH = path.join(SESSION_DIR, 'foundit.json');

const SENSITIVE_BOT_COOKIES = new Set(['_abck', 'ak_bmsc', 'bm_sz', 'bm_sv', 'bm_s', 'bm_so', 'bm_lso', '__cf_bm']);

async function handleGoogleLoginIfNeeded(page) {
  const url = page.url();
  if (url.includes('/login') || url.includes('/signin') || url.includes('accounts.google.com')) {
    const isBatch = process.env.BATCH_APPLY_ACTIVE === 'true';
    const waitTimeout = isBatch ? 60000 : 120000;
    console.log(`👉 Please log in manually in the browser window (waiting up to ${isBatch ? '60 seconds' : '2 minutes'})...`);
    try {
      await page.waitForFunction(
        () => !window.location.href.includes('/login') && 
              !window.location.href.includes('/signin') &&
              !window.location.href.includes('accounts.google.com'),
        { timeout: waitTimeout }
      );
      console.log('✅ Logged in successfully');

      if (!fs.existsSync(SESSION_DIR)) fs.mkdirSync(SESSION_DIR, { recursive: true });
      const allCookies = await page.context().cookies();
      const cookies = allCookies.filter(c => (!c.domain || c.domain.includes('foundit.in')) && !SENSITIVE_BOT_COOKIES.has(c.name));
      fs.writeFileSync(SESSION_PATH, JSON.stringify(cookies, null, 2));
    } catch (_) {
      console.warn('  ⚠️ Login wait timed out — continuing');
    }
  }
}

async function purgeAkamaiCookies(context) {
  try {
    const cookies = await context.cookies();
    const badCookies = cookies.filter(c => 
      (c.domain && c.domain.includes('foundit.in')) && SENSITIVE_BOT_COOKIES.has(c.name)
    );
    for (const c of badCookies) {
      await context.clearCookies({ name: c.name, domain: c.domain }).catch(() => {});
    }
  } catch (_) {}
}

async function restoreSession(page) {
  await purgeAkamaiCookies(page.context());
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
  const seenUrls = new Set();
  await restoreSession(page);

  for (const role of searchCfg.roles) {
    const query = encodeURIComponent(role);
    const locParam = encodeURIComponent(searchCfg.location || 'India');
    const searchUrl = `${BASE_URL}/srp/results?query=${query}&locations=${locParam}&experience=1`;

    console.log(`\n🔍 Foundit search: "${role}"`);
    console.log(`   URL: ${searchUrl}`);

    try {
      await purgeAkamaiCookies(page.context());
      await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await humanDelay(2000, 3500);
      await handleGoogleLoginIfNeeded(page);

      if (await detectCaptcha(page)) {
        console.warn('  🤖 CAPTCHA on Foundit — skipping');
        continue;
      }

      const extracted = await page.evaluate((maxPer) => {
        const cards = document.querySelectorAll('.srpResultCard, [class*="cardContainer"]');
        const results = [];
        cards.forEach(card => {
          if (results.length >= maxPer) return;
          try {
            const titleEl = card.querySelector('.jobTitle, a[class*="title"], h3 a, [class*="jobTitle"], a');
            const compEl = card.querySelector('.companyName, a[class*="company"], [class*="companyName"]');
            const locEl = card.querySelector('.location, [class*="location"]');
            const salEl = card.querySelector('.salary, [class*="salary"]');

            if (!titleEl) return;

            let linkEl = card.querySelector('a[href*="/job/"], a[href*="/job-desc/"], a[href*="foundit.in"], a');
            if (!linkEl && card.tagName === 'A') linkEl = card;
            let rawUrl = (linkEl && linkEl.href) ? linkEl.href : (titleEl.href || '');
            if (!rawUrl) {
              const dataId = card.getAttribute('data-job-id') || card.getAttribute('data-id') || card.id;
              if (dataId) rawUrl = `https://www.foundit.in/job/${dataId}`;
            }
            if (rawUrl && rawUrl.startsWith('/')) {
              rawUrl = 'https://www.foundit.in' + rawUrl;
            }
            let cleanUrl = rawUrl ? rawUrl.split('?')[0] : '';
            // Never replace /job/ with /job-desc/ as Foundit redirects /job-desc/ to the user dashboard
            if (!cleanUrl || cleanUrl.includes('/career-services/') || cleanUrl.includes('talk-to-us') || (!cleanUrl.includes('/job/') && !cleanUrl.includes('/job-desc/'))) {
              return;
            }

            results.push({
              title: titleEl.innerText.trim(),
              company: compEl ? compEl.innerText.trim() : 'Company',
              location: locEl ? locEl.innerText.trim() : 'India',
              jobUrl: cleanUrl,
              salary: salEl ? salEl.innerText.trim() : '',
              platform: 'foundit',
            });
          } catch (_) {}
        });
        return results;
      }, searchCfg.maxPerRun);

      const skipKw = (searchCfg.skipKeywords || []).map(k => k.toLowerCase());
      const filtered = extracted.filter(j => {
        const combined = `${j.title} ${j.company}`.toLowerCase();
        if (skipKw.some(kw => combined.includes(kw))) return false;
        if (seenUrls.has(j.jobUrl)) return false;
        seenUrls.add(j.jobUrl);
        return true;
      });

      console.log(`  ✅ Found ${filtered.length} Foundit jobs`);
      jobs.push(...filtered);
    } catch (err) {
      console.warn(`  ⚠️ Foundit search error:`, err.message);
    }

    await humanDelay(1500, 2500);
  }

  return jobs;
}

async function apply(page, job, profile) {
  try {
    console.log(`\n📋 Opening: ${job.title} @ ${job.company}`);
    await restoreSession(page);

    try {
      await page.setExtraHTTPHeaders({
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Sec-Fetch-Dest': 'document',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-Site': 'same-origin',
        'Sec-Fetch-User': '?1',
        'Upgrade-Insecure-Requests': '1',
      });
    } catch (_) {}

    // Passing referer helps prevent Akamai WAF 403 Access Denied block
    await page.goto(job.jobUrl, { referer: 'https://www.foundit.in/srp/results', waitUntil: 'domcontentloaded', timeout: 30000 });
    await humanDelay(2000, 3500);

    // Detect Akamai WAF Access Denied immediately
    const isAccessDenied = await page.evaluate(() => {
      const t = (document.title || '').toLowerCase();
      const b = (document.body?.innerText || '').toLowerCase();
      return t.includes('access denied') || b.includes('access denied') || b.includes("you don't have permission to access");
    }).catch(() => false);

    if (isAccessDenied) {
      console.warn(`  🛡️ Foundit Akamai WAF blocked direct page load for ${job.title} @ ${job.company} — clearing cookies & skipping`);
      await purgeAkamaiCookies(page.context());
      return 'skipped';
    }

    if (await detectCaptcha(page)) return 'skipped';

    // Verify detail page location
    const { isAllowedLocation } = require('../helpers/jobFilter');
    const pageLoc = await page.evaluate(() => {
      const locEl = document.querySelector('.location, [class*="location"]');
      return locEl ? locEl.innerText.trim() : '';
    }).catch(() => '');
    if (pageLoc) {
      const locCheck = isAllowedLocation(pageLoc, job.title);
      if (!locCheck.allowed) {
        console.warn(`  ⏭ Skipped location restricted Foundit role: ${job.title} @ ${job.company} [${locCheck.reason}]`);
        return 'skipped';
      }
    }

    // Detect if Foundit redirected away from the job posting to seeker dashboard or homepage
    const isDashboardOrExpired = await page.evaluate(() => {
      const currentHref = window.location.href.toLowerCase();
      const text = (document.body?.innerText || '').toLowerCase();
      const isJobUrl = currentHref.includes('/job/') || currentHref.includes('/job-desc/');
      const isDashboard = currentHref.includes('/seeker/dashboard') ||
                          currentHref === 'https://www.foundit.in/' ||
                          currentHref === 'https://www.foundit.in' ||
                          (text.includes('welcome back') && text.includes('profile score')) ||
                          text.includes('view recommended jobs') ||
                          text.includes('this job has expired') ||
                          text.includes('job is no longer available');
      return !isJobUrl || isDashboard;
    });

    if (isDashboardOrExpired) {
      console.warn(`  ⚠️ Foundit redirected to dashboard / job expired for ${job.title} @ ${job.company} — skipping`);
      return 'skipped';
    }

    // Attempt automated credential login first
    await handleLoginIfPrompted(page, profile?.credentials?.foundit || profile?.credentials?.default);
    await handleGoogleLoginIfNeeded(page);

    // Check if already applied
    const alreadyApplied = await page.$('text=Already Applied, [class*="already-applied"], text=You have already applied').catch(() => null);
    if (alreadyApplied) {
      console.log(`  🎉 Already applied previously on Foundit for ${job.title} @ ${job.company}`);
      tracker.insertApplication({ ...job, job_title: job.title, job_url: job.jobUrl, status: 'applied', notes: 'Already applied on Foundit' });
      return 'applied';
    }

    // Find the first VISIBLE apply button
    const applySelectors = [
      '#applyNowBtn',
      'button#applyNowBtn',
      'a#applyNowBtn',
      'button:has-text("Apply")',
      'button:has-text("Quick Apply")',
      'button:has-text("Apply Now")',
      'a:has-text("Apply Now")',
      'a:has-text("Apply")',
      'a:has-text("Quick Apply")',
      '.applyBtn',
      '[class*="applyButton"]',
      'a[class*="apply"]',
      'button[class*="apply"]',
      '[data-testid*="apply"]',
      '.btn-apply',
      'button:has-text("Apply on")',
      'a:has-text("Apply on")',
      'button:has-text("Login to Apply")',
      'a:has-text("Login to Apply")',
    ];

    let applyBtn = null;
    for (const sel of applySelectors) {
      const candidates = await page.$$(sel);
      for (const el of candidates) {
        if (await el.isVisible().catch(() => false)) {
          applyBtn = el;
          break;
        }
      }
      if (applyBtn) break;
    }

    if (!applyBtn) {
      console.warn('  ⚠️ No visible apply button found on Foundit');
      return 'skipped';
    }

    const action = await reviewPause(page, {
      jobTitle: job.title,
      company: job.company,
      platform: 'foundit',
    });

    if (action === 'submit') {
      await applyBtn.scrollIntoViewIfNeeded().catch(() => {});
      await applyBtn.click({ timeout: 4000, force: true }).catch(async () => {
        await applyBtn.evaluate(b => b.click()).catch(() => {});
      });
      await humanDelay(2000, 3000);
      await handleGoogleLoginIfNeeded(page);

      // Check if quick apply modal popped up with a submit button
      const modalSubmit = await page.$('.modal button:has-text("Submit"), button:has-text("Send Application"), button:has-text("Submit Application")');
      if (modalSubmit && (await modalSubmit.isVisible().catch(() => false))) {
        await modalSubmit.click({ timeout: 4000, force: true }).catch(async () => {
          await modalSubmit.evaluate(b => b.click()).catch(() => {});
        });
        await humanDelay(2000, 3000);
      }

      // Check if external company redirect occurred
      const currentUrl = page.url();
      if (!currentUrl.includes('foundit.in')) {
        console.log('  🌐 Foundit redirected to external company site — skipping');
        return 'skipped';
      }

      // Verify actual application confirmation
      const isConfirmed = await page.waitForSelector(
        'text="Applied successfully", text="Application submitted", text="Already Applied", text="You have already applied", text="Applied", [class*="success"], .appliedBadge',
        { timeout: 8000 }
      ).catch(() => null);

      if (isConfirmed || currentUrl.includes('applied') || currentUrl.includes('success')) {
        console.log(`  🎉 Confirmed: Application accepted by Foundit for ${job.title} @ ${job.company}`);
        tracker.insertApplication({
          job_title: job.title,
          company: job.company,
          platform: 'foundit',
          job_url: job.jobUrl,
          status: 'applied',
          notes: 'Confirmed by Foundit',
          salary_range: job.salary,
          location: job.location,
        });
        return 'applied';
      } else {
        const btnText = await applyBtn.innerText().catch(() => '');
        if (/applied/i.test(btnText)) {
          console.log(`  🎉 Confirmed: Foundit apply button changed to applied for ${job.title} @ ${job.company}`);
          tracker.insertApplication({
            job_title: job.title,
            company: job.company,
            platform: 'foundit',
            job_url: job.jobUrl,
            status: 'applied',
            notes: 'Confirmed by Foundit button status',
            salary_range: job.salary,
            location: job.location,
          });
          return 'applied';
        }
        console.warn(`  ⚠️ Foundit submission confirmation unverified for ${job.title} @ ${job.company}`);
        tracker.insertApplication({
          job_title: job.title,
          company: job.company,
          platform: 'foundit',
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
    console.error(`  ❌ Foundit apply error:`, err.message);
    return 'error';
  }
}

module.exports = { search, apply };
