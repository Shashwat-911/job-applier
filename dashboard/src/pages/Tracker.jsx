import { useEffect, useState } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend,
} from 'recharts';
import { Download, Filter, ChevronDown, ChevronUp, ChevronsUpDown, Loader2, TrendingUp, Award, MessageSquare, XCircle } from 'lucide-react';
import api from '../api.js';
import clsx from 'clsx';

const STATUS_OPTS = ['all','applied','interviewing','offer','rejected','skipped'];
const PLATFORM_OPTS = ['all','linkedin','indeed','naukri'];
const PALETTE = ['#6366f1','#10b981','#f59e0b','#ef4444','#8b5cf6','#06b6d4'];

function StatCard({ label, value, icon: Icon, color }) {
  return (
    <div className="stat-card">
      <div className={`text-2xl font-bold ${color}`}>{value}</div>
      <div className="text-xs text-slate-500 flex items-center gap-1.5">
        <Icon size={12} /> {label}
      </div>
    </div>
  );
}

function BadgeStatus({ status }) {
  return <span className={`badge-${status}`}>{status}</span>;
}

const STATUS_BADGE_MAP = {
  applied:      'badge-applied',
  interviewing: 'badge-interviewing',
  offer:        'badge-offer',
  rejected:     'badge-rejected',
  skipped:      'badge-skipped',
};

function StatusSelect({ id, current, onChange }) {
  return (
    <select
      className="bg-transparent border border-white/10 rounded-lg text-xs px-2 py-1 focus:outline-none focus:border-brand-500"
      value={current}
      onChange={e => onChange(id, e.target.value)}
    >
      {['applied','interviewing','offer','rejected','skipped'].map(s => (
        <option key={s} value={s}>{s}</option>
      ))}
    </select>
  );
}

function exportCSV(rows) {
  const headers = ['id','job_title','company','platform','status','applied_at','location','salary_range','notes','job_url'];
  const csv = [
    headers.join(','),
    ...rows.map(r => headers.map(h => JSON.stringify(r[h] ?? '')).join(',')),
  ].join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url; a.download = `applications_${Date.now()}.csv`;
  a.click(); URL.revokeObjectURL(url);
}

const TOOLTIP_STYLE = {
  contentStyle: { background: '#1a1a2e', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 12, color: '#e2e8f0' },
  labelStyle:   { color: '#94a3b8' },
};

export default function TrackerPage() {
  const [apps,     setApps]    = useState([]);
  const [stats,    setStats]   = useState(null);
  const [loading,  setLoading] = useState(true);
  const [filters,  setFilters] = useState({ status: 'all', platform: 'all', search: '' });
  const [sortKey,  setSortKey] = useState('applied_at');
  const [sortDir,  setSortDir] = useState('desc'); // 'asc' | 'desc'

  useEffect(() => { refresh(); }, []);

  async function refresh() {
    setLoading(true);
    try {
      const params = {};
      if (filters.status   !== 'all') params.status   = filters.status;
      if (filters.platform !== 'all') params.platform = filters.platform;
      if (filters.search)             params.search   = filters.search;

      const [a, s] = await Promise.all([api.getApplications(params), api.getStats()]);
      setApps(a);
      setStats(s);
    } finally { setLoading(false); }
  }

  // Re-fetch when filters change
  useEffect(() => { refresh(); }, [filters.status, filters.platform]);

  async function handleStatusChange(id, status) {
    await api.updateStatus(id, status);
    setApps(prev => prev.map(a => a.id === id ? { ...a, status } : a));
    const s = await api.getStats();
    setStats(s);
  }

  const byStatusData = stats
    ? Object.entries(stats.byStatus).map(([name, value]) => ({ name, value }))
    : [];

  const byPlatformData = stats
    ? Object.entries(stats.byPlatform).map(([name, value]) => ({ name, value }))
    : [];

  const perDayData = stats?.perDay || [];

  const filteredApps = apps.filter(a =>
    !filters.search || a.job_title?.toLowerCase().includes(filters.search.toLowerCase())
      || a.company?.toLowerCase().includes(filters.search.toLowerCase())
  );

  // ── Client-side sort ────────────────────────────────────────────────────────
  const sortedApps = [...filteredApps].sort((a, b) => {
    let av = a[sortKey] ?? '';
    let bv = b[sortKey] ?? '';
    // Date columns: compare as timestamps
    if (sortKey === 'applied_at') {
      av = av ? new Date(av).getTime() : 0;
      bv = bv ? new Date(bv).getTime() : 0;
    } else {
      av = String(av).toLowerCase();
      bv = String(bv).toLowerCase();
    }
    if (av < bv) return sortDir === 'asc' ? -1 :  1;
    if (av > bv) return sortDir === 'asc' ?  1 : -1;
    return 0;
  });

  function handleSort(key) {
    if (sortKey === key) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      setSortKey(key);
      setSortDir('asc');
    }
  }

  function SortIcon({ col }) {
    if (sortKey !== col) return <ChevronsUpDown size={12} className="text-slate-600" />;
    return sortDir === 'asc'
      ? <ChevronUp   size={12} className="text-brand-400" />
      : <ChevronDown size={12} className="text-brand-400" />;
  }

  function SortableHeader({ col, label, className = '' }) {
    return (
      <th
        className={`pb-3 pr-4 text-xs uppercase tracking-wider font-medium cursor-pointer select-none
                    group/th hover:text-slate-300 transition-colors ${sortKey === col ? 'text-brand-400' : 'text-slate-500'} ${className}`}
        onClick={() => handleSort(col)}
      >
        <span className="inline-flex items-center gap-1">
          {label}
          <SortIcon col={col} />
        </span>
      </th>
    );
  }

  return (
    <div className="space-y-5">

      {/* Stats row */}
      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <StatCard label="Total Applied"  value={stats.total}                   icon={TrendingUp}    color="text-brand-400" />
          <StatCard label="Interviewing"   value={stats.byStatus.interviewing||0} icon={MessageSquare} color="text-purple-400" />
          <StatCard label="Offers"         value={stats.byStatus.offer||0}        icon={Award}         color="text-emerald-400" />
          <StatCard label="Rejected"       value={stats.byStatus.rejected||0}     icon={XCircle}       color="text-red-400" />
        </div>
      )}

      {/* Charts */}
      {stats && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          {/* Bar: per day */}
          <div className="card p-5">
            <h3 className="text-sm font-semibold text-slate-300 mb-4">Applications — Last 14 Days</h3>
            <ResponsiveContainer width="100%" height={180}>
              <BarChart data={perDayData} barSize={20}>
                <XAxis dataKey="day" tick={{ fill:'#94a3b8', fontSize:10 }} tickFormatter={v => v.slice(5)} />
                <YAxis tick={{ fill:'#94a3b8', fontSize:10 }} allowDecimals={false} />
                <Tooltip {...TOOLTIP_STYLE} />
                <Bar dataKey="count" fill="#6366f1" radius={[4,4,0,0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* Pie: by platform */}
          <div className="card p-5">
            <h3 className="text-sm font-semibold text-slate-300 mb-4">By Platform</h3>
            <ResponsiveContainer width="100%" height={180}>
              <PieChart>
                <Pie data={byPlatformData} cx="50%" cy="50%" innerRadius={50} outerRadius={75}
                  dataKey="value" nameKey="name" paddingAngle={3}>
                  {byPlatformData.map((_, i) => <Cell key={i} fill={PALETTE[i % PALETTE.length]} />)}
                </Pie>
                <Tooltip {...TOOLTIP_STYLE} />
                <Legend wrapperStyle={{ fontSize:12, color:'#94a3b8' }} />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* Filter bar + table */}
      <div className="card p-5">
        {/* Filters */}
        <div className="flex flex-wrap gap-3 mb-4 items-center">
          <input
            className="input flex-1 min-w-[180px]"
            placeholder="Search by title or company…"
            value={filters.search}
            onChange={e => setFilters(f => ({ ...f, search: e.target.value }))}
          />
          <select className="input w-36" value={filters.status} onChange={e => setFilters(f => ({ ...f, status: e.target.value }))}>
            {STATUS_OPTS.map(s => <option key={s} value={s}>{s === 'all' ? 'All Statuses' : s}</option>)}
          </select>
          <select className="input w-36" value={filters.platform} onChange={e => setFilters(f => ({ ...f, platform: e.target.value }))}>
            {PLATFORM_OPTS.map(p => <option key={p} value={p}>{p === 'all' ? 'All Platforms' : p}</option>)}
          </select>
          <button onClick={refresh} className="btn-secondary">
            <Filter size={14} /> Refresh
          </button>
          <button onClick={() => exportCSV(filteredApps)} className="btn-secondary">
            <Download size={14} /> CSV
          </button>
        </div>

        {/* Table */}
        {loading ? (
          <div className="flex items-center justify-center py-16 text-slate-500">
            <Loader2 size={20} className="animate-spin mr-3" /> Loading…
          </div>
        ) : filteredApps.length === 0 ? (
          <div className="text-center py-16 text-slate-600">
            <div className="text-4xl mb-3">📭</div>
            <p>No applications yet. Run the bot to get started!</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-white/5 text-left">
                  <SortableHeader col="company"    label="Company" />
                  <SortableHeader col="job_title"  label="Role" />
                  <SortableHeader col="platform"   label="Platform" />
                  <SortableHeader col="status"     label="Status" />
                  <SortableHeader col="applied_at" label="Date" />
                  <th className="pb-3 pr-4 text-xs uppercase tracking-wider text-slate-500 font-medium">Notes</th>
                  <th className="pb-3 text-xs uppercase tracking-wider text-slate-500 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {sortedApps.map(app => (
                  <tr key={app.id} className="group hover:bg-white/5 transition-colors">
                    <td className="py-3 pr-4">
                      <div className="font-medium text-slate-200">{app.company}</div>
                    </td>
                    <td className="py-3 pr-4">
                      <div className="text-slate-300 max-w-[200px] truncate">{app.job_title}</div>
                      {app.location && <div className="text-xs text-slate-600">{app.location}</div>}
                    </td>
                    <td className="py-3 pr-4">
                      <span className="text-slate-400 capitalize">{app.platform || '—'}</span>
                    </td>
                    <td className="py-3 pr-4">
                      <span className={STATUS_BADGE_MAP[app.status] || 'badge'}>{app.status}</span>
                    </td>
                    <td className="py-3 pr-4 text-xs text-slate-500">
                      {app.applied_at ? new Date(app.applied_at).toLocaleDateString() : '—'}
                    </td>
                    <td className="py-3 pr-4 text-xs text-slate-500 max-w-[150px] truncate">
                      {app.notes || '—'}
                    </td>
                    <td className="py-3">
                      <StatusSelect id={app.id} current={app.status} onChange={handleStatusChange} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="mt-3 text-xs text-slate-600 text-right">
          {sortedApps.length} application{sortedApps.length !== 1 ? 's' : ''}
          {' '}· sorted by <span className="text-slate-500">{sortKey.replace('_',' ')}</span> {sortDir === 'asc' ? '↑' : '↓'}
        </div>
      </div>
    </div>
  );
}
