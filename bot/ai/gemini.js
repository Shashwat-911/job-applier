const { GoogleGenerativeAI } = require('@google/generative-ai');
const path = require('path');
const fs = require('fs');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const apiKey = process.env.GEMINI_API_KEY;
const genAI = (apiKey && apiKey !== 'your_gemini_key_here') ? new GoogleGenerativeAI(apiKey) : null;

// Use gemini-1.5-flash — free tier, fast, generous limits
const MODEL = 'gemini-1.5-flash';

async function callGemini(prompt) {
  if (!genAI) {
    console.log('⚠️  GEMINI_API_KEY not set — skipping AI call');
    return null;
  }
  try {
    const model = genAI.getGenerativeModel({ model: MODEL });
    const result = await model.generateContent(prompt);
    return result.response.text();
  } catch (err) {
    console.error('⚠️  Gemini API error:', err.message);
    return null;
  }
}

// generateAnswer — detects question type, returns 2-4 sentence answer
async function generateAnswer(question, profile, jobContext = {}) {
  const prompt = `
You are helping a job applicant answer an application question.
Applicant profile:
  Name: ${profile?.personal?.name || 'Applicant'}
  Role applying for: ${jobContext?.title || 'Role'} at ${jobContext?.company || 'Company'}
  Summary: ${profile?.professional?.summary || ''}
  Skills: ${(profile?.professional?.skills || []).join(', ')}
  Experience: ${profile?.professional?.yearsExperience || 0} years

Question: "${question}"

Write a professional, specific, confident answer in 2-4 sentences.
Do NOT start with "I am writing" or "I believe".
Sound human, not generic. Use first person.
Return ONLY the answer text, nothing else.
  `.trim();

  return await callGemini(prompt);
}

// generateCoverLetter — ~300 words, saves to bot/output/cover_letters/
async function generateCoverLetter(profile, jobContext = {}) {
  const prompt = `
Write a professional cover letter for this job application.

Applicant:
  Name: ${profile?.personal?.name || 'Applicant'}
  Email: ${profile?.personal?.email || ''}
  Experience: ${profile?.professional?.yearsExperience || 0} years
  Skills: ${(profile?.professional?.skills || []).join(', ')}
  Summary: ${profile?.professional?.summary || ''}

Job:
  Role: ${jobContext?.title || 'Role'}
  Company: ${jobContext?.company || 'Company'}
  Description: ${(jobContext?.description || '').slice(0, 800)}

Rules:
  - ~300 words
  - Opening: hook that mentions the company name and role specifically
  - Middle: 2 paragraphs matching candidate experience to job needs
  - Closing: confident CTA, no "I look forward to hearing from you"
  - Never use: "I am writing to", "To whom it may concern", "I believe I am a great fit"
  - Tone: professional but human
  - Return ONLY the cover letter text, no subject line, no metadata
  `.trim();

  const text = await callGemini(prompt);
  if (!text) return null;

  const outputDir = path.join(__dirname, '../output/cover_letters');
  fs.mkdirSync(outputDir, { recursive: true });

  const slug = (s) => (s || 'unknown').toLowerCase().replace(/[^a-z0-9]+/g, '_').slice(0, 30);
  const date = new Date().toISOString().slice(0, 10);
  const filename = `${slug(jobContext.company)}_${slug(jobContext.title)}_${date}.txt`;
  const filepath = path.join(outputDir, filename);

  fs.writeFileSync(filepath, text, 'utf8');
  return { text, path: filepath };
}

// analyzeJobDescription — extracts skills, returns matchScore
async function analyzeJobDescription(rawJD, profile) {
  const prompt = `
Analyze this job description and return a JSON object only.

Job Description:
${(rawJD || '').slice(0, 2000)}

Candidate skills: ${(profile?.professional?.skills || []).join(', ')}

Return ONLY valid JSON in this exact shape (no markdown, no backticks):
{
  "requiredSkills": [],
  "preferredSkills": [],
  "keywords": [],
  "matchScore": 0,
  "missingSkills": [],
  "strongMatches": [],
  "seniorityLevel": "",
  "techStack": []
}

matchScore = integer 0-100 representing % of requiredSkills found in candidate skills.
  `.trim();

  const text = await callGemini(prompt);
  if (!text) return null;

  try {
    const clean = text.replace(/```json|```/g, '').trim();
    return JSON.parse(clean);
  } catch {
    console.error('⚠️  Failed to parse JD analysis JSON');
    return null;
  }
}

// tailorResume — returns tailored text (does not modify PDF)
async function tailorResume(profile, jobContext = {}, analysisResult = {}) {
  const matched = (analysisResult?.strongMatches || []).join(', ');
  const missing = (analysisResult?.missingSkills || []).join(', ');

  const prompt = `
You are helping tailor a resume summary for a specific job application.

Original summary: "${profile?.professional?.summary || ''}"
Candidate skills: ${(profile?.professional?.skills || []).join(', ')}

Target job: ${jobContext?.title || 'Role'} at ${jobContext?.company || 'Company'}
Strong skill matches: ${matched}
Skills to de-emphasize (candidate doesn't have): ${missing}
Required keywords from JD: ${(analysisResult?.keywords || []).slice(0, 10).join(', ')}

Tasks:
1. Rewrite the professional summary (2-3 lines) to naturally include the top JD keywords
2. List skills reordered to put strong matches first
3. List 2-3 experiences or projects to emphasize

Return ONLY valid JSON (no markdown):
{
  "tailoredSummary": "",
  "reorderedSkills": [],
  "emphasisSuggestions": []
}
  `.trim();

  const text = await callGemini(prompt);
  if (!text) return null;

  try {
    const clean = text.replace(/```json|```/g, '').trim();
    return JSON.parse(clean);
  } catch {
    console.error('⚠️  Failed to parse resume tailor JSON');
    return null;
  }
}

module.exports = { generateAnswer, generateCoverLetter, analyzeJobDescription, tailorResume };
