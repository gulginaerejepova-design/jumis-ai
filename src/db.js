// SQLite database (built into Node.js 22+). One file: DATA_DIR/jumis.db
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { config } from './env.js';

fs.mkdirSync(config.dataDir, { recursive: true });
export const db = new DatabaseSync(process.env.DB_FILE || path.join(config.dataDir, 'jumis.db'));
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');

const clean = (params) => params.map((p) => (p === undefined ? null : typeof p === 'boolean' ? (p ? 1 : 0) : p));

/** Query helpers */
export const q = {
  all: (sql, ...params) => db.prepare(sql).all(...clean(params)),
  get: (sql, ...params) => db.prepare(sql).get(...clean(params)),
  run: (sql, ...params) => db.prepare(sql).run(...clean(params)),
  /** Insert an object into a table, returns new id */
  insert(table, obj) {
    const keys = Object.keys(obj).filter((k) => obj[k] !== undefined);
    const sql = `INSERT INTO ${table} (${keys.join(',')}) VALUES (${keys.map(() => '?').join(',')})`;
    return Number(db.prepare(sql).run(...clean(keys.map((k) => obj[k]))).lastInsertRowid);
  },
  /** Update columns of one row by id */
  update(table, id, obj) {
    const keys = Object.keys(obj).filter((k) => obj[k] !== undefined);
    if (!keys.length) return;
    const sql = `UPDATE ${table} SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`;
    db.prepare(sql).run(...clean(keys.map((k) => obj[k])), id);
  },
  tx(fn) {
    db.exec('BEGIN');
    try { const r = fn(); db.exec('COMMIT'); return r; } catch (e) { db.exec('ROLLBACK'); throw e; }
  },
};

export const json = {
  parse(s, fallback) { try { return s ? JSON.parse(s) : fallback; } catch { return fallback; } },
};

export function slugify(text) {
  const map = { 'ı': 'i', 'ǵ': 'g', 'ń': 'n', 'ú': 'u', 'á': 'a', 'ó': 'o', "'": '', '’': '', 'ʻ': '', 'ʼ': '' };
  const cyr = 'а:a,б:b,в:v,г:g,д:d,е:e,ё:yo,ж:j,з:z,и:i,й:y,к:k,л:l,м:m,н:n,о:o,п:p,р:r,с:s,т:t,у:u,ф:f,х:x,ц:ts,ч:ch,ш:sh,щ:sh,ъ:,ы:i,ь:,э:e,ю:yu,я:ya,қ:q,ғ:g,ң:n,ү:u,ұ:u,ә:a,ө:o,ҳ:h,ў:o';
  const cmap = Object.fromEntries(cyr.split(',').map((p) => p.split(':')));
  let s = String(text || '').toLowerCase().split('').map((ch) => map[ch] ?? cmap[ch] ?? ch).join('');
  s = s.normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
  return s || 'item';
}

/** Unique slug for a table */
export function uniqueSlug(table, text, ignoreId = null) {
  const base = slugify(text);
  let slug = base;
  for (let i = 2; q.get(`SELECT id FROM ${table} WHERE slug = ? AND id IS NOT ?`, slug, ignoreId); i++) slug = `${base}-${i}`;
  return slug;
}

export const randomToken = (bytes = 32) => crypto.randomBytes(bytes).toString('base64url');
export const sha256 = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');
export const now = () => new Date().toISOString();

// ─── Schema ───────────────────────────────────────────────────────────────────
const migrations = [
  `
  CREATE TABLE users (
    id INTEGER PRIMARY KEY,
    email TEXT NOT NULL UNIQUE COLLATE NOCASE,
    password_hash TEXT NOT NULL,
    full_name TEXT NOT NULL DEFAULT '',
    role TEXT NOT NULL DEFAULT 'user',            -- admin | teacher | user
    user_type TEXT,                               -- student | teacher | organization (chosen at onboarding)
    organization_name TEXT,
    phone TEXT, id_number TEXT, bio TEXT, photo_url TEXT, cv_url TEXT,
    future_goals TEXT,
    open_to_work INTEGER NOT NULL DEFAULT 0,      -- lets organizations see the CV
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE user_files (
    id INTEGER PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    kind TEXT NOT NULL,                           -- certificate | award
    name TEXT NOT NULL, url TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE sessions (
    token_hash TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at TEXT NOT NULL
  );
  CREATE TABLE password_resets (
    token_hash TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at TEXT NOT NULL
  );
  CREATE TABLE teacher_profiles (
    user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    headline TEXT, bio TEXT, experience_years INTEGER, education TEXT, specialization TEXT,
    contact_email TEXT, contact_phone TEXT, linkedin TEXT, telegram TEXT, website TEXT,
    is_visible INTEGER NOT NULL DEFAULT 1
  );
  CREATE TABLE courses (
    id INTEGER PRIMARY KEY,
    slug TEXT NOT NULL UNIQUE,
    title TEXT NOT NULL, description TEXT, category TEXT, level TEXT, thumbnail_url TEXT,
    is_published INTEGER NOT NULL DEFAULT 0,
    owner_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE lessons (
    id INTEGER PRIMARY KEY,
    course_id INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
    title TEXT NOT NULL, description TEXT,
    video_type TEXT NOT NULL DEFAULT 'external',  -- upload | external
    file_url TEXT, external_url TEXT, duration TEXT,
    sort_order INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE lesson_materials (
    id INTEGER PRIMARY KEY,
    lesson_id INTEGER NOT NULL REFERENCES lessons(id) ON DELETE CASCADE,
    title TEXT NOT NULL, file_url TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE lesson_comments (
    id INTEGER PRIMARY KEY,
    lesson_id INTEGER NOT NULL REFERENCES lessons(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    comment TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE enrollments (
    id INTEGER PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    course_id INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
    id_number TEXT, phone TEXT,
    code_hash TEXT, code_expires_at TEXT, attempts INTEGER NOT NULL DEFAULT 0,
    verified INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(user_id, course_id)
  );
  CREATE TABLE lesson_progress (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    lesson_id INTEGER NOT NULL REFERENCES lessons(id) ON DELETE CASCADE,
    completed_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (user_id, lesson_id)
  );
  CREATE TABLE tests (
    id INTEGER PRIMARY KEY,
    course_id INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
    lesson_id INTEGER REFERENCES lessons(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    test_type TEXT NOT NULL DEFAULT 'lesson',     -- level | lesson | final
    time_limit_minutes INTEGER NOT NULL DEFAULT 15,
    pass_percent INTEGER NOT NULL DEFAULT 70
  );
  CREATE TABLE test_questions (
    id INTEGER PRIMARY KEY,
    test_id INTEGER NOT NULL REFERENCES tests(id) ON DELETE CASCADE,
    question TEXT NOT NULL, option_a TEXT, option_b TEXT, option_c TEXT, option_d TEXT,
    correct TEXT NOT NULL, topic TEXT, sort_order INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE test_results (
    id INTEGER PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    test_id INTEGER NOT NULL REFERENCES tests(id) ON DELETE CASCADE,
    score INTEGER NOT NULL, total INTEGER NOT NULL, percentage INTEGER NOT NULL,
    topic_scores TEXT, answers TEXT, ai_analysis TEXT, time_taken_seconds INTEGER,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE skill_questions (
    id INTEGER PRIMARY KEY,
    question TEXT NOT NULL, option_a TEXT, option_b TEXT, option_c TEXT, option_d TEXT,
    correct TEXT NOT NULL, category TEXT NOT NULL DEFAULT 'General', difficulty TEXT NOT NULL DEFAULT 'medium'
  );
  CREATE TABLE skill_results (
    id INTEGER PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    score INTEGER NOT NULL, total INTEGER NOT NULL,
    category_scores TEXT, answers TEXT, ai_analysis TEXT, time_taken_seconds INTEGER,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE assignments (
    id INTEGER PRIMARY KEY,
    course_id INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
    lesson_id INTEGER REFERENCES lessons(id) ON DELETE CASCADE,
    title TEXT NOT NULL, description TEXT, due_date TEXT,
    created_by INTEGER REFERENCES users(id) ON DELETE SET NULL
  );
  CREATE TABLE submissions (
    id INTEGER PRIMARY KEY,
    assignment_id INTEGER NOT NULL REFERENCES assignments(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    text_submission TEXT, file_url TEXT, ai_feedback TEXT,
    grade TEXT, teacher_comment TEXT,
    status TEXT NOT NULL DEFAULT 'submitted',     -- submitted | reviewed
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(assignment_id, user_id)
  );
  CREATE TABLE certificates (
    id INTEGER PRIMARY KEY,
    code TEXT NOT NULL UNIQUE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    course_id INTEGER REFERENCES courses(id) ON DELETE SET NULL,
    course_title TEXT NOT NULL,
    issued_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    file_url TEXT, score INTEGER,
    issued_date TEXT NOT NULL DEFAULT (date('now'))
  );
  CREATE TABLE schedules (
    id INTEGER PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    course_id INTEGER REFERENCES courses(id) ON DELETE SET NULL,
    title TEXT NOT NULL, scheduled_at TEXT NOT NULL, notes TEXT
  );
  CREATE TABLE vacancies (
    id INTEGER PRIMARY KEY,
    slug TEXT NOT NULL UNIQUE,
    owner_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    title TEXT NOT NULL, organization TEXT NOT NULL, description TEXT,
    job_type TEXT NOT NULL DEFAULT 'full_time',
    experience_level TEXT NOT NULL DEFAULT 'junior',
    address TEXT, salary TEXT, contact_email TEXT, deadline TEXT,
    is_active INTEGER NOT NULL DEFAULT 1,
    cancellation_reason TEXT, cancelled_at TEXT, cancelled_by INTEGER, ai_analysis TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE applications (
    id INTEGER PRIMARY KEY,
    vacancy_id INTEGER NOT NULL REFERENCES vacancies(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    cover_letter TEXT, cv_url TEXT,
    status TEXT NOT NULL DEFAULT 'submitted',     -- submitted | reviewed | accepted | rejected | cancelled
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(vacancy_id, user_id)
  );
  CREATE TABLE notifications (
    id INTEGER PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    type TEXT NOT NULL, title TEXT NOT NULL, body TEXT, link TEXT,
    is_read INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE connections (
    id INTEGER PRIMARY KEY,
    from_user INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    to_user INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    status TEXT NOT NULL DEFAULT 'pending',       -- pending | accepted
    message TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(from_user, to_user)
  );
  CREATE TABLE community_content (
    id INTEGER PRIMARY KEY,
    type TEXT NOT NULL,   -- video_explanation | useful_link | investor | event | news | director | support_info
    title TEXT NOT NULL, description TEXT, url TEXT, photo_url TEXT, platform TEXT,
    date TEXT, contact TEXT,
    is_active INTEGER NOT NULL DEFAULT 1, sort_order INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE ai_reports (
    id INTEGER PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    kind TEXT NOT NULL,   -- career | purpose
    result TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX idx_lessons_course ON lessons(course_id, sort_order);
  CREATE INDEX idx_notifications_user ON notifications(user_id, is_read);
  CREATE INDEX idx_vacancies_active ON vacancies(is_active, created_at);
  `,
];

export function migrate() {
  const version = db.prepare('PRAGMA user_version').get().user_version;
  for (let i = version; i < migrations.length; i++) {
    q.tx(() => {
      db.exec(migrations[i]);
      db.exec(`PRAGMA user_version = ${i + 1}`);
    });
  }
}
migrate();

/** Create an in-app notification */
export function notify(userId, { type, title, body = '', link = '' }) {
  q.insert('notifications', { user_id: userId, type, title, body, link });
}
