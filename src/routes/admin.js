// Admin & teacher panel: courses, lessons, tests, questions, assignments, submissions, certificates, users, community.
import crypto from 'node:crypto';
import { q, notify, uniqueSlug } from '../db.js';
import { send, redirect, readForm, field, fileField, HttpError } from '../http.js';
import { requireRole, isAdmin, isTeacher } from '../auth.js';
import { askAI, aiConfigured, saveUpload } from '../services.js';
import { panelPage } from '../views/panel.js';
import { html, raw, cx, markdown } from '../views/html.js';
import { icon } from '../views/icons.js';
import { emptyState, fmtDate, avatar, statCard } from '../views/components.js';
import { COURSE_SELECT } from './public.js';
import { courseProgress } from './learn.js';

const staff = (ctx) => requireRole(ctx, isTeacher);
const admin = (ctx) => requireRole(ctx, isAdmin);
const back = (ctx, fallback) => (ctx.req.headers.referer ? new URL(ctx.req.headers.referer).pathname + new URL(ctx.req.headers.referer).search : fallback);

function ownCourse(ctx, id) {
  const c = q.get('SELECT * FROM courses WHERE id = ?', Number(id));
  if (!c || !(isAdmin(ctx.user) || c.owner_id === ctx.user.id)) throw new HttpError(404);
  return c;
}
const courseFilter = (ctx, alias = 'c') => (isAdmin(ctx.user) ? ['1 = 1', []] : [`${alias}.owner_id = ?`, [ctx.user.id]]);

// ─── Overview ─────────────────────────────────────────────────────────────────
function overview(ctx) {
  const { t, lang } = ctx;
  staff(ctx);
  const [w, p] = courseFilter(ctx);
  const n = (sql, ...a) => q.get(sql, ...a).n;
  const courses = n(`SELECT COUNT(*) n FROM courses c WHERE ${w}`, ...p);
  const lessons = n(`SELECT COUNT(*) n FROM lessons l JOIN courses c ON c.id = l.course_id WHERE ${w}`, ...p);
  const students = n(`SELECT COUNT(DISTINCT e.user_id) n FROM enrollments e JOIN courses c ON c.id = e.course_id WHERE e.verified = 1 AND ${w}`, ...p);
  const pending = n(`SELECT COUNT(*) n FROM submissions s JOIN assignments a ON a.id = s.assignment_id JOIN courses c ON c.id = a.course_id WHERE s.status = 'submitted' AND ${w}`, ...p);
  const latest = q.all(`SELECT r.percentage, r.created_at, u.full_name, t.title FROM test_results r JOIN tests t ON t.id = r.test_id JOIN courses c ON c.id = t.course_id JOIN users u ON u.id = r.user_id WHERE ${w} ORDER BY r.id DESC LIMIT 8`, ...p);
  const content = html`
    <div class="grid g4">${statCard(t('nav_courses'), courses, 'book', 'tile-primary', '/admin/courses')}${statCard(t('lessons'), lessons, 'play', 'tile-info')}${statCard(t('students'), students, 'users', 'tile-success')}${statCard(t('to_review'), pending, 'clipboard', 'tile-accent', '/admin/submissions')}</div>
    ${!aiConfigured() ? html`<div class="alert alert-warn">${icon('alert')}<div>${t('ai_not_configured')}</div></div>` : ''}
    <div class="card"><div class="card-head"><h3>${t('latest_test_results')}</h3></div>${latest.length ? html`<div class="divide">${latest.map((r) => html`<div class="list-item"><span class="badge ${r.percentage >= 70 ? 'b-success' : r.percentage >= 40 ? 'b-accent' : 'b-danger'}" style="min-width:52px;justify-content:center">${r.percentage}%</span><div class="grow"><div class="bold small">${r.full_name}</div><div class="xs muted">${r.title} · ${fmtDate(r.created_at, lang, true)}</div></div></div>`)}</div>` : html`<p class="muted small" style="padding:16px 20px">${t('no_results')}</p>`}</div>`;
  send(ctx, 200, panelPage(ctx, { base: '/admin', active: 'overview', title: t('overview'), content, actions: html`<a href="/admin/courses/new" class="btn btn-primary">${icon('plus', 'ic-sm')}${t('new_course')}</a>` }));
}

// ─── Courses ──────────────────────────────────────────────────────────────────
function coursesPage(ctx) {
  const { t } = ctx;
  staff(ctx);
  const [w, p] = courseFilter(ctx);
  const list = q.all(`${COURSE_SELECT} WHERE ${w} ORDER BY c.created_at DESC`, ...p);
  const enrolled = new Map(q.all('SELECT course_id, COUNT(*) n FROM enrollments WHERE verified = 1 GROUP BY course_id').map((r) => [r.course_id, r.n]));
  const content = list.length ? html`<div class="card divide">${list.map((c) => html`<div class="list-item" style="flex-wrap:wrap">
    <div class="icon-tile tile-primary">${icon('book')}</div>
    <div class="grow"><a href="/admin/courses/${c.id}" class="bold">${c.title}</a><div class="xs muted">${c.lesson_count} ${t('lessons_count')} · ${enrolled.get(c.id) || 0} ${t('students_count')}${c.category ? ' · ' + c.category : ''}${isAdmin(ctx.user) && c.teacher_name ? ' · ' + c.teacher_name : ''}</div></div>
    <span class="badge ${c.is_published ? 'b-success' : ''}">${icon(c.is_published ? 'eye' : 'eyeOff', 'ic-sm')}${t(c.is_published ? 'published' : 'hidden')}</span>
    <a href="/admin/courses/${c.id}" class="btn btn-outline btn-xs">${icon('pencil', 'ic-sm')}${t('manage')}</a>
    <a href="/courses/${c.slug}" class="btn btn-ghost btn-xs">${icon('external', 'ic-sm')}</a></div>`)}</div>`
    : html`<div class="card">${emptyState(t('no_courses_teacher'), 'book', html`<a href="/admin/courses/new" class="btn btn-primary btn-sm">${t('new_course')}</a>`)}</div>`;
  send(ctx, 200, panelPage(ctx, { base: '/admin', active: 'courses', title: t('nav_courses'), content, actions: html`<a href="/admin/courses/new" class="btn btn-primary">${icon('plus', 'ic-sm')}${t('new_course')}</a>` }));
}

function courseFields(ctx, c = {}) {
  const { t } = ctx;
  return html`<div class="form-grid">
    <label class="field full"><span>${t('course_name')} *</span><input class="input" name="title" required maxlength="150" value="${c.title || ''}"></label>
    <label class="field full"><span>${t('description')}</span><textarea class="textarea" name="description" rows="5" maxlength="6000">${c.description || ''}</textarea><div class="hint">${t('markdown_hint')}</div></label>
    <label class="field"><span>${t('category')}</span><input class="input" name="category" maxlength="60" value="${c.category || ''}" placeholder="${t('category_ph')}" list="cats"></label>
    <label class="field"><span>${t('level')}</span><select class="select" name="level">${['', 'beginner', 'intermediate', 'advanced'].map((l) => html`<option value="${l}" ${(c.level || '') === l ? raw('selected') : ''}>${l ? t('level_' + l) : '—'}</option>`)}</select></label>
    <label class="field"><span>${t('thumbnail_url')}</span><input class="input" type="url" name="thumbnail_url" value="${c.thumbnail_url?.startsWith('http') ? c.thumbnail_url : ''}" placeholder="https://..."></label>
    <label class="field"><span>${t('or_upload_image')}</span><label class="file-drop">${icon('upload', 'ic-sm')}<span data-file-label>${c.thumbnail_url?.startsWith('/uploads') ? t('replace_image') : t('choose_file')}</span><input type="file" name="thumbnail" accept="image/*"></label></label>
    <label class="check full"><input type="checkbox" name="is_published" value="1" ${c.is_published ? raw('checked') : ''}> ${t('publish_course')}</label>
  </div>
  <datalist id="cats">${q.all("SELECT DISTINCT category FROM courses WHERE category != ''").map((r) => html`<option value="${r.category}">`)}</datalist>`;
}

function newCourse(ctx) {
  const { t } = ctx;
  staff(ctx);
  const content = html`<form method="post" action="/admin/courses/new" enctype="multipart/form-data" class="card card-pad stack">${courseFields(ctx)}<div><button class="btn btn-primary">${t('create')}</button></div></form>`;
  send(ctx, 200, panelPage(ctx, { base: '/admin', active: 'courses', title: t('new_course'), content }));
}

async function courseData(ctx, form, existing) {
  const thumb = fileField(form, 'thumbnail');
  return {
    title: field(form, 'title', 150), description: field(form, 'description', 6000) || null, category: field(form, 'category', 60) || null,
    level: ['beginner', 'intermediate', 'advanced'].includes(field(form, 'level')) ? field(form, 'level') : null,
    thumbnail_url: thumb ? await saveUpload(thumb, 'image') : (field(form, 'thumbnail_url', 500) || (existing?.thumbnail_url?.startsWith('/uploads') ? existing.thumbnail_url : null)),
    is_published: form.get('is_published') === '1' ? 1 : 0,
  };
}

async function createCourse(ctx) {
  staff(ctx);
  const form = await readForm(ctx);
  const data = await courseData(ctx, form);
  if (!data.title) throw new HttpError(400, ctx.t('fill_required'));
  const id = q.insert('courses', { ...data, slug: uniqueSlug('courses', data.title), owner_id: ctx.user.id });
  redirect(ctx, `/admin/courses/${id}`, { msg: ctx.t('course_created') });
}

async function updateCourse(ctx) {
  staff(ctx);
  const c = ownCourse(ctx, ctx.params.id);
  const form = await readForm(ctx);
  const data = await courseData(ctx, form, c);
  if (!data.title) throw new HttpError(400, ctx.t('fill_required'));
  if (data.title !== c.title) data.slug = uniqueSlug('courses', data.title, c.id);
  q.update('courses', c.id, data);
  redirect(ctx, `/admin/courses/${c.id}`, { msg: ctx.t('saved') });
}

function deleteCourse(ctx) {
  staff(ctx);
  const c = ownCourse(ctx, ctx.params.id);
  q.run('DELETE FROM courses WHERE id = ?', c.id);
  redirect(ctx, '/admin/courses', { msg: ctx.t('deleted') });
}

function lessonFields(ctx, l = {}) {
  const { t } = ctx;
  const nm = `video_type_${l.id || 'new'}`;
  return html`<div class="form-grid">
    <label class="field full"><span>${t('title')} *</span><input class="input" name="title" required maxlength="150" value="${l.title || ''}"></label>
    <label class="field full"><span>${t('description')}</span><textarea class="textarea" name="description" rows="2" maxlength="3000">${l.description || ''}</textarea></label>
    <label class="field"><span>${t('video_type')}</span><select class="select" name="${nm}">
      <option value="external" ${l.video_type !== 'upload' ? raw('selected') : ''}>${t('video_external')}</option><option value="upload" ${l.video_type === 'upload' ? raw('selected') : ''}>${t('video_upload')}</option></select></label>
    <label class="field"><span>${t('duration')}</span><input class="input" name="duration" maxlength="10" value="${l.duration || ''}" placeholder="10:30"></label>
    <label class="field full" data-show-for="${nm}" data-show-when="external"><span>YouTube / Vimeo URL</span><input class="input" type="url" name="external_url" value="${l.external_url || ''}" placeholder="https://www.youtube.com/watch?v=..."></label>
    <label class="field full" data-show-for="${nm}" data-show-when="upload"><span>${t('video_file')}</span><label class="file-drop">${icon('upload', 'ic-sm')}<span data-file-label>${l.file_url ? t('replace_video') : t('choose_video')}</span><input type="file" name="video" accept="video/*"></label><div class="hint">${t('video_hint')}</div></label>
    <label class="field"><span>${t('order')}</span><input class="input" type="number" name="sort_order" value="${l.sort_order ?? ''}"></label>
  </div>`;
}

function courseEditor(ctx) {
  const { t, lang } = ctx;
  staff(ctx);
  const c = ownCourse(ctx, ctx.params.id);
  const lessons = q.all('SELECT * FROM lessons WHERE course_id = ? ORDER BY sort_order, id', c.id);
  const tests = q.all('SELECT t.*, l.title lesson_title, (SELECT COUNT(*) FROM test_questions x WHERE x.test_id = t.id) qn FROM tests t LEFT JOIN lessons l ON l.id = t.lesson_id WHERE t.course_id = ? ORDER BY t.id', c.id);
  const assignments = q.all('SELECT a.*, l.title lesson_title, (SELECT COUNT(*) FROM submissions s WHERE s.assignment_id = a.id) subs FROM assignments a LEFT JOIN lessons l ON l.id = a.lesson_id WHERE a.course_id = ? ORDER BY a.id', c.id);
  const students = q.all('SELECT u.id, u.full_name, u.email, u.photo_url, e.created_at FROM enrollments e JOIN users u ON u.id = e.user_id WHERE e.course_id = ? AND e.verified = 1 ORDER BY e.id DESC', c.id);
  const lessonOptions = (sel) => html`<option value="">—</option>${lessons.map((l, i) => html`<option value="${l.id}" ${sel === l.id ? raw('selected') : ''}>${i + 1}. ${l.title}</option>`)}`;

  const content = html`
  <details class="acc"><summary>${icon('pencil', 'ic-sm text-primary')}${t('course_details')}${icon('chevronDown', 'ic-sm chev')}</summary><div class="acc-body" style="padding-top:16px">
    <form method="post" action="/admin/courses/${c.id}" enctype="multipart/form-data" class="stack">${courseFields(ctx, c)}<div class="row"><button class="btn btn-primary">${t('save')}</button></div></form>
    <form method="post" action="/admin/courses/${c.id}/delete" data-confirm="${t('confirm_delete_course')}" style="margin-top:12px"><button class="btn btn-danger-ghost btn-sm">${icon('trash', 'ic-sm')}${t('delete_course')}</button></form>
  </div></details>

  <div class="card">
    <div class="card-head"><h3 class="row">${icon('play', 'ic-sm text-primary')}${t('lessons')} (${lessons.length})</h3></div>
    ${lessons.length ? html`<div class="divide">${lessons.map((l, i) => html`<details style="padding:0"><summary class="list-item" style="cursor:pointer;list-style:none"><span class="badge">${i + 1}</span><span class="grow bold small">${l.title}</span>${l.duration ? html`<span class="xs muted">${l.duration}</span>` : ''}<span class="badge ${l.video_type === 'upload' ? 'b-info' : 'b-primary'}">${l.video_type === 'upload' ? t('video_upload') : 'YouTube'}</span>${icon('pencil', 'ic-sm muted')}</summary>
      <div style="padding:6px 20px 20px"><form method="post" action="/admin/lessons/${l.id}" enctype="multipart/form-data" class="stack">${lessonFields(ctx, l)}<div class="row"><button class="btn btn-primary btn-sm" data-busy="${t('uploading')}">${t('save')}</button></div></form>
      <form method="post" action="/admin/lessons/${l.id}/delete" data-confirm="${t('confirm_delete')}" style="margin-top:10px"><button class="btn btn-danger-ghost btn-xs">${icon('trash', 'ic-sm')}${t('delete')}</button></form></div></details>`)}</div>` : html`<p class="muted small" style="padding:16px 20px">${t('no_lessons')}</p>`}
    <details style="border-top:1px solid var(--border)"><summary class="list-item text-primary bold" style="cursor:pointer;list-style:none">${icon('plus', 'ic-sm')}${t('add_lesson')}</summary>
      <form method="post" action="/admin/courses/${c.id}/lessons" enctype="multipart/form-data" class="stack" style="padding:6px 20px 20px">${lessonFields(ctx, { sort_order: lessons.length + 1 })}<div><button class="btn btn-primary btn-sm" data-busy="${t('uploading')}">${t('add_lesson')}</button></div></form></details>
  </div>

  <div class="card">
    <div class="card-head"><h3 class="row">${icon('flask', 'ic-sm text-primary')}${t('tests')} (${tests.length})</h3></div>
    ${tests.length ? html`<div class="divide">${tests.map((x) => html`<a href="/admin/tests/${x.id}" class="list-item"><span class="badge ${x.test_type === 'final' ? 'b-accent' : x.test_type === 'level' ? 'b-purple' : 'b-info'}">${t('test_' + x.test_type)}</span><div class="grow"><div class="bold small">${x.title}</div><div class="xs muted">${x.qn} ${t('questions')} · ${x.time_limit_minutes} ${t('minutes')}${x.lesson_title ? ' · ' + x.lesson_title : ''}</div></div>${x.qn === 0 ? html`<span class="badge b-danger">${t('no_questions_short')}</span>` : ''}${icon('chevronRight', 'ic-sm muted')}</a>`)}</div>` : html`<p class="muted small" style="padding:16px 20px">${t('no_tests')}</p>`}
    <form method="post" action="/admin/courses/${c.id}/tests" class="form-grid" style="padding:16px 20px;border-top:1px solid var(--border)">
      <label class="field"><span>${t('test_title')}</span><input class="input" name="title" required maxlength="150"></label>
      <label class="field"><span>${t('test_type')}</span><select class="select" name="test_type"><option value="lesson">${t('test_lesson')}</option><option value="level">${t('test_level')}</option><option value="final">${t('test_final')}</option></select></label>
      <label class="field"><span>${t('lesson')} (${t('for_lesson_tests')})</span><select class="select" name="lesson_id">${lessonOptions()}</select></label>
      <label class="field"><span>${t('time_limit')}</span><input class="input" type="number" name="time_limit_minutes" min="1" max="180" value="15"></label>
      <div class="full"><button class="btn btn-primary btn-sm">${icon('plus', 'ic-sm')}${t('add_test')}</button></div>
    </form>
  </div>

  <div class="card">
    <div class="card-head"><h3 class="row">${icon('clipboard', 'ic-sm text-primary')}${t('assignments')} (${assignments.length})</h3><a href="/admin/submissions?course=${c.id}" class="btn btn-ghost btn-xs">${t('submissions')}</a></div>
    ${assignments.length ? html`<div class="divide">${assignments.map((a) => html`<div class="list-item"><div class="icon-tile tile-accent">${icon('clipboard', 'ic-sm')}</div><div class="grow"><div class="bold small">${a.title}</div><div class="xs muted">${a.lesson_title || '—'}${a.due_date ? ' · ' + t('due') + ': ' + fmtDate(a.due_date, lang) : ''} · ${a.subs} ${t('submissions').toLowerCase()}</div></div>
      <form method="post" action="/admin/assignments/${a.id}/delete" data-confirm="${t('confirm_delete')}"><button class="btn btn-danger-ghost btn-xs">${icon('trash', 'ic-sm')}</button></form></div>`)}</div>` : html`<p class="muted small" style="padding:16px 20px">${t('no_assignments')}</p>`}
    <form method="post" action="/admin/courses/${c.id}/assignments" class="form-grid" style="padding:16px 20px;border-top:1px solid var(--border)">
      <label class="field"><span>${t('title')}</span><input class="input" name="title" required maxlength="150"></label>
      <label class="field"><span>${t('lesson')}</span><select class="select" name="lesson_id" required>${lessonOptions()}</select></label>
      <label class="field full"><span>${t('description')}</span><textarea class="textarea" name="description" rows="3" maxlength="4000"></textarea></label>
      <label class="field"><span>${t('due')}</span><input class="input" type="date" name="due_date"></label>
      <div class="full"><button class="btn btn-primary btn-sm">${icon('plus', 'ic-sm')}${t('add_assignment')}</button></div>
    </form>
  </div>

  <div class="card"><div class="card-head"><h3 class="row">${icon('users', 'ic-sm text-primary')}${t('students')} (${students.length})</h3></div>
    ${students.length ? html`<div class="divide">${students.map((s) => { const p = courseProgress(s.id, c.id); return html`<div class="list-item">${avatar(s)}<div class="grow"><div class="bold small">${s.full_name}</div><div class="xs muted">${s.email} · ${fmtDate(s.created_at, lang)}</div></div><div style="width:120px"><div class="bar thin"><i style="width:${p.percent}%"></i></div><div class="xs muted" style="margin-top:3px">${p.percent}%</div></div></div>`; })}</div>` : html`<p class="muted small" style="padding:16px 20px">${t('no_students')}</p>`}</div>`;

  send(ctx, 200, panelPage(ctx, { base: '/admin', active: 'courses', title: c.title, subtitle: c.is_published ? t('published') : t('hidden'),
    actions: html`<a href="/courses/${c.slug}" class="btn btn-outline btn-sm">${icon('eye', 'ic-sm')}${t('preview')}</a><a href="/learn/${c.slug}" class="btn btn-primary btn-sm">${icon('play', 'ic-sm')}${t('open_classroom')}</a>`, content }));
}

async function lessonData(ctx, form, existing) {
  const typeKey = [...form.keys()].find((k) => k.startsWith('video_type_'));
  const video_type = form.get(typeKey) === 'upload' ? 'upload' : 'external';
  const video = fileField(form, 'video');
  const data = {
    title: field(form, 'title', 150), description: field(form, 'description', 3000) || null, video_type,
    external_url: field(form, 'external_url', 500) || null, duration: field(form, 'duration', 10) || null,
    file_url: video ? await saveUpload(video, 'video') : existing?.file_url || null,
  };
  const order = field(form, 'sort_order', 6);
  if (order !== '') data.sort_order = Number(order) || 0;
  if (!data.title) throw new HttpError(400, ctx.t('fill_required'));
  return data;
}

async function addLesson(ctx) {
  staff(ctx);
  const c = ownCourse(ctx, ctx.params.id);
  const form = await readForm(ctx);
  const data = await lessonData(ctx, form);
  if (data.sort_order === undefined) data.sort_order = q.get('SELECT COALESCE(MAX(sort_order), 0) + 1 n FROM lessons WHERE course_id = ?', c.id).n;
  q.insert('lessons', { ...data, course_id: c.id });
  redirect(ctx, `/admin/courses/${c.id}`, { msg: ctx.t('lesson_added') });
}

async function updateLesson(ctx) {
  staff(ctx);
  const l = q.get('SELECT * FROM lessons WHERE id = ?', Number(ctx.params.id));
  if (!l) throw new HttpError(404);
  const c = ownCourse(ctx, l.course_id);
  const form = await readForm(ctx);
  q.update('lessons', l.id, await lessonData(ctx, form, l));
  redirect(ctx, `/admin/courses/${c.id}`, { msg: ctx.t('saved') });
}

function deleteLesson(ctx) {
  staff(ctx);
  const l = q.get('SELECT * FROM lessons WHERE id = ?', Number(ctx.params.id));
  if (!l) throw new HttpError(404);
  ownCourse(ctx, l.course_id);
  q.run('DELETE FROM lessons WHERE id = ?', l.id);
  redirect(ctx, `/admin/courses/${l.course_id}`, { msg: ctx.t('deleted') });
}

async function addAssignment(ctx) {
  staff(ctx);
  const c = ownCourse(ctx, ctx.params.id);
  const form = await readForm(ctx);
  const title = field(form, 'title', 150);
  const lesson_id = Number(field(form, 'lesson_id', 12)) || null;
  if (!title || !lesson_id || !q.get('SELECT id FROM lessons WHERE id = ? AND course_id = ?', lesson_id, c.id)) throw new HttpError(400, ctx.t('fill_required'));
  q.insert('assignments', { course_id: c.id, lesson_id, title, description: field(form, 'description', 4000) || null, due_date: field(form, 'due_date', 10) || null, created_by: ctx.user.id });
  redirect(ctx, `/admin/courses/${c.id}`, { msg: ctx.t('saved') });
}

function deleteAssignment(ctx) {
  staff(ctx);
  const a = q.get('SELECT * FROM assignments WHERE id = ?', Number(ctx.params.id));
  if (!a) throw new HttpError(404);
  ownCourse(ctx, a.course_id);
  q.run('DELETE FROM assignments WHERE id = ?', a.id);
  redirect(ctx, `/admin/courses/${a.course_id}`, { msg: ctx.t('deleted') });
}

// ─── Tests & questions ────────────────────────────────────────────────────────
async function addTest(ctx) {
  staff(ctx);
  const c = ownCourse(ctx, ctx.params.id);
  const form = await readForm(ctx);
  const type = ['lesson', 'level', 'final'].includes(field(form, 'test_type')) ? field(form, 'test_type') : 'lesson';
  const lesson_id = Number(field(form, 'lesson_id', 12)) || null;
  if (type === 'lesson' && !lesson_id) throw new HttpError(400, ctx.t('lesson_required'));
  if (lesson_id && !q.get('SELECT id FROM lessons WHERE id = ? AND course_id = ?', lesson_id, c.id)) throw new HttpError(400);
  const id = q.insert('tests', { course_id: c.id, lesson_id: type === 'lesson' ? lesson_id : null, title: field(form, 'title', 150) || ctx.t('test_' + type), test_type: type, time_limit_minutes: Math.min(180, Math.max(1, Number(field(form, 'time_limit_minutes', 4)) || 15)) });
  redirect(ctx, `/admin/tests/${id}`, { msg: ctx.t('test_created') });
}

function ownTest(ctx) {
  const x = q.get('SELECT * FROM tests WHERE id = ?', Number(ctx.params.id));
  if (!x) throw new HttpError(404);
  return { test: x, course: ownCourse(ctx, x.course_id) };
}

export function questionForm(ctx, action, topicName = 'topic', extra = '') {
  const { t } = ctx;
  return html`<form method="post" action="${action}" class="form-grid">
    <label class="field full"><span>${t('question')} *</span><textarea class="textarea" name="question" rows="2" required maxlength="1000"></textarea></label>
    ${['a', 'b', 'c', 'd'].map((k) => html`<label class="field"><span>${t('option')} ${k.toUpperCase()}${k < 'c' ? ' *' : ''}</span><input class="input" name="option_${k}" ${k < 'c' ? raw('required') : ''} maxlength="400"></label>`)}
    <label class="field"><span>${t('correct_answer')} *</span><select class="select" name="correct">${['a', 'b', 'c', 'd'].map((k) => html`<option value="${k}">${k.toUpperCase()}</option>`)}</select></label>
    <label class="field"><span>${t(topicName)}</span><input class="input" name="${topicName}" maxlength="60"></label>
    ${extra}
    <div class="full"><button class="btn btn-primary btn-sm">${icon('plus', 'ic-sm')}${t('add_question')}</button></div>
  </form>`;
}

function bulkForm(ctx, action) {
  const { t } = ctx;
  return html`<form method="post" action="${action}" class="stack">
    <p class="small muted">${t('bulk_hint')}</p>
    <textarea class="textarea" name="bulk" rows="8" required style="font-family:ui-monospace,monospace;font-size:13px" placeholder="${'What is 2 + 2?\na) 3\nb) 4\nc) 5\nd) 6\nanswer: b\ntopic: Math\n\nNext question...'}"></textarea>
    <div><button class="btn btn-outline btn-sm">${icon('upload', 'ic-sm')}${t('import')}</button></div></form>`;
}

function aiGenerateForm(ctx, action, withCategory = false) {
  const { t } = ctx;
  return html`<form method="post" action="${action}" class="form-grid">
    <label class="field full"><span>${t('ai_gen_topic')}</span><input class="input" name="topic" required maxlength="300" placeholder="${t('ai_gen_topic_ph')}"></label>
    ${withCategory ? html`<label class="field"><span>${t('category')}</span><input class="input" name="category" maxlength="60" required></label><label class="field"><span>${t('difficulty')}</span><select class="select" name="difficulty"><option value="easy">${t('diff_easy')}</option><option value="medium" selected>${t('diff_medium')}</option><option value="hard">${t('diff_hard')}</option></select></label>` : ''}
    <label class="field"><span>${t('count')}</span><input class="input" type="number" name="count" min="1" max="20" value="5"></label>
    <div class="full"><button class="btn btn-ai btn-sm" data-busy="${t('ai_generating')}" ${!aiConfigured() ? raw('disabled') : ''}>${icon('sparkles', 'ic-sm')}${t('ai_generate')}</button>${!aiConfigured() ? html` <span class="xs muted">${t('ai_not_configured_short')}</span>` : ''}</div>
  </form>`;
}

function testEditor(ctx) {
  const { t } = ctx;
  staff(ctx);
  const { test, course } = ownTest(ctx);
  const questions = q.all('SELECT * FROM test_questions WHERE test_id = ? ORDER BY sort_order, id', test.id);
  const lessons = q.all('SELECT id, title FROM lessons WHERE course_id = ? ORDER BY sort_order, id', course.id);
  const content = html`
    <form method="post" action="/admin/tests/${test.id}" class="card card-pad form-grid">
      <label class="field"><span>${t('test_title')}</span><input class="input" name="title" required maxlength="150" value="${test.title}"></label>
      <label class="field"><span>${t('test_type')}</span><select class="select" name="test_type">${['lesson', 'level', 'final'].map((k) => html`<option value="${k}" ${test.test_type === k ? raw('selected') : ''}>${t('test_' + k)}</option>`)}</select></label>
      <label class="field"><span>${t('lesson')}</span><select class="select" name="lesson_id"><option value="">—</option>${lessons.map((l) => html`<option value="${l.id}" ${test.lesson_id === l.id ? raw('selected') : ''}>${l.title}</option>`)}</select></label>
      <label class="field"><span>${t('time_limit')}</span><input class="input" type="number" name="time_limit_minutes" min="1" max="180" value="${test.time_limit_minutes}"></label>
      <label class="field"><span>${t('pass_mark')} (%)</span><input class="input" type="number" name="pass_percent" min="1" max="100" value="${test.pass_percent}"></label>
      <div class="full row"><button class="btn btn-primary btn-sm">${t('save')}</button><a href="/tests/${test.id}" class="btn btn-ghost btn-sm">${icon('eye', 'ic-sm')}${t('preview')}</a></div>
    </form>
    <div class="card"><div class="card-head"><h3>${t('questions_h')} (${questions.length})</h3></div>
      ${questions.length ? html`<div class="divide">${questions.map((x, i) => html`<div class="list-item" style="align-items:flex-start"><span class="badge">${i + 1}</span><div class="grow"><div class="bold small">${x.question}</div>
        <div class="xs muted" style="margin-top:4px">${['a', 'b', 'c', 'd'].filter((k) => x['option_' + k]).map((k) => html`<span class="${k === x.correct ? 'text-success bold' : ''}">${k.toUpperCase()}) ${x['option_' + k]}&nbsp;&nbsp; </span>`)}</div>${x.topic ? html`<span class="badge b-primary" style="margin-top:4px">${x.topic}</span>` : ''}</div>
        <form method="post" action="/admin/test-questions/${x.id}/delete"><button class="btn btn-danger-ghost btn-xs">${icon('trash', 'ic-sm')}</button></form></div>`)}</div>` : html`<p class="muted small" style="padding:16px 20px">${t('no_questions')}</p>`}
    </div>
    <details class="acc" open><summary>${icon('sparkles', 'ic-sm text-primary')}${t('ai_generate_questions')}${icon('chevronDown', 'ic-sm chev')}</summary><div class="acc-body" style="padding-top:16px">${aiGenerateForm(ctx, `/admin/tests/${test.id}/generate`)}</div></details>
    <details class="acc"><summary>${icon('plus', 'ic-sm text-primary')}${t('add_question')}${icon('chevronDown', 'ic-sm chev')}</summary><div class="acc-body" style="padding-top:16px">${questionForm(ctx, `/admin/tests/${test.id}/questions`)}</div></details>
    <details class="acc"><summary>${icon('upload', 'ic-sm text-primary')}${t('bulk_import')}${icon('chevronDown', 'ic-sm chev')}</summary><div class="acc-body" style="padding-top:16px">${bulkForm(ctx, `/admin/tests/${test.id}/bulk`)}</div></details>
    <form method="post" action="/admin/tests/${test.id}/delete" data-confirm="${t('confirm_delete')}"><button class="btn btn-danger-ghost btn-sm">${icon('trash', 'ic-sm')}${t('delete_test')}</button></form>`;
  send(ctx, 200, panelPage(ctx, { base: '/admin', active: 'courses', title: test.title, subtitle: `${course.title} · ${t('test_' + test.test_type)}`,
    actions: html`<a href="/admin/courses/${course.id}" class="btn btn-outline btn-sm">${icon('arrowLeft', 'ic-sm')}${course.title}</a>`, content }));
}

async function updateTest(ctx) {
  staff(ctx);
  const { test, course } = ownTest(ctx);
  const form = await readForm(ctx);
  const type = ['lesson', 'level', 'final'].includes(field(form, 'test_type')) ? field(form, 'test_type') : test.test_type;
  const lesson_id = Number(field(form, 'lesson_id', 12)) || null;
  if (type === 'lesson' && !lesson_id) throw new HttpError(400, ctx.t('lesson_required'));
  q.update('tests', test.id, {
    title: field(form, 'title', 150) || test.title, test_type: type, lesson_id: lesson_id && q.get('SELECT id FROM lessons WHERE id = ? AND course_id = ?', lesson_id, course.id) ? lesson_id : null,
    time_limit_minutes: Math.min(180, Math.max(1, Number(field(form, 'time_limit_minutes', 4)) || 15)),
    pass_percent: Math.min(100, Math.max(1, Number(field(form, 'pass_percent', 3)) || 70)),
  });
  redirect(ctx, `/admin/tests/${test.id}`, { msg: ctx.t('saved') });
}

function deleteTest(ctx) {
  staff(ctx);
  const { test, course } = ownTest(ctx);
  q.run('DELETE FROM tests WHERE id = ?', test.id);
  redirect(ctx, `/admin/courses/${course.id}`, { msg: ctx.t('deleted') });
}

function questionFromForm(form, topicName) {
  const qn = {
    question: field(form, 'question', 1000), option_a: field(form, 'option_a', 400), option_b: field(form, 'option_b', 400),
    option_c: field(form, 'option_c', 400) || null, option_d: field(form, 'option_d', 400) || null,
    correct: ['a', 'b', 'c', 'd'].includes(field(form, 'correct')) ? field(form, 'correct') : 'a',
    [topicName]: field(form, topicName, 60) || (topicName === 'category' ? 'General' : null),
  };
  if (!qn.question || !qn.option_a || !qn.option_b || !qn['option_' + qn.correct]) return null;
  return qn;
}

/** Parse the bulk-import text format */
export function parseBulk(text, topicName = 'topic') {
  const out = [];
  for (const block of String(text).replace(/\r/g, '').split(/\n\s*\n/)) {
    const lines = block.split('\n').map((l) => l.trim()).filter(Boolean);
    if (!lines.length) continue;
    const qn = { question: '', correct: '' };
    for (const line of lines) {
      let m;
      if ((m = line.match(/^([a-dA-D])[).:]\s*(.+)$/))) qn['option_' + m[1].toLowerCase()] = m[2];
      else if ((m = line.match(/^(answer|javob|juwap|ответ|correct)\s*[:=-]\s*([a-dA-D])/i))) qn.correct = m[2].toLowerCase();
      else if ((m = line.match(/^(topic|category|mavzu|tema|тема|kategoriya)\s*[:=-]\s*(.+)$/i))) qn[topicName] = m[2];
      else if (!qn.option_a) qn.question += (qn.question ? ' ' : '') + line.replace(/^\d+[).]\s*/, '');
    }
    if (qn.question && qn.option_a && qn.option_b && qn['option_' + qn.correct]) out.push(qn);
  }
  return out;
}

async function addTestQuestion(ctx) {
  staff(ctx);
  const { test } = ownTest(ctx);
  const qn = questionFromForm(await readForm(ctx), 'topic');
  if (!qn) throw new HttpError(400, ctx.t('fill_required'));
  q.insert('test_questions', { ...qn, test_id: test.id, sort_order: q.get('SELECT COUNT(*) n FROM test_questions WHERE test_id = ?', test.id).n + 1 });
  redirect(ctx, `/admin/tests/${test.id}`, { msg: ctx.t('saved') });
}

async function bulkTestQuestions(ctx) {
  staff(ctx);
  const { test } = ownTest(ctx);
  const list = parseBulk(field(await readForm(ctx), 'bulk', 100000), 'topic');
  let n = q.get('SELECT COUNT(*) n FROM test_questions WHERE test_id = ?', test.id).n;
  q.tx(() => list.forEach((qn) => q.insert('test_questions', { ...qn, test_id: test.id, sort_order: ++n })));
  redirect(ctx, `/admin/tests/${test.id}`, { type: list.length ? 'ok' : 'error', msg: ctx.t('imported', { n: list.length }) });
}

async function generateQuestions(ctx, { topic, count, context = '', topicName }) {
  const res = await askAI({
    lang: ctx.lang, json: true, maxTokens: 4000,
    mock: () => ({ questions: Array.from({ length: count }, (_, i) => ({ question: `${topic}: sample question ${i + 1}?`, a: 'Option A', b: 'Option B', c: 'Option C', d: 'Option D', correct: 'abcd'[i % 4], topic })) }),
    system: 'You write clear, accurate multiple-choice questions for students. Exactly one option is correct. Distractors are plausible.',
    prompt: `Write ${count} multiple-choice questions about: ${topic}\n${context}\nReturn JSON: {"questions":[{"question":"...","a":"...","b":"...","c":"...","d":"...","correct":"a|b|c|d","topic":"short sub-topic"}]}`,
  });
  return (res.questions || []).map((x) => ({
    question: String(x.question || '').slice(0, 1000), option_a: String(x.a || '').slice(0, 400), option_b: String(x.b || '').slice(0, 400),
    option_c: x.c ? String(x.c).slice(0, 400) : null, option_d: x.d ? String(x.d).slice(0, 400) : null,
    correct: ['a', 'b', 'c', 'd'].includes(String(x.correct).toLowerCase()) ? String(x.correct).toLowerCase() : 'a',
    [topicName]: String(x.topic || topic).slice(0, 60),
  })).filter((x) => x.question && x.option_a && x.option_b && x['option_' + x.correct]);
}

async function aiTestQuestions(ctx) {
  staff(ctx);
  const { test, course } = ownTest(ctx);
  const form = await readForm(ctx);
  const topic = field(form, 'topic', 300);
  const count = Math.min(20, Math.max(1, Number(field(form, 'count', 3)) || 5));
  const lesson = test.lesson_id ? q.get('SELECT title, description FROM lessons WHERE id = ?', test.lesson_id) : null;
  let list = [];
  try {
    list = await generateQuestions(ctx, { topic, count, topicName: 'topic', context: `Course: ${course.title}. ${lesson ? `Lesson: ${lesson.title}. ${lesson.description || ''}` : ''}` });
  } catch (e) {
    return redirect(ctx, `/admin/tests/${test.id}`, { type: 'error', msg: ctx.t(e.code === 'AI_NOT_CONFIGURED' ? 'ai_not_configured_short' : 'ai_error') });
  }
  let n = q.get('SELECT COUNT(*) n FROM test_questions WHERE test_id = ?', test.id).n;
  q.tx(() => list.forEach((qn) => q.insert('test_questions', { ...qn, test_id: test.id, sort_order: ++n })));
  redirect(ctx, `/admin/tests/${test.id}`, { msg: ctx.t('imported', { n: list.length }) });
}

function deleteTestQuestion(ctx) {
  staff(ctx);
  const x = q.get('SELECT * FROM test_questions WHERE id = ?', Number(ctx.params.id));
  if (!x) throw new HttpError(404);
  const test = q.get('SELECT * FROM tests WHERE id = ?', x.test_id);
  ownCourse(ctx, test.course_id);
  q.run('DELETE FROM test_questions WHERE id = ?', x.id);
  redirect(ctx, `/admin/tests/${test.id}`);
}

// ─── Skill question bank ──────────────────────────────────────────────────────
function questionsPage(ctx) {
  const { t } = ctx;
  staff(ctx);
  const cat = ctx.url.searchParams.get('category') || '';
  const cats = q.all('SELECT category, COUNT(*) n FROM skill_questions GROUP BY category ORDER BY category');
  const list = q.all(`SELECT * FROM skill_questions ${cat ? 'WHERE category = ?' : ''} ORDER BY id DESC LIMIT 300`, ...(cat ? [cat] : []));
  const diffSel = html`<label class="field"><span>${t('difficulty')}</span><select class="select" name="difficulty"><option value="easy">${t('diff_easy')}</option><option value="medium" selected>${t('diff_medium')}</option><option value="hard">${t('diff_hard')}</option></select></label>`;
  const content = html`
    ${cats.length ? html`<div class="pills"><a href="/admin/questions" class="${cx(!cat && 'on')}">${t('all')}</a>${cats.map((c) => html`<a href="/admin/questions?category=${encodeURIComponent(c.category)}" class="${cx(cat === c.category && 'on')}">${c.category} (${c.n})</a>`)}</div>` : ''}
    <details class="acc"><summary>${icon('sparkles', 'ic-sm text-primary')}${t('ai_generate_questions')}${icon('chevronDown', 'ic-sm chev')}</summary><div class="acc-body" style="padding-top:16px">${aiGenerateForm(ctx, '/admin/questions/generate', true)}</div></details>
    <details class="acc"><summary>${icon('plus', 'ic-sm text-primary')}${t('add_question')}${icon('chevronDown', 'ic-sm chev')}</summary><div class="acc-body" style="padding-top:16px">${questionForm(ctx, '/admin/questions', 'category', diffSel)}</div></details>
    <details class="acc"><summary>${icon('upload', 'ic-sm text-primary')}${t('bulk_import')}${icon('chevronDown', 'ic-sm chev')}</summary><div class="acc-body" style="padding-top:16px">${bulkForm(ctx, '/admin/questions/bulk')}</div></details>
    <div class="card"><div class="card-head"><h3>${t('questions_h')} (${list.length})</h3></div>
      ${list.length ? html`<div class="divide">${list.map((x) => html`<div class="list-item" style="align-items:flex-start"><div class="grow"><div class="bold small">${x.question}</div>
        <div class="xs muted" style="margin-top:4px">${['a', 'b', 'c', 'd'].filter((k) => x['option_' + k]).map((k) => html`<span class="${k === x.correct ? 'text-success bold' : ''}">${k.toUpperCase()}) ${x['option_' + k]}&nbsp;&nbsp; </span>`)}</div>
        <div class="row-wrap" style="margin-top:4px"><span class="badge b-primary">${x.category}</span><span class="badge">${t('diff_' + x.difficulty)}</span></div></div>
        <form method="post" action="/admin/questions/${x.id}/delete"><button class="btn btn-danger-ghost btn-xs">${icon('trash', 'ic-sm')}</button></form></div>`)}</div>` : html`<p class="muted small" style="padding:16px 20px">${t('no_questions')}</p>`}
    </div>`;
  send(ctx, 200, panelPage(ctx, { base: '/admin', active: 'questions', title: t('skill_questions'), subtitle: t('skill_questions_sub'), content }));
}

async function addSkillQuestion(ctx) {
  staff(ctx);
  const form = await readForm(ctx);
  const qn = questionFromForm(form, 'category');
  if (!qn) throw new HttpError(400, ctx.t('fill_required'));
  qn.difficulty = ['easy', 'medium', 'hard'].includes(field(form, 'difficulty')) ? field(form, 'difficulty') : 'medium';
  q.insert('skill_questions', qn);
  redirect(ctx, back(ctx, '/admin/questions'), { msg: ctx.t('saved') });
}

async function bulkSkillQuestions(ctx) {
  staff(ctx);
  const list = parseBulk(field(await readForm(ctx), 'bulk', 100000), 'category');
  q.tx(() => list.forEach((qn) => q.insert('skill_questions', { ...qn, category: qn.category || 'General' })));
  redirect(ctx, '/admin/questions', { type: list.length ? 'ok' : 'error', msg: ctx.t('imported', { n: list.length }) });
}

async function aiSkillQuestions(ctx) {
  staff(ctx);
  const form = await readForm(ctx);
  const category = field(form, 'category', 60) || 'General';
  const difficulty = ['easy', 'medium', 'hard'].includes(field(form, 'difficulty')) ? field(form, 'difficulty') : 'medium';
  const count = Math.min(20, Math.max(1, Number(field(form, 'count', 3)) || 5));
  let list;
  try {
    list = await generateQuestions(ctx, { topic: field(form, 'topic', 300), count, topicName: 'category', context: `Difficulty: ${difficulty}. Category: ${category}.` });
  } catch (e) {
    return redirect(ctx, '/admin/questions', { type: 'error', msg: ctx.t(e.code === 'AI_NOT_CONFIGURED' ? 'ai_not_configured_short' : 'ai_error') });
  }
  q.tx(() => list.forEach((qn) => q.insert('skill_questions', { ...qn, category, difficulty })));
  redirect(ctx, `/admin/questions?category=${encodeURIComponent(category)}`, { msg: ctx.t('imported', { n: list.length }) });
}

// ─── Submissions ──────────────────────────────────────────────────────────────
function submissionsPage(ctx) {
  const { t, lang } = ctx;
  staff(ctx);
  const [w, p] = courseFilter(ctx);
  const status = ctx.url.searchParams.get('status') === 'reviewed' ? 'reviewed' : ctx.url.searchParams.get('status') === 'all' ? '' : 'submitted';
  const course = Number(ctx.url.searchParams.get('course')) || null;
  const list = q.all(`SELECT s.*, a.title atitle, a.description adesc, c.title ctitle, u.full_name, u.email, u.photo_url FROM submissions s JOIN assignments a ON a.id = s.assignment_id JOIN courses c ON c.id = a.course_id JOIN users u ON u.id = s.user_id
    WHERE ${w} ${status ? 'AND s.status = ?' : ''} ${course ? 'AND c.id = ?' : ''} ORDER BY s.created_at DESC LIMIT 200`, ...p, ...(status ? [status] : []), ...(course ? [course] : []));
  const tab = (k, label) => html`<a href="/admin/submissions?status=${k}${course ? '&course=' + course : ''}" class="${cx((status || 'all') === k && 'on')}">${label}</a>`;
  const content = html`<div class="pills">${tab('submitted', t('sub_submitted'))}${tab('reviewed', t('sub_reviewed'))}${tab('all', t('all'))}</div>
    ${list.length ? html`<div class="stack">${list.map((s) => html`<div class="card card-pad stack-sm" id="s${s.id}">
      <div class="row" style="flex-wrap:wrap">${avatar(s)}<div class="grow"><div class="bold">${s.full_name}</div><div class="xs muted">${s.email} · ${fmtDate(s.created_at, lang, true)}</div></div><span class="badge ${s.status === 'reviewed' ? 'b-success' : 'b-info'}">${t('sub_' + s.status)}</span></div>
      <div class="small"><strong>${s.atitle}</strong> <span class="muted">· ${s.ctitle}</span></div>
      ${s.text_submission ? html`<p class="small pre" style="background:var(--muted);padding:10px 12px;border-radius:12px">${s.text_submission}</p>` : ''}
      ${s.file_url ? html`<a href="${s.file_url}" target="_blank" rel="noopener" class="btn btn-outline btn-xs" style="align-self:flex-start">${icon('file', 'ic-sm')}${t('attached_file')}</a>` : ''}
      ${s.ai_feedback ? html`<details class="small"><summary class="text-primary bold" style="cursor:pointer">🤖 ${t('ai_feedback')}</summary><div class="prose small" style="margin-top:6px">${markdown(s.ai_feedback)}</div></details>` : ''}
      <form method="post" action="/admin/submissions/${s.id}" class="row-wrap" style="align-items:flex-end">
        <label class="field" style="width:120px"><span>${t('grade')}</span><input class="input" name="grade" maxlength="20" value="${s.grade || ''}" placeholder="A / 95"></label>
        <label class="field grow"><span>${t('teacher_comment')}</span><input class="input" name="teacher_comment" maxlength="1000" value="${s.teacher_comment || ''}"></label>
        <button class="btn btn-primary btn-sm">${icon('check', 'ic-sm')}${t('save_review')}</button></form>
    </div>`)}</div>` : html`<div class="card">${emptyState(t('nothing_to_review'), 'check')}</div>`}`;
  send(ctx, 200, panelPage(ctx, { base: '/admin', active: 'submissions', title: t('submissions'), content }));
}

async function reviewSubmission(ctx) {
  staff(ctx);
  const s = q.get('SELECT s.*, a.course_id, a.title, a.lesson_id FROM submissions s JOIN assignments a ON a.id = s.assignment_id WHERE s.id = ?', Number(ctx.params.id));
  if (!s) throw new HttpError(404);
  const c = ownCourse(ctx, s.course_id);
  const form = await readForm(ctx);
  q.update('submissions', s.id, { grade: field(form, 'grade', 20) || null, teacher_comment: field(form, 'teacher_comment', 1000) || null, status: 'reviewed' });
  notify(s.user_id, { type: 'review', title: `✅ ${s.title}`, body: `${ctx.t('grade')}: ${field(form, 'grade', 20) || '—'}`, link: `/learn/${c.slug}?lesson=${s.lesson_id || ''}&tab=assignments` });
  redirect(ctx, back(ctx, '/admin/submissions'), { msg: ctx.t('saved') });
}

// ─── Certificates ─────────────────────────────────────────────────────────────
function certificatesPage(ctx) {
  const { t, lang } = ctx;
  staff(ctx);
  const [w, p] = courseFilter(ctx);
  const courses = q.all(`SELECT id, title FROM courses c WHERE ${w} ORDER BY title`, ...p);
  const list = q.all(`SELECT ce.*, u.full_name, u.email FROM certificates ce JOIN users u ON u.id = ce.user_id LEFT JOIN courses c ON c.id = ce.course_id WHERE ${isAdmin(ctx.user) ? '1 = 1' : 'c.owner_id = ?'} ORDER BY ce.id DESC LIMIT 300`, ...(isAdmin(ctx.user) ? [] : [ctx.user.id]));
  const content = html`<form method="post" action="/admin/certificates" enctype="multipart/form-data" class="card card-pad form-grid">
      <h3 class="full">${t('issue_certificate')}</h3>
      <label class="field"><span>${t('course')} *</span><select class="select" name="course_id" required>${courses.map((c) => html`<option value="${c.id}">${c.title}</option>`)}</select></label>
      <label class="field"><span>${t('student_email')} *</span><input class="input" type="email" name="email" required></label>
      <label class="field"><span>${t('score')} (%)</span><input class="input" type="number" name="score" min="0" max="100"></label>
      <label class="field"><span>${t('optional_file')}</span><label class="file-drop">${icon('upload', 'ic-sm')}<span data-file-label>${t('choose_file')}</span><input type="file" name="file" accept=".pdf,.jpg,.jpeg,.png"></label></label>
      <div class="full"><button class="btn btn-primary btn-sm">${icon('award', 'ic-sm')}${t('issue')}</button><span class="xs muted" style="margin-left:10px">${t('auto_cert_note')}</span></div>
    </form>
    <div class="card"><div class="card-head"><h3>${t('issued_certificates')} (${list.length})</h3></div>
      ${list.length ? html`<div class="divide">${list.map((c) => html`<div class="list-item"><div class="icon-tile tile-accent">${icon('award', 'ic-sm')}</div><div class="grow"><div class="bold small">${c.full_name} <span class="muted">· ${c.course_title}</span></div><div class="xs muted">${c.email} · ${fmtDate(c.issued_date, lang)} · ${c.code}</div></div>
        <a href="/certificates/${c.code}" class="btn btn-ghost btn-xs">${icon('eye', 'ic-sm')}</a><form method="post" action="/admin/certificates/${c.id}/delete" data-confirm="${t('confirm_delete')}"><button class="btn btn-danger-ghost btn-xs">${icon('trash', 'ic-sm')}</button></form></div>`)}</div>` : html`<p class="muted small" style="padding:16px 20px">${t('nothing_yet')}</p>`}</div>`;
  send(ctx, 200, panelPage(ctx, { base: '/admin', active: 'certificates', title: t('certificates'), content }));
}

async function issueCertificate(ctx) {
  staff(ctx);
  const form = await readForm(ctx);
  const c = ownCourse(ctx, field(form, 'course_id', 12));
  const student = q.get('SELECT id FROM users WHERE email = ?', field(form, 'email', 200).toLowerCase());
  if (!student) throw new HttpError(400, ctx.t('user_not_found'));
  const file = fileField(form, 'file');
  const score = field(form, 'score', 3);
  const code = crypto.randomBytes(5).toString('hex').toUpperCase();
  q.insert('certificates', { code, user_id: student.id, course_id: c.id, course_title: c.title, issued_by: ctx.user.id, file_url: file ? await saveUpload(file, 'document') : null, score: score === '' ? null : Number(score) });
  notify(student.id, { type: 'certificate', title: `🎓 ${c.title}`, body: ctx.t('cert_issued'), link: `/certificates/${code}` });
  redirect(ctx, '/admin/certificates', { msg: ctx.t('cert_issued') });
}

function deleteCertificate(ctx) {
  staff(ctx);
  const ce = q.get('SELECT * FROM certificates WHERE id = ?', Number(ctx.params.id));
  if (!ce) throw new HttpError(404);
  if (!isAdmin(ctx.user)) ownCourse(ctx, ce.course_id);
  q.run('DELETE FROM certificates WHERE id = ?', ce.id);
  redirect(ctx, '/admin/certificates', { msg: ctx.t('deleted') });
}

// ─── Users (admin) ────────────────────────────────────────────────────────────
function usersPage(ctx) {
  const { t, lang } = ctx;
  admin(ctx);
  const search = (ctx.url.searchParams.get('q') || '').trim().slice(0, 80);
  const filter = ctx.url.searchParams.get('filter') || '';
  const where = [];
  const params = [];
  if (search) { where.push('(full_name LIKE ? OR email LIKE ?)'); params.push(`%${search}%`, `%${search}%`); }
  if (filter === 'pending') where.push("user_type = 'teacher' AND role = 'user'");
  else if (['student', 'teacher', 'organization'].includes(filter)) { where.push('user_type = ?'); params.push(filter); }
  else if (filter === 'admin') where.push("role = 'admin'");
  const list = q.all(`SELECT * FROM users ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY id DESC LIMIT 300`, ...params);
  const pill = (k, label) => html`<a href="/admin/users?filter=${k}${search ? '&q=' + encodeURIComponent(search) : ''}" class="${cx(filter === k && 'on')}">${label}</a>`;
  const content = html`
    <form method="get" class="search-bar">${icon('search')}<input class="input" name="q" value="${search}" placeholder="${t('search_users')}">${filter ? html`<input type="hidden" name="filter" value="${filter}">` : ''}</form>
    <div class="pills">${pill('', t('all'))}${pill('pending', t('pending_approval'))}${pill('student', t('type_student'))}${pill('teacher', t('type_teacher'))}${pill('organization', t('type_organization'))}${pill('admin', t('role_admin'))}</div>
    <div class="card table-wrap"><table class="table"><thead><tr><th>${t('user')}</th><th>${t('account_type')}</th><th>${t('role')}</th><th>${t('joined')}</th><th></th></tr></thead><tbody>
      ${list.map((u) => html`<tr>
        <td><div class="row">${avatar(u)}<div><div class="bold small">${u.full_name}</div><div class="xs muted">${u.email}${u.organization_name ? ' · ' + u.organization_name : ''}</div></div></div></td>
        <td>${u.user_type ? html`<span class="badge">${t('type_' + u.user_type)}</span>` : '—'}${u.user_type === 'teacher' && u.role === 'user' ? html` <span class="badge b-accent">${t('pending')}</span>` : ''}</td>
        <td><form method="post" action="/admin/users/${u.id}/role" class="row" style="gap:6px"><select class="select" name="role" style="padding:6px 10px;font-size:13px;width:auto" ${u.id === ctx.user.id ? raw('disabled') : ''}>${['user', 'teacher', 'admin'].map((r) => html`<option value="${r}" ${u.role === r ? raw('selected') : ''}>${t('role_' + r)}</option>`)}</select>${u.id !== ctx.user.id ? html`<button class="btn btn-outline btn-xs">${t('update')}</button>` : ''}</form></td>
        <td class="xs muted">${fmtDate(u.created_at, lang)}</td>
        <td>${u.id !== ctx.user.id ? html`<div class="row" style="gap:4px">${u.user_type === 'teacher' && u.role === 'user' ? html`<form method="post" action="/admin/users/${u.id}/role"><input type="hidden" name="role" value="teacher"><button class="btn btn-primary btn-xs">${icon('check', 'ic-sm')}${t('approve')}</button></form>` : ''}
          <form method="post" action="/admin/users/${u.id}/delete" data-confirm="${t('confirm_delete_user')}"><button class="btn btn-danger-ghost btn-xs">${icon('trash', 'ic-sm')}</button></form></div>` : ''}</td>
      </tr>`)}
    </tbody></table>${!list.length ? emptyState(t('nothing_found'), 'users') : ''}</div>`;
  send(ctx, 200, panelPage(ctx, { base: '/admin', active: 'users', title: t('users'), subtitle: `${list.length}`, content }));
}

async function setRole(ctx) {
  admin(ctx);
  const u = q.get('SELECT * FROM users WHERE id = ?', Number(ctx.params.id));
  if (!u || u.id === ctx.user.id) throw new HttpError(400);
  const role = field(await readForm(ctx), 'role', 10);
  if (!['user', 'teacher', 'admin'].includes(role)) throw new HttpError(400);
  q.update('users', u.id, { role });
  if (role === 'teacher' && u.role === 'user') {
    q.run('INSERT INTO teacher_profiles (user_id, is_visible) VALUES (?, 1) ON CONFLICT(user_id) DO UPDATE SET is_visible = 1', u.id);
    if (!u.user_type) q.update('users', u.id, { user_type: 'teacher' });
    notify(u.id, { type: 'teacher_approved', title: '🎉 ' + ctx.t('teacher_approved_title'), body: ctx.t('teacher_approved_body'), link: '/admin' });
  }
  redirect(ctx, back(ctx, '/admin/users'), { msg: ctx.t('saved') });
}

function deleteUser(ctx) {
  admin(ctx);
  const u = q.get('SELECT id FROM users WHERE id = ?', Number(ctx.params.id));
  if (!u || u.id === ctx.user.id) throw new HttpError(400);
  q.run('DELETE FROM users WHERE id = ?', u.id);
  redirect(ctx, back(ctx, '/admin/users'), { msg: ctx.t('deleted') });
}

// ─── Community content (admin) ────────────────────────────────────────────────
const CTYPES = ['video_explanation', 'useful_link', 'investor', 'event', 'news', 'support_info', 'director'];

function communityPage(ctx) {
  const { t, lang } = ctx;
  admin(ctx);
  const type = CTYPES.includes(ctx.url.searchParams.get('type')) ? ctx.url.searchParams.get('type') : CTYPES[0];
  const list = q.all('SELECT * FROM community_content WHERE type = ? ORDER BY sort_order, id DESC', type);
  const edit = list.find((x) => x.id === Number(ctx.url.searchParams.get('edit'))) || {};
  const content = html`
    <div class="pills">${CTYPES.map((k) => html`<a href="/admin/community?type=${k}" class="${cx(type === k && 'on')}">${t('ctype_' + k)}</a>`)}</div>
    <form method="post" action="/admin/community${edit.id ? '/' + edit.id : ''}" enctype="multipart/form-data" class="card card-pad form-grid">
      <h3 class="full">${t(edit.id ? 'edit' : 'add')} — ${t('ctype_' + type)}</h3>
      <input type="hidden" name="type" value="${type}">
      <label class="field full"><span>${t(type === 'director' || type === 'investor' ? 'name' : 'title')} *</span><input class="input" name="title" required maxlength="200" value="${edit.title || ''}"></label>
      <label class="field full"><span>${t('description')}</span><textarea class="textarea" name="description" rows="3" maxlength="3000">${edit.description || ''}</textarea></label>
      <label class="field"><span>${t(type === 'video_explanation' ? 'video_url' : type === 'support_info' ? 'telegram_url' : 'link')}</span><input class="input" name="url" maxlength="500" value="${edit.url || ''}" placeholder="https://"></label>
      ${type === 'useful_link' ? html`<label class="field"><span>${t('platform')}</span><select class="select" name="platform">${['telegram', 'instagram', 'youtube', 'other'].map((p) => html`<option value="${p}" ${edit.platform === p ? raw('selected') : ''}>${p}</option>`)}</select></label>` : ''}
      ${['event', 'news'].includes(type) ? html`<label class="field"><span>${t('date')}</span><input class="input" type="date" name="date" value="${edit.date || ''}"></label>` : ''}
      ${['investor', 'director', 'support_info'].includes(type) ? html`<label class="field"><span>${t(type === 'support_info' ? 'phone' : 'contact')}</span><input class="input" name="contact" maxlength="200" value="${edit.contact || ''}"></label>` : ''}
      ${['investor', 'director'].includes(type) ? html`<label class="field"><span>${t('photo')}</span><label class="file-drop">${icon('upload', 'ic-sm')}<span data-file-label>${t('choose_file')}</span><input type="file" name="photo" accept="image/*"></label></label>` : ''}
      ${type === 'video_explanation' ? html`<label class="field"><span>${t('or_upload_video')}</span><label class="file-drop">${icon('upload', 'ic-sm')}<span data-file-label>${t('choose_video')}</span><input type="file" name="video" accept="video/*"></label></label>` : ''}
      <label class="field"><span>${t('order')}</span><input class="input" type="number" name="sort_order" value="${edit.sort_order ?? 0}"></label>
      <label class="check"><input type="checkbox" name="is_active" value="1" ${edit.id ? (edit.is_active ? raw('checked') : '') : raw('checked')}> ${t('visible')}</label>
      <div class="full row"><button class="btn btn-primary btn-sm" data-busy="${t('saving')}">${t('save')}</button>${edit.id ? html`<a href="/admin/community?type=${type}" class="btn btn-ghost btn-sm">${t('cancel')}</a>` : ''}</div>
    </form>
    <div class="card">${list.length ? html`<div class="divide">${list.map((x) => html`<div class="list-item"><div class="grow"><div class="bold small">${x.title}</div><div class="xs muted">${x.url || x.contact || ''}${x.date ? ' · ' + fmtDate(x.date, lang) : ''}</div></div>
      ${!x.is_active ? html`<span class="badge">${t('hidden')}</span>` : ''}<a href="/admin/community?type=${type}&edit=${x.id}" class="btn btn-ghost btn-xs">${icon('pencil', 'ic-sm')}</a>
      <form method="post" action="/admin/community/${x.id}/delete" data-confirm="${t('confirm_delete')}"><button class="btn btn-danger-ghost btn-xs">${icon('trash', 'ic-sm')}</button></form></div>`)}</div>` : html`<p class="muted small" style="padding:16px 20px">${t('nothing_yet')}</p>`}</div>`;
  send(ctx, 200, panelPage(ctx, { base: '/admin', active: 'community', title: t('nav_community'), subtitle: t('community_admin_sub'), content,
    actions: html`<a href="/community" class="btn btn-outline btn-sm">${icon('eye', 'ic-sm')}${t('view_public')}</a>` }));
}

async function saveCommunity(ctx) {
  admin(ctx);
  const form = await readForm(ctx);
  const type = CTYPES.includes(field(form, 'type')) ? field(form, 'type') : null;
  if (!type || !field(form, 'title')) throw new HttpError(400, ctx.t('fill_required'));
  const existing = ctx.params.id ? q.get('SELECT * FROM community_content WHERE id = ?', Number(ctx.params.id)) : null;
  const photo = fileField(form, 'photo');
  const video = fileField(form, 'video');
  const data = {
    type, title: field(form, 'title', 200), description: field(form, 'description', 3000) || null,
    url: video ? await saveUpload(video, 'video') : field(form, 'url', 500) || null,
    platform: field(form, 'platform', 20) || null, date: field(form, 'date', 10) || null, contact: field(form, 'contact', 200) || null,
    photo_url: photo ? await saveUpload(photo, 'image') : existing?.photo_url || null,
    sort_order: Number(field(form, 'sort_order', 6)) || 0, is_active: form.get('is_active') === '1' ? 1 : 0,
  };
  if (existing) q.update('community_content', existing.id, data); else q.insert('community_content', data);
  redirect(ctx, `/admin/community?type=${type}`, { msg: ctx.t('saved') });
}

function deleteCommunity(ctx) {
  admin(ctx);
  const x = q.get('SELECT type FROM community_content WHERE id = ?', Number(ctx.params.id));
  q.run('DELETE FROM community_content WHERE id = ?', Number(ctx.params.id));
  redirect(ctx, `/admin/community?type=${x?.type || ''}`, { msg: ctx.t('deleted') });
}

export default function (r) {
  r.get('/admin', overview);
  r.get('/admin/courses', coursesPage);
  r.get('/admin/courses/new', newCourse);
  r.post('/admin/courses/new', createCourse);
  r.get('/admin/courses/:id', courseEditor);
  r.post('/admin/courses/:id', updateCourse);
  r.post('/admin/courses/:id/delete', deleteCourse);
  r.post('/admin/courses/:id/lessons', addLesson);
  r.post('/admin/lessons/:id', updateLesson);
  r.post('/admin/lessons/:id/delete', deleteLesson);
  r.post('/admin/courses/:id/assignments', addAssignment);
  r.post('/admin/assignments/:id/delete', deleteAssignment);
  r.post('/admin/courses/:id/tests', addTest);
  r.get('/admin/tests/:id', testEditor);
  r.post('/admin/tests/:id', updateTest);
  r.post('/admin/tests/:id/delete', deleteTest);
  r.post('/admin/tests/:id/questions', addTestQuestion);
  r.post('/admin/tests/:id/bulk', bulkTestQuestions);
  r.post('/admin/tests/:id/generate', aiTestQuestions);
  r.post('/admin/test-questions/:id/delete', deleteTestQuestion);
  r.get('/admin/questions', questionsPage);
  r.post('/admin/questions', addSkillQuestion);
  r.post('/admin/questions/bulk', bulkSkillQuestions);
  r.post('/admin/questions/generate', aiSkillQuestions);
  r.post('/admin/questions/:id/delete', (ctx) => { staff(ctx); q.run('DELETE FROM skill_questions WHERE id = ?', Number(ctx.params.id)); redirect(ctx, back(ctx, '/admin/questions')); });
  r.get('/admin/submissions', submissionsPage);
  r.post('/admin/submissions/:id', reviewSubmission);
  r.get('/admin/certificates', certificatesPage);
  r.post('/admin/certificates', issueCertificate);
  r.post('/admin/certificates/:id/delete', deleteCertificate);
  r.get('/admin/users', usersPage);
  r.post('/admin/users/:id/role', setRole);
  r.post('/admin/users/:id/delete', deleteUser);
  r.get('/admin/community', communityPage);
  r.post('/admin/community', saveCommunity);
  r.post('/admin/community/:id', saveCommunity);
  r.post('/admin/community/:id/delete', deleteCommunity);
}
