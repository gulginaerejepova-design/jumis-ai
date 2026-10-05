// Request pipeline: static files → context (user, language, flash) → router → error pages.
import fs from 'node:fs';
import path from 'node:path';
import { parseCookies, send, setCookie, HttpError, redirect } from './http.js';
import { userFromSession } from './auth.js';
import { detectLang, translator } from './i18n.js';
import { q } from './db.js';
import { uploadDir } from './services.js';
import { page } from './views/layout.js';
import { html } from './views/html.js';
import { icon } from './views/icons.js';
import { config } from './env.js';

import publicRoutes from './routes/public.js';
import authRoutes from './routes/auth.js';
import learnRoutes from './routes/learn.js';
import profileRoutes from './routes/profile.js';
import careerRoutes from './routes/career.js';
import adminRoutes from './routes/admin.js';

// ─── Router ───────────────────────────────────────────────────────────────────
const routes = [];
const router = {
  get: (p, h) => add('GET', p, h),
  post: (p, h) => add('POST', p, h),
};
function add(method, pattern, handler) {
  const keys = [];
  const re = new RegExp('^' + pattern.replace(/\/:(\w+)/g, (_, k) => { keys.push(k); return '/([^/]+)'; }) + '/?$');
  routes.push({ method, re, keys, handler });
}
[publicRoutes, authRoutes, learnRoutes, profileRoutes, careerRoutes, adminRoutes].forEach((r) => r(router));

// ─── Static files ─────────────────────────────────────────────────────────────
const MIME = {
  '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif',
  '.ico': 'image/x-icon', '.pdf': 'application/pdf', '.mp4': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime',
  '.m4v': 'video/mp4', '.ogg': 'video/ogg', '.txt': 'text/plain; charset=utf-8', '.json': 'application/json',
  '.doc': 'application/msword', '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.ppt': 'application/vnd.ms-powerpoint', '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.xls': 'application/vnd.ms-excel', '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', '.zip': 'application/zip',
};
const publicDir = path.resolve('public');
const assetVersion = Date.now().toString(36);

function serveStatic(req, res, baseDir, rel, { cache, download } = {}) {
  const file = path.normalize(path.join(baseDir, rel));
  if (!file.startsWith(baseDir + path.sep)) return false;
  let stat;
  try { stat = fs.statSync(file); } catch { return false; }
  if (!stat.isFile()) return false;
  const ext = path.extname(file).toLowerCase();
  const type = MIME[ext] || 'application/octet-stream';
  const headers = {
    'Content-Type': type, 'X-Content-Type-Options': 'nosniff',
    'Cache-Control': cache || 'public, max-age=3600', 'Accept-Ranges': 'bytes',
  };
  if (download && !/^(image|video)\/|pdf/.test(type)) headers['Content-Disposition'] = 'attachment';
  // Range requests (needed for video seeking)
  const range = req.headers.range && /bytes=(\d*)-(\d*)/.exec(req.headers.range);
  if (range) {
    const start = range[1] ? Number(range[1]) : 0;
    const end = range[2] ? Math.min(Number(range[2]), stat.size - 1) : stat.size - 1;
    if (start >= stat.size || start > end) { res.writeHead(416, { 'Content-Range': `bytes */${stat.size}` }); res.end(); return true; }
    res.writeHead(206, { ...headers, 'Content-Range': `bytes ${start}-${end}/${stat.size}`, 'Content-Length': end - start + 1 });
    fs.createReadStream(file, { start, end }).pipe(res);
    return true;
  }
  res.writeHead(200, { ...headers, 'Content-Length': stat.size });
  if (req.method === 'HEAD') { res.end(); return true; }
  fs.createReadStream(file).pipe(res);
  return true;
}

// ─── Main handler ─────────────────────────────────────────────────────────────
export async function handle(req, res) {
  const url = new URL(req.url, 'http://localhost');
  const pathname = decodeURIComponent(url.pathname);

  if (req.method === 'GET' || req.method === 'HEAD') {
    if (pathname.startsWith('/public/') && serveStatic(req, res, publicDir, pathname.slice(8), { cache: 'public, max-age=604800' })) return;
    if (pathname.startsWith('/uploads/') && serveStatic(req, res, uploadDir, pathname.slice(9), { cache: 'public, max-age=86400', download: true })) return;
    if (pathname === '/favicon.ico') return serveStatic(req, res, publicDir, 'img/favicon.ico') || (res.writeHead(204), res.end());
  }

  const cookies = parseCookies(req.headers.cookie);
  const lang = detectLang(cookies, url.searchParams, req.headers['accept-language']);
  const ctx = {
    req, res, url, path: pathname, method: req.method === 'HEAD' ? 'GET' : req.method, cookies, setCookies: [],
    lang, t: translator(lang), params: {}, assetVersion,
  };
  if (url.searchParams.get('lang') && url.searchParams.get('lang') !== cookies.lang) setCookie(ctx, 'lang', lang, { maxAge: 31536000 });

  try {
    ctx.user = userFromSession(cookies.sid);
    if (ctx.user) ctx.unread = q.get('SELECT COUNT(*) n FROM notifications WHERE user_id = ? AND is_read = 0', ctx.user.id).n;
    if (cookies.flash) {
      try { ctx.flash = JSON.parse(cookies.flash); } catch {}
      setCookie(ctx, 'flash', '', { maxAge: 0 });
    }

    // CSRF protection: POSTs must come from our own site
    if (ctx.method === 'POST') {
      const origin = req.headers.origin;
      const host = req.headers['x-forwarded-host'] || req.headers.host;
      if (origin && new URL(origin).host !== host) throw new HttpError(403, 'Cross-site request blocked');
    }

    // New users choose their account type first
    if (ctx.user && !ctx.user.user_type && ctx.user.role !== 'admin' && !['/onboarding', '/logout'].includes(pathname)
      && !pathname.startsWith('/lang/') && ctx.method === 'GET') {
      return redirect(ctx, '/onboarding');
    }

    for (const r of routes) {
      if (r.method !== ctx.method) continue;
      const m = r.re.exec(pathname);
      if (!m) continue;
      r.keys.forEach((k, i) => { ctx.params[k] = m[i + 1]; });
      await r.handler(ctx);
      if (!res.headersSent) send(ctx, 204, '');
      return;
    }
    throw new HttpError(404);
  } catch (err) {
    if (res.headersSent) { console.error(err); return; }
    const status = err.status || 500;
    if (status === 401) return redirect(ctx, `/login?next=${encodeURIComponent(err.next || pathname)}`);
    if (status >= 500) console.error(`[${new Date().toISOString()}] ${req.method} ${req.url}\n`, err);
    // Form errors (400/413/429) go back with a message when possible
    if ([400, 413, 429].includes(status) && ctx.method === 'POST' && req.headers.referer) {
      return redirect(ctx, new URL(req.headers.referer).pathname + new URL(req.headers.referer).search, { type: 'error', msg: err.message });
    }
    const titles = { 403: ctx.t('err_403'), 404: ctx.t('err_404'), 413: err.message, 429: err.message };
    const body = html`<main class="page"><div class="container narrow">
      <div class="card card-pad center stack" style="padding:56px 24px">
        <div class="icon-tile tile-primary" style="margin:0 auto;width:64px;height:64px;border-radius:20px">${icon(status === 404 ? 'search' : 'alert', 'ic-lg')}</div>
        <h1>${status}</h1>
        <p class="muted">${titles[status] || (config.isProd ? ctx.t('err_500') : err.message)}</p>
        <div><a href="/" class="btn btn-primary">${ctx.t('go_home')}</a></div>
      </div></div></main>`;
    send(ctx, status, page(ctx, { title: String(status), body, noindex: true }));
  }
}
