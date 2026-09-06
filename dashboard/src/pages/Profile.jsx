import { useEffect, useState } from 'react';
import { Save, Plus, X, Upload, User, Briefcase, HelpCircle, Loader2, Code2, Brain } from 'lucide-react';
import api from '../api.js';

function Section({ title, icon: Icon, children }) {
  return (
    <div className="card p-6 space-y-5">
      <div className="flex items-center gap-2.5 pb-3 border-b border-white/5">
        <Icon size={17} className="text-brand-400" />
        <h2 className="font-semibold text-slate-200">{title}</h2>
      </div>
      {children}
    </div>
  );
}

function Field({ label, children }) {
  return (
    <div>
      <label className="label">{label}</label>
      {children}
    </div>
  );
}

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
          <button onClick={() => onChange(tags.filter(x => x !== t))} className="ml-1 hover:text-red-400">
            <X size={11} />
          </button>
        </span>
      ))}
      <input
        value={input}
        onChange={e => setInput(e.target.value)}
        onKeyDown={addTag}
        placeholder={tags.length === 0 ? placeholder : '+ Add'}
        className="bg-transparent outline-none text-sm text-slate-200 placeholder-slate-600 min-w-[80px] flex-1"
      />
    </div>
  );
}

export default function ProfilePage() {
  const [profile, setProfile]   = useState(null);
  const [saving,  setSaving]    = useState(false);
  const [saved,   setSaved]     = useState(false);
  const [error,   setError]     = useState('');

  useEffect(() => {
    api.getProfile()
      .then(setProfile)
      .catch(e => setError(e.message));
  }, []);

  function set(section, field, value) {
    setProfile(p => ({ ...p, [section]: { ...p[section], [field]: value } }));
  }

  async function save() {
    setSaving(true);
    setError('');
    try {
      await api.saveProfile(profile);
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  if (!profile) return (
    <div className="flex items-center gap-3 text-slate-400 mt-20 justify-center">
      <Loader2 size={20} className="animate-spin" />
      {error ? <span className="text-red-400">{error} — Is the server running?</span> : 'Loading profile…'}
    </div>
  );

  const { personal: p, professional: pr, qa } = profile;

  return (
    <div className="max-w-3xl space-y-5">
      <div className="flex items-center justify-between mb-2">
        <p className="text-slate-500 text-sm">Fill in your details — used to auto-fill job applications.</p>
        <button onClick={save} disabled={saving} className="btn-primary">
          {saving ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />}
          {saved ? 'Saved ✓' : 'Save Profile'}
        </button>
      </div>

      {error && <div className="card p-3 border-red-500/30 text-red-400 text-sm">{error}</div>}

      {/* Personal */}
      <Section title="Personal Info" icon={User}>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Full Name">
            <input className="input" value={p.name} onChange={e => set('personal','name',e.target.value)} placeholder="Jane Doe" />
          </Field>
          <Field label="Email">
            <input className="input" type="email" value={p.email} onChange={e => set('personal','email',e.target.value)} placeholder="jane@example.com" />
          </Field>
          <Field label="Phone">
            <input className="input" type="tel" value={p.phone} onChange={e => set('personal','phone',e.target.value)} placeholder="+91 98765 43210" />
          </Field>
          <Field label="Location">
            <input className="input" value={p.location} onChange={e => set('personal','location',e.target.value)} placeholder="Bangalore, India" />
          </Field>
          <Field label="LinkedIn URL">
            <input className="input" value={p.linkedin} onChange={e => set('personal','linkedin',e.target.value)} placeholder="https://linkedin.com/in/…" />
          </Field>
          <Field label="Portfolio / Website">
            <input className="input" value={p.portfolio} onChange={e => set('personal','portfolio',e.target.value)} placeholder="https://…" />
          </Field>
        </div>
      </Section>

      {/* Professional */}
      <Section title="Professional Info" icon={Briefcase}>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Current / Desired Title">
            <input className="input" value={pr.title} onChange={e => set('professional','title',e.target.value)} placeholder="Senior Frontend Engineer" />
          </Field>
          <Field label="Years of Experience">
            <input className="input" type="number" min={0} value={pr.yearsExperience} onChange={e => set('professional','yearsExperience', Number(e.target.value))} />
          </Field>
          <Field label="Expected Salary">
            <input className="input" value={pr.expectedSalary} onChange={e => set('professional','expectedSalary',e.target.value)} placeholder="₹30 LPA" />
          </Field>
          <Field label="Notice Period">
            <input className="input" value={pr.noticePeriod} onChange={e => set('professional','noticePeriod',e.target.value)} placeholder="30 days" />
          </Field>
          <Field label="Work Mode">
            <select className="input" value={pr.workMode} onChange={e => set('professional','workMode',e.target.value)}>
              <option>Any</option><option>Remote</option><option>Hybrid</option><option>Onsite</option>
            </select>
          </Field>
          <Field label="Resume Path">
            <div className="flex gap-2">
              <input className="input flex-1" value={pr.resumePath} onChange={e => set('professional','resumePath',e.target.value)} placeholder="./resume.pdf" />
            </div>
            <p className="text-xs text-slate-600 mt-1">Absolute or relative path to your PDF/DOCX resume.</p>
          </Field>
        </div>
        <Field label="Professional Summary (used for cover letters)">
          <textarea className="input resize-none h-28" value={pr.summary}
            onChange={e => set('professional','summary',e.target.value)}
            placeholder="Passionate engineer with 5+ years building scalable web applications…" />
        </Field>
        <Field label="Skills (press Enter or comma to add)">
          <TagInput
            tags={pr.skills || []}
            onChange={tags => set('professional','skills', tags)}
            placeholder="React, Node.js, Python…"
          />
        </Field>
      </Section>

      {/* Coding & Competitive Profiles */}
      <Section title="Coding & Technical Profiles" icon={Code2}>
        <div className="grid grid-cols-2 gap-4">
          <Field label="GitHub Username / URL">
            <input className="input" value={p.github || ''} onChange={e => set('personal','github',e.target.value)} placeholder="https://github.com/shashwat" />
          </Field>
          <Field label="LeetCode Username">
            <input className="input" value={profile.codingProfiles?.leetcode || p.leetcode || ''}
              onChange={e => {
                setProfile(prev => ({
                  ...prev,
                  codingProfiles: { ...(prev.codingProfiles || {}), leetcode: e.target.value },
                  personal: { ...prev.personal, leetcode: e.target.value }
                }));
              }}
              placeholder="shashwat_yadav" />
          </Field>
          <Field label="Codeforces Handle">
            <input className="input" value={profile.codingProfiles?.codeforces || ''}
              onChange={e => {
                setProfile(prev => ({
                  ...prev,
                  codingProfiles: { ...(prev.codingProfiles || {}), codeforces: e.target.value }
                }));
              }}
              placeholder="shashwat_cf" />
          </Field>
          <Field label="HackerRank Username">
            <input className="input" value={profile.codingProfiles?.hackerrank || p.hackerrank || ''}
              onChange={e => {
                setProfile(prev => ({
                  ...prev,
                  codingProfiles: { ...(prev.codingProfiles || {}), hackerrank: e.target.value },
                  personal: { ...prev.personal, hackerrank: e.target.value }
                }));
              }}
              placeholder="shashwat_hr" />
          </Field>
          <Field label="CodeChef Username">
            <input className="input" value={profile.codingProfiles?.codechef || ''}
              onChange={e => {
                setProfile(prev => ({
                  ...prev,
                  codingProfiles: { ...(prev.codingProfiles || {}), codechef: e.target.value }
                }));
              }}
              placeholder="shashwat_cc" />
          </Field>
          <Field label="GeeksForGeeks Username">
            <input className="input" value={profile.codingProfiles?.geeksforgeeks || ''}
              onChange={e => {
                setProfile(prev => ({
                  ...prev,
                  codingProfiles: { ...(prev.codingProfiles || {}), geeksforgeeks: e.target.value }
                }));
              }}
              placeholder="shashwat_gfg" />
          </Field>
        </div>
      </Section>

      {/* AI Assistance & Cover Letter Defaults */}
      <Section title="AI Assistance & Cover Letter Defaults" icon={Brain}>
        <div className="space-y-4">
          <Field label="Gemini API Key">
            <input
              type="password"
              className="input"
              value={profile.geminiApiKey || ''}
              onChange={e => setProfile(prev => ({ ...prev, geminiApiKey: e.target.value }))}
              placeholder="AIzaSy..."
            />
            <p className="text-xs text-slate-500 mt-1">From Google AI Studio (free tier: 15 req/min, 1M tokens/day)</p>
          </Field>

          <Field label="Default Cover Letter Pitch (used when Gemini is not configured)">
            <textarea
              className="input resize-none h-24"
              value={profile.coverLetterTemplate || ''}
              onChange={e => setProfile(prev => ({ ...prev, coverLetterTemplate: e.target.value }))}
              placeholder="I am passionate about contributing to your team with my background in high-impact software engineering..."
            />
          </Field>

          <Field label="Custom Prompt Instructions for AI Answers (Optional)">
            <input
              className="input"
              value={profile.aiInstructions || ''}
              onChange={e => setProfile(prev => ({ ...prev, aiInstructions: e.target.value }))}
              placeholder="Always emphasize full-stack performance, clean code, and fast delivery."
            />
          </Field>
        </div>
      </Section>


      {/* Q&A Defaults */}
      <Section title="Q&A Defaults" icon={HelpCircle}>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Work Authorized?">
            <select className="input" value={qa.authorized} onChange={e => set('qa','authorized',e.target.value)}>
              <option>Yes</option><option>No</option>
            </select>
          </Field>
          <Field label="Open to Relocation?">
            <select className="input" value={qa.relocation} onChange={e => set('qa','relocation',e.target.value)}>
              <option>No</option><option>Yes</option>
            </select>
          </Field>
          <Field label="Highest Education">
            <input className="input" value={qa.education} onChange={e => set('qa','education',e.target.value)} placeholder="B.Tech Computer Science" />
          </Field>
          <Field label="Why This Company? (template)">
            <input className="input" value={qa.whyThisCompany} onChange={e => set('qa','whyThisCompany',e.target.value)} placeholder="I'm excited by your mission to…" />
          </Field>
        </div>
      </Section>
    </div>
  );
}

