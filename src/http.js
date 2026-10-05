// Request/response helpers built on Node's http module.
import { Readable } from 'node:stream';
import { config } from './env.js';

export class HttpError extends Error {
  constructor(status, message = '') { super(message); this.status = status; }
}

export function parseCookies(header = '') {
  const out = {};
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    try { out[k] = decodeURIComponent(part.slice(i + 1).trim()); } catch { out[k] = part.slice(i + 1).trim(); }
  }
  return out;
}

export function isSecure(req) {
  return req.headers['x-forwarded-proto'] === 'https' || config.siteUrl.startsWith('https://');
}

export function setCookie(ctx, name, value, { maxAge, httpOnly = true } = {}) {
  const parts = [`${name}=${encodeURIComponent(value)}`, 'Path=/', 'SameSite=Lax'];
  if (httpOnly) parts.push('HttpOnly');
  if (isSecure(ctx.req)) parts.push('Secure');
  if (maxAge !== undefined) parts.push(`Max-Age=${maxAge}`);
  ctx.setCookies.push(parts.join('; '));
}

/**
 * Parse the request body (urlencoded or multipart) using Node's built-in fetch Request parser.
 * Returns a FormData object (values are strings or File objects).
 */
export async function readForm(ctx) {
  if (ctx._form) return ctx._form;
  const { req } = ctx;
  const len = Number(req.headers['content-length'] || 0);
  const limit = config.maxUploadMb * 1024 * 1024;
  if (len > limit) throw new HttpError(413, `Upload too large (max ${config.maxUploadMb} MB)`);
  const type = req.headers['content-type'] || '';
  if (!type.includes('multipart/form-data') && !type.includes('application/x-www-form-urlencoded')) {
    ctx._form = new FormData();
    return ctx._form;
  }
  let received = 0;
  const guarded = Readable.from((async function* () {
    for await (const chunk of req) {
      received += chunk.length;
      if (received > limit) throw new HttpError(413, `Upload too large (max ${config.maxUploadMb} MB)`);
      yield chunk;
    }
  })());
  const request = new Request('http://local' + req.url, {
    method: req.method, headers: { 'content-type': type }, body: Readable.toWeb(guarded), duplex: 'half',
  });
  ctx._form = await request.formData();
  return ctx._form;
}

/** Convenience: get a trimmed string field */
export const field = (form, name, max = 20000) => {
  const v = form.get(name);
  return typeof v === 'string' ? v.trim().slice(0, max) : '';
};
/** File field if a non-empty file was uploaded */
export const fileField = (form, name) => {
  const v = form.get(name);
  return v && typeof v === 'object' && v.size > 0 ? v : null;
};

export function send(ctx, status, body, headers = {}) {
  const { res } = ctx;
  if (ctx.setCookies.length) res.setHeader('Set-Cookie', ctx.setCookies);
  res.writeHead(status, {
    'Content-Type': 'text/html; charset=utf-8',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'X-Frame-Options': 'SAMEORIGIN',
    ...headers,
  });
  res.end(body);
}

export function redirect(ctx, location, flash) {
  if (flash) setCookie(ctx, 'flash', JSON.stringify(flash), { maxAge: 60 });
  send(ctx, 303, '', { Location: location });
}

export function sendJson(ctx, status, data) {
  send(ctx, status, JSON.stringify(data), { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
}

/** Safe redirect target (only local paths) */
export function safeNext(next, fallback = '/dashboard') {
  return typeof next === 'string' && next.startsWith('/') && !next.startsWith('//') ? next : fallback;
}
