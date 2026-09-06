/**
 * bot/config.js
 * Profile & configuration management.
 * Reads/writes bot/profile.json. Auto-creates from template if missing.
 */

const fs   = require('fs');
const path = require('path');

const PROFILE_PATH   = path.join(__dirname, 'profile.json');
const TEMPLATE_PATH  = path.join(__dirname, 'profile.template.json');

// ──────────────────────────────────────────────────────────────────────────────
// Internal helpers
// ──────────────────────────────────────────────────────────────────────────────

function ensureProfileExists() {
  if (!fs.existsSync(PROFILE_PATH)) {
    if (fs.existsSync(TEMPLATE_PATH)) {
      fs.copyFileSync(TEMPLATE_PATH, PROFILE_PATH);
      console.log('📋 Created profile.json from template. Please fill in your details.');
    } else {
      // Fallback: write minimal profile
      const minimal = {
        personal:     { name:'', email:'', phone:'', location:'', linkedin:'', portfolio:'' },
        professional: { title:'', yearsExperience:0, summary:'', skills:[], expectedSalary:'',
                        noticePeriod:'30 days', workMode:'Any', resumePath:'./resume.pdf' },
        qa:           { authorized:'Yes', education:'', whyThisCompany:'', relocation:'No' },
        search:       { roles:[], platforms:['linkedin','indeed'], location:'',
                        skipKeywords:[], maxPerRun:20, postedWithin:'week' },
        settings:     { delayMin:1000, delayMax:3000, retryOnBlock:true,
                        blockWaitSeconds:60, minBetweenApplicationsMs:3000 },
        credentials:  { naukri:{ email:'', password:'' } },
      };
      fs.writeFileSync(PROFILE_PATH, JSON.stringify(minimal, null, 2), 'utf8');
    }
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// Public API
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Load and return the full profile object.
 * @returns {Object}
 */
function loadProfile() {
  ensureProfileExists();
  const raw = fs.readFileSync(PROFILE_PATH, 'utf8');
  return JSON.parse(raw);
}

/**
 * Overwrite the entire profile.json with a new object.
 * @param {Object} profileData
 */
function saveProfile(profileData) {
  fs.writeFileSync(PROFILE_PATH, JSON.stringify(profileData, null, 2), 'utf8');
}

/**
 * Merge-update a single top-level section of the profile.
 * @param {string} key   - e.g. 'personal', 'search', 'settings'
 * @param {Object} data  - Partial object to deep-merge into that section
 */
function updateSection(key, data) {
  const profile = loadProfile();
  profile[key] = { ...(profile[key] || {}), ...data };
  saveProfile(profile);
  return profile[key];
}

/**
 * Convenience: read a specific section.
 * @param {string} key
 * @returns {Object}
 */
function getSection(key) {
  const profile = loadProfile();
  return profile[key] || {};
}

module.exports = { loadProfile, saveProfile, updateSection, getSection, PROFILE_PATH };
