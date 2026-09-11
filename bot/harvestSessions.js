const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const os = require('os');

// Use the actual Chrome user data directory (reads real logged-in sessions)
// Windows path — auto-detect OS
function getBravePath() {
  const platform = os.platform();
  if (platform === 'win32') {
    return path.join(os.homedir(), 
      'AppData/Local/BraveSoftware/Brave-Browser/User Data');
  } else if (platform === 'darwin') {
    return path.join(os.homedir(), 
      'Library/Application Support/BraveSoftware/Brave-Browser');
  } else {
    return path.join(os.homedir(), 
      '.config/BraveSoftware/Brave-Browser');
  }
}

function getBraveExecutable() {
  const platform = os.platform();
  if (platform === 'win32') {
    return 'C:/Program Files/BraveSoftware/Brave-Browser/Application/brave.exe';
  } else if (platform === 'darwin') {
    return '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser';
  } else {
    return '/usr/bin/brave-browser';
  }
}

const PLATFORMS = [
  { name: 'linkedin',       domains: ['.linkedin.com'],                          url: 'https://www.linkedin.com/feed' },
  { name: 'indeed',         domains: ['.indeed.com'],                            url: 'https://www.indeed.com' },
  { name: 'naukri',         domains: ['.naukri.com'],                            url: 'https://www.naukri.com' },
  { name: 'wellfound',      domains: ['.wellfound.com'],                         url: 'https://wellfound.com/jobs' },
  { name: 'internshala',    domains: ['.internshala.com'],                       url: 'https://internshala.com' },
  { name: 'shine',          domains: ['.shine.com'],                             url: 'https://www.shine.com' },
  { name: 'foundit',        domains: ['.foundit.in'],                            url: 'https://www.foundit.in' },
  { name: 'glassdoor',      domains: ['.glassdoor.com', '.glassdoor.co.in'],     url: 'https://www.glassdoor.co.in' },
  { name: 'unstop',         domains: ['.unstop.com'],                            url: 'https://unstop.com' },
  { name: 'cutshort',       domains: ['.cutshort.io'],                           url: 'https://cutshort.io' },
  { name: 'hirist',         domains: ['.hirist.tech'],                           url: 'https://www.hirist.tech' },
  { name: 'remoteok',       domains: ['.remoteok.com'],                          url: 'https://remoteok.com' },
  { name: 'workatastartup', domains: ['.workatastartup.com'],                    url: 'https://www.workatastartup.com' },
];

const SENSITIVE_BOT_COOKIES = new Set(['_abck', 'ak_bmsc', 'bm_sz', 'bm_sv', 'bm_s', 'bm_so', 'bm_lso', '__cf_bm']);

function filterEphemeralCookies(cookies) {
  if (!Array.isArray(cookies)) return [];
  return cookies.filter(c => {
    const name = (c.name || '').toLowerCase();
    if (SENSITIVE_BOT_COOKIES.has(name)) {
      return false;
    }
    return true;
  });
}

async function harvestSessions() {
  const sessionDir = path.join(__dirname, 'session');
  fs.mkdirSync(sessionDir, { recursive: true });

  console.log('🔍 Connecting to your existing Brave profile...');
  console.log('⚠️  Make sure Brave is CLOSED before running this\n');

  // Launch with real Brave user data — inherits all existing logins
  let context;
  try {
    context = await chromium.launchPersistentContext(getBravePath(), {
      headless: false,
      executablePath: getBraveExecutable(),
      ignoreDefaultArgs: ['--enable-automation'],
      args: ['--no-first-run', '--no-default-browser-check'],
      timeout: 10000,
    });
  } catch (launchErr) {
    console.error(`\n❌ Could not connect to Brave profile: ${launchErr.message}`);
    console.error('💡 Please make sure all Brave browser windows are completely closed so the session profile can be read.\n');
    return;
  }

  const page = await context.newPage();
  let saved = 0;
  let failed = 0;

  for (const platform of PLATFORMS) {
    try {
      console.log(`📥 Harvesting: ${platform.name}...`);
      
      await page.goto(platform.url, { 
        waitUntil: 'domcontentloaded', 
        timeout: 15000 
      });
      await page.waitForTimeout(2000);

      // Get all cookies for this domain
      const allCookies = await context.cookies();
      const platformCookies = allCookies.filter(c => 
        (platform.domains || [platform.domain]).some(d => 
          c.domain.includes(d.replace(/^\./, '')) || c.domain === d
        )
      );

      const cleanCookies = filterEphemeralCookies(platformCookies);

      if (cleanCookies.length === 0) {
        console.log(`  ⚠️  No cookies found for ${platform.name} — might not be logged in`);
        failed++;
        continue;
      }

      const sessionPath = path.join(sessionDir, `${platform.name}.json`);
      fs.writeFileSync(sessionPath, JSON.stringify(cleanCookies, null, 2));
      console.log(`  ✅ Saved ${cleanCookies.length} cookies → session/${platform.name}.json`);
      saved++;

    } catch (err) {
      console.log(`  ❌ Failed ${platform.name}: ${err.message}`);
      failed++;
    }
  }

  await context.close();

  console.log(`\n🎉 Done! ${saved} platforms harvested, ${failed} failed`);
  console.log('You can now run the bot — no logins needed!');
}

harvestSessions().catch(console.error);
