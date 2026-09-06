# JobFlow — Automated Job Application Suite

> **Personal use only.** Please read the [Legal Note](#legal-note) before use.

A desktop-runnable automation tool that searches LinkedIn, Indeed, and Naukri for jobs matching your profile, auto-fills application forms, **pauses for human review** before every submit, and tracks every application in a local SQLite database with a beautiful React dashboard.

---

## Prerequisites

| Requirement | Version |
|---|---|
| Node.js | 18+ |
| npm | 9+ |
| Chromium | auto-installed by setup |

---

## One-Command Setup

```bash
npm run setup
```

This installs all dependencies and downloads the Chromium browser for Playwright.

---

## Configuration

### Option A — Dashboard (recommended)

```bash
npm run start:server    # in terminal 1
npm run start:dashboard # in terminal 2
```

Then open **http://localhost:5173** → go to **Profile** and **Targets** pages.

### Option B — Edit `bot/profile.json` directly

The file is created automatically on first run from the template. Fill in:

```json
{
  "personal":     { "name": "Your Name", "email": "you@email.com", ... },
  "professional": { "title": "Frontend Developer", "skills": ["React", "Node.js"], ... },
  "search":       { "roles": ["Frontend Developer"], "platforms": ["linkedin", "naukri"], ... },
  "credentials":  { "naukri": { "email": "you@naukri.com", "password": "secret" } }
}
```

> ⚠️ `profile.json` is gitignored — your credentials never leave your machine.

---

## Running the Suite

### Start Everything

```bash
# Terminal 1 — API server + bot runner
npm run start:server

# Terminal 2 — React dashboard
npm run start:dashboard

# Dashboard URL
open http://localhost:5173
```

### Run Bot Directly (CLI)

```bash
npm run start:bot
```

---

## How the Pause / Review System Works

The bot **never auto-submits** an application. Before every final submit click:

1. The bot fills all visible form fields using your profile data
2. It prints a review box to the terminal:

```
┌─────────────────────────────────────────────────────┐
│  ⏸  REVIEW APPLICATION                              │
│  📌 Senior Frontend Engineer                         │
│  🏢 Acme Corp                                        │
│  📍 Bangalore, India                                 │
│  💰 ₹25–35 LPA                                      │
├─────────────────────────────────────────────────────┤
│  [S] Submit   [K] Skip   [Q] Quit bot               │
└─────────────────────────────────────────────────────┘
```

3. **In the dashboard** → the Run page shows Submit / Skip / Quit buttons
4. **In the terminal** → press `S`, `K`, or `Q`

| Key | Action |
|-----|--------|
| `S` | Clicks Submit → logs as `applied` in DB |
| `K` | Closes modal → logs as `skipped` in DB |
| `Q` | Closes browser, exits bot |

---

## Dashboard Pages

| Page | URL | Description |
|------|-----|-------------|
| Profile | `/profile` | Personal, professional info, Q&A defaults |
| Targets | `/targets` | Roles, platforms, location, filters |
| Run Bot | `/run` | Start/stop bot, live terminal, review buttons |
| Tracker | `/tracker` | Charts, table, CSV export, status editing |
| Settings | `/settings` | Timing delays, theme, DB clear |

---

## Project Structure

```
job/
├── bot/
│   ├── index.js              # Main orchestrator
│   ├── server.js             # Express API (port 3001)
│   ├── config.js             # Profile read/write
│   ├── profile.json          # ← YOUR DATA (gitignored)
│   ├── session/              # Saved cookies (gitignored)
│   ├── helpers/
│   │   ├── formFiller.js     # Universal form filling
│   │   └── reviewPause.js    # Human review gate
│   └── platforms/
│       ├── linkedin.js
│       ├── indeed.js
│       └── naukri.js
├── dashboard/                # React + Vite (port 5173)
│   └── src/pages/
│       ├── Profile.jsx
│       ├── Targets.jsx
│       ├── Run.jsx
│       ├── Tracker.jsx
│       └── Settings.jsx
├── db/
│   ├── tracker.js            # SQLite layer
│   └── job_tracker.db        # ← DATABASE (gitignored)
└── package.json
```

---

## Safety Features

- **Rate limiting**: Minimum 3 seconds between every application
- **CAPTCHA detection**: 15+ selector patterns; auto-skips if detected, waits 60s and retries once
- **Session cookies**: Saved after each run so re-login is rare
- **Error isolation**: Each job's error is caught individually — one failure doesn't stop the run
- **Fingerprint masking**: `navigator.webdriver` removed, realistic user-agent set

---

## Legal Note

> This tool is for **personal use only**. Automated scraping and form submission may violate the Terms of Service of LinkedIn, Indeed, Naukri, and other platforms. Use responsibly:
> - Do not flood platforms with applications
> - Always review each application before submitting (the pause gate enforces this)
> - Check each platform's robots.txt and ToS before use
> - The authors take no responsibility for account bans or other consequences

---

## Troubleshooting

| Problem | Fix |
|---------|-----|
| `profile.json` missing | Run bot once — it auto-creates from template |
| Chromium not found | Run `npm run playwright:install` |
| `ECONNREFUSED` on dashboard | Start the server: `npm run start:server` |
| Login fails on Naukri | Fill `credentials.naukri` in `profile.json` |
| CAPTCHA every time | Try with a different network / VPN |
