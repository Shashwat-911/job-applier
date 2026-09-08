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
  const cookies = allCookies.filter(c => (!c.domain || c.domain.includes('internshala.com')) && !SENSITIVE_BOT_COOKIES.has(c.name));
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
        if (skipKw.some(kw => combined.includes(kw))) return false;
        if (tracker.isJobAlreadyProcessed && tracker.isJobAlreadyProcessed(j.jobUrl, j.company, j.title)) {
          return false;
        }
        return true;
      });

      console.log(`  ✅ Found ${filtered.length} new Internshala jobs (${extracted.length - filtered.length} already processed)`);
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
    const loginModal = await page.$('#login_modal, #login-modal, #registration_modal, #registration-modal, .login-modal, form#login-form');
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

    // Cover letter / why should we hire you?
    const coverLetter = profile.coverLetterTemplate ||
      `I am a passionate software engineer with hands-on experience in ${(professional?.skills || []).slice(0, 4).join(', ') || 'distributed systems and AI'}. I am eager to apply my technical and problem-solving skills to help ${job.company} succeed.`;

    // Internshala uses Quill rich text editor (.ql-editor) where underlying textareas are hidden.
    // Fill Quill instance, .ql-editor DOM nodes, and raw textareas simultaneously.
    await page.evaluate((cl) => {
      // 1. Check window.quill API
      if (window.quill && typeof window.quill.setText === 'function') {
        try { window.quill.setText(cl); } catch (_) {}
      }

      // 2. Check Quill editor DOM containers
      const qlEditors = document.querySelectorAll('.ql-editor');
      qlEditors.forEach(el => {
        try {
          el.innerText = cl;
          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new Event('keyup', { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
        } catch (_) {}
      });

      // 3. Fallback/sync raw textarea elements
      const textareas = document.querySelectorAll('textarea');
      textareas.forEach(ta => {
        try {
          ta.value = cl;
          ta.dispatchEvent(new Event('input', { bubbles: true }));
          ta.dispatchEvent(new Event('change', { bubbles: true }));
        } catch (_) {}
      });
    }, coverLetter).catch(() => {});

    // Also fill visible required assessment text inputs (e.g. projects, years, links)
    try {
      const textInputs = await page.$$('input[type="text"]:not([value]), input[type="number"]:not([value])');
      for (const inp of textInputs) {
        const isVis = await inp.isVisible().catch(() => false);
        if (isVis) {
          const val = await inp.inputValue().catch(() => '');
          if (!val) {
            const placeholder = (await inp.getAttribute('placeholder') || '').toLowerCase();
            let fillVal = '1';
            if (placeholder.includes('github') || placeholder.includes('portfolio') || placeholder.includes('link') || placeholder.includes('url')) {
              fillVal = profile?.personal?.github || 'https://github.com/Shashwat-911';
            } else if (placeholder.includes('experience') || placeholder.includes('year') || placeholder.includes('rate') || placeholder.includes('scale')) {
              fillVal = String(professional?.yearsExperience || '1');
            }
            await inp.fill(fillVal).catch(() => {});
            await inp.evaluate(el => {
              el.dispatchEvent(new Event('input', { bubbles: true }));
              el.dispatchEvent(new Event('change', { bubbles: true }));
            }).catch(() => {});
          }
        }
      }
    } catch (_) {}

    // Auto-select affirmative radio buttons & required checkboxes for availability & terms
    await page.evaluate(() => {
      // Affirmative radios
      const radios = document.querySelectorAll('#radio1, input[name="confirm_availability"][value="yes"], input[type="radio"]');
      radios.forEach(rb => {
        const val = (rb.value || '').toLowerCase();
        const name = (rb.name || '').toLowerCase();
        const id = (rb.id || '').toLowerCase();
        if (id === 'radio1' || val === 'yes' || val === '1' || name.includes('avail') || name.includes('confirm') || name.includes('reloc')) {
          rb.checked = true;
          rb.click();
          rb.dispatchEvent(new Event('change', { bubbles: true }));
        }
      });

      // Required checkboxes
      const checkboxes = document.querySelectorAll('input[type="checkbox"]');
      checkboxes.forEach(cb => {
        if (!cb.checked) {
          cb.checked = true;
          cb.click();
          cb.dispatchEvent(new Event('change', { bubbles: true }));
        }
      });
    }).catch(() => {});

    const action = await reviewPause(page, {
      jobTitle: job.title,
      company: job.company,
      platform: 'internshala',
    });

    if (action === 'submit') {
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight)).catch(() => {});
      await humanDelay(500, 1000);

      // Listen for AJAX submission response
      let submitApiSuccess = false;
      const submitResponseHandler = async (resp) => {
        try {
          const u = resp.url();
          if (u.includes('/application/submit') && resp.request().method() === 'POST') {
            const data = await resp.json().catch(() => null);
            if (data && (data.success || data.applicationId || (data.message && data.message.toLowerCase().includes('success')) || (data.message && data.message.toLowerCase().includes('already applied')))) {
              submitApiSuccess = true;
            }
          }
        } catch (_) {}
      };
      page.on('response', submitResponseHandler);

      const submitSelectors = [
        '#submit',
        '#submit_button',
        '#application_form_submit',
        '.submit_button_container button',
        '.submit_button_container [type="submit"]',
        'input[type="submit"]',
        'input[value*="Submit"]',
        'button:has-text("Submit application")',
        'button:has-text("Submit")',
        'button[type="submit"]',
        '.submit_button',
        '.btn-primary:has-text("Submit")',
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
          const btn = document.querySelector('#submit, input[type="submit"], button[type="submit"], button.submit_button, .submit_button_container button');
          if (btn) btn.click();
        }).catch(() => {});
      }

      await humanDelay(3000, 4500);
      page.off('response', submitResponseHandler);

      // Verify actual submission acceptance
      const isConfirmed = await page.waitForSelector(
        '.application_submitted, .success_message, [class*="success"], #application_submitted_modal, .modal:has-text("Applied"), text=Applied successfully, text=Application submitted, text=Your application has been submitted, text=Successfully applied, text=Already applied, .alert-success',
        { timeout: 8000 }
      ).catch(() => null);

      const currentUrl = page.url();
      const isUrlSuccess = (currentUrl.includes('/application/') && !currentUrl.includes('/application/form/')) || currentUrl.includes('/student/applications') || currentUrl.includes('success');

      if (submitApiSuccess || isConfirmed || isUrlSuccess) {
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
