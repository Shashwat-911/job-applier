/**
 * bot/resume/resumeTailor.js
 * Analyzes candidate resume text against job descriptions and generates
 * a tailored plain-text summary and emphasis recommendations.
 * Keeps original PDF intact to ensure document formatting is never corrupted.
 */

const fs = require('fs');
const path = require('path');
const pdfParse = require('pdf-parse');
const { tailorResume } = require('../ai/gemini');

const OUTPUT_DIR = path.join(__dirname, '../output/resumes');
if (!fs.existsSync(OUTPUT_DIR)) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}

/**
 * Extract text from a resume PDF file.
 * @param {string} pdfPath
 * @returns {Promise<string>}
 */
async function extractResumeText(pdfPath) {
  if (!pdfPath || !fs.existsSync(pdfPath)) {
    return '';
  }
  try {
    const dataBuffer = fs.readFileSync(pdfPath);
    const data = await pdfParse(dataBuffer);
    return data.text || '';
  } catch (err) {
    console.warn(`[ResumeTailor] Failed to parse PDF at ${pdfPath}:`, err.message);
    return '';
  }
}

/**
 * Generate a tailored summary and emphasis guide for a specific job application.
 *
 * @param {Object} params
 * @param {Object} params.profile - candidate profile
 * @param {Object} params.jobContext - { title, company, description, platform }
 * @param {Object} [params.analysisResult] - output from claude.analyzeJobDescription
 * @returns {Promise<{ tailoredSummaryPath: string|null, tailoredSummary: string|null, resumePath: string }>}
 */
async function generateTailoredResume({ profile, jobContext, analysisResult }) {
  const resumePath = profile?.resume_path || profile?.resumePath || '';
  let resumeText = '';

  if (resumePath && fs.existsSync(resumePath)) {
    resumeText = await extractResumeText(resumePath);
  }

  const enrichedProfile = {
    ...profile,
    extractedResumeText: resumeText || profile.summary || '',
  };

  const tailoring = await tailorResume(enrichedProfile, jobContext, analysisResult);

  if (!tailoring) {
    return {
      tailoredSummaryPath: null,
      tailoredSummary: null,
      resumePath,
    };
  }

  // Format the plain-text tailored document
  const safeCompany = (jobContext.company || 'company').replace(/[^a-zA-Z0-9_-]/g, '_');
  const safeRole = (jobContext.title || 'role').replace(/[^a-zA-Z0-9_-]/g, '_');
  const fileName = `${safeCompany}_${safeRole}_tailored_${Date.now()}.txt`;
  const filePath = path.join(OUTPUT_DIR, fileName);

  const fileContent = [
    `=============================================================`,
    `TAILORED APPLICATION BRIEF`,
    `Target Role:    ${jobContext.title || 'N/A'}`,
    `Company:        ${jobContext.company || 'N/A'}`,
    `Generated At:   ${new Date().toISOString()}`,
    `=============================================================`,
    ``,
    `[TARGETED PROFESSIONAL SUMMARY]`,
    tailoring.tailoredSummary || 'No summary generated.',
    ``,
    `[PRIORITIZED SKILLS]`,
    Array.isArray(tailoring.reorderedSkills) ? tailoring.reorderedSkills.join(', ') : 'N/A',
    ``,
    `[KEY HIGHLIGHTS & EMPHASIS POINTS]`,
    Array.isArray(tailoring.emphasisSuggestions)
      ? tailoring.emphasisSuggestions.map((s, i) => `${i + 1}. ${s}`).join('\n')
      : 'N/A',
    ``,
    `[RELEVANT PROJECTS TO EMPHASIZE]`,
    Array.isArray(tailoring.projectEmphasis)
      ? tailoring.projectEmphasis.map(p => `- ${p}`).join('\n')
      : 'N/A',
    ``,
    `=============================================================`,
  ].join('\n');

  try {
    fs.writeFileSync(filePath, fileContent, 'utf-8');
  } catch (err) {
    console.error('[ResumeTailor] Error writing tailored summary file:', err.message);
  }

  return {
    tailoredSummaryPath: filePath,
    tailoredSummary: tailoring.tailoredSummary || fileContent,
    resumePath,
  };
}

module.exports = {
  extractResumeText,
  generateTailoredResume,
};
