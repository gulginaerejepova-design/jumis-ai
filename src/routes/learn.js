// Learning: enrollment, lesson player, progress, comments, materials, assignments, tests, certificates.
import crypto from 'node:crypto';
import { q, sha256, notify, json, randomToken } from '../db.js';
import { send, redirect, readForm, field, fileField, HttpError, safeNext } from '../http.js';
import { requireUser, rateLimit } from '../auth.js';
import { askAI, sendEmail, saveUpload } from '../services.js';
import { page } from '../views/layout.js';
import { html, raw, cx, markdown } from '../views/html.js';
import { icon } from '../views/icons.js';
import { emptyState, fmtDate, avatar, scoreBars, percentColor } from '../views/components.js';
import { getCourseBySlug, embedFor } from './public.js';
import { config } from '../env.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────
export function access(user, course) {
  const staff = user.role === 'admin' || course.owner_id === user.id;
  const enrollment = q.get('SELECT * FROM enrollments WHERE user_id = ? AND course_id = ?', user.id, course.id);
  return { staff, enrolled: staff || Boolean(enrollment?.verified), enrollment };
}

export function courseProgress(userId, courseId) {
  const total = q.get('SELECT COUNT(*) n FROM lessons WHERE course_id = ?', courseId).n;
  const done = q.get('SELECT COUNT(*) n FROM lesson_progress p JOIN lessons l ON l.id = p.lesson_id WHERE p.user_id = ? AND l.course_id = ?', userId, courseId).n;
  return { total, done, percent: total ? Math.round((done / total) * 100) : 0 };
}

function loadCourse(ctx) {
  const course = getCourseBySlug(ctx.params.slug);
  if (!course) throw new HttpError(404);
  const user = requireUser(ctx);
  const a = access(user, course);
  if (!course.is_published && !a.staff) throw new HttpError(404);
  return { course, user, ...a };
}

/** Issue a certificate automatically when every lesson is done and the final test (if any) is passed */
export function maybeIssueCertificate(userId, course) {
  if (q.get('SELECT id FROM certificates WHERE user_id = ? AND course_id = ?', userId, course.id)) return null;
  const p = courseProgress(userId, course.id);
  if (!p.total || p.done < p.total) return null;
  const finals = q.all("SELECT id, pass_percent FROM tests WHERE course_id = ? AND test_type = 'final'", course.id);
  let score = null;
  if (finals.length) {
    const best = q.get(`SELECT MAX(r.percentage) best FROM test_results r JOIN tests t ON t.id = r.test_id
      WHERE r.user_id = ? AND t.course_id = ? AND t.test_type = 'final' AND r.percentage >= t.pass_percent`, userId, course.id);
    if (best?.best == null) return null;
    score = best.best;
  }
  const code = crypto.randomBytes(5).toString('hex').toUpperCase();
  q.insert('certificates', { code, user_id: userId, course_id: course.id, course_title: course.title, issued_by: course.owner_id, score });
  notify(userId, { type: 'certificate', title: `🎓 ${course.title}`, body: 'Certificate issued', link: `/certificates/${code}` });
  return code;
}

const LANG_MOCK = (kind) => () => kind === 'test'
  ? '**Strong:** you answered the core questions well.\n\n**Review:** look again at the topics marked in red below.\n\n**Next step:** rewatch the related lesson and retake the test in a day.'
  : 'Good structure and a clear answer. Add one concrete example to make it stronger, and check spelling in the last paragraph.';

// ─── Learn page ───────────────────────────────────────────────────────────────
function learnPage(ctx) {
  const { t, lang } = ctx;
  const { course, user, staff, enrolled, enrollment } = loadCourse(ctx);
  const lessons = q.all('SELECT * FROM lessons WHERE course_id = ? ORDER BY sort_order, id', course.id);
  const done = new Set(q.all('SELECT lesson_id FROM lesson_progress WHERE user_id = ?', user.id).map((r) => r.lesson_id));
  const tests = q.all('SELECT t.*, (SELECT COUNT(*) FROM test_questions x WHERE x.test_id = t.id) AS qn FROM tests t WHERE course_id = ? ORDER BY id', course.id);
  const taken = new Map(q.all('SELECT test_id, MAX(percentage) best FROM test_results WHERE user_id = ? GROUP BY test_id', user.id).map((r) => [r.test_id, r.best]));
  const lessonTest = (lessonId) => tests.find((x) => x.lesson_id === lessonId && x.test_type === 'lesson' && x.qn > 0);

  const reqId = Number(ctx.url.searchParams.get('lesson')) || null;
  let idx = Math.max(0, lessons.findIndex((l) => l.id === reqId));
  if (!reqId) { const firstOpen = lessons.findIndex((l) => !done.has(l.id)); idx = firstOpen >= 0 ? firstOpen : 0; }
  const lesson = lessons[idx];
  const canWatch = (i) => enrolled || i === 0;
  const prevTest = lesson && idx > 0 && !staff ? lessonTest(lessons[idx - 1].id) : null;
  const gated = prevTest && !taken.has(prevTest.id);
  const progress = courseProgress(user.id, course.id);
  const cert = q.get('SELECT * FROM certificates WHERE user_id = ? AND course_id = ?', user.id, course.id);
  const tab = ['comments', 'materials', 'assignments'].includes(ctx.url.searchParams.get('tab')) ? ctx.url.searchParams.get('tab') : 'comments';
  const here = `/learn/${course.slug}?lesson=${lesson?.id || ''}`;

  // Main area
  let main;
  if (!lesson) main = html`<div class="card">${emptyState(t('no_lessons'), 'play')}</div>`;
  else if (!canWatch(idx)) main = enrollPanel(ctx, course, enrollment);
  else if (gated) main = html`<div class="card card-pad center stack" style="padding:48px 24px">
      <div class="icon-tile tile-accent" style="margin:0 auto;width:64px;height:64px;border-radius:20px">${icon('flask', 'ic-lg')}</div>
      <h2>${t('gate_title')}</h2><p class="muted">${t('gate_text', { lesson: lessons[idx - 1].title })}</p>
      <div><a href="/tests/${prevTest.id}?next=${encodeURIComponent(here)}" class="btn btn-primary btn-lg">${icon('flask', 'ic-sm')} ${t('start_test')}</a></div></div>`;
  else {
    const e = lesson.video_type === 'upload' ? (lesson.file_url ? { type: 'video', src: lesson.file_url } : null) : embedFor(lesson.external_url);
    const lessonAssignments = q.all('SELECT a.*, s.id sid, s.text_submission, s.file_url sfile, s.ai_feedback, s.grade, s.teacher_comment, s.status FROM assignments a LEFT JOIN submissions s ON s.assignment_id = a.id AND s.user_id = ? WHERE a.lesson_id = ? ORDER BY a.id', user.id, lesson.id);
    const materials = q.all('SELECT * FROM lesson_materials WHERE lesson_id = ? ORDER BY id', lesson.id);
    const comments = q.all('SELECT c.*, u.full_name, u.photo_url, u.email, u.role FROM lesson_comments c JOIN users u ON u.id = c.user_id WHERE c.lesson_id = ? ORDER BY c.id DESC LIMIT 100', lesson.id);
    const tabUrl = (k) => `${here}&tab=${k}#tabs`;
    let tabBody;
    if (tab === 'comments') {
      tabBody = html`<div class="stack">
        <form method="post" action="/lessons/${lesson.id}/comments" class="row" style="align-items:flex-start">${avatar(user)}<div class="grow stack-sm"><textarea class="textarea" name="comment" rows="2" required maxlength="2000" placeholder="${t('write_comment')}"></textarea><div><button class="btn btn-primary btn-sm">${icon('send', 'ic-sm')}${t('send')}</button></div></div></form>
        ${comments.length ? html`<div class="stack">${comments.map((c) => html`<div class="row" style="align-items:flex-start">${avatar(c)}<div class="grow"><div class="row-wrap small"><strong>${c.full_name || c.email}</strong>${c.role !== 'user' ? html`<span class="badge b-primary">${t('role_' + c.role)}</span>` : ''}<span class="xs muted">${fmtDate(c.created_at, lang, true)}</span></div><p class="pre" style="margin-top:4px">${c.comment}</p></div>
          ${c.user_id === user.id || staff ? html`<form method="post" action="/comments/${c.id}/delete" data-confirm="${t('confirm_delete')}"><button class="btn btn-ghost btn-xs" title="${t('delete')}">${icon('trash', 'ic-sm')}</button></form>` : ''}</div>`)}</div>` : html`<p class="muted small center">${t('no_comments')}</p>`}
      </div>`;
    } else if (tab === 'materials') {
      tabBody = html`<div class="stack">
        ${materials.length ? html`<div class="stack-sm">${materials.map((m) => html`<div class="row card card-pad-sm"><div class="icon-tile tile-info">${icon('file')}</div><span class="grow bold small">${m.title}</span>
          <a href="${m.file_url}" target="_blank" rel="noopener" class="btn btn-outline btn-sm">${icon('download', 'ic-sm')}${t('download')}</a>
          ${staff ? html`<form method="post" action="/materials/${m.id}/delete" data-confirm="${t('confirm_delete')}"><button class="btn btn-danger-ghost btn-sm">${icon('trash', 'ic-sm')}</button></form>` : ''}</div>`)}</div>` : html`<p class="muted small center">${t('no_materials')}</p>`}
        ${staff ? html`<form method="post" action="/lessons/${lesson.id}/materials" enctype="multipart/form-data" class="card card-pad-sm stack-sm"><div class="bold small">${t('add_material')}</div>
          <input class="input" name="title" required placeholder="${t('title')}"><label class="file-drop">${icon('upload', 'ic-sm')}<span data-file-label>${t('choose_file')}</span><input type="file" name="file" required></label>
          <div><button class="btn btn-primary btn-sm" data-busy="${t('uploading')}">${icon('upload', 'ic-sm')}${t('upload')}</button></div></form>` : ''}
      </div>`;
    } else {
      tabBody = lessonAssignments.length ? html`<div class="stack">${lessonAssignments.map((a) => html`<div class="card card-pad-sm stack-sm">
        <div class="row between"><h3 style="font-size:1rem;font-family:var(--font-body);font-weight:700">${a.title}</h3>${a.status ? html`<span class="badge ${a.status === 'reviewed' ? 'b-success' : 'b-info'}">${t('sub_' + a.status)}</span>` : ''}</div>
        ${a.description ? html`<div class="prose small">${markdown(a.description)}</div>` : ''}
        ${a.due_date ? html`<p class="xs muted">${icon('calendar', 'ic-sm')} ${t('due')}: ${fmtDate(a.due_date, lang)}</p>` : ''}
        ${a.sid ? html`
          ${a.text_submission ? html`<div class="card-pad-sm" style="background:var(--muted);border-radius:12px"><div class="xs muted">${t('your_answer')}</div><p class="small pre">${a.text_submission}</p></div>` : ''}
          ${a.sfile ? html`<a class="small link" href="${a.sfile}" target="_blank" rel="noopener">${t('attached_file')}</a>` : ''}
          ${a.ai_feedback ? html`<div class="card-soft card-pad-sm"><div class="xs bold text-primary row" style="gap:6px;margin-bottom:6px">${icon('sparkles', 'ic-sm')}${t('ai_feedback')}</div><div class="prose small">${markdown(a.ai_feedback)}</div></div>` : ''}
          ${a.status === 'reviewed' ? html`<div class="alert alert-success">${icon('check', 'ic-sm')}<div><strong>${t('grade')}: ${a.grade || '—'}</strong>${a.teacher_comment ? html`<div class="small">${a.teacher_comment}</div>` : ''}</div></div>` : ''}` : ''}
        ${a.status !== 'reviewed' ? html`<form method="post" action="/assignments/${a.id}/submit" enctype="multipart/form-data" class="stack-sm">
          <textarea class="textarea" name="text" rows="4" maxlength="8000" placeholder="${t('write_answer')}">${a.text_submission || ''}</textarea>
          <div class="row-wrap"><label class="file-drop" style="flex:1">${icon('file', 'ic-sm')}<span data-file-label>${t('attach_file')}</span><input type="file" name="file"></label>
          <button class="btn btn-primary btn-sm" data-busy="${t('ai_checking')}">${icon('upload', 'ic-sm')}${t(a.sid ? 'resubmit' : 'submit')}</button></div></form>` : ''}
      </div>`)}</div>` : html`<p class="muted small center">${t('no_assignments')}</p>`;
    }

    main = html`<div class="stack">
      <div class="player">${!e ? html`<div class="player-ext">${icon('play', 'ic-xl')}<span>${t('no_video')}</span></div>`
        : e.type === 'iframe' ? html`<iframe src="${e.src}" title="${lesson.title}" allowfullscreen allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"></iframe>`
        : e.type === 'video' ? html`<video src="${e.src}" controls preload="metadata" controlslist="nodownload"></video>`
        : html`<a href="${e.src}" target="_blank" rel="noopener" class="player-ext">${icon('external', 'ic-xl')}<span>${t('open_video')}</span></a>`}</div>
      <div class="row between" style="align-items:flex-start;flex-wrap:wrap">
        <div class="grow"><div class="xs muted">${t('lesson')} ${idx + 1} / ${lessons.length}</div><h2>${lesson.title}</h2>${lesson.description ? html`<div class="prose small muted" style="margin-top:6px">${markdown(lesson.description)}</div>` : ''}</div>
        ${enrolled ? (done.has(lesson.id)
          ? html`<span class="badge b-success" style="padding:8px 14px">${icon('check', 'ic-sm')}${t('completed')}</span>`
          : html`<form method="post" action="/lessons/${lesson.id}/complete"><button class="btn btn-primary btn-sm">${icon('check', 'ic-sm')}${t('mark_complete')}</button></form>`) : ''}
      </div>
      ${lessonTest(lesson.id) ? html`<div class="card card-pad-sm row"><div class="icon-tile tile-accent">${icon('flask')}</div><div class="grow"><div class="bold small">${lessonTest(lesson.id).title}</div><div class="xs muted">${t('lesson_test_hint')}</div></div>
        ${taken.has(lessonTest(lesson.id).id) ? html`<span class="badge b-success">${taken.get(lessonTest(lesson.id).id)}%</span>` : ''}<a href="/tests/${lessonTest(lesson.id).id}?next=${encodeURIComponent(here)}" class="btn btn-outline btn-sm">${t(taken.has(lessonTest(lesson.id).id) ? 'retake' : 'start_test')}</a></div>` : ''}
      <div id="tabs" class="tabs">
        <a href="${tabUrl('comments')}" class="${cx(tab === 'comments' && 'on')}">${icon('message', 'ic-sm')}${t('comments')}</a>
        <a href="${tabUrl('materials')}" class="${cx(tab === 'materials' && 'on')}">${icon('file', 'ic-sm')}${t('materials')} ${materials.length ? `(${materials.length})` : ''}</a>
        <a href="${tabUrl('assignments')}" class="${cx(tab === 'assignments' && 'on')}">${icon('clipboard', 'ic-sm')}${t('assignments')} ${lessonAssignments.length ? `(${lessonAssignments.length})` : ''}</a>
      </div>
      <div>${tabBody}</div>
    </div>`;
  }

  const courseTests = tests.filter((x) => x.test_type !== 'lesson' && x.qn > 0);
  const body = html`<main class="page"><div class="container">
    <a href="/courses/${course.slug}" class="back">${icon('arrowLeft', 'ic-sm')} ${course.title}</a>
    <div class="layout-main">
      <div class="stack-lg">
        ${main}
        ${!enrolled && lesson && canWatch(idx) ? html`<div id="enroll">${enrollPanel(ctx, course, enrollment)}</div>` : ''}
        ${courseTests.length && enrolled ? html`<div class="card-soft card-pad stack-sm"><h3 class="row">${icon('flask', 'ic-sm text-primary')}${t('course_tests')}</h3>
          ${courseTests.map((x) => html`<div class="card card-pad-sm row"><span class="badge ${x.test_type === 'final' ? 'b-accent' : 'b-info'}">${t('test_' + x.test_type)}</span><div class="grow"><div class="bold small">${x.title}</div><div class="xs muted">${x.qn} ${t('questions')} · ${x.time_limit_minutes} ${t('minutes')}${x.test_type === 'final' ? ` · ${t('pass_mark')} ${x.pass_percent}%` : ''}</div></div>
          ${taken.has(x.id) ? html`<span class="badge b-${percentColor(taken.get(x.id))}">${taken.get(x.id)}%</span>` : ''}<a href="/tests/${x.id}?next=${encodeURIComponent(here)}" class="btn btn-primary btn-sm">${t(taken.has(x.id) ? 'retake' : 'start_test')}</a></div>`)}</div>` : ''}
        ${enrolled ? html`<div class="card card-pad row" style="flex-wrap:wrap"><div class="icon-tile tile-accent">${icon('award')}</div><div class="grow"><h3>${t('certificate')}</h3><p class="small muted">${cert ? t('cert_ready') : t('cert_how')}</p></div>
          ${cert ? html`<a href="/certificates/${cert.code}" class="btn btn-primary btn-sm">${icon('award', 'ic-sm')}${t('view_certificate')}</a>` : ''}</div>` : ''}
      </div>
      <aside class="stack" style="position:sticky;top:84px">
        ${enrolled ? html`<div class="card card-pad-sm stack-sm"><div class="row between small"><strong>${t('your_progress')}</strong><span class="text-primary bold">${progress.percent}%</span></div><div class="bar"><i style="width:${progress.percent}%"></i></div><div class="xs muted">${progress.done} / ${progress.total} ${t('lessons_count')}</div></div>` : ''}
        <div class="card" style="overflow:hidden">
          <div class="card-head"><strong>${t('lessons')}</strong><span class="xs muted">${lessons.length}</span></div>
          <nav class="playlist divide" style="max-height:60vh;overflow-y:auto">${lessons.map((l, i) => html`<a href="/learn/${course.slug}?lesson=${l.id}" class="${cx(l.id === lesson?.id && 'on', !canWatch(i) && 'locked')}">
            <span class="n">${done.has(l.id) ? icon('check', 'ic-sm') : i + 1}</span>
            <span class="grow"><span class="small bold" style="display:block">${l.title}</span><span class="row xs muted" style="gap:8px">${l.duration ? html`<span class="row" style="gap:3px">${icon('clock', 'ic-sm')}${l.duration}</span>` : ''}${lessonTest(l.id) ? html`<span class="badge b-accent" style="padding:1px 7px">${t('test')}</span>` : ''}</span></span>
            ${!canWatch(i) ? icon('lock', 'ic-sm muted') : ''}</a>`)}</nav>
        </div>
      </aside>
    </div>
  </div></main>`;
  send(ctx, 200, page(ctx, { title: lesson ? `${lesson.title} — ${course.title}` : course.title, body, noindex: true }));
}

function enrollPanel(ctx, course, enrollment) {
  const { t, user } = ctx;
  const awaitingCode = enrollment && !enrollment.verified && enrollment.code_hash && enrollment.code_expires_at > new Date().toISOString();
  return html`<div class="card card-pad stack" style="max-width:560px;margin:0 auto;width:100%">
    <div class="center stack-sm"><div class="icon-tile tile-primary" style="margin:0 auto;width:60px;height:60px;border-radius:18px">${icon('lock', 'ic-lg')}</div><h2>${t('enroll_title')}</h2><p class="muted small">${t('enroll_sub')}</p></div>
    ${awaitingCode ? html`
      <div class="alert alert-info">${icon('mail', 'ic-sm')}<div>${t('code_sent_to', { email: user.email })}</div></div>
      <form method="post" action="/learn/${course.slug}/verify" class="stack">
        <label class="field"><span>${t('verification_code')}</span><input class="input code-box" name="code" inputmode="numeric" pattern="[0-9]{6}" maxlength="6" required autocomplete="one-time-code" placeholder="••••••"></label>
        <button class="btn btn-primary btn-block">${t('verify')}</button>
      </form>
      <form method="post" action="/learn/${course.slug}/enroll"><input type="hidden" name="resend" value="1"><button class="btn btn-ghost btn-sm btn-block">${t('resend_code')}</button></form>`
    : html`<form method="post" action="/learn/${course.slug}/enroll" class="stack">
        <label class="field"><span>${t('id_number')}</span><input class="input" name="id_number" value="${user.id_number || ''}" required maxlength="30" placeholder="AA1234567"></label>
        <label class="field"><span>${t('phone')}</span><input class="input" type="tel" name="phone" value="${user.phone || ''}" required maxlength="20" placeholder="+998 90 123 45 67"></label>
        <button class="btn btn-primary btn-block btn-lg" data-busy="${t('sending')}">${t('enroll_btn')}</button>
      </form>`}
  </div>`;
}

async function enroll(ctx) {
  const { course, user, enrollment } = loadCourse(ctx);
  const form = await readForm(ctx);
  rateLimit('enroll:' + user.id, 8, 60 * 60 * 1000);
  const ref = ctx.req.headers.referer ? new URL(ctx.req.headers.referer) : null;
  const back = ref && ref.pathname === `/learn/${course.slug}` ? ref.pathname + ref.search : `/learn/${course.slug}`;
  if (enrollment?.verified) return redirect(ctx, back);
  const id_number = field(form, 'id_number', 30) || enrollment?.id_number;
  const phone = field(form, 'phone', 20) || enrollment?.phone;
  if (!id_number || !phone) return redirect(ctx, back, { type: 'error', msg: ctx.t('fill_required') });
  q.update('users', user.id, { id_number, phone });

  // Without an email service the code could never arrive, so enrollment is confirmed directly.
  if (!process.env.RESEND_API_KEY) {
    q.run(`INSERT INTO enrollments (user_id, course_id, id_number, phone, verified) VALUES (?, ?, ?, ?, 1)
      ON CONFLICT(user_id, course_id) DO UPDATE SET verified = 1, id_number = excluded.id_number, phone = excluded.phone`, user.id, course.id, id_number, phone);
    notify(user.id, { type: 'enrolled', title: course.title, body: ctx.t('enrollment_success'), link: back });
    return redirect(ctx, back, { msg: ctx.t('enrollment_success') });
  }
  const code = String(crypto.randomInt(100000, 1000000));
  q.run(`INSERT INTO enrollments (user_id, course_id, id_number, phone, code_hash, code_expires_at, attempts, verified) VALUES (?, ?, ?, ?, ?, ?, 0, 0)
    ON CONFLICT(user_id, course_id) DO UPDATE SET id_number = excluded.id_number, phone = excluded.phone, code_hash = excluded.code_hash, code_expires_at = excluded.code_expires_at, attempts = 0`,
  user.id, course.id, id_number, phone, sha256(code + user.id), new Date(Date.now() + 15 * 60e3).toISOString());
  await sendEmail({ to: user.email, subject: `${course.title} — ${ctx.t('verification_code')}: ${code}`,
    text: `${user.full_name},\n\n${ctx.t('enroll_email', { course: course.title })}\n\n${code}\n\n${ctx.t('code_valid_15')}\n\nJumıs AI` });
  redirect(ctx, back, { msg: ctx.t('code_sent_to', { email: user.email }) });
}

async function verify(ctx) {
  const { course, user, enrollment } = loadCourse(ctx);
  const form = await readForm(ctx);
  const ref = ctx.req.headers.referer ? new URL(ctx.req.headers.referer) : null;
  const back = ref && ref.pathname === `/learn/${course.slug}` ? ref.pathname + ref.search : `/learn/${course.slug}`;
  if (!enrollment || enrollment.verified) return redirect(ctx, back);
  if (enrollment.attempts >= 5 || enrollment.code_expires_at < new Date().toISOString()) {
    q.run('UPDATE enrollments SET code_hash = NULL WHERE id = ?', enrollment.id);
    return redirect(ctx, back, { type: 'error', msg: ctx.t('code_expired') });
  }
  if (sha256(field(form, 'code', 10) + user.id) !== enrollment.code_hash) {
    q.run('UPDATE enrollments SET attempts = attempts + 1 WHERE id = ?', enrollment.id);
    return redirect(ctx, back, { type: 'error', msg: ctx.t('invalid_code') });
  }
  q.run('UPDATE enrollments SET verified = 1, code_hash = NULL WHERE id = ?', enrollment.id);
  notify(user.id, { type: 'enrolled', title: course.title, body: ctx.t('enrollment_success'), link: back });
  redirect(ctx, back, { msg: ctx.t('enrollment_success') });
}

// ─── Lesson actions ───────────────────────────────────────────────────────────
function lessonWithCourse(id) {
  const lesson = q.get('SELECT * FROM lessons WHERE id = ?', Number(id));
  if (!lesson) throw new HttpError(404);
  const course = q.get('SELECT * FROM courses WHERE id = ?', lesson.course_id);
  return { lesson, course };
}

function complete(ctx) {
  const user = requireUser(ctx);
  const { lesson, course } = lessonWithCourse(ctx.params.id);
  if (!access(user, course).enrolled) throw new HttpError(403);
  q.run('INSERT OR IGNORE INTO lesson_progress (user_id, lesson_id) VALUES (?, ?)', user.id, lesson.id);
  const certCode = maybeIssueCertificate(user.id, course);
  const next = q.get('SELECT id FROM lessons WHERE course_id = ? AND (sort_order > ? OR (sort_order = ? AND id > ?)) ORDER BY sort_order, id LIMIT 1', course.id, lesson.sort_order, lesson.sort_order, lesson.id);
  if (certCode) return redirect(ctx, `/certificates/${certCode}`, { msg: ctx.t('cert_issued') });
  redirect(ctx, `/learn/${course.slug}?lesson=${next ? next.id : lesson.id}`, { msg: ctx.t('lesson_completed') });
}

async function addComment(ctx) {
  const user = requireUser(ctx);
  const { lesson, course } = lessonWithCourse(ctx.params.id);
  const first = q.get('SELECT id FROM lessons WHERE course_id = ? ORDER BY sort_order, id LIMIT 1', course.id);
  if (!access(user, course).enrolled && first?.id !== lesson.id) throw new HttpError(403);
  const form = await readForm(ctx);
  const comment = field(form, 'comment', 2000);
  rateLimit('comment:' + user.id, 30, 10 * 60 * 1000);
  if (comment) q.insert('lesson_comments', { lesson_id: lesson.id, user_id: user.id, comment });
  if (comment && course.owner_id && course.owner_id !== user.id) {
    notify(course.owner_id, { type: 'comment', title: `💬 ${lesson.title}`, body: `${user.full_name}: ${comment.slice(0, 120)}`, link: `/learn/${course.slug}?lesson=${lesson.id}` });
  }
  redirect(ctx, `/learn/${course.slug}?lesson=${lesson.id}&tab=comments#tabs`);
}

function deleteComment(ctx) {
  const user = requireUser(ctx);
  const c = q.get('SELECT c.*, l.course_id FROM lesson_comments c JOIN lessons l ON l.id = c.lesson_id WHERE c.id = ?', Number(ctx.params.id));
  if (!c) throw new HttpError(404);
  const course = q.get('SELECT * FROM courses WHERE id = ?', c.course_id);
  if (c.user_id !== user.id && !access(user, course).staff) throw new HttpError(403);
  q.run('DELETE FROM lesson_comments WHERE id = ?', c.id);
  redirect(ctx, `/learn/${course.slug}?lesson=${c.lesson_id}&tab=comments#tabs`);
}

async function addMaterial(ctx) {
  const user = requireUser(ctx);
  const { lesson, course } = lessonWithCourse(ctx.params.id);
  if (!access(user, course).staff) throw new HttpError(403);
  const form = await readForm(ctx);
  const file = fileField(form, 'file');
  const title = field(form, 'title', 200);
  if (!file || !title) throw new HttpError(400, ctx.t('fill_required'));
  const url = await saveUpload(file, 'document');
  q.insert('lesson_materials', { lesson_id: lesson.id, title, file_url: url });
  redirect(ctx, `/learn/${course.slug}?lesson=${lesson.id}&tab=materials#tabs`, { msg: ctx.t('saved') });
}

function deleteMaterial(ctx) {
  const user = requireUser(ctx);
  const m = q.get('SELECT m.*, l.course_id FROM lesson_materials m JOIN lessons l ON l.id = m.lesson_id WHERE m.id = ?', Number(ctx.params.id));
  if (!m) throw new HttpError(404);
  const course = q.get('SELECT * FROM courses WHERE id = ?', m.course_id);
  if (!access(user, course).staff) throw new HttpError(403);
  q.run('DELETE FROM lesson_materials WHERE id = ?', m.id);
  redirect(ctx, `/learn/${course.slug}?lesson=${m.lesson_id}&tab=materials#tabs`);
}

async function submitAssignment(ctx) {
  const user = requireUser(ctx);
  const a = q.get('SELECT * FROM assignments WHERE id = ?', Number(ctx.params.id));
  if (!a) throw new HttpError(404);
  const course = q.get('SELECT * FROM courses WHERE id = ?', a.course_id);
  if (!access(user, course).enrolled) throw new HttpError(403);
  const existing = q.get('SELECT * FROM submissions WHERE assignment_id = ? AND user_id = ?', a.id, user.id);
  if (existing?.status === 'reviewed') throw new HttpError(400, ctx.t('already_reviewed'));
  const form = await readForm(ctx);
  const text = field(form, 'text', 8000);
  const file = fileField(form, 'file');
  if (!text && !file && !existing?.file_url) throw new HttpError(400, ctx.t('answer_required'));
  rateLimit('submit:' + user.id, 20, 60 * 60 * 1000);
  const file_url = file ? await saveUpload(file, 'document') : existing?.file_url || null;

  let ai_feedback = null;
  try {
    ai_feedback = await askAI({
      lang: ctx.lang, maxTokens: 600, mock: LANG_MOCK('assignment'),
      system: 'You are a supportive teacher giving short, constructive feedback.',
      prompt: `Assignment: "${a.title}"\n${a.description || ''}\n\nStudent's answer:\n"""${text || '[The student attached a file instead of writing text.]'}"""\n\nWrite brief feedback (3-4 sentences): what was done well, what to improve, and one concrete tip. Do not invent content of attached files.`,
    });
  } catch (e) { if (e.code !== 'AI_NOT_CONFIGURED') console.error(e.message); }

  q.run(`INSERT INTO submissions (assignment_id, user_id, text_submission, file_url, ai_feedback, status) VALUES (?, ?, ?, ?, ?, 'submitted')
    ON CONFLICT(assignment_id, user_id) DO UPDATE SET text_submission = excluded.text_submission, file_url = excluded.file_url, ai_feedback = excluded.ai_feedback, created_at = datetime('now')`,
  a.id, user.id, text, file_url, ai_feedback);
  if (course.owner_id && course.owner_id !== user.id) {
    notify(course.owner_id, { type: 'submission', title: `📝 ${a.title}`, body: `${user.full_name} — ${course.title}`, link: '/admin/submissions' });
  }
  redirect(ctx, `/learn/${course.slug}?lesson=${a.lesson_id || ''}&tab=assignments#tabs`, { msg: ctx.t(ai_feedback ? 'submitted_ai' : 'submitted') });
}

// ─── Tests ────────────────────────────────────────────────────────────────────
function loadTest(ctx) {
  const user = requireUser(ctx);
  const test = q.get('SELECT * FROM tests WHERE id = ?', Number(ctx.params.id));
  if (!test) throw new HttpError(404);
  const course = q.get('SELECT * FROM courses WHERE id = ?', test.course_id);
  const a = access(user, course);
  if (!course.is_published && !a.staff) throw new HttpError(404);
  if (test.test_type !== 'level' && !a.enrolled) throw new HttpError(403);
  const questions = q.all('SELECT * FROM test_questions WHERE test_id = ? ORDER BY sort_order, id', test.id);
  return { user, test, course, questions };
}

export function quizForm(ctx, { action, questions, seconds, title, subtitle, nextHidden = '' }) {
  const { t } = ctx;
  return html`<form method="post" action="${action}" data-quiz data-seconds="${seconds}" class="narrow stack">
    <input type="hidden" name="time_taken" value="0">${nextHidden}
    <div class="stack-sm"><div class="row between small"><span class="muted">${title}</span><span class="row bold timer" data-timer style="gap:5px">${icon('clock', 'ic-sm')}${seconds}s</span></div>
      <div class="bar thin"><i data-progress style="width:0"></i></div><div class="xs muted" data-count>${subtitle}</div></div>
    ${questions.map((qq, i) => html`<div class="quiz-q ${i === 0 ? 'on' : ''}">
      <div class="card card-pad stack-sm" style="margin-bottom:14px">${qq.topic || qq.category ? html`<span class="badge b-primary">${qq.topic || qq.category}</span>` : ''}<p style="font-size:1.12rem;font-weight:500">${i + 1}. ${qq.question}</p></div>
      <div class="stack-sm">${['a', 'b', 'c', 'd'].filter((k) => qq['option_' + k]).map((k) => html`<label class="quiz-opt"><input type="radio" name="q_${qq.id}" value="${k}"><span class="k">${k}</span><span>${qq['option_' + k]}</span></label>`)}</div>
    </div>`)}
    <button class="btn btn-primary btn-lg btn-block" data-qnext data-label-next="${t('next_question')}" data-label-finish="${t('finish_test')}" data-label-busy="${t('ai_analyzing')}"><span>${t('finish_test')}</span>${icon('chevronRight', 'ic-sm')}</button>
    <noscript><p class="xs muted center">${t('noscript_quiz')}</p></noscript>
  </form>`;
}

function testPage(ctx) {
  const { t } = ctx;
  const { test, course, questions } = loadTest(ctx);
  const next = safeNext(ctx.url.searchParams.get('next'), `/learn/${course.slug}`);
  const per = Math.max(15, Math.floor((test.time_limit_minutes * 60) / Math.max(1, questions.length)));
  const start = ctx.url.searchParams.get('start') === '1';
  let body;
  if (!questions.length) body = html`<div class="card narrow">${emptyState(t('no_questions'), 'flask')}</div>`;
  else if (!start) {
    body = html`<div class="card card-pad narrow center stack" style="padding:44px 24px">
      <span class="badge ${test.test_type === 'final' ? 'b-accent' : 'b-info'}" style="margin:0 auto">${t('test_' + test.test_type)}</span>
      <h1>${test.title}</h1><p class="muted">${course.title}</p>
      <div class="row-wrap" style="justify-content:center;gap:24px">
        <div><div style="font-family:var(--font-head);font-size:1.8rem">${questions.length}</div><div class="xs muted">${t('questions')}</div></div>
        <div><div style="font-family:var(--font-head);font-size:1.8rem">${per}s</div><div class="xs muted">${t('per_question')}</div></div>
        ${test.test_type === 'final' ? html`<div><div style="font-family:var(--font-head);font-size:1.8rem">${test.pass_percent}%</div><div class="xs muted">${t('pass_mark')}</div></div>` : ''}
      </div>
      <p class="small muted">${t('test_rules')}</p>
      <div class="row" style="justify-content:center"><a href="${next}" class="btn btn-outline">${t('back')}</a><a href="/tests/${test.id}?start=1&next=${encodeURIComponent(next)}" class="btn btn-primary btn-lg">${icon('play', 'ic-sm')} ${t('start_test')}</a></div>
    </div>`;
  } else {
    body = quizForm(ctx, { action: `/tests/${test.id}?next=${encodeURIComponent(next)}`, questions, seconds: per, title: test.title, subtitle: `1 / ${questions.length}` });
  }
  send(ctx, 200, page(ctx, { title: test.title, body: html`<main class="page"><div class="container">${body}</div></main>`, noindex: true }));
}

/** Score answers; returns { score, total, topics, answers, details } */
export function grade(form, questions, topicKey = 'topic') {
  let score = 0;
  const topics = {};
  const answers = {};
  const details = [];
  for (const qq of questions) {
    const ans = field(form, `q_${qq.id}`, 2);
    answers[qq.id] = ans;
    const topic = qq[topicKey] || 'General';
    topics[topic] ||= { correct: 0, total: 0 };
    topics[topic].total++;
    const ok = ans === qq.correct;
    if (ok) { score++; topics[topic].correct++; }
    details.push(`Q${details.length + 1} [${topic}] "${qq.question}" — answered: ${ans ? ans.toUpperCase() + ') ' + (qq['option_' + ans] || '') : 'no answer'}; correct: ${qq.correct.toUpperCase()}) ${qq['option_' + qq.correct] || ''} ${ok ? '✓' : '✗'}`);
  }
  return { score, total: questions.length, topics, answers, details };
}

async function submitTest(ctx) {
  const { user, test, course, questions } = loadTest(ctx);
  if (!questions.length) throw new HttpError(400);
  const form = await readForm(ctx);
  const g = grade(form, questions);
  const percentage = Math.round((g.score / g.total) * 100);
  let ai_analysis = null;
  try {
    ai_analysis = await askAI({
      lang: ctx.lang, maxTokens: 700, mock: LANG_MOCK('test'),
      system: 'You analyse test results for a student and give precise, encouraging study advice.',
      prompt: `Test "${test.title}" (course "${course.title}"). Score ${g.score}/${g.total} (${percentage}%).\nTopic scores: ${Object.entries(g.topics).map(([k, v]) => `${k}: ${v.correct}/${v.total}`).join(', ')}\n\nQuestion breakdown:\n${g.details.join('\n')}\n\nWrite a short personalised analysis (4-6 sentences, you may use a short bullet list): strong topics, what to review based on the wrong answers, and one specific next step.`,
    });
  } catch (e) { if (e.code !== 'AI_NOT_CONFIGURED') console.error(e.message); }
  const id = q.insert('test_results', {
    user_id: user.id, test_id: test.id, score: g.score, total: g.total, percentage,
    topic_scores: JSON.stringify(g.topics), answers: JSON.stringify(g.answers), ai_analysis,
    time_taken_seconds: Number(field(form, 'time_taken', 10)) || null,
  });
  if (test.test_type === 'final') maybeIssueCertificate(user.id, course);
  redirect(ctx, `/results/${id}?next=${encodeURIComponent(safeNext(ctx.url.searchParams.get('next'), `/learn/${course.slug}`))}`);
}

function resultPage(ctx) {
  const { t } = ctx;
  const user = requireUser(ctx);
  const r = q.get('SELECT r.*, t.title, t.test_type, t.pass_percent, t.course_id FROM test_results r JOIN tests t ON t.id = r.test_id WHERE r.id = ?', Number(ctx.params.id));
  if (!r) throw new HttpError(404);
  const course = q.get('SELECT * FROM courses WHERE id = ?', r.course_id);
  if (r.user_id !== user.id && !access(user, course).staff) throw new HttpError(403);
  const questions = q.all('SELECT * FROM test_questions WHERE test_id = ? ORDER BY sort_order, id', r.test_id);
  const answers = json.parse(r.answers, {});
  const next = safeNext(ctx.url.searchParams.get('next'), `/learn/${course.slug}`);
  const cert = q.get('SELECT code FROM certificates WHERE user_id = ? AND course_id = ?', r.user_id, course.id);
  const color = percentColor(r.percentage);
  const passed = r.test_type !== 'final' || r.percentage >= r.pass_percent;
  const body = html`<main class="page"><div class="container narrow stack-lg">
    <div class="card card-pad center stack">
      <div class="score-ring" style="background:var(--${color}-soft,var(--muted));color:var(--${color === 'accent' ? 'warn' : color})">${r.percentage}%</div>
      <h1 style="font-size:1.6rem">${r.percentage >= 70 ? t('result_great') : r.percentage >= 40 ? t('result_ok') : t('result_low')}</h1>
      <p class="muted">${r.title} · ${r.score} / ${r.total} ${t('correct')}${r.time_taken_seconds ? ` · ${Math.floor(r.time_taken_seconds / 60)}m ${r.time_taken_seconds % 60}s` : ''}</p>
      ${r.test_type === 'final' ? html`<div class="alert ${passed ? 'alert-success' : 'alert-warn'}" style="justify-content:center">${icon(passed ? 'check' : 'alert', 'ic-sm')}${t(passed ? 'final_passed' : 'final_failed', { n: r.pass_percent })}</div>` : ''}
      <div class="row" style="justify-content:center;flex-wrap:wrap">
        <a href="/tests/${r.test_id}?next=${encodeURIComponent(next)}" class="btn btn-outline">${icon('refresh', 'ic-sm')}${t('retake')}</a>
        ${cert ? html`<a href="/certificates/${cert.code}" class="btn btn-accent">${icon('award', 'ic-sm')}${t('view_certificate')}</a>` : ''}
        <a href="${next}" class="btn btn-primary">${t('continue')} ${icon('chevronRight', 'ic-sm')}</a>
      </div>
    </div>
    ${r.ai_analysis ? html`<div class="card-soft card-pad"><div class="bold text-primary row" style="margin-bottom:10px">${icon('sparkles', 'ic-sm')}${t('ai_analysis')}</div><div class="prose">${markdown(r.ai_analysis)}</div></div>` : ''}
    <div class="card card-pad"><h3 style="margin-bottom:14px">${t('by_topic')}</h3>${scoreBars(ctx, json.parse(r.topic_scores, {}))}</div>
    <div class="card"><div class="card-head"><h3>${t('review_answers')}</h3></div><div class="divide">${questions.map((qq, i) => {
      const a = answers[qq.id]; const ok = a === qq.correct;
      return html`<div class="card-pad-sm stack-sm" style="padding:16px 20px"><div class="row" style="align-items:flex-start">${icon(ok ? 'check' : 'x', 'ic ' + (ok ? 'text-success' : 'text-danger'))}<div class="grow"><p class="bold small">${i + 1}. ${qq.question}</p>
        <p class="xs ${ok ? 'text-success' : 'text-danger'}">${t('your_answer')}: ${a ? `${a.toUpperCase()}) ${qq['option_' + a] || ''}` : '—'}</p>
        ${!ok ? html`<p class="xs text-success">${t('correct_answer')}: ${qq.correct.toUpperCase()}) ${qq['option_' + qq.correct] || ''}</p>` : ''}</div></div></div>`; })}</div></div>
  </div></main>`;
  send(ctx, 200, page(ctx, { title: r.title, body, noindex: true }));
}

// ─── Certificates (public verification page) ─────────────────────────────────
function certificatePage(ctx) {
  const { t } = ctx;
  const c = q.get('SELECT c.*, u.full_name, i.full_name issuer FROM certificates c JOIN users u ON u.id = c.user_id LEFT JOIN users i ON i.id = c.issued_by WHERE c.code = ?', ctx.params.code);
  if (!c) throw new HttpError(404);
  const body = html`<main class="page"><div class="container stack">
    <div class="row between no-print" style="flex-wrap:wrap"><a href="/dashboard" class="back" style="margin:0">${icon('arrowLeft', 'ic-sm')} ${t('nav_home')}</a>
      <div class="row">${c.file_url ? html`<a href="${c.file_url}" target="_blank" rel="noopener" class="btn btn-outline btn-sm">${icon('download', 'ic-sm')}${t('download')}</a>` : ''}<button class="btn btn-primary btn-sm" onclick="window.print()">${icon('print', 'ic-sm')}${t('print_pdf')}</button></div></div>
    <div class="cert">
      <div class="row" style="gap:10px;justify-content:center">${raw('<svg width="44" height="44" viewBox="0 0 32 32" fill="none"><circle cx="16" cy="16" r="15" stroke="#0E8A5F" stroke-width="1.5"/><circle cx="8" cy="20" r="2" fill="#0E8A5F"/><circle cx="16" cy="14" r="2" fill="#0E8A5F"/><circle cx="23" cy="9" r="2" fill="#F2A83A"/><path d="M10 19.5 Q14 13 22 9.5" stroke="#0E8A5F" stroke-width="1.5" stroke-dasharray="2 2" fill="none"/></svg>')}<span style="font-family:var(--font-head);font-size:1.4rem">Jumıs AI</span></div>
      <p style="margin-top:22px;letter-spacing:.2em;text-transform:uppercase;font-size:13px;color:#5E7A92">${t('cert_of_completion')}</p>
      <h1 style="margin-top:6px">${t('certificate')}</h1>
      <p style="margin-top:18px;color:#5E7A92">${t('cert_presented_to')}</p>
      <div class="who">${c.full_name}</div>
      <p style="max-width:560px">${t('cert_for_completing')} <strong>«${c.course_title}»</strong>${c.score != null ? ` — ${t('final_score')}: ${c.score}%` : ''}</p>
      <div class="row" style="justify-content:space-between;width:100%;margin-top:36px;font-size:13px;color:#5E7A92">
        <div style="text-align:left"><div>${t('date')}</div><strong style="color:#0D1B2A">${fmtDate(c.issued_date, ctx.lang)}</strong></div>
        ${c.issuer ? html`<div><div>${t('teacher')}</div><strong style="color:#0D1B2A">${c.issuer}</strong></div>` : ''}
        <div style="text-align:right"><div>${t('cert_id')}</div><strong style="color:#0D1B2A">${c.code}</strong></div>
      </div>
      <p style="margin-top:18px;font-size:11px;color:#7A9BB5">${t('cert_verify')}: ${config.siteUrl}/certificates/${c.code}</p>
    </div></div></main>`;
  send(ctx, 200, page(ctx, { title: `${t('certificate')} — ${c.full_name}`, body, noindex: true }));
}

export default function (r) {
  r.get('/learn/:slug', learnPage);
  r.post('/learn/:slug/enroll', enroll);
  r.post('/learn/:slug/verify', verify);
  r.post('/lessons/:id/complete', complete);
  r.post('/lessons/:id/comments', addComment);
  r.post('/comments/:id/delete', deleteComment);
  r.post('/lessons/:id/materials', addMaterial);
  r.post('/materials/:id/delete', deleteMaterial);
  r.post('/assignments/:id/submit', submitAssignment);
  r.get('/tests/:id', testPage);
  r.post('/tests/:id', submitTest);
  r.get('/results/:id', resultPage);
  r.get('/certificates/:code', certificatePage);
}
