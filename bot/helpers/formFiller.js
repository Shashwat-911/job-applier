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
// dismissCookieBanners — clear OneTrust and overlay modals
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Dismiss cookie consent banners (OneTrust, GDPR, etc.) that intercept clicks.
 * @param {import('playwright').Page|import('playwright').Frame} page
 */
async function dismissCookieBanners(page) {
  if (!page) return;
  try {
    const acceptSelectors = [
      '#onetrust-accept-btn-handler',
      '#onetrust-reject-all-handler',
      'button#accept-recommended-btn-handler',
      '.onetrust-close-btn-handler',
      'button:has-text("Accept all cookies")',
      'button:has-text("Accept All")',
      'button:has-text("Accept all")',
      'button:has-text("Allow all cookies")',
      'button:has-text("Allow all")',
      'button:has-text("I agree")',
      'button[aria-label="Close"]',
    ];

    for (const sel of acceptSelectors) {
      const btn = await page.$(sel).catch(() => null);
      if (btn) {
        const isVis = await btn.isVisible().catch(() => false);
        if (isVis) {
          await btn.click({ force: true, timeout: 1000 }).catch(() => {});
          break;
        }
      }
    }

    // Forcefully remove OneTrust and overlay wrappers from DOM if still obstructing
    await page.evaluate(() => {
      const idsToRemove = [
        'onetrust-consent-sdk',
        'onetrust-banner-sdk',
        'onetrust-style',
      ];
      idsToRemove.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.remove();
      });
      document.querySelectorAll('.onetrust-pc-dark-filter, .ot-fade-in, [id*="onetrust"]').forEach(el => el.remove());
      if (document.body) {
        document.body.style.overflow = 'auto';
        document.body.style.pointerEvents = 'auto';
      }
      if (document.documentElement) {
        document.documentElement.style.overflow = 'auto';
        document.documentElement.style.pointerEvents = 'auto';
      }
    }).catch(() => {});
  } catch (_) {}
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
  await dismissCookieBanners(page);
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
        if (shouldCheck !== checked) await el.click({ force: true }).catch(() => el.click());
        return true;
      }

      if (type === 'radio') {
        await el.click({ force: true }).catch(() => el.click());
        return true;
      }

      if (type === 'file') {
        // Handled separately by uploadResume
        continue;
      }

      // Default: text / tel / email / textarea
      try {
        await el.fill(String(value));
      } catch (_) {
        await el.click({ clickCount: 3, force: true }).catch(() => {});
        await el.fill(String(value));
      }
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
    const cleanPath = (resumePath || '').replace(/^["']|["']$/g, '').trim();
    const absPath = path.resolve(cleanPath);
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
  // Interactive reCAPTCHA challenge frame (bframe = interactive challenge, anchor = invisible badge)
  'iframe[src*="recaptcha/api2/bframe"]',
  'iframe[src*="recaptcha/enterprise/bframe"]',
  '#recaptcha-anchor-label',
  // hCaptcha interactive frame
  'iframe[src*="hcaptcha.com/box"]',
  'iframe[src*="hcaptcha.com/challenge"]',
  // Cloudflare & Turnstile challenges
  'iframe[src*="challenges.cloudflare.com"]',
  '#challenge-stage',
  '#challenge-form',
  '#cf-challenge-form',
  '.cf-browser-verification',
  '#challenge-running',
  '.ray-id',
  '.cf-turnstile-wrapper',
  '[data-translate="blocked_why_headline"]',
  // LinkedIn specific challenge
  '.challenge-dialog',
  // Indeed specific interactive challenge
  '#indeed-captcha',
  '#challenge-container',
  'form#captcha-form',
  'div#captcha-box',
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

  // Check for transient Cloudflare / Turnstile challenges and wait up to 8s for auto-resolution / interactive click
  let title = (await page.title().catch(() => '')).toLowerCase();
  let url   = (page.url() || '').toLowerCase();

  const isCloudflareChallenge = title.includes('just a moment...') || 
                                title.includes('checking if the site connection is secure') ||
                                url.includes('challenges.cloudflare.com') ||
                                url.includes('challenge-platform');

  if (isCloudflareChallenge) {
    console.log('  ⏳ Waiting for Cloudflare challenge (attempting auto-resolution / Turnstile click)…');
    // Check if there is an interactive Turnstile iframe checkbox to click
    try {
      const turnstileFrame = page.frames().find(f => f.url().includes('cloudflare.com') || f.url().includes('turnstile'));
      if (turnstileFrame) {
        const checkbox = await turnstileFrame.$('input[type="checkbox"], .ctp-checkbox-label, #challenge-stage, label.ctp-checkbox-label');
        if (checkbox) {
          console.log('  👆 Clicking Cloudflare Turnstile verification checkbox…');
          await checkbox.click({ force: true }).catch(() => {});
        }
      }
    } catch (_) {}

    for (let waitStep = 0; waitStep < 5; waitStep++) {
      await page.waitForTimeout(1500).catch(() => {});
      title = (await page.title().catch(() => '')).toLowerCase();
      url   = (page.url() || '').toLowerCase();
      if (!title.includes('just a moment...') && 
          !title.includes('checking if the site connection is secure') &&
          !url.includes('challenges.cloudflare.com')) {
        console.log('  ✅ Cloudflare challenge cleared!');
        break;
      }
    }
  }

  const blockedIndicators = [
    'recaptcha',
    'hcaptcha',
    'security check',
    'verify you are human',
    'just a moment...',
    'request blocked',
    'additional verification required',
    'attention required',
    'checking if the site connection is secure',
    'are you a robot',
    'not a robot',
    'access denied',
    'edgesuite.net',
    '403 forbidden',
  ];
  for (const indicator of blockedIndicators) {
    if (url.includes(indicator) || title.includes(indicator)) {
      console.warn(`  🤖 CAPTCHA/block detected via URL/title: "${title}" | ${url}`);
      return true;
    }
  }

  // Check visible page body text for challenge phrases if title is ambiguous
  try {
    const bodyText = await page.evaluate(() => {
      const b = document.body;
      return b ? (b.innerText || '').slice(0, 1000).toLowerCase() : '';
    });
    if (
      bodyText.includes('verifying you are human') ||
      bodyText.includes('checking if the site connection is secure') ||
      bodyText.includes('additional verification required') ||
      bodyText.includes('access denied') ||
      bodyText.includes("you don't have permission to access") ||
      bodyText.includes('edgesuite.net') ||
      (bodyText.includes('ray id:') && bodyText.includes('cloudflare'))
    ) {
      console.warn(`  🤖 WAF/Cloudflare/Bot challenge detected via page text`);
      return true;
    }
  } catch (_) {
    // ignore
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
    await dismissCookieBanners(page);
    await page.click(selector, { timeout });
    return true;
  } catch (_) {
    try {
      await page.click(selector, { timeout: 1000, force: true });
      return true;
    } catch (_) {
      return false;
    }
  }
}

/**
 * handleLoginIfPrompted — detects and auto-fills login forms if a portal presents a login gate.
 * Supports both single-step and two-step login flows across all portals.
 * Uses provided creds or defaults to shashwatyadav101@gmail.com / 9380743710@Aa.
 *
 * @param {import('playwright').Page} page
 * @param {{ email?: string, password?: string }} [creds]
 * @returns {Promise<boolean>}
 */
async function handleLoginIfPrompted(page, creds) {
  const fallback = { email: 'shashwatyadav101@gmail.com', password: '9380743710@Aa' };
  const c = {
    email: (creds?.email && creds.email.trim()) || fallback.email,
    password: (creds?.password && creds.password.trim()) || fallback.password,
  };

  try {
    const url = (page.url() || '').toLowerCase();
    const isAuthUrl = url.includes('/login') || url.includes('/signin') || url.includes('/auth') || url.includes('/uas/') || url.includes('/session') || url.includes('/nlogin');

    const emailInput = await page.$(
      'input[type="email"], input[id*="username"], input[id*="email"], input[name*="email"], input[name*="username"], input[name="session_key"], input[placeholder*="email" i], input[placeholder*="username" i]'
    );
    const passInput = await page.$(
      'input[type="password"], input[id*="password"], input[name*="password"], input[name="session_password"], input[placeholder*="password" i]'
    );

    if (!emailInput && !passInput && !isAuthUrl) {
      return false;
    }

    console.log(`  🔐 Login gate detected — filling credentials for ${c.email}…`);

    // Step 1: Fill email if present
    if (emailInput) {
      const isVis = await emailInput.isVisible().catch(() => false);
      if (isVis) {
        await emailInput.click({ clickCount: 3 });
        await emailInput.fill(c.email);
        await humanDelay(400, 800);
      }
    }

    // Step 2: Handle password if visible, or click Continue for 2-step auth
    let activePass = passInput;
    if (!activePass || !(await activePass.isVisible().catch(() => false))) {
      const step1Btn = await page.$(
        'button:has-text("Continue"), button:has-text("Next"), button[type="submit"], input[type="submit"]'
      );
      if (step1Btn && emailInput) {
        await step1Btn.click();
        await humanDelay(1500, 2500);
        activePass = await page.$(
          'input[type="password"], input[id*="password"], input[name*="password"], input[placeholder*="password" i]'
        );
      }
    }

    if (activePass) {
      const isVis = await activePass.isVisible().catch(() => false);
      if (isVis) {
        await activePass.click({ clickCount: 3 });
        await activePass.fill(c.password);
        await humanDelay(500, 900);
      }
    }

    // Step 3: Click final submit / sign in button
    const submitBtn = await page.$(
      'button[type="submit"], input[type="submit"], button:has-text("Sign in"), button:has-text("Log in"), button:has-text("Login"), button:has-text("Submit"), button:has-text("Continue")'
    );
    if (submitBtn) {
      const isVis = await submitBtn.isVisible().catch(() => false);
      if (isVis) {
        await submitBtn.click();
        await humanDelay(2500, 4500);
      }
    }

    if (await detectCaptcha(page)) {
      console.warn('  🤖 Verification challenge / 2FA prompt detected on login.');
      console.warn('  👉 Please complete verification challenge in the browser window if prompted...');
      await humanDelay(4000, 6000);
    }

    return true;
  } catch (_) {
    return false;
  }
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
  dismissCookieBanners,
  handleLoginIfPrompted,
  uploadResume,
  humanDelay,
  detectCaptcha,
  waitForNavOrTimeout,
  safeClick,
};

