/**
 * bot/helpers/formFiller.js
 * Shared Playwright helpers for form filling, file upload, delays, and CAPTCHA detection.
 */

const path = require('path');

// ──────────────────────────────────────────────────────────────────────────────
// humanDelay — random pause to mimic human timing
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Wait a random duration between min and max milliseconds.
 * @param {number} min  Default 1000 ms
 * @param {number} max  Default 3000 ms
 */
async function humanDelay(min = 1000, max = 3000) {
  const ms = Math.floor(Math.random() * (max - min + 1)) + min;
  await new Promise(resolve => setTimeout(resolve, ms));
}

// ──────────────────────────────────────────────────────────────────────────────
// fillField — universal field filler
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Try each selector in order; fill the first one found.
 * Handles text/tel/email inputs, textareas, selects (closest match), radio, checkbox.
 *
 * @param {import('playwright').Page} page
 * @param {string[]} selectors   Array of CSS selectors to try
 * @param {string|boolean}  value
 * @returns {Promise<boolean>}   true if a field was filled
 */
async function fillField(page, selectors, value) {
  for (const selector of selectors) {
    try {
      const el = await page.$(selector);
      if (!el) continue;

      const tagName = await el.evaluate(e => e.tagName.toLowerCase());
      const type    = await el.evaluate(e => (e.type || '').toLowerCase());

      if (tagName === 'select') {
        // Pick the option whose text or value most closely matches
        await el.evaluate((select, val) => {
          const opts = Array.from(select.options);
          const valLower = String(val).toLowerCase();

          // Exact value match
          const exactVal = opts.find(o => o.value.toLowerCase() === valLower);
          if (exactVal) { select.value = exactVal.value; return; }

          // Exact text match
          const exactText = opts.find(o => o.text.toLowerCase() === valLower);
          if (exactText) { select.value = exactText.value; return; }

          // Partial text match
          const partial = opts.find(o => o.text.toLowerCase().includes(valLower));
          if (partial) { select.value = partial.value; return; }

          // First non-empty option as fallback
          const fallback = opts.find(o => o.value);
          if (fallback) select.value = fallback.value;
        }, value);
        await el.dispatchEvent('change');
        return true;
      }

      if (type === 'checkbox') {
        const checked = await el.isChecked();
        const shouldCheck = value === true || value === 'true' || value === 'yes' || value === 'Yes';
        if (shouldCheck !== checked) await el.click();
        return true;
      }

      if (type === 'radio') {
        await el.click();
        return true;
      }

      if (type === 'file') {
        // Handled separately by uploadResume
        continue;
      }

      // Default: text / tel / email / textarea
      await el.click({ clickCount: 3 }); // select all existing text
      await el.fill(String(value));
      return true;

    } catch (err) {
      // Selector failed — try next
    }
  }
  return false;
}

// ──────────────────────────────────────────────────────────────────────────────
// uploadResume
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Upload a resume file to the first visible file input found.
 * @param {import('playwright').Page} page
 * @param {string} resumePath   Absolute or relative path to the PDF/DOCX
 * @returns {Promise<boolean>}
 */
async function uploadResume(page, resumePath) {
  try {
    const absPath = path.resolve(resumePath);
    const fileInput = await page.$('input[type="file"]');
    if (!fileInput) {
      console.warn('  ⚠️  No file input found on page');
      return false;
    }
    await fileInput.setInputFiles(absPath);
    console.log(`  📎 Resume uploaded: ${absPath}`);
    return true;
  } catch (err) {
    console.error('  ❌ Resume upload failed:', err.message);
    return false;
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// detectCaptcha
// ──────────────────────────────────────────────────────────────────────────────

const CAPTCHA_SELECTORS = [
  // reCAPTCHA
  'iframe[src*="recaptcha"]',
  '#recaptcha',
  '.g-recaptcha',
  // hCaptcha
  'iframe[src*="hcaptcha"]',
  '.h-captcha',
  // Cloudflare
  '#cf-challenge-form',
  '.cf-browser-verification',
  // Generic
  '[class*="captcha"]',
  '[id*="captcha"]',
  '[data-callback*="captcha"]',
  // LinkedIn specific
  '.challenge-dialog',
  // Indeed specific
  '#indeed-captcha',
];

/**
 * Scan the current page for known CAPTCHA indicators.
 * @param {import('playwright').Page} page
 * @returns {Promise<boolean>}
 */
async function detectCaptcha(page) {
  for (const selector of CAPTCHA_SELECTORS) {
    try {
      const el = await page.$(selector);
      if (el) {
        const visible = await el.isVisible().catch(() => false);
        if (visible) {
          console.warn(`  🤖 CAPTCHA detected via selector: ${selector}`);
          return true;
        }
      }
    } catch (_) {
      // ignore
    }
  }

  // Also check page title / URL
  const url   = page.url();
  const title = await page.title().catch(() => '');
  const blockedIndicators = [
    'captcha', 'robot', 'verification', 'security check', 'verify you are human'
  ];
  for (const indicator of blockedIndicators) {
    if (url.toLowerCase().includes(indicator) || title.toLowerCase().includes(indicator)) {
      console.warn(`  🤖 CAPTCHA/block detected via URL/title: "${title}" | ${url}`);
      return true;
    }
  }

  return false;
}

// ──────────────────────────────────────────────────────────────────────────────
// waitForNavOrTimeout — safe navigation wait
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Wait for navigation but don't throw if it times out.
 * @param {import('playwright').Page} page
 * @param {number} timeout  ms
 */
async function waitForNavOrTimeout(page, timeout = 5000) {
  try {
    await page.waitForLoadState('domcontentloaded', { timeout });
  } catch (_) {
    // timeout is acceptable
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// safeClick — click with retry
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Click a selector safely; returns false if not found.
 * @param {import('playwright').Page} page
 * @param {string} selector
 * @param {number} timeout
 */
async function safeClick(page, selector, timeout = 3000) {
  try {
    await page.click(selector, { timeout });
    return true;
  } catch (_) {
    return false;
  }
}

/**
 * handleLoginIfPrompted — detects and auto-fills login forms if a portal presents a login gate.
 * @param {import('playwright').Page} page
 * @param {{ email: string, password: string }} creds
 * @returns {Promise<boolean>}
 */
async function handleLoginIfPrompted(page, creds) {

  if (!creds?.email || !creds?.password) return false;
  try {
    const emailInput = await page.$(
      'input[type="email"], input[id*="username"], input[id*="email"], input[name*="email"], input[name*="user"], input[placeholder*="email" i]'
    );
    const passInput = await page.$(
      'input[type="password"], input[id*="password"], input[name*="password"], input[placeholder*="password" i]'
    );

    if (emailInput && passInput) {
      console.log('  🔐 Login gate detected — filling portal credentials...');
      await emailInput.click({ clickCount: 3 });
      await emailInput.fill(creds.email);
      await humanDelay(400, 800);
      await passInput.click({ clickCount: 3 });
      await passInput.fill(creds.password);
      await humanDelay(400, 800);

      const submitBtn = await page.$(
        'button[type="submit"], input[type="submit"], button:has-text("Sign in"), button:has-text("Log in"), button:has-text("Login"), button:has-text("Continue")'
      );
      if (submitBtn) {
        await submitBtn.click();
        await humanDelay(2000, 3000);
      }
      return true;
    }
  } catch (_) {}
  return false;
}

/**
 * fillFieldWithAI — detects open-ended questions and generates contextual AI answers,
 * or handles coding platform links (GitHub, LeetCode, HackerRank, etc.)
 *
 * @param {import('playwright').Page} page
 * @param {string[]} selectors
 * @param {Object} profile
 * @param {Object} jobContext
 * @param {string} [fieldHint]
 * @returns {Promise<boolean>}
 */
async function fillFieldWithAI(page, selectors, profile, jobContext = {}, fieldHint = '') {
  const { generateAnswer, generateCoverLetter } = require('../ai/gemini');

  for (const selector of selectors) {
    try {
      const el = await page.$(selector);
      if (!el) continue;

      const tagName = await el.evaluate(e => e.tagName.toLowerCase());
      const labelText = await page.evaluate(target => {
        let text = target.getAttribute('placeholder') || target.getAttribute('aria-label') || target.getAttribute('name') || '';
        if (target.id) {
          const lbl = document.querySelector(`label[for="${target.id}"]`);
          if (lbl) text += ' ' + lbl.innerText;
        }
        return text.toLowerCase();
      }, el);

      const combinedHint = `${fieldHint} ${labelText}`.toLowerCase();

      // Check for coding profiles
      if (combinedHint.includes('github') && profile.personal?.github) {
        await fillField(page, [selector], profile.personal.github);
        return true;
      }
      if (combinedHint.includes('leetcode') && (profile.codingProfiles?.leetcode || profile.personal?.leetcode)) {
        await fillField(page, [selector], profile.codingProfiles?.leetcode || profile.personal.leetcode);
        return true;
      }
      if (combinedHint.includes('hackerrank') && (profile.codingProfiles?.hackerrank || profile.personal?.hackerrank)) {
        await fillField(page, [selector], profile.codingProfiles?.hackerrank || profile.personal.hackerrank);
        return true;
      }
      if (combinedHint.includes('linkedin') && profile.personal?.linkedin) {
        await fillField(page, [selector], profile.personal.linkedin);
        return true;
      }

      // Check if this is an open-ended question / cover letter
      const isOpenEnded = tagName === 'textarea' ||
        combinedHint.includes('why') ||
        combinedHint.includes('cover letter') ||
        combinedHint.includes('tell us') ||
        combinedHint.includes('experience with') ||
        combinedHint.includes('note');

      if (isOpenEnded) {
        let answer = null;
        if (combinedHint.includes('cover letter')) {
          answer = await generateCoverLetter(profile, jobContext);
        } else {
          answer = await generateAnswer(labelText || fieldHint, profile, jobContext);
        }

        if (answer) {
          await el.click({ clickCount: 3 });
          await el.fill(answer);
          return true;
        }
      }

      // If no AI answer generated, fallback to standard profile summary
      if (tagName === 'textarea' && profile.professional?.summary) {
        await el.click({ clickCount: 3 });
        await el.fill(profile.professional.summary);
        return true;
      }
    } catch (_) {}
  }
  return false;
}

module.exports = {
  fillField,
  fillFieldWithAI,
  handleLoginIfPrompted,
  uploadResume,
  humanDelay,
  detectCaptcha,
  waitForNavOrTimeout,
  safeClick,
};

