/**
 * bot/index.js
 * Main orchestrator for the Job Application Automation Suite.
 * Coordinates platform scrapers, applies rate limits, and handles errors.
 *
 * Usage: node bot/index.js
 */

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { loadProfile } = require('./config');
const { humanDelay, detectCaptcha } = require('./helpers/formFiller');

const linkedin       = require('./platforms/linkedin');
const indeed         = require('./platforms/indeed');
const naukri         = require('./platforms/naukri');
const wellfound      = require('./platforms/wellfound');
const internshala    = require('./platforms/internshala');
const shine          = require('./platforms/shine');
const foundit        = require('./platforms/foundit');
const glassdoor      = require('./platforms/glassdoor');
const unstop         = require('./platforms/unstop');
const cutshort       = require('./platforms/cutshort');
const hirist         = require('./platforms/hirist');
const remoteok       = require('./platforms/remoteok');
const workatastartup = require('./platforms/workatastartup');

const PLATFORM_MAP = {
  linkedin,
  indeed,
  naukri,
  wellfound,
  internshala,
  shine,
  foundit,
  glassdoor,
  unstop,
  cutshort,
  hirist,
  remoteok,
  workatastartup,
};

// ── Logging ──────────────────────────────────────────────────────────────────

function log(msg) {
  const ts = new Date().toISOString().replace('T', ' ').slice(0, 19);
  console.log(`[${ts}] ${msg}`);
}

// ── Retry wrapper ─────────────────────────────────────────────────────────────

async function withRetry(fn, page, retries = 1, waitMs = 60000) {
  try {
    return await fn();
  } catch (err) {
    if (retries > 0) {
      const captcha = await detectCaptcha(page).catch(() => false);
      const reason  = captcha ? 'CAPTCHA/block' : err.message;
      log(`  ⚠️  Retrying after error (${reason}). Waiting ${waitMs / 1000}s…`);
      await humanDelay(waitMs, waitMs + 5000);
      return withRetry(fn, page, retries - 1, waitMs);
    }
    throw err;
  }
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  log('🚀 Job Application Bot starting…');

  const profile = loadProfile();
  const { search: searchCfg, settings } = profile;
  const platforms = (searchCfg.platforms || []).filter(p => PLATFORM_MAP[p]);

  if (platforms.length === 0) {
    log(`❌ No valid platforms configured. Choose from: ${Object.keys(PLATFORM_MAP).join(', ')}`);
    process.exit(1);
  }

  if (!searchCfg.roles || searchCfg.roles.length === 0) {
    log('❌ No roles configured. Add roles to profile.search.roles');
    process.exit(1);
  }

  log(`📋 Profile loaded: ${profile.personal.name || '(no name)'}`);
  log(`🎯 Platforms: ${platforms.join(', ')}`);
  log(`🔍 Roles: ${searchCfg.roles.join(', ')}`);
  log(`📍 Location: ${searchCfg.location || 'not set'}`);
  log(`📊 Max per run: ${searchCfg.maxPerRun}`);

  // ── Browser setup ─────────────────────────────────────────────────────────

  const SESSION_DIR = path.join(__dirname, 'session');

  function getBrowserLaunchOptions() {
    let execPath = null;
    if (os.platform() === 'win32') {
      const p = 'C:/Program Files/BraveSoftware/Brave-Browser/Application/brave.exe';
      if (fs.existsSync(p)) execPath = p;
    } else if (os.platform() === 'darwin') {
      const p = '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser';
      if (fs.existsSync(p)) execPath = p;
    } else {
      const p = '/usr/bin/brave-browser';
      if (fs.existsSync(p)) execPath = p;
    }

    const opts = {
      headless: false,
      slowMo:   50,
      args: [
        '--no-sandbox',
        '--disable-blink-features=AutomationControlled',
        '--disable-infobars',
      ],
    };

    if (execPath) {
      log(`🌐 Using detected Brave browser: ${execPath}`);
      opts.executablePath = execPath;
    }

    return opts;
  }

  let browser;
  try {
    browser = await chromium.launch(getBrowserLaunchOptions());
  } catch (launchErr) {
    log(`⚠️ Primary browser launch failed (${launchErr.message}), falling back to chromium...`);
    browser = await chromium.launch({
      headless: false,
      slowMo:   50,
      args: [
        '--no-sandbox',
        '--disable-blink-features=AutomationControlled',
        '--disable-infobars',
      ],
    });
  }

  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    viewport:  { width: 1280, height: 800 },
    locale:    'en-US',
  });

  const page = await context.newPage();

  // Remove Playwright fingerprints
  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
  });

  let totalApplied  = 0;
  let totalSkipped  = 0;
  let totalErrors   = 0;
  let shouldQuit    = false;

  // ── Platform loop ─────────────────────────────────────────────────────────

  for (const platformName of platforms) {
    if (shouldQuit) break;

    const platform = PLATFORM_MAP[platformName];
    log(`\n${'═'.repeat(55)}`);
    log(`  Platform: ${platformName.toUpperCase()}`);
    log(`${'═'.repeat(55)}`);

    let jobs = [];
    let searchProfile = profile;

    if (platformName === 'linkedin' && searchCfg.roles && searchCfg.roles.length > 5) {
      const offsetFile = path.join(SESSION_DIR, 'linkedin_role_offset.json');
      let offset = 0;
      try {
        if (fs.existsSync(offsetFile)) {
          const data = JSON.parse(fs.readFileSync(offsetFile, 'utf8'));
          if (typeof data.offset === 'number') offset = data.offset;
        }
      } catch (_) {}

      const allRoles = searchCfg.roles;
      const rotatedRoles = [];
      for (let r = 0; r < 5; r++) {
        rotatedRoles.push(allRoles[(offset + r) % allRoles.length]);
      }

      const nextOffset = (offset + 5) % allRoles.length;
      try {
        if (!fs.existsSync(SESSION_DIR)) fs.mkdirSync(SESSION_DIR, { recursive: true });
        fs.writeFileSync(offsetFile, JSON.stringify({ offset: nextOffset }), 'utf8');
      } catch (_) {}

      log(`  🔄 LinkedIn searching 5 rotated roles (batch offset ${offset}): ${rotatedRoles.join(', ')}`);
      searchProfile = {
        ...profile,
        search: {
          ...searchCfg,
          roles: rotatedRoles,
        },
      };
    }

    try {
      jobs = await withRetry(() => platform.search(page, searchProfile), page);
      log(`  📦 Total jobs collected: ${jobs.length}`);
    } catch (err) {
      log(`  ❌ Search failed for ${platformName}: ${err.message}`);
      continue;
    }

    // ── Job application loop ─────────────────────────────────────────────

    for (let i = 0; i < jobs.length; i++) {
      if (shouldQuit) break;

      const job = jobs[i];
      log(`\n  [${i + 1}/${jobs.length}] ${job.title} @ ${job.company}`);

      let result;
      try {
        result = await withRetry(
          () => platform.apply(page, job, profile),
          page,
          1, // 1 retry
          (settings?.blockWaitSeconds || 60) * 1000
        );
      } catch (err) {
        log(`  ❌ Apply failed: ${err.message}`);
        result = 'error';
      }

      switch (result) {
        case 'applied':
          totalApplied++;
          log(`  ✅ Applied (${totalApplied} total)`);
          break;
        case 'skipped':
          totalSkipped++;
          log(`  ⏭  Skipped (${totalSkipped} total)`);
          break;
        case 'quit':
          log('  🛑 User requested quit');
          shouldQuit = true;
          break;
        case 'error':
          totalErrors++;
          log(`  ⚠️  Error (${totalErrors} total)`);
          break;
      }

      if (!shouldQuit && i < jobs.length - 1) {
        const minDelay = Math.max(
          settings?.minBetweenApplicationsMs || 3000,
          3000 // enforce minimum 3s
        );
        log(`  ⏱  Cooling down…`);
        await humanDelay(minDelay, minDelay + 2000);
      }
    }

    // Save session cookies after each platform
    try {
      if (platform.saveSession) await platform.saveSession(context);
    } catch (_) {}
  }

  // ── Summary ───────────────────────────────────────────────────────────────

  log(`\n${'═'.repeat(55)}`);
  log('  🏁 Bot run complete!');
  log(`  ✅ Applied:  ${totalApplied}`);
  log(`  ⏭  Skipped:  ${totalSkipped}`);
  log(`  ❌ Errors:   ${totalErrors}`);
  log(`${'═'.repeat(55)}\n`);

  await browser.close();
  process.exit(0);
}

// ── Entry point ───────────────────────────────────────────────────────────────

main().catch(err => {
  console.error('💥 Fatal error:', err);
  process.exit(1);
});
