// Passwords (scrypt) and cookie sessions stored in the database.
import crypto from 'node:crypto';
import { q, sha256, randomToken } from './db.js';
import { setCookie, HttpError } from './http.js';

const SESSION_DAYS = 30;

export function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 64, { N: 16384, r: 8, p: 1 });
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}

export function verifyPassword(password, stored) {
  const [alg, saltHex, hashHex] = String(stored).split('$');
  if (alg !== 'scrypt' || !saltHex || !hashHex) return false;
  const hash = crypto.scryptSync(password, Buffer.from(saltHex, 'hex'), 64, { N: 16384, r: 8, p: 1 });
  const expected = Buffer.from(hashHex, 'hex');
  return expected.length === hash.length && crypto.timingSafeEqual(expected, hash);
}

export function createSession(ctx, userId) {
  const token = randomToken();
  const expires = new Date(Date.now() + SESSION_DAYS * 864e5).toISOString();
  q.run('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)', sha256(token), userId, expires);
  setCookie(ctx, 'sid', token, { maxAge: SESSION_DAYS * 86400 });
}

export function destroySession(ctx) {
  if (ctx.cookies.sid) q.run('DELETE FROM sessions WHERE token_hash = ?', sha256(ctx.cookies.sid));
  setCookie(ctx, 'sid', '', { maxAge: 0 });
}

export function userFromSession(token) {
  if (!token) return null;
  const row = q.get(
    `SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ? AND s.expires_at > ?`,
    sha256(token), new Date().toISOString(),
  );
  if (!row) return null;
  delete row.password_hash;
  return row;
}

// Simple in-memory rate limiter for login / sensitive actions
const buckets = new Map();
export function rateLimit(key, max = 10, windowMs = 15 * 60 * 1000) {
  const nowMs = Date.now();
  const b = buckets.get(key) || { count: 0, reset: nowMs + windowMs };
  if (nowMs > b.reset) { b.count = 0; b.reset = nowMs + windowMs; }
  b.count++;
  buckets.set(key, b);
  if (b.count > max) throw new HttpError(429, 'Too many attempts. Please wait a few minutes.');
}

export const isAdmin = (u) => u?.role === 'admin';
export const isTeacher = (u) => u?.role === 'teacher' || u?.role === 'admin';
export const isOrg = (u) => u?.user_type === 'organization' || u?.role === 'admin';

export function requireUser(ctx) {
  if (!ctx.user) throw Object.assign(new HttpError(401), { next: ctx.url.pathname + ctx.url.search });
  return ctx.user;
}
export function requireRole(ctx, check) {
  requireUser(ctx);
  if (!check(ctx.user)) throw new HttpError(403);
  return ctx.user;
}

// ─── Phone numbers (login with email or phone) ───────────────────────────────
/** Normalize a phone to "+<digits>". 9 digits are treated as an Uzbek number (+998). Returns '' if invalid. */
export function normalizePhone(input) {
  let digits = String(input || '').replace(/\D/g, '');
  if (digits.length === 9) digits = '998' + digits;
  return digits.length >= 10 && digits.length <= 15 ? '+' + digits : '';
}

/** True when another account already uses this (normalized) phone */
export const phoneTaken = (phone, exceptUserId = null) =>
  Boolean(phone && q.get('SELECT id FROM users WHERE phone = ? AND id IS NOT ?', phone, exceptUserId));

/** Find a user by email, or by phone number when the login has no "@" */
export function findUserByLogin(login) {
  const value = String(login || '').trim();
  if (value.includes('@')) return q.get('SELECT * FROM users WHERE email = ?', value.toLowerCase());
  const phone = normalizePhone(value);
  if (!phone) return null;
  const rows = q.all('SELECT * FROM users WHERE phone = ? LIMIT 2', phone);
  return rows.length === 1 ? rows[0] : null;
}
