import { useEffect, useState } from 'react';
import { Save, Trash2, Moon, Sun, Sliders, AlertTriangle, Loader2, CheckCircle2, RefreshCw, Key, ShieldCheck, Terminal } from 'lucide-react';
import api from '../api.js';

const PLATFORMS_CONFIG = [
  { key: 'linkedin',       label: 'LinkedIn',          icon: '💼', domain: 'linkedin.com' },
  { key: 'indeed',         label: 'Indeed',            icon: '🎯', domain: 'indeed.com' },
  { key: 'naukri',         label: 'Naukri',            icon: '🇮🇳', domain: 'naukri.com' },
  { key: 'wellfound',      label: 'Wellfound',         icon: '🚀', domain: 'wellfound.com' },
  { key: 'internshala',    label: 'Internshala',       icon: '🎓', domain: 'internshala.com' },
  { key: 'shine',          label: 'Shine',             icon: '✨', domain: 'shine.com' },
  { key: 'foundit',        label: 'Foundit',           icon: '🔍', domain: 'foundit.in' },
  { key: 'glassdoor',      label: 'Glassdoor',         icon: '🏢', domain: 'glassdoor.com' },
  { key: 'unstop',         label: 'Unstop',            icon: '🏆', domain: 'unstop.com' },
  { key: 'cutshort',       label: 'Cutshort',          icon: '⚡', domain: 'cutshort.io' },
  { key: 'hirist',         label: 'Hirist',            icon: '💻', domain: 'hirist.tech' },
  { key: 'remoteok',       label: 'RemoteOK',          icon: '🌍', domain: 'remoteok.com' },
  { key: 'workatastartup', label: 'Work at a Startup', icon: '🦄', domain: 'workatastartup.com' },
];

function Section({ title, children }) {
  return (
    <div className="card p-6 space-y-5">
      <h2 className="font-semibold text-slate-200 pb-3 border-b border-white/5">{title}</h2>
      {children}
    </div>
  );
}

export default function SettingsPage() {
  const [settings, setSettings] = useState(null);
  const [theme,    setTheme]    = useState('dark');
  const [saving,   setSaving]   = useState(false);
  const [saved,    setSaved]    = useState(false);
  const [clearing, setClearing] = useState(false);
  const [cleared,  setCleared]  = useState(false);
  const [confirm,  setConfirm]  = useState(false);
  const [error,    setError]    = useState('');
  const [aiUsage,  setAiUsage]  = useState({ totalCalls: 0, totalTokens: 0 });

  // Sessions state
  const [sessions, setSessions] = useState({});
  const [loadingSessions, setLoadingSessions] = useState(false);
  const [harvesting, setHarvesting] = useState(false);
  const [harvestLogs, setHarvestLogs] = useState([]);
  const [harvestMsg, setHarvestMsg] = useState(null);

  async function fetchSessions() {
    setLoadingSessions(true);
    try {
      const data = await api.getSessionsStatus();
      setSessions(data);
    } catch (e) {
      console.error('Failed to fetch session health:', e);
    } finally {
      setLoadingSessions(false);
    }
  }

  async function startHarvest() {
    setHarvesting(true);
    setHarvestMsg(null);
    setHarvestLogs(['[INFO] Connecting to Brave profile session harvester...']);

    try {
      await api.harvestSessions();

      const es = new EventSource('/api/bot/stream');

      es.addEventListener('harvest-log', (e) => {
        try {
          const { line } = JSON.parse(e.data);
          setHarvestLogs(prev => [...prev.slice(-40), line]);
        } catch (_) {}
      });

      es.addEventListener('log', (e) => {
        try {
          const { line } = JSON.parse(e.data);
          if (line.includes('Harvest') || line.includes('cookies') || line.includes('Brave') || line.includes('profile')) {
            setHarvestLogs(prev => [...prev.slice(-40), line]);
          }
        } catch (_) {}
      });

      es.addEventListener('harvest-status', (e) => {
        try {
          const data = JSON.parse(e.data);
          if (data.status === 'done') {
            setHarvesting(false);
            setHarvestMsg({ type: 'success', text: 'Brave sessions successfully harvested!' });
            es.close();
            fetchSessions();
          } else if (data.status === 'error') {
            setHarvesting(false);
            setHarvestMsg({ type: 'error', text: 'Harvest process finished with issues. Make sure Brave is closed.' });
            es.close();
            fetchSessions();
          }
        } catch (_) {}
      });

      es.onerror = () => {
        setTimeout(async () => {
          try {
            const res = await fetch('/api/sessions/harvest/status').then(r => r.json());
            if (!res.running) {
              setHarvesting(false);
              es.close();
              fetchSessions();
            }
          } catch (_) {}
        }, 4000);
      };
    } catch (err) {
      setHarvesting(false);
      setHarvestMsg({ type: 'error', text: err.message || 'Failed to trigger harvest' });
    }
  }

  useEffect(() => {
    api.getProfile().then(p => setSettings(p.settings || {})).catch(e => setError(e.message));
    fetch('/api/ai/usage').then(r => r.json()).then(d => { if (d.ok) setAiUsage(d.data); }).catch(() => {});
    fetchSessions();
    setTheme(document.documentElement.classList.contains('dark') ? 'dark' : 'light');
  }, []);

  function set(field, value) {
    setSettings(s => ({ ...s, [field]: value }));
  }

  async function save() {
    setSaving(true);
    try {
      await api.patchSection('settings', settings);
      setSaved(true); setTimeout(() => setSaved(false), 3000);
    } catch(e) { setError(e.message); }
    finally { setSaving(false); }
  }

  function toggleTheme() {
    const html = document.documentElement;
    if (html.classList.contains('dark')) {
      html.classList.remove('dark');
      setTheme('light');
    } else {
      html.classList.add('dark');
      setTheme('dark');
    }
  }

  async function clearDatabase() {
    if (!confirm) { setConfirm(true); return; }
    setClearing(true);
    try {
      await api.clearDatabase();
      setCleared(true);
      setConfirm(false);
      setTimeout(() => setCleared(false), 3000);
    } catch(e) { setError(e.message); }
    finally { setClearing(false); }
  }

  if (!settings) return (
    <div className="flex items-center gap-3 text-slate-400 mt-20 justify-center">
      <Loader2 size={20} className="animate-spin" />
      {error ? <span className="text-red-400">{error}</span> : 'Loading…'}
    </div>
  );

  return (
    <div className="max-w-3xl space-y-5">
      <div className="flex justify-between items-center mb-2">
        <p className="text-slate-500 text-sm">Configure bot behaviour and app appearance.</p>
        <button onClick={save} disabled={saving} className="btn-primary">
          {saving ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />}
          {saved ? 'Saved ✓' : 'Save Settings'}
        </button>
      </div>
      {error && <div className="card p-3 border-red-500/30 text-red-400 text-sm">{error}</div>}

      {/* Bot timing */}
      <Section title="🤖 Bot Timing">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="label">Min Delay Between Actions (ms)</label>
            <input className="input" type="number" min={500} step={100}
              value={settings.delayMin ?? 1000}
              onChange={e => set('delayMin', Number(e.target.value))} />
          </div>
          <div>
            <label className="label">Max Delay Between Actions (ms)</label>
            <input className="input" type="number" min={500} step={100}
              value={settings.delayMax ?? 3000}
              onChange={e => set('delayMax', Number(e.target.value))} />
          </div>
          <div>
            <label className="label">Min Between Applications (ms)</label>
            <input className="input" type="number" min={3000} step={500}
              value={settings.minBetweenApplicationsMs ?? 3000}
              onChange={e => set('minBetweenApplicationsMs', Number(e.target.value))} />
            <p className="text-xs text-slate-600 mt-1">Minimum 3000ms enforced</p>
          </div>
          <div>
            <label className="label">Block Wait (seconds)</label>
            <input className="input" type="number" min={10}
              value={settings.blockWaitSeconds ?? 60}
              onChange={e => set('blockWaitSeconds', Number(e.target.value))} />
          </div>
        </div>
        <div className="flex items-center gap-3">
          <input type="checkbox" id="retry" className="w-4 h-4 accent-brand-500"
            checked={settings.retryOnBlock ?? true}
            onChange={e => set('retryOnBlock', e.target.checked)} />
          <label htmlFor="retry" className="text-sm text-slate-300 cursor-pointer">
            Retry once after block / CAPTCHA detection
          </label>
        </div>
      </Section>

      {/* Sessions & Authentication */}
      <Section title="🔐 Sessions & Authentication">
        <div className="space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-gradient-to-r from-indigo-950/40 via-purple-950/20 to-transparent p-4 rounded-xl border border-indigo-500/20">
            <div>
              <div className="text-sm font-semibold text-white flex items-center gap-2">
                <span>Brave Profile Session Harvester</span>
                <span className="text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded-full bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">Auto OAuth</span>
              </div>
              <p className="text-xs text-slate-400 mt-1 max-w-md">
                One-click extraction of authenticated cookies from your active Brave browser profile across all 13 platforms so the bot runs without manual logins.
              </p>
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              <button
                type="button"
                onClick={fetchSessions}
                disabled={loadingSessions || harvesting}
                title="Refresh session status"
                className="btn-secondary text-xs px-2.5 py-2"
              >
                <RefreshCw size={13} className={loadingSessions ? 'animate-spin' : ''} />
              </button>
              <button
                type="button"
                onClick={startHarvest}
                disabled={harvesting}
                className="btn-primary text-xs px-3.5 py-2 bg-gradient-to-r from-indigo-500 to-purple-600 hover:from-indigo-600 hover:to-purple-700 shadow-md shadow-indigo-500/20"
              >
                {harvesting ? (
                  <>
                    <Loader2 size={13} className="animate-spin" />
                    <span>Harvesting...</span>
                  </>
                ) : (
                  <>
                    <Key size={13} />
                    <span>Harvest Sessions</span>
                  </>
                )}
              </button>
            </div>
          </div>

          <div className="p-3 bg-amber-500/10 border border-amber-500/25 rounded-lg flex items-start gap-2.5 text-xs text-amber-300">
            <AlertTriangle size={15} className="flex-shrink-0 text-amber-400 mt-0.5" />
            <span>
              <strong>Brave Must Be Closed:</strong> Please exit all Brave browser windows completely before clicking <em>Harvest Sessions</em>, otherwise Brave will lock its profile database.
            </span>
          </div>

          {harvestMsg && (
            <div className={`p-3 rounded-lg text-xs flex items-center gap-2 ${
              harvestMsg.type === 'success' 
                ? 'bg-emerald-500/15 border border-emerald-500/30 text-emerald-300' 
                : 'bg-red-500/15 border border-red-500/30 text-red-300'
            }`}>
              {harvestMsg.type === 'success' ? <CheckCircle2 size={15} /> : <AlertTriangle size={15} />}
              <span>{harvestMsg.text}</span>
            </div>
          )}

          {/* Session Health Panel */}
          <div className="pt-2">
            <div className="flex items-center justify-between mb-2.5">
              <span className="text-xs font-semibold uppercase tracking-wider text-slate-400 flex items-center gap-2">
                <ShieldCheck size={14} className="text-indigo-400" />
                Session Health ({Object.values(sessions).filter(s => s.exists).length}/13 Active)
              </span>
              <span className="text-[11px] text-slate-500">
                Source: <code className="text-indigo-400 text-[10px]">bot/session/*.json</code>
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              {PLATFORMS_CONFIG.map(({ key, label, icon, domain }) => {
                const info = sessions[key] || { exists: false };
                const isActive = !!info.exists;

                return (
                  <div
                    key={key}
                    className={`p-3 rounded-xl border transition-all duration-200 flex items-center justify-between ${
                      isActive
                        ? 'bg-emerald-950/10 border-emerald-500/20 hover:border-emerald-500/40'
                        : 'bg-white/[0.02] border-white/5 opacity-70 hover:opacity-100'
                    }`}
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      {/* Green or Red Dot */}
                      <span className="relative flex h-2.5 w-2.5 flex-shrink-0">
                        {isActive ? (
                          <>
                            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                            <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500 shadow-[0_0_8px_#10b981]"></span>
                          </>
                        ) : (
                          <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-rose-500/80 shadow-[0_0_6px_#f43f5e]"></span>
                        )}
                      </span>

                      <div className="min-w-0">
                        <div className="text-xs font-medium text-slate-200 flex items-center gap-1.5 truncate">
                          <span>{icon}</span>
                          <span className="truncate">{label}</span>
                        </div>
                        <div className="text-[10px] text-slate-500 truncate">{domain}</div>
                      </div>
                    </div>

                    <div className="text-right flex-shrink-0 pl-2">
                      {isActive ? (
                        <div className="space-y-0.5">
                          <div className="text-[11px] font-semibold text-emerald-400">
                            {info.cookies} {info.cookies === 1 ? 'cookie' : 'cookies'}
                          </div>
                          <div className="text-[9px] text-slate-500 font-mono">
                            {info.savedAt || 'Saved'}
                          </div>
                        </div>
                      ) : (
                        <span className="text-[10px] text-slate-500 px-2 py-0.5 rounded bg-white/5 border border-white/5">
                          No session
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Live Harvester Console output if available */}
          {harvestLogs.length > 0 && (
            <div className="mt-3 bg-black/50 border border-white/10 rounded-xl p-3 font-mono text-[11px] space-y-1 max-h-48 overflow-y-auto">
              <div className="text-slate-500 text-[10px] pb-1 border-b border-white/5 flex items-center justify-between">
                <span className="flex items-center gap-1.5">
                  <Terminal size={12} className="text-indigo-400" />
                  Harvester Output
                </span>
                {harvesting && <span className="text-indigo-400 animate-pulse">Running...</span>}
              </div>
              {harvestLogs.map((log, i) => (
                <div key={i} className={`leading-relaxed ${
                  log.includes('✅') ? 'text-emerald-400' :
                  log.includes('❌') || log.includes('[ERR]') ? 'text-red-400' :
                  log.includes('⚠️') ? 'text-amber-400' :
                  'text-slate-300'
                }`}>
                  {log}
                </div>
              ))}
            </div>
          )}
        </div>
      </Section>

      {/* Theme */}
      <Section title="🎨 Appearance">
        <div className="flex items-center justify-between">
          <div>
            <div className="font-medium text-slate-200">Theme</div>
            <div className="text-sm text-slate-500">Currently: {theme}</div>
          </div>
          <button onClick={toggleTheme} className="btn-secondary">
            {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
            Switch to {theme === 'dark' ? 'Light' : 'Dark'}
          </button>
        </div>
      </Section>

      {/* AI Gemini Token Usage & Telemetry */}
      <Section title="🧠 Gemini AI Usage & Telemetry">
        <div className="space-y-3">
          <div className="flex justify-between items-center bg-black/30 p-3 rounded-xl border border-white/5">
            <div>
              <div className="text-sm font-semibold text-white">Total API Invocations</div>
              <div className="text-xs text-slate-500">Autonomous JD analysis & answering</div>
            </div>
            <div className="text-lg font-bold text-indigo-400">
              {aiUsage?.totalCalls || 0} calls
            </div>
          </div>

          <div className="flex justify-between items-center bg-black/30 p-3 rounded-xl border border-white/5">
            <div>
              <div className="text-sm font-semibold text-white">Estimated Tokens Processed</div>
              <div className="text-xs text-slate-500">Prompt & completion volume</div>
            </div>
            <div className="text-lg font-bold text-purple-400">
              {(aiUsage?.totalTokens || 0).toLocaleString()} tokens
            </div>
          </div>

          <div className="text-[11px] text-slate-500 italic">
            gemini-1.5-flash — free tier: 15 requests/min, 1M tokens/day
          </div>
        </div>
      </Section>


      {/* Danger zone */}
      <Section title="⚠️ Storage Management & Danger Zone">
        <div className="space-y-4">
          {/* Clear Resumes Cache */}
          <div className="p-4 bg-white/[0.02] border border-white/5 rounded-xl flex items-center justify-between">
            <div>
              <div className="text-sm font-medium text-slate-200">Clear Tailored Resumes Briefs</div>
              <div className="text-xs text-slate-500">Deletes all generated plain-text briefs in bot/output/resumes</div>
            </div>
            <button
              onClick={async () => {
                await fetch('/api/output/resumes', { method: 'DELETE' });
                alert('Resumes cache cleared!');
              }}
              className="btn-secondary text-xs"
            >
              Clear Briefs
            </button>
          </div>

          {/* Clear JD Cache */}
          <div className="p-4 bg-white/[0.02] border border-white/5 rounded-xl flex items-center justify-between">
            <div>
              <div className="text-sm font-medium text-slate-200">Clear Job Description Cache</div>
              <div className="text-xs text-slate-500">Deletes cached raw JD text files in bot/output/jd_cache</div>
            </div>
            <button
              onClick={async () => {
                await fetch('/api/output/jd-cache', { method: 'DELETE' });
                alert('Job description cache cleared!');
              }}
              className="btn-secondary text-xs"
            >
              Clear JD Cache
            </button>
          </div>

          {/* Wipe DB */}
          <div className="p-4 bg-red-500/5 border border-red-500/20 rounded-xl">
            <div className="flex items-start gap-3">
              <AlertTriangle size={18} className="text-red-400 mt-0.5 flex-shrink-0" />
              <div className="flex-1">
                <div className="font-medium text-red-400 mb-1">Clear All Application Data</div>
                <p className="text-xs text-slate-500 mb-4">
                  Permanently deletes all records from the database. This cannot be undone.
                </p>
                {confirm && !cleared && (
                  <p className="text-amber-400 text-xs mb-3 font-medium">
                    Are you sure? Click again to confirm deletion.
                  </p>
                )}
                {cleared ? (
                  <div className="flex items-center gap-2 text-emerald-400 text-sm">
                    <CheckCircle2 size={15} /> Database cleared successfully
                  </div>
                ) : (
                  <button onClick={clearDatabase} disabled={clearing} className="btn-danger">
                    {clearing ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
                    {confirm ? 'Click to Confirm Delete' : 'Clear Database'}
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      </Section>
    </div>
  );
}

