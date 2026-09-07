/**
 * bot/applyBatch.js
 * Runner dedicated to automatically applying to jobs in the review queue
 * or a specific selected job from the localhost dashboard.
 *
 * Usage:
 *   node bot/applyBatch.js              (applies to all jobs in session/review_queue.json)
 *   node bot/applyBatch.js --index=0    (applies to a single job by index)
 */

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { loadProfile } = require('./config');
const { humanDelay } = require('./helpers/formFiller');
const tracker = require('../db/tracker');

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
  linkedin, indeed, naukri, wellfound, internshala,
  shine, foundit, glassdoor, unstop, cutshort,
  hirist, remoteok, workatastartup
};

function log(msg) {
  const ts = new Date().toISOString().replace('T', ' ').slice(0, 19);
  console.log(`[${ts}] ${msg}`);
}

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
    slowMo: 50,
    ignoreDefaultArgs: ['--enable-automation'],
    args: [
      '--no-sandbox',
      '--disable-blink-features=AutomationControlled',
      '--disable-infobars',
    ],
  };

  if (execPath) {
    opts.executablePath = execPath;
  }
  return opts;
}

async function loadSessionCookiesForPlatform(context, platformName) {
  try {
    const sessionPath = path.join(__dirname, 'session', `${platformName}.json`);
    if (fs.existsSync(sessionPath)) {
      const cookies = JSON.parse(fs.readFileSync(sessionPath, 'utf8') || '[]');
      if (Array.isArray(cookies) && cookies.length > 0) {
        const clean = cookies.filter(c => c && c.name && c.value && !c.name.startsWith('__Host-') && !c.name.startsWith('__Secure-'));
        await context.addCookies(clean).catch(() => {});
      }
    }
  } catch (_) {}
}

async function main() {
  const queuePath = path.join(__dirname, 'session', 'review_queue.json');
  if (!fs.existsSync(queuePath)) {
    log('❌ Review queue is empty (session/review_queue.json not found)');
    process.exit(0);
  }

  let queue = [];
  try {
    queue = JSON.parse(fs.readFileSync(queuePath, 'utf8') || '[]');
  } catch (err) {
    log(`❌ Failed to read review queue: ${err.message}`);
    process.exit(1);
  }

  if (queue.length === 0) {
    log('ℹ️ Review queue has 0 jobs.');
    process.exit(0);
  }

  // Parse CLI args (e.g. --index=0 or --all)
  const args = process.argv.slice(2);
  let targetJobs = queue;
  const indexArg = args.find(a => a.startsWith('--index='));
  if (indexArg) {
    const idx = parseInt(indexArg.split('=')[1], 10);
    if (!isNaN(idx) && queue[idx]) {
      targetJobs = [queue[idx]];
      log(`🎯 Submitting single job from queue: #${idx + 1} "${queue[idx].title}" @ ${queue[idx].company}`);
    }
  }

  log(`🚀 Starting automated batch submission for ${targetJobs.length} job(s)…`);

  process.env.BATCH_APPLY_ACTIVE = 'true';
  const profile = loadProfile();
  // Mark batch apply active so reviewPause auto-approves
  profile.settings = { ...profile.settings, batchApplyActive: true };

  let browser;
  try {
    browser = await chromium.launch(getBrowserLaunchOptions());
  } catch (_) {
    browser = await chromium.launch({
      headless: false,
      slowMo: 50,
      ignoreDefaultArgs: ['--enable-automation'],
      args: ['--no-sandbox', '--disable-blink-features=AutomationControlled'],
    });
  }

  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    locale: 'en-US',
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  });
  let page = await context.newPage();

  let appliedCount = 0;
  let skippedCount = 0;
  let errorCount = 0;

  for (let i = 0; i < targetJobs.length; i++) {
    const job = targetJobs[i];
    log(`\n-------------------------------------------------------`);
    log(`[${i + 1}/${targetJobs.length}] Applying to: ${job.title} @ ${job.company}`);
    log(`Platform: ${job.platform.toUpperCase()} | URL: ${job.jobUrl || 'N/A'}`);

    if (!browser.isConnected()) {
      log('🛑 Browser closed by user. Exiting batch run.');
      break;
    }
    if (page.isClosed()) {
      page = await context.newPage();
    }

    // Restore saved authenticated cookies for this platform
    await loadSessionCookiesForPlatform(context, job.platform);

    const platform = PLATFORM_MAP[job.platform];
    if (!platform || !platform.apply) {
      log(`⚠️ No automated apply handler for platform: ${job.platform}. Recording as skipped.`);
      tracker.insertApplication({ ...job, job_title: job.title, job_url: job.jobUrl, status: 'skipped', notes: 'Platform apply handler not available' });
      skippedCount++;
      continue;
    }

    try {
      const res = await platform.apply(page, job, profile);
      // Close any popup tabs that might have opened during apply
      const allPages = context.pages();
      for (const p of allPages) {
        if (p !== page && !p.isClosed()) {
          await p.close().catch(() => {});
        }
      }
      if (res === 'applied') {
        appliedCount++;
        log(`✅ Successfully applied: ${job.title} @ ${job.company}`);
      } else if (res === 'skipped') {
        skippedCount++;
        log(`⏭️ Skipped: ${job.title} @ ${job.company}`);
      } else if (res === 'quit') {
        log('🛑 Quit signal received.');
        break;
      } else {
        errorCount++;
        log(`⚠️ Result: ${res}`);
      }
    } catch (applyErr) {
      errorCount++;
      log(`❌ Error applying: ${applyErr.message}`);
    }

    // Remove job from queue on completion
    try {
      const currentQ = JSON.parse(fs.readFileSync(queuePath, 'utf8') || '[]');
      const updatedQ = currentQ.filter(j => j.jobUrl !== job.jobUrl && `${j.title}-${j.company}` !== `${job.title}-${job.company}`);
      fs.writeFileSync(queuePath, JSON.stringify(updatedQ, null, 2), 'utf8');
    } catch (_) {}

    if (i < targetJobs.length - 1) {
      log('⏱️ Cooling down between submissions…');
      await humanDelay(3500, 5000);
    }
  }

  log(`\n=======================================================`);
  log(`🏁 Batch Submission Complete!`);
  log(`   Applied: ${appliedCount}`);
  log(`   Skipped: ${skippedCount}`);
  log(`   Errors:  ${errorCount}`);
  log(`=======================================================\n`);

  await browser.close().catch(() => {});
  process.exit(0);
}

main().catch(err => {
  console.error('Fatal batch application error:', err);
  process.exit(1);
});
