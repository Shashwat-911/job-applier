/**
 * db/tracker.js
 * SQLite database layer for the Job Application Automation Suite.
 * Uses better-sqlite3 for synchronous, high-performance SQLite access.
 */

const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const DB_DIR = path.join(__dirname);
const DB_PATH = path.join(DB_DIR, 'job_tracker.db');

// Ensure the db directory exists
if (!fs.existsSync(DB_DIR)) {
  fs.mkdirSync(DB_DIR, { recursive: true });
}

const db = new Database(DB_PATH);

// Enable WAL mode for better concurrent read performance
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// ──────────────────────────────────────────────────────────────────────────────
// Schema initialization
// ──────────────────────────────────────────────────────────────────────────────

db.exec(`
  CREATE TABLE IF NOT EXISTS applications (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    job_title     TEXT    NOT NULL,
    company       TEXT    NOT NULL,
    platform      TEXT,
    job_url       TEXT,
    status        TEXT    DEFAULT 'applied'
                  CHECK(status IN ('applied','interviewing','offer','rejected','skipped')),
    applied_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
    notes         TEXT,
    salary_range  TEXT,
    location      TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_status   ON applications(status);
  CREATE INDEX IF NOT EXISTS idx_platform ON applications(platform);
  CREATE INDEX IF NOT EXISTS idx_applied  ON applications(applied_at);

  CREATE TABLE IF NOT EXISTS ai_usage (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    endpoint    TEXT NOT NULL,
    tokens_used INTEGER DEFAULT 0,
    called_at   DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

// Safe column migrations for existing databases
const existingCols = db.pragma('table_info(applications)').map(c => c.name);
const colsToAdd = [
  { name: 'match_score', type: 'INTEGER' },
  { name: 'missing_skills', type: 'TEXT' },
  { name: 'tailored_resume', type: 'TEXT' },
  { name: 'cover_letter', type: 'TEXT' },
  { name: 'ai_answer_log', type: 'TEXT' },
];
for (const col of colsToAdd) {
  if (!existingCols.includes(col.name)) {
    try {
      db.exec(`ALTER TABLE applications ADD COLUMN ${col.name} ${col.type}`);
    } catch (e) {
      // Column might already exist
    }
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// Prepared statements
// ──────────────────────────────────────────────────────────────────────────────

const stmts = {
  insert: db.prepare(`
    INSERT INTO applications (
      job_title, company, platform, job_url, status, notes, salary_range, location,
      match_score, missing_skills, tailored_resume, cover_letter, ai_answer_log
    )
    VALUES (
      @job_title, @company, @platform, @job_url, @status, @notes, @salary_range, @location,
      @match_score, @missing_skills, @tailored_resume, @cover_letter, @ai_answer_log
    )
  `),

  updateStatus: db.prepare(`
    UPDATE applications
    SET status = @status, notes = COALESCE(@notes, notes)
    WHERE id = @id
  `),

  updateAI: db.prepare(`
    UPDATE applications
    SET match_score = COALESCE(@match_score, match_score),
        missing_skills = COALESCE(@missing_skills, missing_skills),
        tailored_resume = COALESCE(@tailored_resume, tailored_resume),
        cover_letter = COALESCE(@cover_letter, cover_letter),
        ai_answer_log = COALESCE(@ai_answer_log, ai_answer_log)
    WHERE id = @id
  `),

  insertAIUsage: db.prepare(`
    INSERT INTO ai_usage (endpoint, tokens_used) VALUES (@endpoint, @tokens_used)
  `),

  getAIUsageStats: db.prepare(`
    SELECT endpoint, COUNT(*) as calls, SUM(tokens_used) as total_tokens
    FROM ai_usage
    GROUP BY endpoint
  `),

  getAllAIUsage: db.prepare(`SELECT * FROM ai_usage ORDER BY called_at DESC LIMIT 100`),

  getAll: db.prepare(`SELECT * FROM applications ORDER BY applied_at DESC`),

  getById: db.prepare(`SELECT * FROM applications WHERE id = ?`),

  statsByStatus: db.prepare(`
    SELECT status, COUNT(*) as count FROM applications GROUP BY status
  `),

  statsByPlatform: db.prepare(`
    SELECT platform, COUNT(*) as count FROM applications GROUP BY platform
  `),

  statsThisWeek: db.prepare(`
    SELECT COUNT(*) as count FROM applications
    WHERE applied_at >= datetime('now', '-7 days')
  `),

  statsTotal: db.prepare(`SELECT COUNT(*) as count FROM applications`),

  perDay: db.prepare(`
    SELECT date(applied_at) as day, COUNT(*) as count
    FROM applications
    WHERE applied_at >= datetime('now', '-14 days')
    GROUP BY day
    ORDER BY day ASC
  `),
};

// ──────────────────────────────────────────────────────────────────────────────
// Normalization & Deduplication Helpers
// ──────────────────────────────────────────────────────────────────────────────

function normalizeJobString(str) {
  return (str || '')
    .replace(/Actively\s*hiring/gi, '')
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/**
 * Find an existing application by URL or by company + job title.
 */
function findExistingApplication(jobUrl, company, jobTitle) {
  if (jobUrl && typeof jobUrl === 'string' && jobUrl.trim().length > 10) {
    const cleanUrl = jobUrl.split('?')[0].trim();
    const row = db.prepare(`SELECT * FROM applications WHERE job_url = ? OR job_url LIKE ? LIMIT 1`).get(jobUrl, `${cleanUrl}%`);
    if (row) return row;
  }

  const normComp = normalizeJobString(company);
  const normTitle = normalizeJobString(jobTitle);
  if (!normComp || !normTitle) return null;

  const all = db.prepare(`SELECT * FROM applications`).all();
  for (const row of all) {
    const rComp = normalizeJobString(row.company);
    const rTitle = normalizeJobString(row.job_title);
    if (rComp === normComp && (rTitle === normTitle || rTitle.includes(normTitle) || normTitle.includes(rTitle))) {
      return row;
    }
  }
  return null;
}

function isJobAlreadyProcessed(jobUrl, company, jobTitle) {
  const existing = findExistingApplication(jobUrl, company, jobTitle);
  if (!existing) return false;
  // If already successfully applied, definitely skip
  if (existing.status === 'applied') return true;
  // If explicitly skipped by user manually from dashboard review queue, keep as processed
  if (existing.notes && existing.notes.includes('Skipped by user')) return true;
  // If status is interviewing, offer, or rejected, definitely processed
  if (['interviewing', 'offer', 'rejected'].includes(existing.status)) return true;
  // Otherwise, it was skipped due to transient errors (CAPTCHA, verification timeout, session failure)
  // Allow it to be re-evaluated and retried
  return false;
}

function isJobAlreadyApplied(jobUrl, company, jobTitle) {
  const existing = findExistingApplication(jobUrl, company, jobTitle);
  return existing !== null && existing.status === 'applied';
}

function resetSkippedJobs(platform = null) {
  try {
    if (platform) {
      return db.prepare(`DELETE FROM applications WHERE status = 'skipped' AND platform = ? AND (notes IS NULL OR notes NOT LIKE '%Skipped by user%')`).run(platform);
    }
    return db.prepare(`DELETE FROM applications WHERE status = 'skipped' AND (notes IS NULL OR notes NOT LIKE '%Skipped by user%')`).run();
  } catch (err) {
    return { changes: 0, error: err.message };
  }
}

/**
 * Deduplicate database rows, preserving 'applied' status over 'skipped'
 * and cleaning company badges.
 */
function deduplicateDatabase() {
  const all = db.prepare(`SELECT * FROM applications ORDER BY applied_at DESC`).all();
  if (!all || all.length === 0) return { removed: 0, remaining: 0 };

  const groups = new Map();
  for (const row of all) {
    const cleanCompany = (row.company || '').replace(/Actively\s*hiring/gi, '').replace(/\s+/g, ' ').trim();
    const normComp = normalizeJobString(cleanCompany);
    const normTitle = normalizeJobString(row.job_title);
    const key = `${normComp}:::${normTitle}`;

    if (!groups.has(key)) {
      groups.set(key, []);
    }
    groups.get(key).push(row);
  }

  let removedCount = 0;
  const deleteStmt = db.prepare(`DELETE FROM applications WHERE id = ?`);
  const updateStmt = db.prepare(`UPDATE applications SET company = @company, status = @status, notes = @notes WHERE id = @id`);

  for (const [key, rows] of groups.entries()) {
    if (rows.length === 1) {
      const cleanCompany = (rows[0].company || '').replace(/Actively\s*hiring/gi, '').replace(/\s+/g, ' ').trim();
      if (cleanCompany !== rows[0].company) {
        updateStmt.run({ id: rows[0].id, company: cleanCompany, status: rows[0].status, notes: rows[0].notes });
      }
      continue;
    }

    // Multiple rows found: prefer applied row
    const appliedRows = rows.filter(r => r.status === 'applied');
    const canonical = appliedRows.length > 0 ? appliedRows[0] : rows[0];
    const cleanCompany = (canonical.company || '').replace(/Actively\s*hiring/gi, '').replace(/\s+/g, ' ').trim();

    updateStmt.run({
      id: canonical.id,
      company: cleanCompany,
      status: appliedRows.length > 0 ? 'applied' : canonical.status,
      notes: appliedRows.length > 0 ? (appliedRows[0].notes || canonical.notes) : canonical.notes,
    });

    for (const row of rows) {
      if (row.id !== canonical.id) {
        deleteStmt.run(row.id);
        removedCount++;
      }
    }
  }

  return { removed: removedCount, remaining: groups.size };
}

// ──────────────────────────────────────────────────────────────────────────────
// Public API
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Insert or update an application record with built-in deduplication.
 * If the record exists, it updates without creating duplicates, and
 * NEVER downgrades 'applied' status to 'skipped'.
 * @param {Object} data - { job_title, company, platform, job_url, status, notes, salary_range, location, match_score, missing_skills, tailored_resume, cover_letter, ai_answer_log }
 * @returns {Object} - The application row (with id)
 */
function insertApplication(data) {
  const rawTitle  = data.job_title || data.jobTitle || 'Unknown';
  const rawComp   = data.company || 'Unknown';
  const cleanComp = rawComp.replace(/Actively\s*hiring/gi, '').replace(/\s+/g, ' ').trim();
  const jobUrl    = data.job_url || data.jobUrl || null;
  const status    = data.status || 'applied';

  // Check if this job has already been tracked
  const existing = findExistingApplication(jobUrl, cleanComp, rawTitle);
  if (existing) {
    let finalStatus = status;
    if (existing.status === 'applied' && status === 'skipped') {
      finalStatus = 'applied'; // Never downgrade applied to skipped
    } else if (status === 'applied') {
      finalStatus = 'applied'; // Upgrade to applied if successful
    } else {
      finalStatus = status || existing.status;
    }

    const finalNotes = data.notes || existing.notes;
    const finalSalary = data.salary_range || data.salaryRange || existing.salary_range;
    const finalLocation = data.location || existing.location;
    const finalUrl = jobUrl || existing.job_url;

    db.prepare(`
      UPDATE applications
      SET company = @company,
          status = @status,
          notes = @notes,
          salary_range = COALESCE(@salary_range, salary_range),
          location = COALESCE(@location, location),
          job_url = COALESCE(@job_url, job_url)
      WHERE id = @id
    `).run({
      id: existing.id,
      company: cleanComp,
      status: finalStatus,
      notes: finalNotes,
      salary_range: finalSalary,
      location: finalLocation,
      job_url: finalUrl,
    });

    return { ...existing, company: cleanComp, status: finalStatus, notes: finalNotes, salary_range: finalSalary, location: finalLocation, job_url: finalUrl };
  }

  const payload = {
    job_title:       rawTitle,
    company:         cleanComp,
    platform:        data.platform        || null,
    job_url:         jobUrl,
    status:          status,
    notes:           data.notes           || null,
    salary_range:    data.salary_range    || data.salaryRange    || null,
    location:        data.location        || null,
    match_score:     data.match_score     !== undefined ? data.match_score : null,
    missing_skills:  typeof data.missing_skills === 'object' ? JSON.stringify(data.missing_skills) : (data.missing_skills || null),
    tailored_resume: data.tailored_resume || null,
    cover_letter:    data.cover_letter    || null,
    ai_answer_log:   typeof data.ai_answer_log === 'object' ? JSON.stringify(data.ai_answer_log) : (data.ai_answer_log || null),
  };

  const result = stmts.insert.run(payload);
  return { id: result.lastInsertRowid, ...payload };
}

/**
 * Update the status (and optionally notes) for an application.
 * @param {number} id
 * @param {string} status - applied | interviewing | offer | rejected | skipped
 * @param {string|null} notes
 */
function updateStatus(id, status, notes = null) {
  const validStatuses = ['applied', 'interviewing', 'offer', 'rejected', 'skipped'];
  if (!validStatuses.includes(status)) {
    throw new Error(`Invalid status: ${status}. Must be one of: ${validStatuses.join(', ')}`);
  }
  return stmts.updateStatus.run({ id, status, notes });
}

/**
 * Retrieve all applications with optional filters.
 * @param {Object} filters - { status, platform, fromDate, toDate }
 * @returns {Array}
 */
function getAllApplications(filters = {}) {
  let query = `SELECT * FROM applications WHERE 1=1`;
  const params = [];

  if (filters.status) {
    query += ` AND status = ?`;
    params.push(filters.status);
  }
  if (filters.platform) {
    query += ` AND platform = ?`;
    params.push(filters.platform);
  }
  if (filters.fromDate) {
    query += ` AND date(applied_at) >= ?`;
    params.push(filters.fromDate);
  }
  if (filters.toDate) {
    query += ` AND date(applied_at) <= ?`;
    params.push(filters.toDate);
  }
  if (filters.search) {
    query += ` AND (job_title LIKE ? OR company LIKE ?)`;
    params.push(`%${filters.search}%`, `%${filters.search}%`);
  }

  query += ` ORDER BY applied_at DESC`;

  if (filters.limit) {
    query += ` LIMIT ?`;
    params.push(Number(filters.limit));
  }

  return db.prepare(query).all(...params);
}

/**
 * Returns aggregate statistics.
 * @returns {{ total, byStatus, byPlatform, thisWeek, perDay }}
 */
function getStats() {
  const total     = stmts.statsTotal.get().count;
  const thisWeek  = stmts.statsThisWeek.get().count;
  const byStatus  = Object.fromEntries(
    stmts.statsByStatus.all().map(r => [r.status, r.count])
  );
  const byPlatform = Object.fromEntries(
    stmts.statsByPlatform.all().map(r => [r.platform || 'unknown', r.count])
  );
  const perDay    = stmts.perDay.all();

  return { total, thisWeek, byStatus, byPlatform, perDay };
}

/**
 * Delete all records from the applications table (for settings/reset).
 */
function clearDatabase() {
  return db.prepare(`DELETE FROM applications`).run();
}

/**
 * Get a single application by ID.
 */
function getApplicationById(id) {
  return stmts.getById.get(id);
}

/**
 * Update AI-generated content on an application.
 */
function updateApplicationAI(id, data = {}) {
  return stmts.updateAI.run({
    id,
    match_score:     data.match_score     !== undefined ? data.match_score : null,
    missing_skills:  typeof data.missing_skills === 'object' ? JSON.stringify(data.missing_skills) : (data.missing_skills || null),
    tailored_resume: data.tailored_resume || null,
    cover_letter:    data.cover_letter    || null,
    ai_answer_log:   typeof data.ai_answer_log === 'object' ? JSON.stringify(data.ai_answer_log) : (data.ai_answer_log || null),
  });
}

/**
 * Log AI API usage for token tracking and cost monitoring.
 */
function logAIUsage(endpoint, tokensUsed = 0) {
  return stmts.insertAIUsage.run({ endpoint, tokens_used: tokensUsed });
}

/**
 * Get aggregated AI usage statistics and recent calls.
 */
function getAIUsage() {
  const summary = stmts.getAIUsageStats.all();
  const recent = stmts.getAllAIUsage.all();
  const totalCalls = summary.reduce((acc, row) => acc + row.calls, 0);
  const totalTokens = summary.reduce((acc, row) => acc + (row.total_tokens || 0), 0);
  return { summary, recent, totalCalls, totalTokens };
}

/**
 * Get skill frequency from missing_skills columns.
 */
function getSkillsStats() {
  const rows = db.prepare(`SELECT missing_skills FROM applications WHERE missing_skills IS NOT NULL`).all();
  const counts = {};
  for (const row of rows) {
    try {
      const skills = JSON.parse(row.missing_skills);
      if (Array.isArray(skills)) {
        for (const s of skills) {
          const clean = s.trim().toLowerCase();
          if (clean) counts[clean] = (counts[clean] || 0) + 1;
        }
      }
    } catch (e) {}
  }
  return Object.entries(counts)
    .map(([skill, count]) => ({ skill, count }))
    .sort((a, b) => b.count - a.count);
}

/**
 * Get history of match scores for intelligence chart.
 */
function getMatchScoreHistory() {
  return db.prepare(`
    SELECT id, job_title, company, match_score, date(applied_at) as date
    FROM applications
    WHERE match_score IS NOT NULL
    ORDER BY applied_at ASC
    LIMIT 50
  `).all();
}

/**
 * Get recent AI generated Q&A logs.
 */
function getAIAnswerLogs() {
  const rows = db.prepare(`
    SELECT id, job_title, company, ai_answer_log, applied_at
    FROM applications
    WHERE ai_answer_log IS NOT NULL
    ORDER BY applied_at DESC
    LIMIT 50
  `).all();

  const logs = [];
  for (const row of rows) {
    try {
      const parsed = JSON.parse(row.ai_answer_log);
      if (Array.isArray(parsed)) {
        for (const item of parsed) {
          logs.push({
            id: row.id,
            job_title: row.job_title,
            company: row.company,
            date: row.applied_at,
            question: item.question,
            answer: item.answer,
          });
        }
      }
    } catch (e) {}
  }
  return logs;
}

// Deduplicate and sanitize on module load
try {
  const dedupRes = deduplicateDatabase();
  if (dedupRes.removed > 0) {
    console.log(`🧹 Database cleaned up: removed ${dedupRes.removed} duplicate entries. Remaining unique applications: ${dedupRes.remaining}`);
  }
} catch (_) {}

// ──────────────────────────────────────────────────────────────────────────────
// CLI usage: node db/tracker.js → initializes DB and prints stats
// ──────────────────────────────────────────────────────────────────────────────

if (require.main === module) {
  console.log('✅ Database initialized at:', DB_PATH);
  console.log('📊 Current stats:', getStats());
}

module.exports = {
  insertApplication,
  updateStatus,
  updateApplicationAI,
  logAIUsage,
  getAIUsage,
  getSkillsStats,
  getMatchScoreHistory,
  getAIAnswerLogs,
  getAllApplications,
  getStats,
  clearDatabase,
  getApplicationById,
  findExistingApplication,
  isJobAlreadyProcessed,
  isJobAlreadyApplied,
  resetSkippedJobs,
  deduplicateDatabase,
  db, // expose raw db for advanced use
};

