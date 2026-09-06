import { BrowserRouter, Routes, Route, Navigate, NavLink, useLocation } from 'react-router-dom';
import { useEffect, useRef, useState } from 'react';
import {
  User, Target, Play, BarChart2, Settings,
  Briefcase, Circle, AlertCircle, CheckCircle2, Loader2, Brain
} from 'lucide-react';
import clsx from 'clsx';

import ProfilePage      from './pages/Profile.jsx';
import TargetsPage      from './pages/Targets.jsx';
import RunPage          from './pages/Run.jsx';
import TrackerPage      from './pages/Tracker.jsx';
import IntelligencePage from './pages/Intelligence.jsx';
import SettingsPage     from './pages/Settings.jsx';

const NAV = [
  { to: '/profile',      icon: User,         label: 'Profile'     },
  { to: '/targets',      icon: Target,       label: 'Targets'     },
  { to: '/run',          icon: Play,         label: 'Run Bot'     },
  { to: '/tracker',      icon: BarChart2,    label: 'Tracker'     },
  { to: '/intelligence', icon: Brain,       label: 'AI Insights' },
  { to: '/settings',     icon: Settings,     label: 'Settings'    },
];


function StatusDot({ status }) {
  const map = {
    idle:    { color: 'bg-slate-500',  label: 'Idle' },
    running: { color: 'bg-emerald-400 animate-pulse-dot', label: 'Running' },
    paused:  { color: 'bg-amber-400 animate-pulse-dot',   label: 'Paused'  },
    done:    { color: 'bg-blue-400',   label: 'Done'    },
    error:   { color: 'bg-red-500',    label: 'Error'   },
  };
  const s = map[status] || map.idle;
  return (
    <span className="flex items-center gap-2 text-xs text-slate-400">
      <span className={clsx('w-2 h-2 rounded-full', s.color)} />
      Bot {s.label}
    </span>
  );
}

function Sidebar({ botStatus }) {
  return (
    <aside className="fixed left-0 top-0 h-screen w-56 flex flex-col border-r border-white/5 bg-black/40 backdrop-blur-xl z-30">
      {/* Logo */}
      <div className="px-5 py-5 border-b border-white/5">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-brand-600 flex items-center justify-center text-lg">💼</div>
          <div>
            <div className="text-sm font-bold text-white">JobFlow</div>
            <div className="text-xs text-slate-500">Auto Suite</div>
          </div>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 px-3 py-4 space-y-1">
        {NAV.map(({ to, icon: Icon, label }) => (
          <NavLink key={to} to={to}
            className={({ isActive }) => clsx('nav-item', isActive && 'active')}
          >
            <Icon size={17} />
            {label}
          </NavLink>
        ))}
      </nav>

      {/* Bot status footer */}
      <div className="px-5 py-4 border-t border-white/5">
        <StatusDot status={botStatus} />
      </div>
    </aside>
  );
}

function TopBar({ botStatus }) {
  return (
    <header className="glass-header fixed top-0 left-56 right-0 h-14 flex items-center justify-between px-6 z-20">
      <PageTitle />
      <div className="flex items-center gap-4">
        <StatusDot status={botStatus} />
        <div className="text-xs text-slate-600">localhost:3001</div>
      </div>
    </header>
  );
}

function PageTitle() {
  const loc = useLocation();
  const titles = {
    '/profile':      'Candidate Profile & Portfolios',
    '/targets':      'Search Targets & Platforms',
    '/run':          'Bot Orchestration & Controls',
    '/tracker':      'Application Tracker & Pipeline',
    '/intelligence': 'AI Market Intelligence & Tailored Documents',
    '/settings':     'Bot Settings & Cache Management',
  };
  return <h1 className="text-base font-semibold text-slate-200">{titles[loc.pathname] || 'JobFlow'}</h1>;
}

export default function App() {
  const [botStatus, setBotStatus] = useState('idle');

  // Global SSE listener to keep the status dot in sync
  useEffect(() => {
    const es = new EventSource('/api/bot/stream');
    es.addEventListener('status', e => {
      const { status } = JSON.parse(e.data);
      setBotStatus(status);
    });
    return () => es.close();
  }, []);

  return (
    <BrowserRouter>
      <Sidebar botStatus={botStatus} />
      <TopBar botStatus={botStatus} />
      <main className="ml-56 pt-14 min-h-screen">
        <div className="p-6 animate-fade-in">
          <Routes>
            <Route path="/" element={<Navigate to="/profile" replace />} />
            <Route path="/profile"      element={<ProfilePage />} />
            <Route path="/targets"      element={<TargetsPage />} />
            <Route path="/run"          element={<RunPage botStatus={botStatus} setBotStatus={setBotStatus} />} />
            <Route path="/tracker"      element={<TrackerPage />} />
            <Route path="/intelligence" element={<IntelligencePage />} />
            <Route path="/settings"     element={<SettingsPage />} />
          </Routes>
        </div>
      </main>
    </BrowserRouter>
  );
}

