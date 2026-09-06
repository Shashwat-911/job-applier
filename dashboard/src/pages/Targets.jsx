import { useEffect, useState } from 'react';
import { Save, Target, MapPin, List, Loader2 } from 'lucide-react';
import api from '../api.js';

function TagInput({ tags, onChange, placeholder }) {
  const [input, setInput] = useState('');
  function addTag(e) {
    if ((e.key === 'Enter' || e.key === ',') && input.trim()) {
      e.preventDefault();
      if (!tags.includes(input.trim())) onChange([...tags, input.trim()]);
      setInput('');
    }
  }
  return (
    <div className="flex flex-wrap gap-2 p-3 bg-white/5 border border-white/10 rounded-xl min-h-[46px] items-center
                    focus-within:border-brand-500 focus-within:ring-2 focus-within:ring-brand-500/20 transition-all">
      {tags.map(t => (
        <span key={t} className="chip">
          {t}
          <button onClick={() => onChange(tags.filter(x => x !== t))} className="ml-1 text-xs hover:text-red-400">×</button>
        </span>
      ))}
      <input value={input} onChange={e => setInput(e.target.value)} onKeyDown={addTag}
        placeholder={tags.length === 0 ? placeholder : '+ Add'}
        className="bg-transparent outline-none text-sm text-slate-200 placeholder-slate-600 min-w-[80px] flex-1" />
    </div>
  );
}

const PLATFORMS = [
  { id: 'linkedin',       label: 'LinkedIn',         tag: 'Global',  color: 'from-blue-600 to-cyan-600' },
  { id: 'indeed',         label: 'Indeed',           tag: 'Global',  color: 'from-indigo-600 to-blue-700' },
  { id: 'naukri',         label: 'Naukri.com',       tag: 'India',   color: 'from-amber-600 to-orange-600' },
  { id: 'wellfound',      label: 'Wellfound',        tag: 'Startup', color: 'from-red-600 to-rose-600' },
  { id: 'internshala',    label: 'Internshala',      tag: 'India',   color: 'from-sky-500 to-blue-600' },
  { id: 'shine',          label: 'Shine.com',        tag: 'India',   color: 'from-emerald-600 to-teal-700' },
  { id: 'foundit',        label: 'Foundit (Monster)',tag: 'India',   color: 'from-purple-600 to-indigo-600' },
  { id: 'glassdoor',      label: 'Glassdoor',        tag: 'Global',  color: 'from-green-600 to-emerald-700' },
  { id: 'unstop',         label: 'Unstop',           tag: 'India',   color: 'from-blue-500 to-indigo-600' },
  { id: 'cutshort',       label: 'Cutshort',         tag: 'India',   color: 'from-violet-600 to-purple-700' },
  { id: 'hirist',         label: 'Hirist',           tag: 'India',   color: 'from-teal-600 to-emerald-600' },
  { id: 'remoteok',       label: 'RemoteOK',         tag: 'Remote',  color: 'from-pink-600 to-rose-600' },
  { id: 'workatastartup', label: 'Work at a Startup',tag: 'Startup', color: 'from-orange-500 to-amber-600' },
];

export default function TargetsPage() {
  const [search, setSearch] = useState(null);
  const [saving, setSaving] = useState(false);
  const [saved,  setSaved]  = useState(false);
  const [error,  setError]  = useState('');
  const [filterTag, setFilterTag] = useState('All');

  useEffect(() => {
    api.getProfile()
      .then(p => setSearch({ ...p.search }))
      .catch(e => setError(e.message));
  }, []);

  function set(field, value) {
    setSearch(s => ({ ...s, [field]: value }));
  }

  function togglePlatform(id) {
    const plats = search.platforms || [];
    set('platforms', plats.includes(id) ? plats.filter(p => p !== id) : [...plats, id]);
  }

  function toggleAllVisible(enable) {
    const visibleIds = visiblePlatforms.map(p => p.id);
    const current = new Set(search.platforms || []);
    if (enable) {
      visibleIds.forEach(id => current.add(id));
    } else {
      visibleIds.forEach(id => current.delete(id));
    }
    set('platforms', Array.from(current));
  }

  async function save() {
    setSaving(true);
    try {
      await api.patchSection('search', search);
      setSaved(true); setTimeout(() => setSaved(false), 3000);
    } catch(e) { setError(e.message); }
    finally { setSaving(false); }
  }

  if (!search) return (
    <div className="flex items-center gap-3 text-slate-400 mt-20 justify-center">
      <Loader2 size={20} className="animate-spin" />
      {error ? <span className="text-red-400">{error}</span> : 'Loading…'}
    </div>
  );

  const visiblePlatforms = filterTag === 'All'
    ? PLATFORMS
    : PLATFORMS.filter(p => p.tag === filterTag);

  return (
    <div className="max-w-4xl space-y-6">
      <div className="flex justify-between items-center mb-2">
        <div>
          <h1 className="text-xl font-bold text-white">Search Targets & Job Portals</h1>
          <p className="text-slate-500 text-sm">Select job platforms and roles to automate applications across.</p>
        </div>
        <button onClick={save} disabled={saving} className="btn-primary">
          {saving ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />}
          {saved ? 'Saved ✓' : 'Save Targets'}
        </button>
      </div>
      {error && <div className="card p-3 border-red-500/30 text-red-400 text-sm">{error}</div>}

      {/* Target roles */}
      <div className="card p-6 space-y-5">
        <div className="flex items-center gap-2 pb-3 border-b border-white/5">
          <Target size={17} className="text-brand-400" />
          <h2 className="font-semibold text-slate-200">Target Roles & Filters</h2>
        </div>
        <div>
          <label className="label">Roles to search (Enter or comma to add)</label>
          <TagInput tags={search.roles || []} onChange={v => set('roles', v)} placeholder="Frontend Developer, React Engineer…" />
        </div>
        <div>
          <label className="label">Skip keywords (jobs containing these are ignored)</label>
          <TagInput tags={search.skipKeywords || []} onChange={v => set('skipKeywords', v)} placeholder="Senior, Lead, Manager…" />
        </div>
      </div>

      {/* 13 Platforms Grid */}
      <div className="card p-6 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-white/5">
          <div className="flex items-center gap-2">
            <List size={17} className="text-brand-400" />
            <h2 className="font-semibold text-slate-200">
              Active Job Platforms ({(search.platforms || []).length} / {PLATFORMS.length} Enabled)
            </h2>
          </div>

          <div className="flex items-center gap-2">
            {/* Filter pills */}
            <div className="flex bg-black/40 p-1 rounded-xl border border-white/5 text-xs">
              {['All', 'India', 'Global', 'Remote', 'Startup'].map(tag => (
                <button
                  key={tag}
                  onClick={() => setFilterTag(tag)}
                  className={`px-2.5 py-1 rounded-lg transition-all ${
                    filterTag === tag
                      ? 'bg-brand-600 text-white shadow'
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  {tag}
                </button>
              ))}
            </div>

            <button
              onClick={() => toggleAllVisible(true)}
              className="px-2.5 py-1 text-xs rounded-lg bg-white/5 hover:bg-white/10 text-slate-300 transition-all"
            >
              Enable Visible
            </button>
            <button
              onClick={() => toggleAllVisible(false)}
              className="px-2.5 py-1 text-xs rounded-lg bg-white/5 hover:bg-white/10 text-slate-300 transition-all"
            >
              Clear
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
          {visiblePlatforms.map(({ id, label, tag, color }) => {
            const on = (search.platforms || []).includes(id);
            return (
              <button
                key={id}
                onClick={() => togglePlatform(id)}
                className={`flex items-center justify-between p-3.5 rounded-xl border transition-all cursor-pointer text-left ${
                  on
                    ? 'bg-brand-600/15 border-brand-500/40 text-white shadow-lg shadow-brand-500/5'
                    : 'bg-white/[0.02] border-white/5 text-slate-400 hover:bg-white/[0.05]'
                }`}
              >
                <div className="flex items-center gap-2.5 overflow-hidden">
                  <div
                    className={`w-8 h-8 rounded-lg bg-gradient-to-br ${color} flex items-center justify-center text-white font-bold text-xs shrink-0 shadow`}
                  >
                    {label.slice(0, 2).toUpperCase()}
                  </div>
                  <div className="truncate">
                    <div className="text-sm font-semibold truncate text-slate-200">{label}</div>
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-white/5 text-slate-400 border border-white/5">
                      {tag}
                    </span>
                  </div>
                </div>

                <div
                  className={`w-4 h-4 rounded-full border flex items-center justify-center transition-all ${
                    on ? 'bg-brand-500 border-brand-400 text-black' : 'border-slate-600'
                  }`}
                >
                  {on && <div className="w-1.5 h-1.5 rounded-full bg-white" />}
                </div>
              </button>
            );
          })}
        </div>
      </div>


      {/* Filters */}
      <div className="card p-6 space-y-4">
        <div className="flex items-center gap-2 pb-3 border-b border-white/5">
          <MapPin size={17} className="text-brand-400" />
          <h2 className="font-semibold text-slate-200">Filters</h2>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="label">Location</label>
            <input className="input" value={search.location} onChange={e => set('location', e.target.value)} placeholder="Bangalore, India" />
          </div>
          <div>
            <label className="label">Max Applications per Run</label>
            <input className="input" type="number" min={1} max={100} value={search.maxPerRun}
              onChange={e => set('maxPerRun', Number(e.target.value))} />
          </div>
          <div>
            <label className="label">Posted Within</label>
            <select className="input" value={search.postedWithin} onChange={e => set('postedWithin', e.target.value)}>
              <option value="day">Last 24 hours</option>
              <option value="week">Last week</option>
              <option value="month">Last month</option>
            </select>
          </div>
        </div>
      </div>
    </div>
  );
}
