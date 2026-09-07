import { useEffect, useRef, useState } from 'react';
import { Play, Square, Check, SkipForward, LogOut, Terminal, Briefcase, Circle, Copy } from 'lucide-react';
import api from '../api.js';
import clsx from 'clsx';

const STATUS_CONFIG = {
  idle:    { label: 'Idle',    color: 'text-slate-400', dot: 'bg-slate-500' },
  running: { label: 'Running', color: 'text-emerald-400', dot: 'bg-emerald-400 animate-pulse-dot' },
  paused:  { label: 'Paused — Awaiting Review', color: 'text-amber-400', dot: 'bg-amber-400 animate-pulse-dot' },
  done:    { label: 'Done',    color: 'text-blue-400', dot: 'bg-blue-400' },
  error:   { label: 'Error',   color: 'text-red-400',  dot: 'bg-red-500' },
};

function LogLine({ line }) {
  const color =
    line.includes('❌') || line.includes('[ERR]') ? 'text-red-400' :
    line.includes('✅') || line.includes('🎉')     ? 'text-emerald-400' :
    line.includes('⏸') || line.includes('REVIEW')  ? 'text-amber-400' :
    line.includes('⚠️') || line.includes('🤖')     ? 'text-yellow-400' :
    line.includes('🔍') || line.includes('📋')     ? 'text-brand-400' :
    'text-slate-400';
  return <div className={`${color} whitespace-pre-wrap break-all`}>{line}</div>;
}

export default function RunPage({ botStatus, setBotStatus }) {
  const [logs,       setLogs]       = useState([]);
  const [currentJob, setCurrentJob] = useState(null);
  const [error,      setError]      = useState('');
  const [copied,     setCopied]     = useState(false);
  const [reviewQueue, setReviewQueue] = useState([]);
  const [batchNotice, setBatchNotice] = useState(null);
  const logRef = useRef(null);
  const esRef  = useRef(null);

  function copyLogs() {
    navigator.clipboard.writeText(logs.join('\n'));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  // Load existing review queue on mount
  useEffect(() => {
    api.getReviewQueue().then(res => {
      if (res?.jobs?.length) setReviewQueue(res.jobs);
    }).catch(() => {});
  }, []);

  const sc = STATUS_CONFIG[botStatus] || STATUS_CONFIG.idle;

  // SSE connection
  useEffect(() => {
    const es = new EventSource('/api/bot/stream');

    es.addEventListener('status', e => {
      const { status } = JSON.parse(e.data);
      setBotStatus(status);
    });

    es.addEventListener('log', e => {
      const { line } = JSON.parse(e.data);
      setLogs(l => [...l.slice(-500), line]); // keep last 500 lines
    });

    es.addEventListener('batch_collected', e => {
      const { count, jobs } = JSON.parse(e.data);
      setReviewQueue(jobs || []);
      setBatchNotice(`🎯 Threshold Reached: ${count} Pure Software / AI & ML jobs (≥ 6 LPA) collected!`);
    });

    es.addEventListener('queue_cleared', () => {
      setReviewQueue([]);
      setBatchNotice(null);
    });

    es.addEventListener('job', e => {
      const { line } = JSON.parse(e.data);
      // Parse job info from log line
      setCurrentJob(prev => {
        if (line.includes('📌')) return { ...prev, title: line.replace('📌','').trim() };
        if (line.includes('🏢')) return { ...prev, company: line.replace('🏢','').trim() };
        return prev;
      });
    });

    esRef.current = es;
    return () => es.close();
  }, []);

  // Auto-scroll terminal
  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [logs]);

  async function startBot() {
    setLogs([]);
    setCurrentJob(null);
    setError('');
    try {
      await api.startBot();
    } catch(e) { setError(e.message); }
  }

  async function stopBot() {
    try {
      await api.stopBot();
      setBotStatus('idle');
    } catch(e) { setError(e.message); }
  }

  async function sendAction(action) {
    try {
      await api.botAction(action);
      if (action !== 'q') setBotStatus('running');
      else setBotStatus('idle');
    } catch(e) { setError(e.message); }
  }

  async function handleApplyJob(index) {
    try {
      setError('');
      await api.applyQueueJob(index);
    } catch(e) { setError(e.message); }
  }

  async function handleApplyAll() {
    try {
      setError('');
      await api.applyQueueJob(); // apply all
    } catch(e) { setError(e.message); }
  }

  async function handleSkipJob(index) {
    try {
      setError('');
      await api.skipQueueJob(index);
      setReviewQueue(prev => prev.filter((_, i) => i !== index));
    } catch(e) { setError(e.message); }
  }

  async function clearBatchQueue() {
    try {
      await api.clearReviewQueue();
      setReviewQueue([]);
      setBatchNotice(null);
    } catch(e) { setError(e.message); }
  }

  const isRunning = botStatus === 'running' || botStatus === 'paused';
  const isPaused  = botStatus === 'paused';

  return (
    <div className="max-w-4xl space-y-5">

      {/* Batch Collection Alert Notification */}
      {batchNotice && (
        <div className="p-4 bg-emerald-500/15 border border-emerald-500/30 rounded-xl flex items-center justify-between animate-fade-in">
          <div className="flex items-center gap-3">
            <span className="text-2xl">🎉</span>
            <div>
              <div className="font-semibold text-emerald-300">{batchNotice}</div>
              <div className="text-xs text-emerald-400/80">Filtered strictly for pure engineering roles above ₹6,00,000/yr (6 LPA). Ready on localhost!</div>
            </div>
          </div>
          <button onClick={() => setBatchNotice(null)} className="text-xs text-emerald-400 hover:underline px-2 py-1">
            Dismiss
          </button>
        </div>
      )}

      {/* Status + controls */}
      <div className="card p-6">
        <div className="flex items-center justify-between mb-6">
          <div>
            <div className="flex items-center gap-3 mb-1">
              <span className={clsx('w-3 h-3 rounded-full', sc.dot)} />
              <span className={clsx('text-lg font-bold', sc.color)}>{sc.label}</span>
            </div>
            <p className="text-slate-500 text-sm">
              {botStatus === 'idle'    && 'Bot is ready. Running directly on localhost:3001 with pure Software/AI-ML filter.'}
              {botStatus === 'running' && 'Continuously collecting qualifying Software & AI/ML jobs (≥ 6 LPA)…'}
              {botStatus === 'paused'  && 'Review the job below and choose to submit, skip, or quit.'}
              {botStatus === 'done'    && 'Collection run complete! Review collected jobs below or check Tracker.'}
              {botStatus === 'error'   && 'An error occurred. Check the terminal log below.'}
            </p>
          </div>
          <div className="flex gap-3">
            {!isRunning && (
              <button onClick={startBot} className="btn-primary text-base px-6 py-3">
                <Play size={18} />
                Start Bot
              </button>
            )}
            {isRunning && (
              <button onClick={stopBot} className="btn-danger px-5">
                <Square size={15} />
                Stop
              </button>
            )}
          </div>
        </div>

        {error && <div className="text-red-400 text-sm mt-2">{error}</div>}

        {/* Action buttons during pause */}
        {isPaused && (
          <div className="mt-4 p-4 bg-amber-500/10 border border-amber-500/20 rounded-xl">
            <p className="text-amber-400 font-medium mb-3 flex items-center gap-2">
              <Circle size={14} className="animate-pulse" />
              Human review requested — form is filled and ready for submission
            </p>
            <div className="flex gap-3">
              <button onClick={() => sendAction('s')} className="btn-success flex-1 justify-center py-3">
                <Check size={16} />
                Submit Application
              </button>
              <button onClick={() => sendAction('k')} className="btn-secondary flex-1 justify-center py-3">
                <SkipForward size={16} />
                Skip This Job
              </button>
              <button onClick={() => sendAction('q')} className="btn-danger flex-1 justify-center py-3">
                <LogOut size={16} />
                Quit Bot
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Review Queue (Batch collected pure engineering jobs) */}
      {reviewQueue.length > 0 && (
        <div className="card p-6 border-brand-500/30">
          <div className="flex items-center justify-between mb-4">
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-lg font-bold text-slate-100">🎯 Desired Jobs Queue</h3>
                <span className="badge bg-brand-500/20 text-brand-300 border border-brand-500/30">{reviewQueue.length} Qualifying</span>
                <span className="badge bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">≥ 6 LPA</span>
              </div>
              <p className="text-xs text-slate-400 mt-1">Verified pure Software / AI & ML roles. Review below and submit automatically with one click.</p>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={handleApplyAll}
                disabled={botStatus === 'running'}
                className="btn-success text-xs px-3.5 py-1.5 flex items-center gap-1.5 shadow-sm"
                title="Automatically submit applications to all queued jobs"
              >
                <Check size={14} />
                Submit All ({reviewQueue.length})
              </button>
              <button onClick={clearBatchQueue} className="btn-secondary text-xs px-3 py-1.5">
                Clear Queue
              </button>
            </div>
          </div>

          <div className="space-y-2.5 max-h-88 overflow-y-auto pr-1">
            {reviewQueue.map((job, idx) => (
              <div key={idx} className="p-3.5 bg-slate-900/60 border border-slate-800 hover:border-slate-700 rounded-lg flex items-center justify-between gap-4">
                <div className="flex items-center gap-3 min-w-0 flex-1">
                  <div className="w-8 h-8 rounded-lg bg-brand-600/20 text-brand-400 flex items-center justify-center text-sm font-semibold shrink-0">
                    {idx + 1}
                  </div>
                  <div className="min-w-0">
                    <div className="font-medium text-slate-200 text-sm truncate">{job.title}</div>
                    <div className="text-xs text-slate-400 flex items-center gap-2 mt-0.5">
                      <span>{job.company || 'Unknown Company'}</span>
                      {job.location && <span>• 📍 {job.location}</span>}
                      {job.salary && <span className="text-emerald-400">• 💰 {job.salary}</span>}
                      <span className="capitalize">• 🌐 {job.platform}</span>
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  {job.jobUrl && (
                    <a
                      href={job.jobUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs text-slate-400 hover:text-slate-200 px-2 py-1"
                    >
                      View
                    </a>
                  )}
                  <button
                    onClick={() => handleApplyJob(idx)}
                    disabled={botStatus === 'running'}
                    className="btn-success text-xs px-2.5 py-1 flex items-center gap-1"
                    title="Automatically fill and submit this application"
                  >
                    <Check size={12} />
                    Submit
                  </button>
                  <button
                    onClick={() => handleSkipJob(idx)}
                    className="btn-secondary text-xs px-2.5 py-1 flex items-center gap-1 text-slate-400 hover:text-red-400"
                    title="Skip and remove this job from queue"
                  >
                    <SkipForward size={12} />
                    Skip
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Current job card */}
      {currentJob && (
        <div className="card-hover p-5 animate-fade-in">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-xl bg-brand-600/20 border border-brand-500/20 flex items-center justify-center text-2xl">
              <Briefcase size={22} className="text-brand-400" />
            </div>
            <div>
              <div className="font-semibold text-slate-100">{currentJob.title || 'Loading job…'}</div>
              <div className="text-slate-400 text-sm">{currentJob.company || ''}</div>
            </div>
            <div className="ml-auto">
              {isPaused && <span className="badge bg-amber-500/20 text-amber-400 border border-amber-500/30">⏸ Awaiting Review</span>}
              {botStatus === 'running' && <span className="badge-applied">Processing</span>}
            </div>
          </div>
        </div>
      )}

      {/* Terminal log */}
      <div className="card p-5">
        <div className="flex items-center gap-2 mb-3">
          <Terminal size={15} className="text-brand-400" />
          <span className="text-sm font-medium text-slate-300">Bot Output (localhost:3001)</span>
          <span className="ml-auto text-xs text-slate-600">{logs.length} lines</span>
          {logs.length > 0 && (
            <div className="flex items-center gap-3">
              <button
                onClick={copyLogs}
                className="text-xs text-slate-600 hover:text-slate-400 flex items-center gap-1 transition-colors"
                title="Copy logs to clipboard"
              >
                {copied ? (
                  <>
                    <Check size={12} className="text-emerald-400" />
                    <span className="text-emerald-400">Copied</span>
                  </>
                ) : (
                  <>
                    <Copy size={12} />
                    <span>Copy logs</span>
                  </>
                )}
              </button>
              <button onClick={() => setLogs([])} className="text-xs text-slate-600 hover:text-slate-400 transition-colors">Clear</button>
            </div>
          )}
        </div>
        <div ref={logRef} className="terminal h-80">
          {logs.length === 0 ? (
            <span className="text-slate-600">// Output will appear here when the bot starts…</span>
          ) : (
            logs.map((line, i) => <LogLine key={i} line={line} />)
          )}
        </div>
      </div>
    </div>
  );
}
