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
