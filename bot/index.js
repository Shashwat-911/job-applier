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
const { isDesiredEngineeringJob } = require('./helpers/jobFilter');

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

const LOG_FILE = path.join(__dirname, 'agent.log');

function log(msg) {
  const ts = new Date().toISOString().replace('T', ' ').slice(0, 19);
  const formatted = `[${ts}] ${msg}`;
  console.log(formatted);
  try {
    fs.appendFileSync(LOG_FILE, formatted + '\n', 'utf8');
  } catch (_) {}
}

process.on('uncaughtException', (err) => {
  log(`💥 Uncaught Exception: ${err.stack || err.message}`);
});

process.on('unhandledRejection', (reason) => {
  log(`💥 Unhandled Rejection: ${reason?.stack || reason}`);
});

// ── Retry wrapper ─────────────────────────────────────────────────────────────

async function withRetry(fn, page, retries = 1, waitMs = 60000) {
  try {
    return await fn();
  } catch (err) {
    if (err.message && err.message.includes('closed')) {
      throw err; // Don't retry if browser/page was closed
    }
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
      ignoreDefaultArgs: ['--enable-automation'],
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
      ignoreDefaultArgs: ['--enable-automation'],
      args: [
        '--no-sandbox',
        '--disable-blink-features=AutomationControlled',
        '--disable-infobars',
      ],
    });
  }

  const context = await browser.newContext({
    viewport:  { width: 1280, height: 800 },
    locale:    'en-US',
  });

  let page = await context.newPage();

  // Remove Playwright fingerprints
  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    window.chrome = window.chrome || { runtime: {} };
  });

  let totalApplied  = 0;
  let totalSkipped  = 0;
  let totalErrors   = 0;
  let shouldQuit    = false;

  // ── Platform loop with rotation for portal diversity ─────────────────────────
  const pOffsetFile = path.join(SESSION_DIR, 'platform_rotation_offset.json');
  let pOffset = 0;
  try {
    if (fs.existsSync(pOffsetFile)) {
      pOffset = JSON.parse(fs.readFileSync(pOffsetFile, 'utf8')).offset || 0;
    }
  } catch (_) {}
  const orderedPlatforms = [];
  for (let i = 0; i < platforms.length; i++) {
    orderedPlatforms.push(platforms[(pOffset + i) % platforms.length]);
  }
  try {
    fs.writeFileSync(pOffsetFile, JSON.stringify({ offset: (pOffset + 3) % platforms.length }), 'utf8');
  } catch (_) {}

  for (const platformName of orderedPlatforms) {
    if (shouldQuit) break;

    if (!browser.isConnected()) {
      log('🛑 Browser window was closed or disconnected. Stopping run.');
      break;
    }

    if (page.isClosed()) {
      log('⚠️ Reopening fresh browser page for next platform…');
      page = await context.newPage();
    }

    const platform = PLATFORM_MAP[platformName];
    log(`\n${'═'.repeat(55)}`);
    log(`  Platform: ${platformName.toUpperCase()}`);
    log(`${'═'.repeat(55)}`);

    let jobs = [];
    let searchProfile = profile;

    if (searchCfg.roles && searchCfg.roles.length > 5) {
      const offsetFile = path.join(SESSION_DIR, `${platformName}_role_offset.json`);
      let offset = 0;
      try {
        if (fs.existsSync(offsetFile)) {
          const data = JSON.parse(fs.readFileSync(offsetFile, 'utf8'));
          if (typeof data.offset === 'number') offset = data.offset;
        }
      } catch (_) {}

      const batchSize = Math.min(5, searchCfg.roles.length);
      const allRoles = searchCfg.roles;
      const rotatedRoles = [];
      for (let r = 0; r < batchSize; r++) {
        rotatedRoles.push(allRoles[(offset + r) % allRoles.length]);
      }

      const nextOffset = (offset + batchSize) % allRoles.length;
      try {
        if (!fs.existsSync(SESSION_DIR)) fs.mkdirSync(SESSION_DIR, { recursive: true });
        fs.writeFileSync(offsetFile, JSON.stringify({ offset: nextOffset }), 'utf8');
      } catch (_) {}

      log(`  🔄 ${platformName.toUpperCase()} searching ${batchSize} rotated roles (batch offset ${offset}): ${rotatedRoles.join(', ')}`);
      searchProfile = {
        ...profile,
        search: {
          ...searchCfg,
          roles: rotatedRoles,
        },
      };
    }

    try {
      const rawJobs = await withRetry(() => platform.search(page, searchProfile), page);
      const minLpa = settings?.minSalaryLpa || 6;
      const skipKeywords = searchCfg.skipKeywords || [];

      // Strict filter: Pure Software / AI & ML engineering jobs only (>= 6 LPA, Fresher / 0-2 yrs max)
      jobs = [];
      for (const j of rawJobs) {
        const check = isDesiredEngineeringJob(j, { minLpa, skipKeywords });
        if (!check.valid) {
          log(`  ⏭ Filtered out: "${j.title}" @ ${j.company} [${check.reason}]`);
          continue;
        }
        jobs.push(j);
      }

      // Diversity cap: max 3-4 qualifying jobs from any single platform per batch run
      const perPlatformCap = 4;
      if (jobs.length > perPlatformCap) {
        log(`  🌐 Capping to ${perPlatformCap} jobs to preserve platform diversity across portals`);
        jobs = jobs.slice(0, perPlatformCap);
      }

      const maxPerRun = searchCfg.maxPerRun || 20;
      if (jobs.length > maxPerRun) {
        log(`  ✂️ Capping qualifying jobs to maxPerRun (${maxPerRun} of ${jobs.length})`);
        jobs = jobs.slice(0, maxPerRun);
      }
      log(`  🎯 Qualifying Fresher Software / AI-ML jobs (≥ ${minLpa} LPA): ${jobs.length} (from ${rawJobs.length} total found)`);

      // Update review queue file so the localhost dashboard always sees currently collected desired jobs
      try {
        const queuePath = path.join(SESSION_DIR, 'review_queue.json');
        let existingQueue = [];
        if (fs.existsSync(queuePath)) {
          existingQueue = JSON.parse(fs.readFileSync(queuePath, 'utf8'));
        }
        const combinedQueue = [...existingQueue, ...jobs];
        // Deduplicate by jobUrl or title+company
        const seen = new Set();
        const deduped = [];
        for (const item of combinedQueue) {
          const key = item.jobUrl || `${item.title}-${item.company}`;
          if (!seen.has(key)) {
            seen.add(key);
            deduped.push(item);
          }
        }

        // Interleave across platforms so the queue is evenly distributed
        const byPlatform = {};
        for (const item of deduped) {
          const p = item.platform || 'other';
          if (!byPlatform[p]) byPlatform[p] = [];
          byPlatform[p].push(item);
        }
        const interleaved = [];
        let hasItems = true;
        while (hasItems) {
          hasItems = false;
          for (const p of Object.keys(byPlatform)) {
            if (byPlatform[p].length > 0) {
              interleaved.push(byPlatform[p].shift());
              hasItems = true;
            }
          }
        }

        fs.writeFileSync(queuePath, JSON.stringify(interleaved, null, 2), 'utf8');
        log(`  📋 Review queue updated: ${interleaved.length} desired jobs waiting across portals`);

        // Emit batch collected notice
        if (deduped.length > 0) {
          log(`  📢 [BATCH COLLECTED] ${deduped.length} desired engineering jobs collected and ready on localhost`);
        }
      } catch (qErr) {
        log(`  ⚠️ Failed to update review queue file: ${qErr.message}`);
      }
    } catch (err) {
      log(`  ❌ Search failed for ${platformName}: ${err.message}`);
      continue;
    }

    // ── Job application loop ─────────────────────────────────────────────

    for (let i = 0; i < jobs.length; i++) {
      if (shouldQuit) break;

      if (!browser.isConnected()) {
        log('🛑 Browser window was closed or disconnected. Stopping run.');
        shouldQuit = true;
        break;
      }

      if (page.isClosed()) {
        log('⚠️ Browser page was closed. Reopening fresh page to continue…');
        page = await context.newPage();
      }

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
  log(`💥 Fatal error: ${err.stack || err.message}`);
  process.exit(1);
});
