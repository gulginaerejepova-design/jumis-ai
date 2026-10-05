// Finds translation keys used in the code that are missing from src/strings.js
import fs from 'node:fs';
import path from 'node:path';
import { STRINGS } from '../src/strings.js';

const files = [];
(function walk(dir) {
  for (const f of fs.readdirSync(dir)) {
    const p = path.join(dir, f);
    if (fs.statSync(p).isDirectory()) walk(p);
    else if (p.endsWith('.js') && !p.endsWith('strings.js')) files.push(p);
  }
})('src');

const used = new Set();
for (const f of files) {
  const src = fs.readFileSync(f, 'utf8');
  for (const m of src.matchAll(/\bt\('([a-z0-9_]+)'/g)) used.add(m[1]);
  // keys inside ternaries: t(cond ? 'a' : 'b')
  for (const m of src.matchAll(/\bt\([^()]*?\?\s*'([a-z0-9_]+)'\s*:\s*'([a-z0-9_]+)'/g)) { used.add(m[1]); used.add(m[2]); }
}
// keys built dynamically: prefix + value
const dynamic = {
  ai_: ['cv_analysis', 'readiness', 'skill_gaps', 'matched_vacancies', 'recommended_courses', 'roadmap'],
  app_: ['submitted', 'reviewed', 'accepted', 'rejected', 'cancelled'],
  ctype_: ['video_explanation', 'useful_link', 'investor', 'event', 'news', 'support_info', 'director'],
  diff_: ['easy', 'medium', 'hard'], exp_: ['no_experience', 'junior', 'mid', 'senior', 'lead'],
  filter_: ['job_type', 'experience_level', 'organization', 'address'], job_: ['full_time', 'part_time', 'contract', 'internship', 'remote'],
  level_: ['beginner', 'intermediate', 'advanced'], ptab_: ['info', 'teaching', 'documents', 'purpose', 'schedule', 'activity'],
  role_: ['user', 'teacher', 'admin'], sub_: ['submitted', 'reviewed'], tab_: ['videos', 'links', 'investors', 'events', 'news', 'support', 'founders'],
  test_: ['lesson', 'level', 'final'], type_: ['student', 'teacher', 'organization', 'student_d', 'teacher_d', 'organization_d'],
  feat_: ['courses_t', 'courses_d', 'tests_t', 'tests_d', 'assign_t', 'assign_d', 'ai_t', 'ai_d', 'jobs_t', 'jobs_d', 'purpose_t', 'purpose_d'],
  how_: ['1', '1_d', '2', '2_d', '3', '3_d', '4', '4_d'], path_: ['1', '1_d', '2', '2_d', '3', '3_d', '4', '4_d'],
};
for (const [p, list] of Object.entries(dynamic)) { used.delete(p); list.forEach((k) => used.add(p + k)); }
for (const k of ['name', 'title', 'video_url', 'telegram_url', 'link', 'phone', 'contact', 'certificates_uploaded', 'awards']) used.add(k);

const missing = [...used].filter((k) => !STRINGS[k]).sort();
const incomplete = Object.entries(STRINGS).filter(([, v]) => !Array.isArray(v) || v.length !== 4 || v.some((s) => !s)).map(([k]) => k);
const unused = Object.keys(STRINGS).filter((k) => !used.has(k));
console.log(`Keys used: ${used.size} · defined: ${Object.keys(STRINGS).length}`);
if (missing.length) console.log('\nMISSING:', missing.join(', '));
if (incomplete.length) console.log('\nINCOMPLETE (need 4 languages):', incomplete.join(', '));
if (unused.length) console.log('\nUnused (safe to ignore):', unused.join(', '));
process.exit(missing.length || incomplete.length ? 1 : 0);
