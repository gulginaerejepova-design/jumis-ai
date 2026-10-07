// Dashboard (per role), profile, documents, Purpose Space, connections, schedule, notifications.
import fs from 'node:fs';
import path from 'node:path';
import { q, notify, json } from '../db.js';
import { send, redirect, readForm, field, fileField, HttpError, sendJson } from '../http.js';
import { requireUser, isAdmin, isTeacher, hashPassword, verifyPassword, rateLimit, normalizePhone, phoneTaken } from '../auth.js';
import { askAI, saveUpload, uploadDir } from '../services.js';
import { page, pageHead } from '../views/layout.js';
import { html, raw, cx, markdown } from '../views/html.js';
import { icon } from '../views/icons.js';
import { courseCard, vacancyCard, statCard, emptyState, fmtDate, avatar, sectionTitle, percentColor } from '../views/components.js';
import { COURSE_SELECT, publishedCourses, activeVacancies } from './public.js';
import { courseProgress } from './learn.js';
import { requestTeacherApproval } from './auth.js';

// ─── Dashboard ────────────────────────────────────────────────────────────────
function dashboard(ctx) {
  const user = requireUser(ctx);
  let body;
  if (isAdmin(user)) body = adminHome(ctx);
  else if (user.user_type === 'organization') body = orgHome(ctx);
  else if (user.user_type === 'teacher' || user.role === 'teacher') body = teacherHome(ctx);
  else body = studentHome(ctx);
  send(ctx, 200, page(ctx, { title: ctx.t('nav_home'), body: html`<main class="page"><div class="container stack-lg">${body}</div></main>`, noindex: true }));
}

function welcome(ctx, text) {
  const { t, user } = ctx;
  return html`<div class="welcome"><h1 style="font-size:1.7rem">${t('welcome_back', { name: (user.full_name || '').split(' ')[0] || '' })}</h1><p class="muted" style="margin-top:6px">${text}</p></div>`;
}

function upcomingSchedule(userId, limit = 3) {
  const nowLocal = new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  return q.all('SELECT s.*, c.title course_title FROM schedules s LEFT JOIN courses c ON c.id = s.course_id WHERE s.user_id = ? AND s.scheduled_at >= ? ORDER BY s.scheduled_at LIMIT ?', userId, nowLocal, limit);
}

function studentHome(ctx) {
  const { t, user, lang } = ctx;
  const enrolled = q.all(`${COURSE_SELECT} JOIN enrollments e ON e.course_id = c.id AND e.user_id = ? AND e.verified = 1 ORDER BY e.created_at DESC`, user.id)
    .map((c) => ({ ...c, progress: courseProgress(user.id, c.id) }));
  const enrolledIds = new Set(enrolled.map((c) => c.id));
  const recommended = publishedCourses({ limit: 12 }).filter((c) => !enrolledIds.has(c.id)).slice(0, 3);
  const vacancies = activeVacancies({ limit: 4 });
  const results = q.all('SELECT r.*, t.title FROM test_results r JOIN tests t ON t.id = r.test_id WHERE r.user_id = ? ORDER BY r.id DESC LIMIT 3', user.id);
  const certs = q.get('SELECT COUNT(*) n FROM certificates WHERE user_id = ?', user.id).n;
  const avg = q.get('SELECT ROUND(AVG(percentage)) a FROM test_results WHERE user_id = ?', user.id).a;
  const upcoming = upcomingSchedule(user.id);
  const report = q.get("SELECT created_at FROM ai_reports WHERE user_id = ? AND kind = 'career' ORDER BY id DESC LIMIT 1", user.id);

  return html`
  ${welcome(ctx, t('student_welcome_sub'))}
  <div class="grid g4">
    ${statCard(t('my_courses'), enrolled.length, 'book', 'tile-primary', '#my-courses')}
    ${statCard(t('avg_score'), avg != null ? avg + '%' : '—', 'flask', 'tile-accent', '/profile?tab=activity')}
    ${statCard(t('certificates'), certs, 'award', 'tile-purple', '/profile?tab=documents')}
    ${statCard(t('upcoming_sessions'), upcoming.length, 'calendar', 'tile-info', '/profile?tab=schedule')}
  </div>
  <a href="/ai-assistant" class="card-soft card-pad row card-hover" style="flex-wrap:wrap">
    <div class="icon-tile tile-solid">${icon('sparkles')}</div>
    <div class="grow"><h3>${t('ai_cta_title')}</h3><p class="small muted">${report ? t('ai_cta_last', { date: fmtDate(report.created_at, lang) }) : t('ai_cta_sub')}</p></div>
    <span class="btn btn-ai btn-sm">${t(report ? 'open_report' : 'ai_analyze_btn')} ${icon('chevronRight', 'ic-sm')}</span>
  </a>
  <section id="my-courses">${sectionTitle(t('continue_learning'), 'play', 'tile-primary', { href: '/courses', label: t('all_courses') })}
    ${enrolled.length ? html`<div class="grid g3">${enrolled.map((c) => html`<a href="/learn/${c.slug}" class="card card-hover card-pad stack-sm">
      <div class="row"><div class="icon-tile tile-primary">${icon('book')}</div><div class="grow"><h3 class="clamp2" style="font-size:1rem">${c.title}</h3><div class="xs muted">${c.progress.done}/${c.progress.total} ${t('lessons_count')}</div></div></div>
      <div class="bar"><i style="width:${c.progress.percent}%"></i></div><div class="row between xs"><span class="muted">${t('your_progress')}</span><span class="bold text-primary">${c.progress.percent}%</span></div></a>`)}</div>`
      : html`<div class="card">${emptyState(t('no_enrolled'), 'book', html`<a href="/courses" class="btn btn-primary btn-sm">${t('browse_courses')}</a>`)}</div>`}
  </section>
  ${recommended.length ? html`<section>${sectionTitle(t('recommended_courses'), 'star', 'tile-accent', { href: '/courses', label: t('view_all') })}<div class="grid g3">${recommended.map((c) => courseCard(ctx, c))}</div></section>` : ''}
  <section>${sectionTitle(t('recommended_vacancies'), 'briefcase', 'tile-success', { href: '/vacancies', label: t('view_all') })}
    ${vacancies.length ? html`<div class="grid g2">${vacancies.map((v) => vacancyCard(ctx, v))}</div>` : html`<div class="card">${emptyState(t('no_vacancies'), 'briefcase')}</div>`}</section>
  <div class="grid g2">
    <section>${sectionTitle(t('upcoming_schedule'), 'calendar', 'tile-info', { href: '/profile?tab=schedule', label: t('manage') })}
      ${upcoming.length ? html`<div class="card divide">${upcoming.map((s) => html`<div class="list-item"><div class="icon-tile tile-info">${icon('calendar')}</div><div class="grow"><div class="bold small">${s.title}</div><div class="xs muted">${fmtDate(s.scheduled_at, lang, true)}${s.course_title ? ' · ' + s.course_title : ''}</div></div></div>`)}</div>`
        : html`<div class="card">${emptyState(t('no_schedule'), 'calendar', html`<a href="/profile?tab=schedule" class="btn btn-outline btn-sm">${icon('plus', 'ic-sm')}${t('add')}</a>`)}</div>`}</section>
    <section>${sectionTitle(t('recent_results'), 'flask', 'tile-purple', { href: '/skill-test', label: t('nav_skill_test') })}
      ${results.length ? html`<div class="card divide">${results.map((r) => html`<a href="/results/${r.id}" class="list-item"><span class="badge b-${percentColor(r.percentage)}" style="min-width:52px;justify-content:center">${r.percentage}%</span><div class="grow"><div class="bold small truncate">${r.title}</div><div class="xs muted">${r.score}/${r.total} · ${fmtDate(r.created_at, lang)}</div></div>${icon('chevronRight', 'ic-sm muted')}</a>`)}</div>`
        : html`<div class="card">${emptyState(t('no_results'), 'flask')}</div>`}</section>
  </div>`;
}

function teacherHome(ctx) {
  const { t, user, lang } = ctx;
  const pending = user.role !== 'teacher' && !isAdmin(user);
  const courses = q.all(`${COURSE_SELECT} WHERE c.owner_id = ? ORDER BY c.created_at DESC`, user.id);
  const students = q.get('SELECT COUNT(DISTINCT e.user_id) n FROM enrollments e JOIN courses c ON c.id = e.course_id WHERE c.owner_id = ? AND e.verified = 1', user.id).n;
  const toReview = q.all(`SELECT s.id, s.created_at, a.title, u.full_name, c.title course FROM submissions s JOIN assignments a ON a.id = s.assignment_id JOIN courses c ON c.id = a.course_id JOIN users u ON u.id = s.user_id
    WHERE c.owner_id = ? AND s.status = 'submitted' ORDER BY s.created_at DESC LIMIT 5`, user.id);
  const avg = q.get('SELECT ROUND(AVG(r.percentage)) a FROM test_results r JOIN tests t ON t.id = r.test_id JOIN courses c ON c.id = t.course_id WHERE c.owner_id = ?', user.id).a;
  return html`
  ${welcome(ctx, t('teacher_welcome_sub'))}
  ${pending ? html`<div class="alert alert-warn">${icon('clock')}<div><strong>${t('teacher_pending_title')}</strong><div class="small">${t('teacher_pending_text')}</div></div></div>` : ''}
  <div class="grid g4">
    ${statCard(t('my_courses'), courses.length, 'book', 'tile-primary', pending ? null : '/admin/courses')}
    ${statCard(t('students'), students, 'users', 'tile-info')}
    ${statCard(t('to_review'), toReview.length, 'clipboard', 'tile-accent', pending ? null : '/admin/submissions')}
    ${statCard(t('avg_score'), avg != null ? avg + '%' : '—', 'flask', 'tile-purple')}
  </div>
  ${!pending ? html`<div class="row-wrap"><a href="/admin/courses/new" class="btn btn-primary">${icon('plus', 'ic-sm')}${t('new_course')}</a><a href="/profile?tab=teaching" class="btn btn-outline">${icon('user', 'ic-sm')}${t('public_teacher_profile')}</a></div>` : ''}
  <section>${sectionTitle(t('my_courses'), 'book', 'tile-primary', pending ? null : { href: '/admin/courses', label: t('manage') })}
    ${courses.length ? html`<div class="grid g3">${courses.map((c) => courseCard(ctx, c))}</div>` : html`<div class="card">${emptyState(t('no_courses_teacher'), 'book')}</div>`}</section>
  <section>${sectionTitle(t('to_review'), 'clipboard', 'tile-accent', pending ? null : { href: '/admin/submissions', label: t('view_all') })}
    ${toReview.length ? html`<div class="card divide">${toReview.map((s) => html`<a href="/admin/submissions#s${s.id}" class="list-item"><div class="icon-tile tile-accent">${icon('file')}</div><div class="grow"><div class="bold small">${s.title}</div><div class="xs muted">${s.full_name} · ${s.course} · ${fmtDate(s.created_at, lang)}</div></div>${icon('chevronRight', 'ic-sm muted')}</a>`)}</div>`
      : html`<div class="card">${emptyState(t('nothing_to_review'), 'check')}</div>`}</section>`;
}

function orgHome(ctx) {
  const { t, user, lang } = ctx;
  const vacs = q.all('SELECT v.*, (SELECT COUNT(*) FROM applications a WHERE a.vacancy_id = v.id) apps FROM vacancies v WHERE v.owner_id = ? ORDER BY v.created_at DESC', user.id);
  const apps = q.all(`SELECT a.*, v.title vtitle, u.full_name, u.email FROM applications a JOIN vacancies v ON v.id = a.vacancy_id JOIN users u ON u.id = a.user_id WHERE v.owner_id = ? ORDER BY a.created_at DESC LIMIT 6`, user.id);
  const fresh = q.get(`SELECT COUNT(*) n FROM applications a JOIN vacancies v ON v.id = a.vacancy_id WHERE v.owner_id = ? AND a.status = 'submitted'`, user.id).n;
  const candidates = q.get("SELECT COUNT(*) n FROM users WHERE open_to_work = 1 AND cv_url IS NOT NULL AND user_type = 'student'").n;
  return html`
  <div class="welcome"><h1 style="font-size:1.7rem">${user.organization_name || user.full_name}</h1><p class="muted" style="margin-top:6px">${t('org_welcome_sub')}</p></div>
  <div class="grid g4">
    ${statCard(t('active_vacancies'), vacs.filter((v) => v.is_active).length, 'briefcase', 'tile-purple', '/org')}
    ${statCard(t('applications'), vacs.reduce((s, v) => s + v.apps, 0), 'file', 'tile-info', '/org/applications')}
    ${statCard(t('new_applications'), fresh, 'bell', 'tile-accent', '/org/applications')}
    ${statCard(t('open_candidates'), candidates, 'users', 'tile-success', '/org/candidates')}
  </div>
  <div class="row-wrap"><a href="/org/vacancies/new" class="btn btn-primary">${icon('plus', 'ic-sm')}${t('post_vacancy')}</a><a href="/org/candidates" class="btn btn-outline">${icon('users', 'ic-sm')}${t('browse_candidates')}</a></div>
  <section>${sectionTitle(t('my_vacancies'), 'briefcase', 'tile-purple', { href: '/org', label: t('manage') })}
    ${vacs.length ? html`<div class="card divide">${vacs.slice(0, 6).map((v) => html`<a href="/org/vacancies/${v.id}/applications" class="list-item"><div class="icon-tile tile-purple">${icon('briefcase')}</div><div class="grow"><div class="bold small">${v.title}</div><div class="xs muted">${v.address || ''}${v.deadline ? ' · ' + t('deadline') + ': ' + fmtDate(v.deadline, lang) : ''}</div></div>
      <span class="badge ${v.is_active ? 'b-success' : 'b-danger'}">${t(v.is_active ? 'active' : 'cancelled')}</span><span class="badge b-info">${v.apps} ${t('applications').toLowerCase()}</span></a>`)}</div>`
      : html`<div class="card">${emptyState(t('no_vacancies_org'), 'briefcase', html`<a href="/org/vacancies/new" class="btn btn-primary btn-sm">${t('post_vacancy')}</a>`)}</div>`}</section>
  <section>${sectionTitle(t('recent_applications'), 'file', 'tile-info', { href: '/org/applications', label: t('view_all') })}
    ${apps.length ? html`<div class="card divide">${apps.map((a) => html`<a href="/org/vacancies/${a.vacancy_id}/applications#a${a.id}" class="list-item">${avatar(a)}<div class="grow"><div class="bold small">${a.full_name}</div><div class="xs muted">${a.vtitle} · ${fmtDate(a.created_at, lang)}</div></div><span class="badge">${t('app_' + a.status)}</span></a>`)}</div>`
      : html`<div class="card">${emptyState(t('no_applications'), 'file')}</div>`}</section>`;
}

function adminHome(ctx) {
  const { t, lang } = ctx;
  const n = (sql) => q.get(sql).n;
  const pendingTeachers = n("SELECT COUNT(*) n FROM users WHERE user_type = 'teacher' AND role = 'user'");
  const recent = q.all('SELECT id, full_name, email, user_type, role, created_at FROM users ORDER BY id DESC LIMIT 6');
  return html`
  ${welcome(ctx, t('admin_welcome_sub'))}
  ${pendingTeachers ? html`<a href="/admin/users?filter=pending" class="alert alert-warn">${icon('bell')}<div><strong>${t('pending_teachers', { n: pendingTeachers })}</strong></div></a>` : ''}
  <div class="grid g4">
    ${statCard(t('stat_users'), n('SELECT COUNT(*) n FROM users'), 'users', 'tile-primary', '/admin/users')}
    ${statCard(t('nav_courses'), n('SELECT COUNT(*) n FROM courses'), 'book', 'tile-info', '/admin/courses')}
    ${statCard(t('active_vacancies'), n('SELECT COUNT(*) n FROM vacancies WHERE is_active = 1'), 'briefcase', 'tile-purple', '/admin/vacancies')}
    ${statCard(t('enrollments'), n('SELECT COUNT(*) n FROM enrollments WHERE verified = 1'), 'cap', 'tile-accent')}
    ${statCard(t('tests_taken'), n('SELECT COUNT(*) n FROM test_results') + n('SELECT COUNT(*) n FROM skill_results'), 'flask', 'tile-success')}
    ${statCard(t('applications'), n('SELECT COUNT(*) n FROM applications'), 'file', 'tile-info')}
    ${statCard(t('certificates'), n('SELECT COUNT(*) n FROM certificates'), 'award', 'tile-accent', '/admin/certificates')}
    ${statCard(t('to_review'), n("SELECT COUNT(*) n FROM submissions WHERE status = 'submitted'"), 'clipboard', 'tile-danger', '/admin/submissions')}
  </div>
  <div class="row-wrap"><a href="/admin" class="btn btn-primary">${icon('shield', 'ic-sm')}${t('nav_admin')}</a><a href="/admin/courses/new" class="btn btn-outline">${icon('plus', 'ic-sm')}${t('new_course')}</a><a href="/admin/vacancies/new" class="btn btn-outline">${icon('plus', 'ic-sm')}${t('post_vacancy')}</a><a href="/admin/community" class="btn btn-outline">${icon('handshake', 'ic-sm')}${t('nav_community')}</a></div>
  <section>${sectionTitle(t('new_users'), 'users', 'tile-primary', { href: '/admin/users', label: t('view_all') })}
    <div class="card divide">${recent.map((u) => html`<div class="list-item">${avatar(u)}<div class="grow"><div class="bold small">${u.full_name || u.email}</div><div class="xs muted">${u.email} · ${fmtDate(u.created_at, lang)}</div></div>${u.user_type ? html`<span class="badge">${t('type_' + u.user_type)}</span>` : ''}${u.role !== 'user' ? html`<span class="badge b-primary">${t('role_' + u.role)}</span>` : ''}</div>`)}</div></section>`;
}

// ─── Profile ──────────────────────────────────────────────────────────────────
const TABS = ['info', 'documents', 'purpose', 'schedule', 'activity'];

function profilePage(ctx) {
  const { t, lang } = ctx;
  const user = requireUser(ctx);
  const tabs = [...TABS];
  if (isTeacher(user) || user.user_type === 'teacher') tabs.splice(1, 0, 'teaching');
  const tab = tabs.includes(ctx.url.searchParams.get('tab')) ? ctx.url.searchParams.get('tab') : 'info';
  const tabIcons = { info: 'user', teaching: 'cap', documents: 'file', purpose: 'target', schedule: 'calendar', activity: 'trendUp' };
  let content;

  if (tab === 'info') {
    content = html`<form method="post" action="/profile" enctype="multipart/form-data" class="card card-pad stack">
      <div class="row" style="gap:18px">${avatar(user, 'avatar-lg')}<label class="file-drop grow">${icon('upload', 'ic-sm')}<span data-file-label>${t('change_photo')}</span><input type="file" name="photo" accept="image/*"></label></div>
      <div class="form-grid">
        <label class="field"><span>${t('full_name')}</span><input class="input" name="full_name" value="${user.full_name}" required maxlength="120"></label>
        <label class="field"><span>${t('email')}</span><input class="input" value="${user.email}" disabled></label>
        <label class="field"><span>${t('phone')}</span><input class="input" name="phone" value="${user.phone || ''}" maxlength="20"></label>
        <label class="field"><span>${t('id_number')}</span><input class="input" name="id_number" value="${user.id_number || ''}" maxlength="30"></label>
        ${user.user_type === 'organization' ? html`<label class="field full"><span>${t('organization_name')}</span><input class="input" name="organization_name" value="${user.organization_name || ''}" maxlength="150"></label>` : ''}
        <label class="field full"><span>${t('bio')}</span><textarea class="textarea" name="bio" rows="4" maxlength="3000" placeholder="${t('bio_ph')}">${user.bio || ''}</textarea><div class="hint">${t('bio_hint')}</div></label>
        <label class="field"><span>${t('account_type')}</span><select class="select" name="user_type">${['student', 'teacher', 'organization'].map((k) => html`<option value="${k}" ${user.user_type === k ? raw('selected') : ''}>${t('type_' + k)}</option>`)}</select></label>
        ${user.user_type !== 'organization' ? html`<label class="check" style="align-self:end;padding-bottom:10px"><input type="checkbox" name="open_to_work" value="1" ${user.open_to_work ? raw('checked') : ''}> ${t('open_to_work')}</label>` : ''}
      </div>
      <div><button class="btn btn-primary">${t('save_changes')}</button></div>
    </form>
    <form method="post" action="/profile/password" class="card card-pad stack" style="margin-top:20px">
      <h3>${t('change_password')}</h3>
      <div class="form-grid"><label class="field"><span>${t('current_password')}</span><input class="input" type="password" name="current" required autocomplete="current-password"></label>
      <label class="field"><span>${t('new_password')}</span><input class="input" type="password" name="password" minlength="8" required autocomplete="new-password"></label></div>
      <div><button class="btn btn-outline">${t('save')}</button></div>
    </form>`;
  } else if (tab === 'teaching') {
    const tp = q.get('SELECT * FROM teacher_profiles WHERE user_id = ?', user.id) || {};
    content = html`<form method="post" action="/profile/teaching" class="card card-pad stack">
      ${user.role === 'user' ? html`<div class="alert alert-warn">${icon('clock', 'ic-sm')}<div>${t('teacher_pending_text')}</div></div>` : ''}
      <div class="form-grid">
        <label class="field full"><span>${t('headline')}</span><input class="input" name="headline" value="${tp.headline || ''}" maxlength="140" placeholder="${t('headline_ph')}"></label>
        <label class="field"><span>${t('specialization')}</span><input class="input" name="specialization" value="${tp.specialization || ''}" maxlength="80"></label>
        <label class="field"><span>${t('experience_years')}</span><input class="input" type="number" min="0" max="70" name="experience_years" value="${tp.experience_years ?? ''}"></label>
        <label class="field full"><span>${t('education')}</span><input class="input" name="education" value="${tp.education || ''}" maxlength="200"></label>
        <label class="field full"><span>${t('about')}</span><textarea class="textarea" name="bio" rows="5" maxlength="4000">${tp.bio || ''}</textarea></label>
        <label class="field"><span>${t('contact_email')}</span><input class="input" type="email" name="contact_email" value="${tp.contact_email || ''}"></label>
        <label class="field"><span>${t('phone')}</span><input class="input" name="contact_phone" value="${tp.contact_phone || ''}"></label>
        <label class="field"><span>Telegram</span><input class="input" name="telegram" value="${tp.telegram || ''}" placeholder="@username"></label>
        <label class="field"><span>LinkedIn</span><input class="input" type="url" name="linkedin" value="${tp.linkedin || ''}" placeholder="https://"></label>
        <label class="field full"><span>${t('website')}</span><input class="input" type="url" name="website" value="${tp.website || ''}" placeholder="https://"></label>
        <label class="check full"><input type="checkbox" name="is_visible" value="1" ${tp.is_visible ? raw('checked') : ''} ${user.role === 'user' ? raw('disabled') : ''}> ${t('show_public_profile')}</label>
      </div>
      <div class="row"><button class="btn btn-primary">${t('save_changes')}</button>${tp.is_visible && user.role !== 'user' ? html`<a href="/teachers/${user.id}" class="btn btn-ghost">${icon('external', 'ic-sm')}${t('view_public')}</a>` : ''}</div>
    </form>`;
  } else if (tab === 'documents') {
    const files = q.all('SELECT * FROM user_files WHERE user_id = ? ORDER BY id DESC', user.id);
    const certs = q.all('SELECT * FROM certificates WHERE user_id = ? ORDER BY id DESC', user.id);
    const fileList = (kind) => {
      const list = files.filter((f) => f.kind === kind);
      return html`<div class="card"><div class="card-head"><h3>${t(kind === 'certificate' ? 'certificates_uploaded' : 'awards')}</h3></div>
        ${list.length ? html`<div class="divide">${list.map((f) => html`<div class="list-item"><div class="icon-tile ${kind === 'award' ? 'tile-accent' : 'tile-info'}">${icon(kind === 'award' ? 'star' : 'award')}</div><a href="${f.url}" target="_blank" rel="noopener" class="grow bold small">${f.name}</a>
          <form method="post" action="/profile/files/${f.id}/delete" data-confirm="${t('confirm_delete')}"><button class="btn btn-danger-ghost btn-xs">${icon('trash', 'ic-sm')}</button></form></div>`)}</div>` : html`<p class="muted small" style="padding:16px 20px">${t('nothing_yet')}</p>`}
        <form method="post" action="/profile/files" enctype="multipart/form-data" class="row-wrap" style="padding:16px 20px;border-top:1px solid var(--border)">
          <input type="hidden" name="kind" value="${kind}"><input class="input" name="name" required placeholder="${t('name')}" style="flex:1;min-width:160px">
          <label class="file-drop" style="flex:1;min-width:160px">${icon('upload', 'ic-sm')}<span data-file-label>${t('choose_file')}</span><input type="file" name="file" required accept=".pdf,.jpg,.jpeg,.png"></label>
          <button class="btn btn-primary btn-sm" data-busy="${t('uploading')}">${icon('plus', 'ic-sm')}${t('add')}</button></form></div>`;
    };
    content = html`<div class="stack">
      <div class="card card-pad stack-sm"><h3>${t('cv')}</h3>
        ${user.cv_url ? html`<div class="row card card-pad-sm"><div class="icon-tile tile-primary">${icon('file')}</div><span class="grow bold small">${t('cv_uploaded')}</span><a class="btn btn-outline btn-sm" href="${user.cv_url}" target="_blank" rel="noopener">${icon('eye', 'ic-sm')}${t('view')}</a>
          <form method="post" action="/profile/cv/delete" data-confirm="${t('confirm_delete')}"><button class="btn btn-danger-ghost btn-sm">${icon('trash', 'ic-sm')}</button></form></div>` : html`<p class="small muted">${t('cv_hint')}</p>`}
        <form method="post" action="/profile/cv" enctype="multipart/form-data" class="row-wrap"><label class="file-drop" style="flex:1">${icon('upload', 'ic-sm')}<span data-file-label>${t(user.cv_url ? 'replace_cv' : 'upload_cv')} (PDF, DOC)</span><input type="file" name="cv" required accept=".pdf,.doc,.docx"></label><button class="btn btn-primary btn-sm" data-busy="${t('uploading')}">${t('upload')}</button></form>
      </div>
      ${certs.length ? html`<div class="card"><div class="card-head"><h3>${t('course_certificates')}</h3></div><div class="divide">${certs.map((c) => html`<a href="/certificates/${c.code}" class="list-item"><div class="icon-tile tile-accent">${icon('award')}</div><div class="grow"><div class="bold small">${c.course_title}</div><div class="xs muted">${fmtDate(c.issued_date, lang)} · ${c.code}</div></div>${icon('chevronRight', 'ic-sm muted')}</a>`)}</div></div>` : ''}
      ${fileList('certificate')}${fileList('award')}
    </div>`;
  } else if (tab === 'purpose') {
    content = purposeSpace(ctx);
  } else if (tab === 'schedule') {
    const all = q.all('SELECT s.*, c.title course_title FROM schedules s LEFT JOIN courses c ON c.id = s.course_id WHERE s.user_id = ? ORDER BY s.scheduled_at', user.id);
    const nowLocal = new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16);
    const courses = q.all(`SELECT c.id, c.title FROM courses c LEFT JOIN enrollments e ON e.course_id = c.id AND e.user_id = ? WHERE c.is_published = 1 ORDER BY e.id IS NULL, c.title`, user.id);
    const editId = Number(ctx.url.searchParams.get('edit')) || null;
    const editing = all.find((s) => s.id === editId);
    const scheduleForm = (s) => html`<form method="post" action="${s ? `/schedule/${s.id}` : '/schedule'}" class="card card-pad stack">
      <h3>${t(s ? 'edit_schedule' : 'add_schedule')}</h3>
      <div class="form-grid"><label class="field full"><span>${t('title')}</span><input class="input" name="title" required maxlength="150" value="${s?.title || ''}" placeholder="${t('schedule_title_ph')}"></label>
        <label class="field"><span>${t('course')}</span><select class="select" name="course_id"><option value="">—</option>${courses.map((c) => html`<option value="${c.id}" ${s?.course_id === c.id ? raw('selected') : ''}>${c.title}</option>`)}</select></label>
        <label class="field"><span>${t('date_time')}</span><input class="input" type="datetime-local" name="scheduled_at" required value="${s?.scheduled_at || ''}"></label>
        <label class="field full"><span>${t('notes')}</span><textarea class="textarea" name="notes" rows="2" maxlength="500">${s?.notes || ''}</textarea></label></div>
      <div class="row"><button class="btn btn-primary">${t('save')}</button>${s ? html`<a href="/profile?tab=schedule" class="btn btn-ghost">${t('cancel')}</a>` : ''}</div></form>`;
    const upcoming = all.filter((s) => s.scheduled_at >= nowLocal);
    const past = all.filter((s) => s.scheduled_at < nowLocal);
    const row = (s, old) => html`<div class="list-item" style="${old ? 'opacity:.6' : ''}"><div class="icon-tile ${old ? '' : 'tile-info'}">${icon(old ? 'clock' : 'bell')}</div><div class="grow"><div class="bold small">${s.title}</div><div class="xs muted">${fmtDate(s.scheduled_at, lang, true)}${s.course_title ? ' · ' + s.course_title : ''}</div>${s.notes ? html`<div class="xs muted">${s.notes}</div>` : ''}</div>
      ${!old ? html`<a href="/profile?tab=schedule&edit=${s.id}" class="btn btn-ghost btn-xs">${icon('pencil', 'ic-sm')}</a>` : ''}<form method="post" action="/schedule/${s.id}/delete"><button class="btn btn-danger-ghost btn-xs" title="${t('delete')}">${icon('trash', 'ic-sm')}</button></form></div>`;
    content = html`<div class="stack">
      <div class="alert alert-info">${icon('bell', 'ic-sm')}<div class="grow">${t('reminder_info')}</div><button type="button" class="btn btn-primary btn-xs" data-ask-notify hidden>${t('enable_notifications')}</button></div>
      ${scheduleForm(editing)}
      <div class="card"><div class="card-head"><h3>${t('upcoming_schedule')}</h3></div>${upcoming.length ? html`<div class="divide">${upcoming.map((s) => row(s, false))}</div>` : html`<p class="muted small" style="padding:16px 20px">${t('no_schedule')}</p>`}</div>
      ${past.length ? html`<details class="acc"><summary>${t('past_schedule')} (${past.length})${icon('chevronDown', 'ic-sm chev')}</summary><div class="divide">${past.map((s) => row(s, true))}</div></details>` : ''}
    </div>`;
  } else if (tab === 'activity') {
    const results = q.all('SELECT r.*, t.title, t.test_type FROM test_results r JOIN tests t ON t.id = r.test_id WHERE r.user_id = ? ORDER BY r.id DESC LIMIT 30', user.id);
    const skills = q.all('SELECT * FROM skill_results WHERE user_id = ? ORDER BY id DESC LIMIT 10', user.id);
    const apps = q.all('SELECT a.*, v.title, v.organization, v.slug FROM applications a JOIN vacancies v ON v.id = a.vacancy_id WHERE a.user_id = ? ORDER BY a.id DESC', user.id);
    const appCls = { submitted: 'b-info', reviewed: 'b-accent', accepted: 'b-success', rejected: 'b-danger', cancelled: 'b-danger' };
    content = html`<div class="stack">
      <div class="card"><div class="card-head"><h3>${t('my_applications')}</h3></div>${apps.length ? html`<div class="divide">${apps.map((a) => html`<a href="/vacancies/${a.slug}" class="list-item"><div class="icon-tile tile-accent">${icon('briefcase')}</div><div class="grow"><div class="bold small">${a.title}</div><div class="xs muted">${a.organization} · ${fmtDate(a.created_at, lang)}</div></div><span class="badge ${appCls[a.status]}">${t('app_' + a.status)}</span></a>`)}</div>` : html`<p class="muted small" style="padding:16px 20px">${t('no_applications')}</p>`}</div>
      <div class="card"><div class="card-head"><h3>${t('test_results')}</h3></div>${results.length ? html`<div class="divide">${results.map((r) => html`<a href="/results/${r.id}" class="list-item"><span class="badge b-${percentColor(r.percentage)}" style="min-width:52px;justify-content:center">${r.percentage}%</span><div class="grow"><div class="bold small">${r.title}</div><div class="xs muted">${t('test_' + r.test_type)} · ${fmtDate(r.created_at, lang, true)}</div></div>${icon('chevronRight', 'ic-sm muted')}</a>`)}</div>` : html`<p class="muted small" style="padding:16px 20px">${t('no_results')}</p>`}</div>
      <div class="card"><div class="card-head"><h3>${t('nav_skill_test')}</h3><a href="/skill-test" class="btn btn-outline btn-xs">${t('take_test')}</a></div>${skills.length ? html`<div class="divide">${skills.map((r) => { const p = Math.round((r.score / r.total) * 100); return html`<a href="/skill-test/result/${r.id}" class="list-item"><span class="badge b-${percentColor(p)}" style="min-width:52px;justify-content:center">${p}%</span><div class="grow small">${r.score}/${r.total} ${t('correct')} · ${fmtDate(r.created_at, lang, true)}</div>${icon('chevronRight', 'ic-sm muted')}</a>`; })}</div>` : html`<p class="muted small" style="padding:16px 20px">${t('no_results')}</p>`}</div>
    </div>`;
  }

  const body = html`<main class="page"><div class="container">
    ${pageHead(t('my_profile'), t('profile_sub'))}
    <div class="layout-side">
      <nav class="card side-menu">${tabs.map((k) => html`<a href="/profile?tab=${k}" class="${cx(tab === k && 'on')}">${icon(tabIcons[k], 'ic-sm')}${t('ptab_' + k)}</a>`)}</nav>
      <div>${content}</div>
    </div></div></main>`;
  send(ctx, 200, page(ctx, { title: t('my_profile'), body, noindex: true }));
}

async function saveProfile(ctx) {
  const user = requireUser(ctx);
  const form = await readForm(ctx);
  const photo = fileField(form, 'photo');
  const type = field(form, 'user_type', 20);
  const data = {
    full_name: field(form, 'full_name', 120) || user.full_name, phone: field(form, 'phone', 20), id_number: field(form, 'id_number', 30),
    bio: field(form, 'bio', 3000), open_to_work: form.get('open_to_work') === '1' ? 1 : 0,
    organization_name: user.user_type === 'organization' ? field(form, 'organization_name', 150) || user.organization_name : user.organization_name,
  };
  if (['student', 'teacher', 'organization'].includes(type) && type !== user.user_type) {
    data.user_type = type;
    if (type === 'teacher' && user.role === 'user') requestTeacherApproval(user.id, data.full_name);
  }
  const rawPhone = data.phone;
  data.phone = normalizePhone(rawPhone) || null;
  if (rawPhone && !data.phone) return redirect(ctx, '/profile?tab=info', { type: 'error', msg: ctx.t('err_phone') });
  if (phoneTaken(data.phone, user.id)) return redirect(ctx, '/profile?tab=info', { type: 'error', msg: ctx.t('err_phone_taken') });
  if (photo) data.photo_url = await saveUpload(photo, 'image');
  q.update('users', user.id, data);
  redirect(ctx, '/profile?tab=info', { msg: ctx.t('profile_updated') });
}

async function changePassword(ctx) {
  const user = requireUser(ctx);
  const form = await readForm(ctx);
  rateLimit('pw:' + user.id, 10);
  const row = q.get('SELECT password_hash FROM users WHERE id = ?', user.id);
  if (!verifyPassword(field(form, 'current', 200), row.password_hash)) return redirect(ctx, '/profile?tab=info', { type: 'error', msg: ctx.t('wrong_password') });
  const pw = field(form, 'password', 200);
  if (pw.length < 8) return redirect(ctx, '/profile?tab=info', { type: 'error', msg: ctx.t('password_hint') });
  q.update('users', user.id, { password_hash: hashPassword(pw) });
  redirect(ctx, '/profile?tab=info', { msg: ctx.t('password_changed') });
}

async function saveTeaching(ctx) {
  const user = requireUser(ctx);
  if (!isTeacher(user) && user.user_type !== 'teacher') throw new HttpError(403);
  const form = await readForm(ctx);
  const f = (k, n = 300) => field(form, k, n) || null;
  const url = (k) => { const v = f(k); return v && /^https?:\/\//.test(v) ? v : null; };
  q.run(`INSERT INTO teacher_profiles (user_id, headline, bio, experience_years, education, specialization, contact_email, contact_phone, linkedin, telegram, website, is_visible)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET headline=excluded.headline, bio=excluded.bio, experience_years=excluded.experience_years, education=excluded.education,
    specialization=excluded.specialization, contact_email=excluded.contact_email, contact_phone=excluded.contact_phone, linkedin=excluded.linkedin, telegram=excluded.telegram, website=excluded.website, is_visible=excluded.is_visible`,
  user.id, f('headline', 140), f('bio', 4000), Number(field(form, 'experience_years', 3)) || null, f('education', 200), f('specialization', 80), f('contact_email', 200), f('contact_phone', 30), url('linkedin'), f('telegram', 60), url('website'),
  isTeacher(user) && form.get('is_visible') === '1' ? 1 : 0);
  redirect(ctx, '/profile?tab=teaching', { msg: ctx.t('saved') });
}

function removeLocalUpload(url) {
  if (url?.startsWith('/uploads/')) fs.promises.unlink(path.join(uploadDir, path.basename(url))).catch(() => {});
}

async function uploadCv(ctx) {
  const user = requireUser(ctx);
  const form = await readForm(ctx);
  const file = fileField(form, 'cv');
  if (!file) throw new HttpError(400, ctx.t('choose_file'));
  const url = await saveUpload(file, 'document');
  q.update('users', user.id, { cv_url: url });
  redirect(ctx, '/profile?tab=documents', { msg: ctx.t('saved') });
}

function deleteCv(ctx) {
  const user = requireUser(ctx);
  removeLocalUpload(user.cv_url);
  q.update('users', user.id, { cv_url: null });
  redirect(ctx, '/profile?tab=documents');
}

async function addFile(ctx) {
  const user = requireUser(ctx);
  const form = await readForm(ctx);
  const file = fileField(form, 'file');
  const kind = field(form, 'kind', 20) === 'award' ? 'award' : 'certificate';
  const name = field(form, 'name', 150);
  if (!file || !name) throw new HttpError(400, ctx.t('fill_required'));
  q.insert('user_files', { user_id: user.id, kind, name, url: await saveUpload(file, 'document') });
  redirect(ctx, '/profile?tab=documents', { msg: ctx.t('saved') });
}

function deleteFile(ctx) {
  const user = requireUser(ctx);
  const f = q.get('SELECT * FROM user_files WHERE id = ? AND user_id = ?', Number(ctx.params.id), user.id);
  if (f) { removeLocalUpload(f.url); q.run('DELETE FROM user_files WHERE id = ?', f.id); }
  redirect(ctx, '/profile?tab=documents');
}

// ─── Purpose Space (AI matching by goals) + connections ───────────────────────
function purposeSpace(ctx) {
  const { t, user } = ctx;
  const report = q.get("SELECT * FROM ai_reports WHERE user_id = ? AND kind = 'purpose' ORDER BY id DESC LIMIT 1", user.id);
  const matches = json.parse(report?.result, []);
  const ids = matches.map((m) => m.id);
  const people = ids.length ? q.all(`SELECT id, full_name, photo_url, user_type, bio FROM users WHERE id IN (${ids.map(() => '?').join(',')})`, ...ids) : [];
  const conns = q.all('SELECT * FROM connections WHERE from_user = ? OR to_user = ?', user.id, user.id);
  const connWith = (id) => conns.find((c) => (c.from_user === user.id && c.to_user === id) || (c.to_user === user.id && c.from_user === id));
  const incoming = q.all("SELECT c.*, u.full_name, u.photo_url, u.user_type, u.future_goals FROM connections c JOIN users u ON u.id = c.from_user WHERE c.to_user = ? AND c.status = 'pending' ORDER BY c.id DESC", user.id);
  const accepted = q.all(`SELECT c.id, u.id uid, u.full_name, u.photo_url, u.email, u.user_type, u.phone FROM connections c JOIN users u ON u.id = CASE WHEN c.from_user = ? THEN c.to_user ELSE c.from_user END
    WHERE (c.from_user = ? OR c.to_user = ?) AND c.status = 'accepted' ORDER BY c.id DESC`, user.id, user.id, user.id);

  return html`<div class="stack">
    <form method="post" action="/profile/goals" class="card card-pad stack">
      <div class="row">${icon('target', 'ic text-primary')}<h3>${t('purpose_title')}</h3></div>
      <p class="small muted">${t('purpose_sub')}</p>
      <textarea class="textarea" name="future_goals" rows="5" maxlength="2000" required placeholder="${t('purpose_ph')}">${user.future_goals || ''}</textarea>
      <div><button class="btn btn-ai" data-busy="${t('ai_analyzing')}">${icon('sparkles', 'ic-sm')}${t('purpose_btn')}</button></div>
    </form>
    ${incoming.length ? html`<div class="card"><div class="card-head"><h3>${t('connection_requests')}</h3><span class="badge b-accent">${incoming.length}</span></div><div class="divide">${incoming.map((c) => html`<div class="list-item" style="align-items:flex-start">${avatar(c)}<div class="grow"><div class="bold small">${c.full_name}</div>${c.user_type ? html`<span class="badge">${t('type_' + c.user_type)}</span>` : ''}${c.future_goals ? html`<p class="xs muted clamp2" style="margin-top:4px">${c.future_goals}</p>` : ''}${c.message ? html`<p class="xs" style="margin-top:4px">“${c.message}”</p>` : ''}</div>
      <form method="post" action="/connections/${c.id}/accept"><button class="btn btn-primary btn-xs">${icon('check', 'ic-sm')}${t('accept')}</button></form><form method="post" action="/connections/${c.id}/delete"><button class="btn btn-ghost btn-xs">${t('decline')}</button></form></div>`)}</div></div>` : ''}
    ${report ? html`<div class="card"><div class="card-head"><h3 class="row">${icon('sparkles', 'ic-sm text-primary')}${t('similar_people')}</h3><span class="xs muted">${fmtDate(report.created_at, ctx.lang, true)}</span></div>
      ${people.length ? html`<div class="divide">${matches.map((m) => { const p = people.find((x) => x.id === m.id); if (!p) return ''; const c = connWith(p.id); return html`<div class="list-item" style="align-items:flex-start">${avatar(p)}<div class="grow"><div class="bold small">${p.full_name}</div>${p.user_type ? html`<span class="badge">${t('type_' + p.user_type)}</span>` : ''}<p class="xs muted" style="margin-top:4px">🤖 ${m.reason}</p></div>
        ${c ? html`<span class="badge ${c.status === 'accepted' ? 'b-success' : 'b-info'}">${t(c.status === 'accepted' ? 'connected' : 'request_sent')}</span>` : html`<form method="post" action="/connections"><input type="hidden" name="to" value="${p.id}"><button class="btn btn-primary btn-xs">${icon('plus', 'ic-sm')}${t('connect')}</button></form>`}</div>`; })}</div>`
        : html`<p class="muted small" style="padding:16px 20px">${t('no_matches')}</p>`}</div>` : ''}
    <div class="card"><div class="card-head"><h3>${t('my_connections')}</h3><span class="badge">${accepted.length}</span></div>
      ${accepted.length ? html`<div class="divide">${accepted.map((c) => html`<div class="list-item">${avatar(c)}<div class="grow"><div class="bold small">${c.full_name}</div><div class="xs muted">${c.email}${c.phone ? ' · ' + c.phone : ''}</div></div><a href="mailto:${c.email}" class="btn btn-outline btn-xs">${icon('mail', 'ic-sm')}</a></div>`)}</div>` : html`<p class="muted small" style="padding:16px 20px">${t('no_connections')}</p>`}</div>
  </div>`;
}

/** Keyword overlap fallback when AI is not configured */
function keywordMatches(goals, others) {
  const words = (s) => new Set(String(s).toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w.length > 3));
  const mine = words(goals);
  return others.map((o) => {
    const theirs = words(o.future_goals);
    const common = [...mine].filter((w) => theirs.has(w));
    return { id: o.id, score: common.length / Math.max(1, Math.min(mine.size, theirs.size)), common };
  }).filter((m) => m.common.length).sort((a, b) => b.score - a.score).slice(0, 5)
    .map((m) => ({ id: m.id, reason: m.common.slice(0, 5).join(', ') }));
}

async function saveGoals(ctx) {
  const user = requireUser(ctx);
  const form = await readForm(ctx);
  const goals = field(form, 'future_goals', 2000);
  if (!goals) throw new HttpError(400, ctx.t('fill_required'));
  rateLimit('purpose:' + user.id, 15, 60 * 60 * 1000);
  q.update('users', user.id, { future_goals: goals });
  const others = q.all("SELECT id, full_name, user_type, future_goals FROM users WHERE id != ? AND future_goals IS NOT NULL AND future_goals != '' ORDER BY id DESC LIMIT 150", user.id);
  let matches = [];
  if (others.length) {
    try {
      const res = await askAI({
        lang: ctx.lang, json: true, maxTokens: 900,
        mock: () => ({ matches: keywordMatches(goals, others).concat(others.slice(0, 2).map((o) => ({ id: o.id, reason: 'Similar interests in learning and career growth.' }))) }),
        system: 'You match people on a learning platform by similar goals and interests.',
        prompt: `My goals: """${goals}"""\n\nOther users (id | type | goals):\n${others.map((o) => `${o.id} | ${o.user_type || 'user'} | ${o.future_goals.replace(/\s+/g, ' ').slice(0, 300)}`).join('\n')}\n\nPick up to 5 users whose goals are most similar or complementary to mine. Return JSON: {"matches":[{"id": number, "reason": "one short sentence why"}]}`,
      });
      const valid = new Set(others.map((o) => o.id));
      const seen = new Set();
      matches = (res.matches || []).filter((m) => valid.has(Number(m.id)) && !seen.has(Number(m.id)) && seen.add(Number(m.id))).slice(0, 5).map((m) => ({ id: Number(m.id), reason: String(m.reason || '').slice(0, 300) }));
    } catch (e) {
      if (e.code !== 'AI_NOT_CONFIGURED') console.error(e.message);
      matches = keywordMatches(goals, others);
    }
  }
  q.insert('ai_reports', { user_id: user.id, kind: 'purpose', result: JSON.stringify(matches) });
  redirect(ctx, '/profile?tab=purpose', { msg: ctx.t('matches_found', { n: matches.length }) });
}

async function connect(ctx) {
  const user = requireUser(ctx);
  const form = await readForm(ctx);
  const to = Number(field(form, 'to', 12));
  if (!to || to === user.id || !q.get('SELECT id FROM users WHERE id = ?', to)) throw new HttpError(400);
  rateLimit('connect:' + user.id, 30, 60 * 60 * 1000);
  const exists = q.get('SELECT id FROM connections WHERE (from_user = ? AND to_user = ?) OR (from_user = ? AND to_user = ?)', user.id, to, to, user.id);
  if (!exists) {
    q.insert('connections', { from_user: user.id, to_user: to, message: field(form, 'message', 300) || null });
    notify(to, { type: 'connection', title: `🤝 ${user.full_name}`, body: ctx.t('wants_to_connect'), link: '/profile?tab=purpose' });
  }
  redirect(ctx, ctx.req.headers.referer ? new URL(ctx.req.headers.referer).pathname + new URL(ctx.req.headers.referer).search : '/profile?tab=purpose', { msg: ctx.t('request_sent') });
}

function acceptConnection(ctx) {
  const user = requireUser(ctx);
  const c = q.get("SELECT * FROM connections WHERE id = ? AND to_user = ? AND status = 'pending'", Number(ctx.params.id), user.id);
  if (c) {
    q.run("UPDATE connections SET status = 'accepted' WHERE id = ?", c.id);
    notify(c.from_user, { type: 'connection', title: `🤝 ${user.full_name}`, body: ctx.t('accepted_connection'), link: '/profile?tab=purpose' });
  }
  redirect(ctx, '/profile?tab=purpose', { msg: ctx.t('connected') });
}

function deleteConnection(ctx) {
  const user = requireUser(ctx);
  q.run('DELETE FROM connections WHERE id = ? AND (from_user = ? OR to_user = ?)', Number(ctx.params.id), user.id, user.id);
  redirect(ctx, '/profile?tab=purpose');
}

// ─── Schedule ─────────────────────────────────────────────────────────────────
async function saveSchedule(ctx) {
  const user = requireUser(ctx);
  const form = await readForm(ctx);
  const data = {
    title: field(form, 'title', 150), scheduled_at: field(form, 'scheduled_at', 16),
    course_id: Number(field(form, 'course_id', 12)) || null, notes: field(form, 'notes', 500) || null,
  };
  if (!data.title || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(data.scheduled_at)) throw new HttpError(400, ctx.t('fill_required'));
  if (ctx.params.id) {
    const s = q.get('SELECT id FROM schedules WHERE id = ? AND user_id = ?', Number(ctx.params.id), user.id);
    if (!s) throw new HttpError(404);
    q.update('schedules', s.id, data);
  } else q.insert('schedules', { ...data, user_id: user.id });
  redirect(ctx, '/profile?tab=schedule', { msg: ctx.t('schedule_saved') });
}

function deleteSchedule(ctx) {
  const user = requireUser(ctx);
  q.run('DELETE FROM schedules WHERE id = ? AND user_id = ?', Number(ctx.params.id), user.id);
  redirect(ctx, '/profile?tab=schedule');
}

function scheduleApi(ctx) {
  const user = requireUser(ctx);
  // scheduled_at is the wall-clock time the user typed; send it back as-is so the browser reads it in its own timezone
  const nowLocal = new Date(Date.now() - new Date().getTimezoneOffset() * 60000 - 120000).toISOString().slice(0, 16);
  sendJson(ctx, 200, q.all('SELECT id, title, scheduled_at FROM schedules WHERE user_id = ? AND scheduled_at >= ? ORDER BY scheduled_at LIMIT 20', user.id, nowLocal));
}

// ─── Notifications ────────────────────────────────────────────────────────────
function notificationsPage(ctx) {
  const { t, lang } = ctx;
  const user = requireUser(ctx);
  const list = q.all('SELECT * FROM notifications WHERE user_id = ? ORDER BY id DESC LIMIT 100', user.id);
  q.run('UPDATE notifications SET is_read = 1 WHERE user_id = ? AND is_read = 0', user.id);
  ctx.unread = 0;
  const ic = { vacancy_cancelled: 'alert', application: 'file', application_status: 'briefcase', connection: 'users', certificate: 'award', submission: 'clipboard', review: 'check', teacher_request: 'cap', teacher_approved: 'cap', comment: 'message', enrolled: 'book' };
  const body = html`<main class="page"><div class="container narrow">
    ${pageHead(t('notifications'), '', list.length ? html`<form method="post" action="/notifications/clear" data-confirm="${t('confirm_delete')}"><button class="btn btn-ghost btn-sm">${icon('trash', 'ic-sm')}${t('clear_all')}</button></form>` : '')}
    ${list.length ? html`<div class="card divide">${list.map((n) => html`<a href="${n.link || '#'}" class="list-item" style="align-items:flex-start">
      <div class="icon-tile ${n.type === 'vacancy_cancelled' ? 'tile-danger' : 'tile-primary'}">${icon(ic[n.type] || 'bell')}</div>
      <div class="grow"><div class="bold small">${n.title}</div>${n.body ? html`<div class="small muted clamp3 pre">${n.body}</div>` : ''}<div class="xs muted" style="margin-top:4px">${fmtDate(n.created_at, lang, true)}</div></div>
      ${!n.is_read ? html`<span class="notice-dot" style="margin-top:8px"></span>` : ''}</a>`)}</div>` : html`<div class="card">${emptyState(t('no_notifications'), 'bell')}</div>`}
  </div></main>`;
  send(ctx, 200, page(ctx, { title: t('notifications'), body, noindex: true }));
}

export default function (r) {
  r.get('/dashboard', dashboard);
  r.get('/profile', profilePage);
  r.post('/profile', saveProfile);
  r.post('/profile/password', changePassword);
  r.post('/profile/teaching', saveTeaching);
  r.post('/profile/cv', uploadCv);
  r.post('/profile/cv/delete', deleteCv);
  r.post('/profile/files', addFile);
  r.post('/profile/files/:id/delete', deleteFile);
  r.post('/profile/goals', saveGoals);
  r.post('/connections', connect);
  r.post('/connections/:id/accept', acceptConnection);
  r.post('/connections/:id/delete', deleteConnection);
  r.post('/schedule', saveSchedule);
  r.post('/schedule/:id', saveSchedule);
  r.post('/schedule/:id/delete', deleteSchedule);
  r.get('/api/schedule', scheduleApi);
  r.get('/notifications', notificationsPage);
  r.post('/notifications/clear', (ctx) => { const u = requireUser(ctx); q.run('DELETE FROM notifications WHERE user_id = ?', u.id); redirect(ctx, '/notifications'); });
}
