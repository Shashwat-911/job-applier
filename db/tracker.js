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
// Public API
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Insert a new application record.
 * @param {Object} data - { job_title, company, platform, job_url, status, notes, salary_range, location, match_score, missing_skills, tailored_resume, cover_letter, ai_answer_log }
 * @returns {Object} - The newly inserted row (with id)
 */
function insertApplication(data) {
  const payload = {
    job_title:       data.job_title       || data.jobTitle       || 'Unknown',
    company:         data.company         || 'Unknown',
    platform:        data.platform        || null,
    job_url:         data.job_url         || data.jobUrl         || null,
    status:          data.status          || 'applied',
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
  db, // expose raw db for advanced use
};

