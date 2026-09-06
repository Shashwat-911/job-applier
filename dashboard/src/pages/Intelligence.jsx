import { useState, useEffect } from 'react';
import {
  Brain, Sparkles, FileText, Code2, TrendingUp, Search,
  ExternalLink, Eye, RefreshCw, Layers, CheckCircle2, ShieldCheck,
  Github, Terminal, BookOpen, AlertTriangle, Zap, Download
} from 'lucide-react';
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip,
  LineChart, Line, CartesianGrid, AreaChart, Area
} from 'recharts';

export default function IntelligencePage() {
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [skills, setSkills] = useState([]);
  const [keywords, setKeywords] = useState([]);
  const [matchScores, setMatchScores] = useState([]);
  const [files, setFiles] = useState([]);
  const [codingData, setCodingData] = useState(null);
  const [answerLogs, setAnswerLogs] = useState([]);
  const [activeFileCategory, setActiveFileCategory] = useState('resumes');
  const [selectedFile, setSelectedFile] = useState(null);
  const [fileContent, setFileContent] = useState('');
  const [fileLoading, setFileLoading] = useState(false);
  const [aiUsage, setAiUsage] = useState({ totalCalls: 0, totalTokens: 0, summary: [] });

  const loadData = async () => {
    try {
      const [skillsRes, matchRes, kwRes, filesRes, codingRes, logsRes, usageRes] = await Promise.allSettled([
        fetch('/api/intelligence/skills').then(r => r.json()),
        fetch('/api/intelligence/match-scores').then(r => r.json()),
        fetch('/api/intelligence/keywords').then(r => r.json()),
        fetch('/api/intelligence/files').then(r => r.json()),
        fetch('/api/coding-stats').then(r => r.json()),
        fetch('/api/ai/answer-log').then(r => r.json()),
        fetch('/api/ai/usage').then(r => r.json()),
      ]);

      if (skillsRes.status === 'fulfilled' && skillsRes.value.ok) setSkills(skillsRes.value.data || []);
      if (matchRes.status === 'fulfilled' && matchRes.value.ok) setMatchScores(matchRes.value.data || []);
      if (kwRes.status === 'fulfilled' && kwRes.value.ok) setKeywords(kwRes.value.data || []);
      if (filesRes.status === 'fulfilled' && filesRes.value.ok) setFiles(filesRes.value.data || []);
      if (codingRes.status === 'fulfilled' && codingRes.value.ok) setCodingData(codingRes.value.data || null);
      if (logsRes.status === 'fulfilled' && logsRes.value.ok) setAnswerLogs(logsRes.value.data || []);
      if (usageRes.status === 'fulfilled' && usageRes.value.ok) setAiUsage(usageRes.value.data || { totalCalls: 0, totalTokens: 0 });
    } catch (err) {
      console.error('Failed to load intelligence metrics', err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const openFileModal = async (file) => {
    setSelectedFile(file);
    setFileLoading(true);
    try {
      const res = await fetch(`/api/intelligence/files/${file.category}/${file.name}`);
      const data = await res.json();
      setFileContent(data.content || 'No content found');
    } catch (err) {
      setFileContent('Error loading file preview: ' + err.message);
    } finally {
      setFileLoading(false);
    }
  };

  const filteredFiles = files.filter(f => f.category === activeFileCategory);

  return (
    <div className="space-y-8 max-w-7xl mx-auto pb-16">
      {/* Header Banner */}
      <div className="relative overflow-hidden rounded-2xl border border-indigo-500/20 bg-gradient-to-r from-indigo-950/40 via-purple-950/20 to-slate-950 p-6 md:p-8 backdrop-blur-xl">
        <div className="absolute -right-10 -top-10 w-64 h-64 rounded-full bg-indigo-600/10 blur-3xl pointer-events-none" />
        <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 text-indigo-400 font-semibold text-xs uppercase tracking-wider mb-2">
              <Sparkles size={16} className="animate-pulse" />
              <span>JobFlow AI Intelligence Engine</span>
            </div>
            <h1 className="text-2xl md:text-3xl font-bold text-white tracking-tight">
              AI Market Intelligence & Tailoring
            </h1>
            <p className="text-slate-400 text-sm mt-1 max-w-2xl">
              Real-time telemetry on candidate ATS match scores, missing skill heatmaps, live coding stats, and AI-tailored briefs.
            </p>
          </div>

          <div className="flex items-center gap-3">
            <div className="bg-slate-900/80 border border-white/10 rounded-xl px-4 py-2 text-right">
              <div className="text-xs text-slate-500">Gemini AI Usage</div>
              <div className="text-sm font-bold text-indigo-400">
                {aiUsage.totalTokens?.toLocaleString() || 0} <span className="text-xs text-slate-400 font-normal">tokens</span>
              </div>
            </div>
            <button
              onClick={() => { setRefreshing(true); loadData(); }}
              disabled={refreshing}
              className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium transition-all shadow-lg shadow-indigo-600/20 active:scale-95 disabled:opacity-50"
            >
              <RefreshCw size={16} className={refreshing ? 'animate-spin' : ''} />
              <span>Refresh</span>
            </button>
          </div>
        </div>
      </div>

      {/* Top Metrics Row */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-slate-900/60 border border-white/5 p-5 rounded-xl backdrop-blur-md">
          <div className="flex items-center justify-between text-slate-400 mb-2">
            <span className="text-xs font-medium uppercase tracking-wider">AI Answers Formulated</span>
            <Brain size={18} className="text-indigo-400" />
          </div>
          <div className="text-2xl font-bold text-white">{answerLogs.length}</div>
          <div className="text-xs text-slate-500 mt-1">Contextual responses submitted</div>
        </div>

        <div className="bg-slate-900/60 border border-white/5 p-5 rounded-xl backdrop-blur-md">
          <div className="flex items-center justify-between text-slate-400 mb-2">
            <span className="text-xs font-medium uppercase tracking-wider">Tailored Briefs</span>
            <FileText size={18} className="text-emerald-400" />
          </div>
          <div className="text-2xl font-bold text-white">
            {files.filter(f => f.category === 'resumes').length}
          </div>
          <div className="text-xs text-slate-500 mt-1">ATS-aligned application briefs</div>
        </div>

        <div className="bg-slate-900/60 border border-white/5 p-5 rounded-xl backdrop-blur-md">
          <div className="flex items-center justify-between text-slate-400 mb-2">
            <span className="text-xs font-medium uppercase tracking-wider">Avg Match Score</span>
            <TrendingUp size={18} className="text-purple-400" />
          </div>
          <div className="text-2xl font-bold text-white">
            {matchScores.length > 0
              ? `${Math.round(matchScores.reduce((acc, m) => acc + (m.match_score || 0), 0) / matchScores.length)}%`
              : 'N/A'}
          </div>
          <div className="text-xs text-slate-500 mt-1">ATS resume relevance average</div>
        </div>

        <div className="bg-slate-900/60 border border-white/5 p-5 rounded-xl backdrop-blur-md">
          <div className="flex items-center justify-between text-slate-400 mb-2">
            <span className="text-xs font-medium uppercase tracking-wider">LeetCode Solved</span>
            <Code2 size={18} className="text-amber-400" />
          </div>
          <div className="text-2xl font-bold text-white">
            {codingData?.coding?.leetcode?.totalSolved || 'Synced'}
          </div>
          <div className="text-xs text-slate-500 mt-1">Algorithm problems verified</div>
        </div>
      </div>

      {/* Analytics Charts Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Missing Skills Gap BarChart */}
        <div className="bg-slate-900/60 border border-white/5 p-6 rounded-2xl backdrop-blur-md flex flex-col">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-base font-semibold text-white flex items-center gap-2">
                <AlertTriangle size={18} className="text-amber-400" />
                Market Skill Gap Frequency
              </h2>
              <p className="text-xs text-slate-400">Skills requested in job postings that were missing in resume</p>
            </div>
            <span className="text-xs font-medium px-2.5 py-1 rounded-full bg-amber-500/10 text-amber-300 border border-amber-500/20">
              {skills.length} Detected
            </span>
          </div>

          <div className="h-64 w-full flex-1">
            {skills.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={skills.slice(0, 7)} layout="vertical" margin={{ left: 20, right: 20 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#334155" opacity={0.3} horizontal={false} />
                  <XAxis type="number" stroke="#64748b" tickLine={false} />
                  <YAxis type="category" dataKey="skill" stroke="#94a3b8" tickLine={false} width={80} />
                  <Tooltip
                    contentStyle={{ background: '#0f172a', borderColor: '#334155', borderRadius: '8px', color: '#fff' }}
                  />
                  <Bar dataKey="count" fill="#818cf8" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-full flex flex-col items-center justify-center text-slate-500 text-sm">
                <ShieldCheck size={32} className="mb-2 opacity-40 text-emerald-400" />
                <span>No skill gaps recorded yet. Run bot applications to extract JD requirements!</span>
              </div>
            )}
          </div>
        </div>

        {/* ATS Match Score History */}
        <div className="bg-slate-900/60 border border-white/5 p-6 rounded-2xl backdrop-blur-md flex flex-col">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-base font-semibold text-white flex items-center gap-2">
                <TrendingUp size={18} className="text-indigo-400" />
                ATS Match Score Progression
              </h2>
              <p className="text-xs text-slate-400">Semantic alignment scores (%) computed for recent applications</p>
            </div>
          </div>

          <div className="h-64 w-full flex-1">
            {matchScores.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={matchScores} margin={{ left: -10, right: 10, top: 10 }}>
                  <defs>
                    <linearGradient id="scoreGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#6366f1" stopOpacity={0.4} />
                      <stop offset="95%" stopColor="#6366f1" stopOpacity={0.0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#334155" opacity={0.3} />
                  <XAxis dataKey="company" stroke="#64748b" tickLine={false} />
                  <YAxis domain={[0, 100]} stroke="#64748b" tickLine={false} />
                  <Tooltip
                    contentStyle={{ background: '#0f172a', borderColor: '#334155', borderRadius: '8px', color: '#fff' }}
                  />
                  <Area type="monotone" dataKey="match_score" stroke="#818cf8" strokeWidth={2} fillOpacity={1} fill="url(#scoreGrad)" />
                </AreaChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-full flex flex-col items-center justify-center text-slate-500 text-sm">
                <Sparkles size={32} className="mb-2 opacity-40 text-indigo-400" />
                <span>Scores will populate automatically as Gemini evaluates job postings.</span>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Coding Profiles & GitHub Live Badges */}
      <div className="bg-slate-900/60 border border-white/5 p-6 rounded-2xl backdrop-blur-md">
        <h2 className="text-base font-semibold text-white flex items-center gap-2 mb-4">
          <Code2 size={18} className="text-indigo-400" />
          Live Coding Profiles & GitHub Telemetry
        </h2>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {/* GitHub Card */}
          <div className="bg-black/30 border border-white/5 p-4 rounded-xl">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <Github size={20} className="text-white" />
                <span className="font-semibold text-white text-sm">GitHub</span>
              </div>
              {codingData?.github?.profileUrl && (
                <a href={codingData.github.profileUrl} target="_blank" rel="noreferrer" className="text-indigo-400 hover:text-indigo-300">
                  <ExternalLink size={15} />
                </a>
              )}
            </div>
            {codingData?.github?.success ? (
              <div className="space-y-2 text-xs">
                <div className="flex justify-between text-slate-400">
                  <span>Public Repos:</span>
                  <span className="text-white font-medium">{codingData.github.publicRepos}</span>
                </div>
                <div className="flex justify-between text-slate-400">
                  <span>Total Stars:</span>
                  <span className="text-amber-400 font-medium">★ {codingData.github.totalStars}</span>
                </div>
                <div className="text-slate-400">Top Languages:</div>
                <div className="flex flex-wrap gap-1 mt-1">
                  {(codingData.github.topLanguages || []).map(l => (
                    <span key={l} className="px-2 py-0.5 rounded bg-indigo-500/10 text-indigo-300 border border-indigo-500/20 text-[10px]">
                      {l}
                    </span>
                  ))}
                </div>
              </div>
            ) : (
              <div className="text-xs text-slate-500 py-2">
                Configure GitHub username in Profile to sync stats.
              </div>
            )}
          </div>

          {/* LeetCode Card */}
          <div className="bg-black/30 border border-white/5 p-4 rounded-xl">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <Terminal size={20} className="text-amber-400" />
                <span className="font-semibold text-white text-sm">LeetCode</span>
              </div>
              {codingData?.coding?.leetcode?.profileUrl && (
                <a href={codingData.coding.leetcode.profileUrl} target="_blank" rel="noreferrer" className="text-amber-400 hover:text-amber-300">
                  <ExternalLink size={15} />
                </a>
              )}
            </div>
            {codingData?.coding?.leetcode?.success ? (
              <div className="space-y-2 text-xs">
                <div className="flex justify-between text-slate-400">
                  <span>Problems Solved:</span>
                  <span className="text-emerald-400 font-bold">{codingData.coding.leetcode.totalSolved}</span>
                </div>
                <div className="grid grid-cols-3 gap-1 text-center py-1">
                  <div className="bg-emerald-500/10 text-emerald-300 p-1 rounded">
                    <div className="text-[10px] text-slate-500">Easy</div>
                    <div className="font-bold">{codingData.coding.leetcode.breakdown?.easy || 0}</div>
                  </div>
                  <div className="bg-amber-500/10 text-amber-300 p-1 rounded">
                    <div className="text-[10px] text-slate-500">Med</div>
                    <div className="font-bold">{codingData.coding.leetcode.breakdown?.medium || 0}</div>
                  </div>
                  <div className="bg-red-500/10 text-red-300 p-1 rounded">
                    <div className="text-[10px] text-slate-500">Hard</div>
                    <div className="font-bold">{codingData.coding.leetcode.breakdown?.hard || 0}</div>
                  </div>
                </div>
              </div>
            ) : (
              <div className="text-xs text-slate-500 py-2">
                Configure LeetCode handle in Profile to track AC problem counts.
              </div>
            )}
          </div>

          {/* Codeforces / HackerRank Card */}
          <div className="bg-black/30 border border-white/5 p-4 rounded-xl">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <Zap size={20} className="text-cyan-400" />
                <span className="font-semibold text-white text-sm">Competitive Ranks</span>
              </div>
            </div>
            <div className="space-y-2.5 text-xs">
              <div className="flex justify-between items-center text-slate-400">
                <span>Codeforces:</span>
                <span className="text-cyan-300 font-medium">
                  {codingData?.coding?.codeforces?.rating ? `${codingData.coding.codeforces.rating} (${codingData.coding.codeforces.rank})` : 'Linked'}
                </span>
              </div>
              <div className="flex justify-between items-center text-slate-400">
                <span>HackerRank:</span>
                <span className="text-emerald-300 font-medium">
                  {codingData?.coding?.hackerrank?.badgesCount ? `${codingData.coding.hackerrank.badgesCount} Badges` : 'Active'}
                </span>
              </div>
              <div className="flex justify-between items-center text-slate-400">
                <span>CodeChef:</span>
                <span className="text-purple-300 font-medium">Active Contender</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Generated Documents & Briefs Library */}
      <div className="bg-slate-900/60 border border-white/5 p-6 rounded-2xl backdrop-blur-md">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-6">
          <div>
            <h2 className="text-base font-semibold text-white flex items-center gap-2">
              <BookOpen size={18} className="text-emerald-400" />
              Generated Application Documents & Briefs
            </h2>
            <p className="text-xs text-slate-400">Inspect tailored resume briefs and cover letters generated by Gemini</p>
          </div>

          {/* Category Tabs */}
          <div className="flex bg-black/40 p-1 rounded-xl border border-white/5">
            {[
              { id: 'resumes', label: 'Tailored Resumes' },
              { id: 'cover_letters', label: 'Cover Letters' },
              { id: 'jd_cache', label: 'Job Descriptions' },
            ].map(tab => (
              <button
                key={tab.id}
                onClick={() => setActiveFileCategory(tab.id)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                  activeFileCategory === tab.id
                    ? 'bg-indigo-600 text-white shadow'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        {/* Files Grid */}
        {filteredFiles.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {filteredFiles.map(file => (
              <div
                key={file.name}
                className="group flex items-center justify-between p-3.5 rounded-xl bg-black/20 border border-white/5 hover:border-indigo-500/30 transition-all"
              >
                <div className="flex items-center gap-3 overflow-hidden">
                  <div className="p-2 rounded-lg bg-indigo-500/10 text-indigo-400 shrink-0">
                    <FileText size={16} />
                  </div>
                  <div className="truncate">
                    <div className="text-sm font-medium text-slate-200 truncate">{file.name}</div>
                    <div className="text-[11px] text-slate-500">
                      {(file.size / 1024).toFixed(1)} KB • {new Date(file.updatedAt).toLocaleDateString()}
                    </div>
                  </div>
                </div>

                <button
                  onClick={() => openFileModal(file)}
                  className="p-2 rounded-lg bg-white/5 hover:bg-white/10 text-slate-400 hover:text-white transition-all shrink-0 ml-2"
                  title="Preview File"
                >
                  <Eye size={15} />
                </button>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-center py-10 text-slate-500 text-sm">
            No files saved in this category yet.
          </div>
        )}
      </div>

      {/* AI Answer Log Table */}
      <div className="bg-slate-900/60 border border-white/5 p-6 rounded-2xl backdrop-blur-md">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-base font-semibold text-white flex items-center gap-2">
              <Brain size={18} className="text-purple-400" />
              AI Application Answers Audit Log
            </h2>
            <p className="text-xs text-slate-400">Questions encountered on application forms and the answers generated</p>
          </div>
          <span className="text-xs font-medium px-2.5 py-1 rounded-full bg-purple-500/10 text-purple-300 border border-purple-500/20">
            {answerLogs.length} Records
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm text-slate-400">
            <thead className="bg-white/5 text-slate-300 text-xs uppercase font-medium">
              <tr>
                <th className="py-3 px-4 rounded-l-lg">Target Company & Role</th>
                <th className="py-3 px-4">Question Prompt</th>
                <th className="py-3 px-4 rounded-r-lg">Generated Response</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {answerLogs.length > 0 ? (
                answerLogs.map((log, idx) => (
                  <tr key={idx} className="hover:bg-white/[0.02] transition-colors">
                    <td className="py-3 px-4 text-white font-medium whitespace-nowrap">
                      <div>{log.company}</div>
                      <div className="text-xs text-slate-500 font-normal">{log.job_title}</div>
                    </td>
                    <td className="py-3 px-4 text-indigo-300 text-xs max-w-xs">{log.question}</td>
                    <td className="py-3 px-4 text-xs text-slate-300 max-w-md">
                      <div className="line-clamp-3">{log.answer}</div>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={3} className="py-8 text-center text-slate-500 text-sm">
                    No application questions answered by AI yet. Run the bot to see contextual answers populate.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* File Preview Modal */}
      {selectedFile && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
          <div className="bg-slate-900 border border-white/10 rounded-2xl w-full max-w-3xl max-h-[85vh] flex flex-col shadow-2xl">
            <div className="flex items-center justify-between p-4 border-b border-white/10">
              <div className="flex items-center gap-2">
                <FileText size={18} className="text-indigo-400" />
                <span className="font-semibold text-white text-sm truncate">{selectedFile.name}</span>
              </div>
              <button
                onClick={() => setSelectedFile(null)}
                className="text-slate-400 hover:text-white text-sm px-3 py-1 rounded-lg bg-white/5"
              >
                Close
              </button>
            </div>

            <div className="p-4 flex-1 overflow-y-auto">
              {fileLoading ? (
                <div className="flex justify-center py-12 text-slate-400">Loading document preview...</div>
              ) : (
                <pre className="text-xs text-slate-300 font-mono whitespace-pre-wrap leading-relaxed bg-black/40 p-4 rounded-xl border border-white/5">
                  {fileContent}
                </pre>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
