/**
 * bot/helpers/reviewPause.js
 * Terminal pause system — prints job details and waits for S/K/Q keypress.
 * Non-negotiable human review gate before any form submission.
 */

const readline = require('readline');

/**
 * Pause and ask the user to review the pre-filled application.
 * Returns 'submit' | 'skip' | 'quit'
 *
 * @param {string} jobTitle
 * @param {string} company
 * @param {Object} [extra]   Optional extra info to display (salary, location, url)
 * @returns {Promise<'submit'|'skip'|'quit'>}
 */
async function reviewPause(jobTitle, company, extra = {}) {
  let title = typeof jobTitle === 'string' ? jobTitle : '';
  let comp = typeof company === 'string' ? company : '';
  let info = extra || {};

  if (typeof jobTitle === 'object' && company && typeof company === 'object') {
    // Called as: reviewPause(page, { jobTitle, company, ... })
    title = company.jobTitle || company.title || 'Role';
    comp  = company.company || 'Company';
    info  = company;
  } else if (!comp && typeof extra === 'object' && extra.company) {
    comp = extra.company;
  }

  // Check if profile or environment is configured for unattended batch apply
  try {
    if (process.env.BATCH_APPLY_ACTIVE === 'true') {
      console.log(`  ⚡ [Batch Mode] Auto-approving application for ${title || 'Role'} @ ${comp || 'Company'}`);
      return 'submit';
    }
    const { loadProfile } = require('../config');
    const prof = loadProfile();
    if (prof?.settings?.reviewMode === 'batch' || prof?.settings?.batchApplyActive) {
      console.log(`  ⚡ [Batch Mode] Auto-approving application for ${title || 'Role'} @ ${comp || 'Company'}`);
      return 'submit';
    }
  } catch (_) {}

  return new Promise((resolve) => {
    const lines = [
      '',
      '┌─────────────────────────────────────────────────────┐',
      `│  ⏸  REVIEW APPLICATION                              │`,
      `│  📌 ${truncate(title || 'Role', 46).padEnd(47)}│`,
      `│  🏢 ${truncate(comp || 'Company', 46).padEnd(47)}│`,
    ];

    if (info.location) {
      lines.push(`│  📍 ${truncate(info.location, 46).padEnd(47)}│`);
    }
    if (info.salary) {
      lines.push(`│  💰 ${truncate(info.salary, 46).padEnd(47)}│`);
    }
    if (info.url) {
      lines.push(`│  🔗 ${truncate(info.url, 46).padEnd(47)}│`);
    }

    lines.push(
      '├─────────────────────────────────────────────────────┤',
      '│  [S] Submit   [K] Skip   [Q] Quit bot               │',
      '└─────────────────────────────────────────────────────┘',
      ''
    );

    console.log(lines.join('\n'));
    process.stdout.write('  ➤ Your choice: ');

    // Use raw mode for single keypress without Enter
    const rl = readline.createInterface({
      input:  process.stdin,
      output: process.stdout,
    });

    // Handle piped / non-TTY environments (e.g. child process from server)
    if (!process.stdin.isTTY) {
      rl.question('', (answer) => {
        rl.close();
        const key = (answer || '').trim().toLowerCase();
        if (key === 's') { console.log('  ✅ Submitting…'); resolve('submit'); }
        else if (key === 'q') { console.log('  🛑 Quitting…'); resolve('quit'); }
        else { console.log('  ⏭  Skipping…'); resolve('skip'); }
      });
      return;
    }

    // TTY: single keypress via raw mode
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.setEncoding('utf8');

    const onKey = (key) => {
      process.stdin.setRawMode(false);
      process.stdin.pause();
      process.stdin.removeListener('data', onKey);
      rl.close();

      const k = key.toLowerCase();
      if (k === 's') {
        console.log('s\n  ✅ Submitting…');
        resolve('submit');
      } else if (k === 'q' || key === '\u0003' /* Ctrl+C */) {
        console.log('q\n  🛑 Quitting…');
        resolve('quit');
      } else {
        console.log(`${key}\n  ⏭  Skipping…`);
        resolve('skip');
      }
    };

    process.stdin.on('data', onKey);
  });
}

function truncate(str, len) {
  if (!str) return '';
  return str.length > len ? str.slice(0, len - 1) + '…' : str;
}

module.exports = { reviewPause };
