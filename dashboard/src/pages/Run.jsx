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
  const logRef = useRef(null);
  const esRef  = useRef(null);

  function copyLogs() {
    navigator.clipboard.writeText(logs.join('\n'));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

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

  const isRunning = botStatus === 'running' || botStatus === 'paused';
  const isPaused  = botStatus === 'paused';

  return (
    <div className="max-w-4xl space-y-5">

      {/* Status + controls */}
      <div className="card p-6">
        <div className="flex items-center justify-between mb-6">
          <div>
            <div className="flex items-center gap-3 mb-1">
              <span className={clsx('w-3 h-3 rounded-full', sc.dot)} />
              <span className={clsx('text-lg font-bold', sc.color)}>{sc.label}</span>
            </div>
            <p className="text-slate-500 text-sm">
              {botStatus === 'idle'    && 'Bot is ready. Configure your profile and targets first.'}
              {botStatus === 'running' && 'Searching and applying to jobs across configured platforms…'}
              {botStatus === 'paused'  && 'Review the job below and choose to submit, skip, or quit.'}
              {botStatus === 'done'    && 'Run complete! Check the Tracker for results.'}
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
              Human review required — the bot has pre-filled the application form
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
          <span className="text-sm font-medium text-slate-300">Bot Output</span>
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
