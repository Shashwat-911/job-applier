/**
 * bot/server.js
 * Express REST API (port 3001) bridging the React dashboard to the bot and DB.
 *
 * Endpoints:
 *   GET  /api/profile
 *   POST /api/profile
 *   GET  /api/applications
 *   GET  /api/stats
 *   POST /api/applications/:id/status  → sends email if status becomes 'interviewing'
 *   POST /api/bot/start      (SSE stream)
 *   POST /api/bot/stop
 *   POST /api/bot/action     (S/K/Q keypresses from dashboard)
 */

const express      = require('express');
const cors         = require('cors');
const path         = require('path');
const fs           = require('fs');
const nodemailer   = require('nodemailer');
const { spawn, execFile } = require('child_process');
const { loadProfile, saveProfile, updateSection } = require('./config');
const tracker = require('../db/tracker');

// ──────────────────────────────────────────────────────────────────────────────
// Email notification system
// ──────────────────────────────────────────────────────────────────────────────

const EMAIL_CONFIG_PATH = path.join(__dirname, 'email.config.json');

/**
 * Load email config safely. Returns null if file missing or disabled.
 * @returns {Object|null}
 */
function loadEmailConfig() {
  try {
    if (!fs.existsSync(EMAIL_CONFIG_PATH)) return null;
    const cfg = JSON.parse(fs.readFileSync(EMAIL_CONFIG_PATH, 'utf8'));
    return cfg.enabled ? cfg : null;
  } catch {
    return null;
  }
}

/**
 * Send an interview notification email (fire-and-forget).
 * Silently skips if email is not configured or disabled.
 * @param {string} jobTitle
 * @param {string} company
 * @param {string} jobUrl
 */
async function sendInterviewEmail(jobTitle, company, jobUrl) {
  const cfg = loadEmailConfig();
  if (!cfg) return; // not configured or disabled

  try {
    const transporter = nodemailer.createTransport({
      host:   cfg.smtp.host,
      port:   cfg.smtp.port,
      secure: cfg.smtp.secure,
      auth:   cfg.smtp.auth,
    });

    const jobLink = jobUrl ? `<p><a href="${jobUrl}" style="color:#818cf8">View Job Posting</a></p>` : '';

    await transporter.sendMail({
      from:    cfg.from,
      to:      cfg.to,
      subject: `🎉 Interview logged — ${jobTitle} at ${company}`,
      html: `
        <div style="font-family:Inter,sans-serif;background:#0b0b18;color:#e2e8f0;padding:32px;border-radius:12px;max-width:520px">
          <h2 style="margin:0 0 8px;color:#818cf8">🎉 Interview Logged!</h2>
          <p style="color:#94a3b8;margin:0 0 24px">You have an interview opportunity — time to prepare!</p>
          <div style="background:#1a1a2e;border:1px solid rgba(255,255,255,0.08);border-radius:8px;padding:20px;margin-bottom:24px">
            <div style="margin-bottom:12px">
              <span style="color:#64748b;font-size:12px;text-transform:uppercase;letter-spacing:0.05em">Role</span><br/>
              <span style="font-size:18px;font-weight:600">${jobTitle}</span>
            </div>
            <div>
              <span style="color:#64748b;font-size:12px;text-transform:uppercase;letter-spacing:0.05em">Company</span><br/>
              <span style="font-size:18px;font-weight:600">${company}</span>
            </div>
          </div>
          ${jobLink}
          <p style="color:#475569;font-size:12px;margin:24px 0 0">Sent by JobFlow Automation Suite</p>
        </div>
      `,
    });

    console.log(`📧 Interview email sent for ${jobTitle} @ ${company}`);
  } catch (err) {
    // Never let email errors surface to the API response
    console.error('📧 Email send failed:', err.message);
  }
}

const app  = express();
const PORT = 3001;

app.use(cors({ origin: ['http://localhost:5173', 'http://localhost:3001'], credentials: true }));
app.use(express.json({ limit: '2mb' }));

// Serve compiled dashboard statically so http://localhost:3001 gives the full Web UI
const DIST_PATH = path.join(__dirname, '../dashboard/dist');
if (fs.existsSync(DIST_PATH)) {
  app.use(express.static(DIST_PATH));
}

// ──────────────────────────────────────────────────────────────────────────────
// Bot process state
// ──────────────────────────────────────────────────────────────────────────────

let botProcess   = null;
let botStatus    = 'idle'; // idle | running | paused | done | error
let harvestProcess = null;
let harvestStatus  = 'idle'; // idle | running | done | error
let sseClients   = [];     // Server-Sent Event response objects
let pendingAction = null;  // Resolve function for waiting stdin

// ──────────────────────────────────────────────────────────────────────────────
// SSE broadcaster
// ──────────────────────────────────────────────────────────────────────────────

function broadcast(event, data) {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  sseClients = sseClients.filter(res => {
    try { res.write(payload); return true; } catch { return false; }
  });
}

// ──────────────────────────────────────────────────────────────────────────────
// Profile endpoints
// ──────────────────────────────────────────────────────────────────────────────

app.get('/api/profile', (req, res) => {
  try {
    const prof = loadProfile();
    const envKey = process.env.GEMINI_API_KEY;
    prof.geminiApiKey = (envKey && envKey !== 'your_gemini_key_here') ? envKey : '';
    res.json(prof);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/profile', (req, res) => {
  try {
    if (req.body.geminiApiKey) {
      const envPath = path.join(__dirname, '.env');
      fs.writeFileSync(envPath, `GEMINI_API_KEY=${req.body.geminiApiKey}\n`, 'utf8');
      process.env.GEMINI_API_KEY = req.body.geminiApiKey;
    }
    saveProfile(req.body);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


app.patch('/api/profile/:section', (req, res) => {
  try {
    const updated = updateSection(req.params.section, req.body);
    res.json({ ok: true, section: updated });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ──────────────────────────────────────────────────────────────────────────────
// Application tracker endpoints
// ──────────────────────────────────────────────────────────────────────────────

app.get('/api/applications', (req, res) => {
  try {
    const filters = {};
    if (req.query.status)   filters.status   = req.query.status;
    if (req.query.platform) filters.platform = req.query.platform;
    if (req.query.from)     filters.fromDate = req.query.from;
    if (req.query.to)       filters.toDate   = req.query.to;
    if (req.query.search)   filters.search   = req.query.search;
    if (req.query.limit)    filters.limit    = req.query.limit;

    res.json(tracker.getAllApplications(filters));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/stats', (req, res) => {
  try {
    res.json(tracker.getStats());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/applications/:id/status', (req, res) => {
  try {
    const id             = Number(req.params.id);
    const { status, notes } = req.body;

    tracker.updateStatus(id, status, notes);
    res.json({ ok: true });

    // Fire-and-forget email notification when status becomes 'interviewing'
    if (status === 'interviewing') {
      const app = tracker.getApplicationById(id);
      if (app) {
        sendInterviewEmail(app.job_title, app.company, app.job_url);
      }
    }
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.delete('/api/applications/all', (req, res) => {
  try {
    tracker.clearDatabase();
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ──────────────────────────────────────────────────────────────────────────────
// Bot control endpoints
// ──────────────────────────────────────────────────────────────────────────────

app.post('/api/bot/start', (req, res) => {
  if (botProcess) {
    return res.status(409).json({ error: 'Bot is already running' });
  }

  botStatus = 'running';
  broadcast('status', { status: 'running' });

  const botPath = path.join(__dirname, 'index.js');

  botProcess = spawn('node', [botPath], {
    cwd:   path.join(__dirname, '..'),
    env:   { ...process.env },
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  // Stream stdout → SSE
  botProcess.stdout.on('data', (chunk) => {
    const lines = chunk.toString().split('\n').filter(Boolean);
    lines.forEach(line => {
      console.log('[BOT]', line);
      broadcast('log', { line });

      // Detect review pause prompt
      if (line.includes('REVIEW APPLICATION') || line.includes('⏸')) {
        botStatus = 'paused';
        broadcast('status', { status: 'paused' });
      }
      // Detect batch collection ready event
      if (line.includes('[BATCH COLLECTED]') || line.includes('Review queue updated:')) {
        try {
          const queueData = fs.existsSync(REVIEW_QUEUE_PATH)
            ? JSON.parse(fs.readFileSync(REVIEW_QUEUE_PATH, 'utf8') || '[]')
            : [];
          broadcast('batch_collected', { count: queueData.length, jobs: queueData });
        } catch (_) {}
      }
      // Detect job card info from log lines
      if (line.includes('📌') || line.includes('🏢')) {
        broadcast('job', { line });
      }
    });
  });

  // Stream stderr → SSE as well
  botProcess.stderr.on('data', (chunk) => {
    const lines = chunk.toString().split('\n').filter(Boolean);
    lines.forEach(line => {
      broadcast('log', { line: `[ERR] ${line}` });
    });
  });

  botProcess.on('close', (code) => {
    botStatus  = code === 0 ? 'done' : 'error';
    botProcess = null;
    broadcast('status', { status: botStatus, code });
    console.log(`[BOT] Process exited with code ${code}`);
  });

  botProcess.on('error', (err) => {
    botStatus  = 'error';
    botProcess = null;
    broadcast('status', { status: 'error', message: err.message });
  });

  res.json({ ok: true, message: 'Bot started' });
});

app.post('/api/bot/stop', (req, res) => {
  if (!botProcess) {
    return res.status(404).json({ error: 'No bot process running' });
  }
  botProcess.kill('SIGTERM');
  botStatus  = 'idle';
  botProcess = null;
  broadcast('status', { status: 'idle' });
  res.json({ ok: true, message: 'Bot stopped' });
});

/**
 * Send a keypress action to the bot's stdin.
 * body: { action: 's' | 'k' | 'q' }
 */
app.post('/api/bot/action', (req, res) => {
  const { action } = req.body;
  if (!['s', 'k', 'q'].includes(action)) {
    return res.status(400).json({ error: 'action must be s, k, or q' });
  }

  if (!botProcess) {
    return res.status(404).json({ error: 'No bot process running' });
  }

  botProcess.stdin.write(`${action}\n`);
  broadcast('log', { line: `[UI] Sent action: ${action.toUpperCase()}` });

  if (action === 'q') {
    botStatus = 'idle';
    broadcast('status', { status: 'idle' });
  } else if (action === 's' || action === 'k') {
    botStatus = 'running';
    broadcast('status', { status: 'running' });
  }

  res.json({ ok: true });
});

// ──────────────────────────────────────────────────────────────────────────────
// Batch review queue endpoints
// ──────────────────────────────────────────────────────────────────────────────

const REVIEW_QUEUE_PATH = path.join(__dirname, 'session', 'review_queue.json');

app.get('/api/bot/review-queue', (req, res) => {
  try {
    if (!fs.existsSync(REVIEW_QUEUE_PATH)) {
      return res.json({ ok: true, count: 0, jobs: [] });
    }
    const data = JSON.parse(fs.readFileSync(REVIEW_QUEUE_PATH, 'utf8') || '[]');
    res.json({ ok: true, count: data.length, jobs: data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/bot/review-queue/clear', (req, res) => {
  try {
    if (fs.existsSync(REVIEW_QUEUE_PATH)) {
      fs.writeFileSync(REVIEW_QUEUE_PATH, '[]', 'utf8');
    }
    broadcast('queue_cleared', {});
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Apply to a specific job or all jobs from review queue
app.post('/api/bot/review-queue/apply', (req, res) => {
  if (botProcess) {
    return res.status(409).json({ error: 'Another bot process is currently running.' });
  }

  const { index } = req.body; // undefined means apply all
  const scriptPath = path.join(__dirname, 'applyBatch.js');
  const args = index !== undefined ? [`--index=${index}`] : [];

  botStatus = 'running';
  broadcast('status', { status: 'running' });
  broadcast('log', { line: `🚀 Launching automated application for ${index !== undefined ? `job #${Number(index) + 1}` : 'all queued jobs'}…` });

  botProcess = spawn('node', [scriptPath, ...args], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env },
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  botProcess.stdout.on('data', (chunk) => {
    const lines = chunk.toString().split('\n').filter(Boolean);
    lines.forEach(line => {
      console.log('[BATCH APPLY]', line);
      broadcast('log', { line });
    });
  });

  botProcess.stderr.on('data', (chunk) => {
    const lines = chunk.toString().split('\n').filter(Boolean);
    lines.forEach(line => {
      broadcast('log', { line: `[ERR] ${line}` });
    });
  });

  botProcess.on('close', (code) => {
    botStatus = code === 0 ? 'done' : 'error';
    botProcess = null;
    broadcast('status', { status: botStatus, code });
    // Refresh queue after run
    try {
      const remaining = fs.existsSync(REVIEW_QUEUE_PATH) ? JSON.parse(fs.readFileSync(REVIEW_QUEUE_PATH, 'utf8') || '[]') : [];
      broadcast('batch_collected', { count: remaining.length, jobs: remaining });
    } catch (_) {}
  });

  botProcess.on('error', (err) => {
    botStatus = 'error';
    botProcess = null;
    broadcast('status', { status: 'error', message: err.message });
  });

  res.json({ ok: true, message: 'Automated application started' });
});

// Skip/remove a specific job from review queue
app.post('/api/bot/review-queue/skip', (req, res) => {
  try {
    const { index } = req.body;
    if (fs.existsSync(REVIEW_QUEUE_PATH)) {
      const data = JSON.parse(fs.readFileSync(REVIEW_QUEUE_PATH, 'utf8') || '[]');
      if (typeof index === 'number' && data[index]) {
        const skippedJob = data.splice(index, 1)[0];
        fs.writeFileSync(REVIEW_QUEUE_PATH, JSON.stringify(data, null, 2), 'utf8');
        tracker.insertApplication({ ...skippedJob, job_title: skippedJob.title, job_url: skippedJob.jobUrl, status: 'skipped', notes: 'Skipped by user from review queue' });
        broadcast('batch_collected', { count: data.length, jobs: data });
        return res.json({ ok: true, remaining: data.length });
      }
    }
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ──────────────────────────────────────────────────────────────────────────────
// Session harvesting & status endpoints
// ──────────────────────────────────────────────────────────────────────────────

const ALL_PLATFORMS = [
  'linkedin', 'indeed', 'naukri', 'wellfound', 'internshala',
  'shine', 'foundit', 'glassdoor', 'unstop', 'cutshort',
  'hirist', 'remoteok', 'workatastartup'
];

app.get('/api/sessions/status', (req, res) => {
  try {
    const sessionDir = path.join(__dirname, 'session');
    const result = {};

    for (const name of ALL_PLATFORMS) {
      const filePath = path.join(sessionDir, `${name}.json`);
      if (fs.existsSync(filePath)) {
        try {
          const content = fs.readFileSync(filePath, 'utf8');
          const cookies = JSON.parse(content);
          const stat = fs.statSync(filePath);
          const savedAt = stat.mtime.toISOString().split('T')[0];
          result[name] = {
            exists: true,
            cookies: Array.isArray(cookies) ? cookies.length : 0,
            savedAt
          };
        } catch {
          result[name] = { exists: true, cookies: 0, savedAt: 'unknown' };
        }
      } else {
        result[name] = { exists: false };
      }
    }

    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/sessions/harvest/status', (req, res) => {
  res.json({ status: harvestStatus, running: !!harvestProcess });
});

app.post('/api/sessions/harvest', (req, res) => {
  if (harvestProcess) {
    return res.status(409).json({ error: 'Session harvesting already in progress' });
  }

  harvestStatus = 'running';
  broadcast('harvest-status', { status: 'running' });
  broadcast('log', { line: '🚀 Starting session harvest from Brave profile...' });

  const harvestScript = path.join(__dirname, 'harvestSessions.js');

  harvestProcess = spawn('node', [harvestScript], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env },
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  harvestProcess.stdout.on('data', (chunk) => {
    const lines = chunk.toString().split('\n').filter(Boolean);
    lines.forEach(line => {
      console.log('[HARVEST]', line);
      broadcast('harvest-log', { line });
      broadcast('log', { line: `[HARVEST] ${line}` });
    });
  });

  harvestProcess.stderr.on('data', (chunk) => {
    const lines = chunk.toString().split('\n').filter(Boolean);
    lines.forEach(line => {
      console.error('[HARVEST ERR]', line);
      broadcast('harvest-log', { line: `[ERR] ${line}` });
      broadcast('log', { line: `[HARVEST ERR] ${line}` });
    });
  });

  harvestProcess.on('close', (code) => {
    harvestStatus = code === 0 ? 'done' : 'error';
    harvestProcess = null;
    broadcast('harvest-status', { status: harvestStatus, code });
    broadcast('log', { line: `🎉 Session harvest completed with code ${code}` });
  });

  harvestProcess.on('error', (err) => {
    harvestStatus = 'error';
    harvestProcess = null;
    broadcast('harvest-status', { status: 'error', message: err.message });
    broadcast('log', { line: `❌ Harvester process error: ${err.message}` });
  });

  res.json({ ok: true, message: 'Session harvesting started' });
});

// ──────────────────────────────────────────────────────────────────────────────
// Server-Sent Events stream
// ──────────────────────────────────────────────────────────────────────────────

app.get('/api/bot/stream', (req, res) => {
  res.set({
    'Content-Type':  'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection':    'keep-alive',
    'Access-Control-Allow-Origin': 'http://localhost:5173',
  });

  // Send current status immediately on connect
  res.write(`event: status\ndata: ${JSON.stringify({ status: botStatus })}\n\n`);

  sseClients.push(res);

  req.on('close', () => {
    sseClients = sseClients.filter(c => c !== res);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// Health check
// ──────────────────────────────────────────────────────────────────────────────

app.get('/api/health', (req, res) => {
  res.json({ ok: true, botStatus, clients: sseClients.length });
});

// ──────────────────────────────────────────────────────────────────────────────
// Intelligence & AI Endpoints
// ──────────────────────────────────────────────────────────────────────────────

const { getAllCodingStats } = require('./integrations/codingProfiles');
const { getGitHubStats } = require('./integrations/github');
const { generateCoverLetter, generateAnswer } = require('./ai/gemini');

app.get('/api/intelligence/skills', (req, res) => {
  try {
    const stats = tracker.getSkillsStats();
    res.json({ ok: true, data: stats });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/intelligence/match-scores', (req, res) => {
  try {
    const history = tracker.getMatchScoreHistory();
    res.json({ ok: true, data: history });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/intelligence/keywords', (req, res) => {
  try {
    const apps = tracker.getAllApplications();
    const freq = {};
    for (const app of apps) {
      const words = `${app.job_title} ${app.notes || ''}`
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, ' ')
        .split(/\s+/);
      for (const w of words) {
        if (w.length > 3 && !['with', 'from', 'have', 'this', 'that', 'your', 'about'].includes(w)) {
          freq[w] = (freq[w] || 0) + 1;
        }
      }
    }
    const sorted = Object.entries(freq)
      .map(([word, count]) => ({ word, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 30);
    res.json({ ok: true, data: sorted });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/intelligence/files', (req, res) => {
  try {
    const baseOutput = path.join(__dirname, 'output');
    const categories = ['resumes', 'cover_letters', 'jd_cache'];
    const files = [];

    for (const cat of categories) {
      const dir = path.join(baseOutput, cat);
      if (fs.existsSync(dir)) {
        const list = fs.readdirSync(dir).filter(f => !f.startsWith('.'));
        for (const item of list) {
          const itemPath = path.join(dir, item);
          const stat = fs.statSync(itemPath);
          files.push({
            name: item,
            category: cat,
            size: stat.size,
            updatedAt: stat.mtime,
          });
        }
      }
    }
    res.json({ ok: true, data: files });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/intelligence/files/:category/:filename', (req, res) => {
  try {
    const { category, filename } = req.params;
    const safeCat = category.replace(/[^a-zA-Z0-9_-]/g, '');
    const safeName = filename.replace(/[^a-zA-Z0-9._-]/g, '');
    const filePath = path.join(__dirname, 'output', safeCat, safeName);

    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'File not found' });
    }

    const content = fs.readFileSync(filePath, 'utf8');
    res.json({ ok: true, filename: safeName, category: safeCat, content });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/coding-stats', async (req, res) => {
  try {
    const profile = loadProfile();
    const handles = {
      leetcode: profile.codingProfiles?.leetcode || profile.personal?.leetcode || '',
      codeforces: profile.codingProfiles?.codeforces || '',
      hackerrank: profile.codingProfiles?.hackerrank || profile.personal?.hackerrank || '',
      codechef: profile.codingProfiles?.codechef || '',
      geeksforgeeks: profile.codingProfiles?.geeksforgeeks || '',
    };

    const coding = await getAllCodingStats(handles);
    let github = null;
    if (profile.personal?.github) {
      github = await getGitHubStats(profile.personal.github);
    }

    res.json({ ok: true, data: { coding, github } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/ai/preview-cover-letter', async (req, res) => {
  try {
    const profile = loadProfile();
    const jobContext = req.body || {};
    const letter = await generateCoverLetter(profile, jobContext);
    res.json({ ok: true, coverLetter: letter });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/ai/preview-answer', async (req, res) => {
  try {
    const profile = loadProfile();
    const { question, jobContext } = req.body;
    const answer = await generateAnswer(question || 'Tell us about yourself.', profile, jobContext || {});
    res.json({ ok: true, answer });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/ai/answer-log', (req, res) => {
  try {
    const logs = tracker.getAIAnswerLogs();
    res.json({ ok: true, data: logs });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/ai/usage', (req, res) => {
  try {
    const usage = tracker.getAIUsage();
    res.json({ ok: true, data: usage });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/output/resumes', (req, res) => {
  try {
    const dir = path.join(__dirname, 'output', 'resumes');
    if (fs.existsSync(dir)) {
      const files = fs.readdirSync(dir).filter(f => !f.startsWith('.'));
      for (const f of files) fs.unlinkSync(path.join(dir, f));
    }
    res.json({ ok: true, message: 'Resumes cache cleared' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/output/jd-cache', (req, res) => {
  try {
    const dir = path.join(__dirname, 'output', 'jd_cache');
    if (fs.existsSync(dir)) {
      const files = fs.readdirSync(dir).filter(f => !f.startsWith('.'));
      for (const f of files) fs.unlinkSync(path.join(dir, f));
    }
    res.json({ ok: true, message: 'Job descriptions cache cleared' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// SPA fallback route: redirect client routes to index.html
if (fs.existsSync(path.join(DIST_PATH, 'index.html'))) {
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api/')) return next();
    res.sendFile(path.join(DIST_PATH, 'index.html'));
  });
}

// ──────────────────────────────────────────────────────────────────────────────
// Start server
// ──────────────────────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`\n🌐 API server running at http://localhost:${PORT}`);
  console.log(`   Health: http://localhost:${PORT}/api/health`);
  console.log(`   Dashboard: http://localhost:5173\n`);
});
