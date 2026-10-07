// Login, registration, onboarding, password reset, logout.
import { q, sha256, randomToken, notify } from '../db.js';
import { send, redirect, readForm, field, safeNext, HttpError } from '../http.js';
import { hashPassword, verifyPassword, createSession, destroySession, rateLimit, requireUser, normalizePhone, phoneTaken, findUserByLogin } from '../auth.js';
import { sendEmail } from '../services.js';
import { page } from '../views/layout.js';
import { html, raw } from '../views/html.js';
import { icon, logoMark } from '../views/icons.js';
import { config } from '../env.js';

const TYPES = [
  ['student', 'cap', 'tile-success'],
  ['teacher', 'book', 'tile-info'],
  ['organization', 'building', 'tile-purple'],
];

function authShell(ctx, title, inner) {
  return page(ctx, {
    title, noindex: true,
    body: html`<main class="auth-wrap"><div class="auth-card stack">
      <div class="center stack-sm"><a href="/" style="display:inline-block">${logoMark(48)}</a><h1 style="font-size:1.8rem">${title}</h1></div>
      ${inner}</div></main>`,
  });
}

const errBox = (msg) => (msg ? html`<div class="alert alert-danger">${icon('alert', 'ic-sm')}<div>${msg}</div></div>` : '');

function typeChoices(ctx, selected) {
  const { t } = ctx;
  return html`<div class="stack-sm">${TYPES.map(([k, ic, tile]) => html`<label class="choice">
    <input type="radio" name="user_type" value="${k}" ${selected === k ? raw('checked') : ''} required>
    <span class="icon-tile ${tile}">${icon(ic)}</span><span class="grow"><span class="bold" style="display:block">${t('type_' + k)}</span><span class="small muted">${t('type_' + k + '_d')}</span></span></label>`)}</div>`;
}

// ─── Login ────────────────────────────────────────────────────────────────────
function loginForm(ctx, { error, login = '' } = {}) {
  const { t } = ctx;
  const next = safeNext(ctx.url.searchParams.get('next'), '');
  return authShell(ctx, t('login_title'), html`
    <div class="card card-pad stack">
      ${errBox(error)}
      <form method="post" action="/login${next ? `?next=${encodeURIComponent(next)}` : ''}" class="stack">
        <label class="field"><span>${t('email_or_phone')}</span><input class="input" name="login" value="${login}" required autocomplete="username" autocapitalize="none" spellcheck="false" placeholder="${t('email_or_phone_ph')}" autofocus></label>
        <label class="field"><span class="row between">${t('password')}<a href="/forgot" class="xs text-primary">${t('forgot_password')}</a></span><input class="input" type="password" name="password" required autocomplete="current-password"></label>
        <button class="btn btn-primary btn-block btn-lg">${t('login')}</button>
      </form>
    </div>
    <p class="center small muted">${t('no_account')} <a href="/register${next ? `?next=${encodeURIComponent(next)}` : ''}" class="text-primary bold">${t('register')}</a></p>`);
}

async function login(ctx) {
  const form = await readForm(ctx);
  const login = field(form, 'login', 200) || field(form, 'email', 200);
  const password = field(form, 'password', 200);
  rateLimit('login:' + (ctx.req.socket.remoteAddress || '') + login.toLowerCase(), 10);
  const user = findUserByLogin(login);
  if (!user || !verifyPassword(password, user.password_hash)) {
    return send(ctx, 401, loginForm(ctx, { error: ctx.t('bad_login'), login }));
  }
  createSession(ctx, user.id);
  redirect(ctx, safeNext(ctx.url.searchParams.get('next'), '/dashboard'));
}

// ─── Register ─────────────────────────────────────────────────────────────────
function registerForm(ctx, { error, values = {} } = {}) {
  const { t } = ctx;
  const next = safeNext(ctx.url.searchParams.get('next'), '');
  const type = values.user_type || ctx.url.searchParams.get('type') || 'student';
  return authShell(ctx, t('register_title'), html`
    <div class="card card-pad stack">
      ${errBox(error)}
      <form method="post" action="/register${next ? `?next=${encodeURIComponent(next)}` : ''}" class="stack">
        <label class="field"><span>${t('full_name')}</span><input class="input" name="full_name" value="${values.full_name || ''}" required maxlength="120" autocomplete="name"></label>
        <label class="field"><span>${t('email')}</span><input class="input" type="email" name="email" value="${values.email || ''}" required autocomplete="email"></label>
        <label class="field"><span>${t('phone')}</span><input class="input" type="tel" name="phone" value="${values.phone || ''}" maxlength="20" autocomplete="tel" placeholder="+998 90 123 45 67"><div class="hint">${t('phone_login_hint')}</div></label>
        <label class="field"><span>${t('password')}</span><input class="input" type="password" name="password" required minlength="8" autocomplete="new-password"><div class="hint">${t('password_hint')}</div></label>
        <div><span class="label">${t('who_are_you')}</span>${typeChoices(ctx, type)}</div>
        <label class="field" data-show-for="user_type" data-show-when="organization"><span>${t('organization_name')}</span><input class="input" name="organization_name" value="${values.organization_name || ''}" maxlength="150"></label>
        <button class="btn btn-primary btn-block btn-lg">${t('create_account')}</button>
        <p class="xs muted center">${t('agree_privacy')} <a href="/privacy" class="link">${t('privacy')}</a></p>
      </form>
    </div>
    <p class="center small muted">${t('have_account')} <a href="/login${next ? `?next=${encodeURIComponent(next)}` : ''}" class="text-primary bold">${t('login')}</a></p>`);
}

async function register(ctx) {
  const { t } = ctx;
  const form = await readForm(ctx);
  rateLimit('register:' + (ctx.req.socket.remoteAddress || ''), 20, 60 * 60 * 1000);
  const values = {
    full_name: field(form, 'full_name', 120), email: field(form, 'email', 200).toLowerCase(),
    user_type: field(form, 'user_type', 20), organization_name: field(form, 'organization_name', 150),
    phone: field(form, 'phone', 20),
  };
  const phone = normalizePhone(values.phone);
  const password = field(form, 'password', 200);
  let error;
  if (!values.full_name) error = t('err_name');
  else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(values.email)) error = t('err_email');
  else if (password.length < 8) error = t('password_hint');
  else if (!['student', 'teacher', 'organization'].includes(values.user_type)) error = t('err_type');
  else if (values.user_type === 'organization' && !values.organization_name) error = t('err_org_name');
  else if (values.user_type !== 'organization' && !values.phone) error = t('err_phone_required');
  else if (values.phone && !phone) error = t('err_phone');
  else if (q.get('SELECT id FROM users WHERE email = ?', values.email)) error = t('err_email_taken');
  else if (phoneTaken(phone)) error = t('err_phone_taken');
  if (error) return send(ctx, 400, registerForm(ctx, { error, values }));

  const firstUser = !q.get("SELECT id FROM users WHERE role = 'admin'");
  const id = q.insert('users', {
    email: values.email, password_hash: hashPassword(password), full_name: values.full_name,
    user_type: values.user_type, organization_name: values.organization_name || null, phone: phone || null,
    role: firstUser ? 'admin' : 'user',
  });
  if (values.user_type === 'teacher' && !firstUser) requestTeacherApproval(id, values.full_name);
  createSession(ctx, id);
  redirect(ctx, safeNext(ctx.url.searchParams.get('next'), '/dashboard'), { msg: t('welcome_msg', { name: values.full_name.split(' ')[0] }) });
}

export function requestTeacherApproval(userId, name) {
  q.run("INSERT OR IGNORE INTO teacher_profiles (user_id, is_visible) VALUES (?, 0)", userId);
  for (const a of q.all("SELECT id FROM users WHERE role = 'admin'")) {
    notify(a.id, { type: 'teacher_request', title: `Teacher approval: ${name}`, body: 'A new teacher account is waiting for approval.', link: '/admin/users?filter=pending' });
  }
}

// ─── Onboarding (users without an account type) ──────────────────────────────
function onboardingPage(ctx, error) {
  const { t } = ctx;
  requireUser(ctx);
  return send(ctx, 200, authShell(ctx, t('onboarding_title'), html`
    <p class="center muted">${t('onboarding_sub')}</p>
    <div class="card card-pad stack">${errBox(error)}
      <form method="post" action="/onboarding" class="stack">
        ${typeChoices(ctx, ctx.user.user_type || '')}
        <label class="field" data-show-for="user_type" data-show-when="organization"><span>${t('organization_name')}</span><input class="input" name="organization_name" maxlength="150"></label>
        <button class="btn btn-primary btn-block btn-lg">${t('continue')} ${icon('chevronRight', 'ic-sm')}</button>
      </form></div>`));
}

async function onboarding(ctx) {
  const user = requireUser(ctx);
  const form = await readForm(ctx);
  const type = field(form, 'user_type', 20);
  const org = field(form, 'organization_name', 150);
  if (!['student', 'teacher', 'organization'].includes(type)) return onboardingPage(ctx, ctx.t('err_type'));
  if (type === 'organization' && !org) return onboardingPage(ctx, ctx.t('err_org_name'));
  q.update('users', user.id, { user_type: type, organization_name: org || user.organization_name });
  if (type === 'teacher' && user.role === 'user') requestTeacherApproval(user.id, user.full_name);
  redirect(ctx, '/dashboard');
}

// ─── Password reset ───────────────────────────────────────────────────────────
function forgotPage(ctx, { sent, error } = {}) {
  const { t } = ctx;
  send(ctx, 200, authShell(ctx, t('reset_title'), html`<div class="card card-pad stack">
    ${sent ? html`<div class="alert alert-success">${icon('check', 'ic-sm')}<div>${t('reset_sent')}</div></div>` : errBox(error)}
    <form method="post" action="/forgot" class="stack">
      <label class="field"><span>${t('email_or_phone')}</span><input class="input" name="login" required autocapitalize="none" placeholder="${t('email_or_phone_ph')}"></label>
      <button class="btn btn-primary btn-block">${t('send_reset')}</button>
    </form></div><p class="center small"><a href="/login" class="text-primary">${t('back_to_login')}</a></p>`));
}

async function forgot(ctx) {
  const form = await readForm(ctx);
  rateLimit('forgot:' + (ctx.req.socket.remoteAddress || ''), 5);
  const user = findUserByLogin(field(form, 'login', 200) || field(form, 'email', 200));
  const email = user?.email;
  if (user) {
    const token = randomToken();
    q.run('INSERT INTO password_resets (token_hash, user_id, expires_at) VALUES (?, ?, ?)', sha256(token), user.id, new Date(Date.now() + 3600e3).toISOString());
    await sendEmail({ to: email, subject: 'Jumıs AI — password reset', text: `${user.full_name},\n\n${ctx.t('reset_email_body')}\n\n${config.siteUrl}/reset/${token}\n\nJumıs AI` });
  }
  forgotPage(ctx, { sent: true });
}

function resetRow(token) {
  return q.get('SELECT * FROM password_resets WHERE token_hash = ? AND expires_at > ?', sha256(token), new Date().toISOString());
}

function resetPage(ctx, error) {
  const { t } = ctx;
  if (!resetRow(ctx.params.token)) return forgotPage(ctx, { error: t('reset_invalid') });
  send(ctx, 200, authShell(ctx, t('new_password'), html`<div class="card card-pad stack">${errBox(error)}
    <form method="post" class="stack"><label class="field"><span>${t('new_password')}</span><input class="input" type="password" name="password" minlength="8" required autocomplete="new-password"><div class="hint">${t('password_hint')}</div></label>
    <button class="btn btn-primary btn-block">${t('save')}</button></form></div>`));
}

async function reset(ctx) {
  const row = resetRow(ctx.params.token);
  if (!row) return forgotPage(ctx, { error: ctx.t('reset_invalid') });
  const form = await readForm(ctx);
  const password = field(form, 'password', 200);
  if (password.length < 8) return resetPage(ctx, ctx.t('password_hint'));
  q.update('users', row.user_id, { password_hash: hashPassword(password) });
  q.run('DELETE FROM password_resets WHERE user_id = ?', row.user_id);
  q.run('DELETE FROM sessions WHERE user_id = ?', row.user_id);
  createSession(ctx, row.user_id);
  redirect(ctx, '/dashboard', { msg: ctx.t('password_changed') });
}

export default function (r) {
  r.get('/login', (ctx) => (ctx.user ? redirect(ctx, '/dashboard') : send(ctx, 200, loginForm(ctx))));
  r.post('/login', login);
  r.get('/register', (ctx) => (ctx.user ? redirect(ctx, '/dashboard') : send(ctx, 200, registerForm(ctx))));
  r.post('/register', register);
  r.post('/logout', (ctx) => { destroySession(ctx); redirect(ctx, '/'); });
  r.get('/onboarding', (ctx) => onboardingPage(ctx));
  r.post('/onboarding', onboarding);
  r.get('/forgot', (ctx) => forgotPage(ctx));
  r.post('/forgot', forgot);
  r.get('/reset/:token', (ctx) => resetPage(ctx));
  r.post('/reset/:token', reset);
}
