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

const SENSITIVE_BOT_COOKIES = new Set(['_abck', 'ak_bmsc', 'bm_sz', 'bm_sv', 'bm_s', 'bm_so', 'bm_lso', '__cf_bm']);

async function handleGoogleLoginIfNeeded(page) {
  const url = page.url();
  if (url.includes('/login') || url.includes('/signin') || url.includes('accounts.google.com')) {
    const isBatch = process.env.BATCH_APPLY_ACTIVE === 'true';
    const waitTimeout = isBatch ? 15000 : 45000;
    console.log(`👉 Please log in manually in the browser window (waiting up to ${waitTimeout / 1000}s)...`);
    try {
      await page.waitForFunction(
        () => !window.location.href.includes('/login') && 
              !window.location.href.includes('/signin') &&
              !window.location.href.includes('accounts.google.com'),
        { timeout: waitTimeout }
      );
      console.log('✅ Logged in successfully');

      if (!fs.existsSync(SESSION_DIR)) fs.mkdirSync(SESSION_DIR, { recursive: true });
      const cookies = await page.context().cookies();
      const safeCookies = cookies.filter(c => !SENSITIVE_BOT_COOKIES.has(c.name));
      fs.writeFileSync(SESSION_PATH, JSON.stringify(safeCookies, null, 2));
    } catch (_) {
      console.warn('  ⚠️ Login wait timed out — continuing');
    }
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
  const seenUrls = new Set();
  await restoreSession(page);

  for (const role of searchCfg.roles) {
    console.log(`\n🔍 Unstop search: "${role}"`);
    console.log(`   URL: ${BASE_URL}/jobs`);

    try {
      await page.goto(`${BASE_URL}/jobs`, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await humanDelay(2000, 3000);
      await handleGoogleLoginIfNeeded(page);

      if (await detectCaptcha(page)) {
        console.warn('  🤖 CAPTCHA on Unstop — skipping');
        continue;
      }

      // Enter role directly into search input to trigger Next.js live filter
      const searchInput = await page.$('input[placeholder*="Search Jobs" i], input[placeholder*="Search by" i], input[type="search"]');
      if (searchInput) {
        await searchInput.click();
        await searchInput.fill('');
        await searchInput.type(role, { delay: 30 });
        await searchInput.press('Enter');
        await humanDelay(2500, 3500);
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
        if (skipKw.some(kw => combined.includes(kw))) return false;
        if (seenUrls.has(j.jobUrl)) return false;
        seenUrls.add(j.jobUrl);
        return true;
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
    await handleLoginIfPrompted(page, profile?.credentials?.unstop || profile?.credentials?.default);
    await handleGoogleLoginIfNeeded(page);

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
        console.warn(`  ⏭ Skipped location restricted Unstop role: ${job.title} @ ${job.company} [${locCheck.reason}]`);
        return 'skipped';
      }
    }

    // Pre-check for explicit ineligibility on job page
    const pageIneligible = await page.evaluate(() => {
      const text = (document.body?.innerText || '').toLowerCase();
      return text.includes('college students are not allowed') ||
             text.includes('college students not allowed') ||
             (text.includes('working professionals only') && !text.includes('students'));
    });
    if (pageIneligible) {
      console.warn(`  ⏭ Unstop role restricts eligibility ("College Students are not allowed") for ${job.title} @ ${job.company} — skipping`);
      return 'skipped';
    }

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

    // Check if already registered
    const btnText = await regBtn.innerText().catch(() => '');
    if (/registered|applied|under review/i.test(btnText)) {
      console.log(`  🎉 Already registered previously on Unstop for ${job.title} @ ${job.company}`);
      tracker.insertApplication({
        job_title: job.title,
        company: job.company,
        platform: 'unstop',
        job_url: job.jobUrl,
        status: 'applied',
        notes: 'Already registered on Unstop',
        salary_range: job.salary,
        location: job.location,
      });
      return 'applied';
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

      // Multi-step progression (supports both full-page /register and overlay modals, up to 5 steps)
      for (let step = 0; step < 5; step++) {
        // Dismiss notification prompt if present
        try {
          const dontAllow = await page.$('button:has-text("Don\'t Allow"), .moe-btn-close');
          if (dontAllow) await dontAllow.click().catch(() => {});
        } catch (_) {}

        // Immediate check: Did Unstop display an eligibility rejection modal?
        const hasIneligibilityModal = await page.evaluate(() => {
          const text = (document.body?.innerText || '').toLowerCase();
          return text.includes('you are not eligible') ||
                 text.includes('college students are not allowed') ||
                 (text.includes('eligibility') && text.includes('not match the following eligibility criteria'));
        });

        if (hasIneligibilityModal) {
          console.warn(`  ⏭ Unstop eligibility rejection: "College Students are not allowed" for ${job.title} @ ${job.company} — skipping`);
          // Click "Ok, I understand" button to dismiss
          const okBtn = await page.$('button:has-text("Ok, I understand"), button:has-text("Ok"), button:has-text("I understand")');
          if (okBtn) await okBtn.click().catch(() => {});
          return 'skipped';
        }

        // Auto-upload resume if file input is present
        try {
          if (profile?.professional?.resumePath) {
            const fileInput = await page.$('input[type="file"]');
            if (fileInput) {
              await uploadResume(page, profile.professional.resumePath).catch(() => {});
            }
          }
        } catch (_) {}

        // Fill specific Unstop registration fields if present
        try {
          await page.evaluate((prof) => {
            const setVal = (sel, val) => {
              const el = document.querySelector(sel);
              if (el && !el.value && val) {
                el.value = val;
                el.dispatchEvent(new Event('input', { bubbles: true }));
                el.dispatchEvent(new Event('change', { bubbles: true }));
              }
            };
            setVal('input#player_firstname, input[name="player_firstname"]', prof?.personal?.name?.split(' ')[0] || 'Shashwat');
            setVal('input#player_name_last, input[name="player_name_last"]', prof?.personal?.name?.split(' ').slice(1).join(' ') || 'Yadav');
            setVal('input#player_email, input[name="player_email"]', prof?.personal?.email || 'shashwatyadav101@gmail.com');
            setVal('input#cities_input, input[name="player_location"]', prof?.personal?.location || 'Bengaluru');

            // Gender & affirmative radios
            const maleRadio = document.querySelector('input[name="user_gender"][value="male"], input#un-radio-5-input');
            if (maleRadio) { maleRadio.checked = true; maleRadio.click(); maleRadio.dispatchEvent(new Event('change', { bubbles: true })); }

            // User type radio: select if unselected
            const userTypeRadio = document.querySelector('input[name="user_type"][value="college_students"], input#un-radio-13-input');
            if (userTypeRadio && !userTypeRadio.checked) {
              userTypeRadio.checked = true;
              userTypeRadio.click();
              userTypeRadio.dispatchEvent(new Event('change', { bubbles: true }));
            }

            // Acceptance checkbox
            const accept = document.querySelector('input#acceptance-input, input[name="acceptance"], input[type="checkbox"]');
            if (accept && !accept.checked) {
              accept.checked = true;
              accept.click();
              accept.dispatchEvent(new Event('change', { bubbles: true }));
            }
          }, profile);
        } catch (_) {}

        // Auto-check any remaining required checkboxes (terms, agreements)
        await page.evaluate(() => {
          const checkboxes = document.querySelectorAll('input[type="checkbox"]');
          checkboxes.forEach(cb => {
            if (!cb.checked) {
              cb.checked = true;
              cb.click();
              cb.dispatchEvent(new Event('change', { bubbles: true }));
            }
          });
        }).catch(() => {});

        // Fill remaining empty text inputs & tel inputs instantly in page context
        await page.evaluate((prof) => {
          const textInputs = document.querySelectorAll('input[type="text"], input[type="tel"]');
          textInputs.forEach(inp => {
            if (!inp.value) {
              const placeholder = (inp.placeholder || inp.name || inp.id || '').toLowerCase();
              let fillVal = '';
              if (placeholder.includes('phone') || placeholder.includes('mobile') || placeholder.includes('tel')) {
                fillVal = prof?.personal?.phone?.replace('+91', '').trim() || '6393355490';
              } else if (placeholder.includes('college') || placeholder.includes('university') || placeholder.includes('institute') || placeholder.includes('organisation')) {
                fillVal = 'Dayananda Sagar Academy of Technology & Management';
              } else if (placeholder.includes('graduat') || placeholder.includes('pass') || placeholder.includes('batch')) {
                fillVal = '2027';
              } else if (placeholder.includes('degree') || placeholder.includes('course')) {
                fillVal = 'B.E. Artificial Intelligence & Machine Learning';
              } else if (placeholder.includes('cgpa') || placeholder.includes('gpa') || placeholder.includes('percentage')) {
                fillVal = '9.2';
              } else if (placeholder.includes('experience') || placeholder.includes('year')) {
                fillVal = String(prof?.professional?.yearsExperience || '1');
              } else if (placeholder.includes('github') || placeholder.includes('portfolio') || placeholder.includes('link')) {
                fillVal = prof?.personal?.github || 'https://github.com/Shashwat-911';
              }
              if (fillVal) {
                inp.value = fillVal;
                inp.dispatchEvent(new Event('input', { bubbles: true }));
                inp.dispatchEvent(new Event('change', { bubbles: true }));
              }
            }
          });
        }, profile).catch(() => {});

        // Check for submit button first
        const submitBtn = await page.$(
          'button:has-text("Confirm & Submit"), button:has-text("Submit Application"), button:has-text("Submit"), [type="submit"]:has-text("Submit")'
        );
        if (submitBtn && (await submitBtn.isVisible().catch(() => false))) {
          await submitBtn.click({ timeout: 4000, force: true }).catch(async () => {
            await submitBtn.evaluate(b => b.click()).catch(() => {});
          });
          await humanDelay(2500, 3500);
          break;
        }

        // Check for next button
        const nextBtn = await page.$(
          'button:has-text("Next"), button:has-text("Proceed"), button:has-text("Continue"), button:has-text("Save & Next"), .btn_min_width'
        );
        if (nextBtn && (await nextBtn.isVisible().catch(() => false))) {
          await nextBtn.click({ timeout: 4000, force: true }).catch(async () => {
            await nextBtn.evaluate(b => b.click()).catch(() => {});
          });
          await humanDelay(2000, 3000);
        } else {
          break;
        }
      }

      // Check confirmation
      const isConfirmed = await page.waitForSelector(
        'text="Registered successfully", text="Application submitted", text="Already Registered", text="Registration Successful", text="Your application has been submitted", text="Successfully Registered", [class*="registered"], [class*="success"]',
        { timeout: 8000 }
      ).catch(() => null);

      const postBtnText = await regBtn.innerText().catch(() => '');
      if (isConfirmed || /registered|applied/i.test(postBtnText)) {
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
