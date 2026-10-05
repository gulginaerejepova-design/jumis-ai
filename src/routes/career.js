// Careers: Ziyrek AI career assistant, skill test, applying to jobs, vacancy management (organizations & admins).
import { q, notify, json, uniqueSlug } from '../db.js';
import { send, redirect, readForm, field, fileField, HttpError } from '../http.js';
import { requireUser, isAdmin, rateLimit } from '../auth.js';
import { askAI, aiConfigured, saveUpload, sendEmail } from '../services.js';
import { page, pageHead } from '../views/layout.js';
import { panelPage } from '../views/panel.js';
import { html, raw, cx, markdown } from '../views/html.js';
import { icon } from '../views/icons.js';
import { emptyState, fmtDate, avatar, scoreBars, percentColor, aiNotConfigured, JOB_TYPES, EXP_LEVELS, jobTypeBadge } from '../views/components.js';
import { activeVacancies, publishedCourses } from './public.js';
import { courseProgress, quizForm, grade } from './learn.js';
import { config } from '../env.js';

// ─── Ziyrek AI career assistant ───────────────────────────────────────────────
const SECTIONS = [
  ['cv_analysis', 'brain', 'tile-primary'], ['readiness', 'target', 'tile-accent'], ['skill_gaps', 'alert', 'tile-danger'],
  ['matched_vacancies', 'briefcase', 'tile-success'], ['recommended_courses', 'book', 'tile-info'], ['roadmap', 'map', 'tile-purple'],
];

function aiAssistant(ctx) {
  const { t, user, lang } = ctx;
  if (!user) {
    const body = html`<main class="page"><div class="container narrow center stack" style="padding-top:20px">
      <div class="icon-tile tile-solid" style="margin:0 auto;width:72px;height:72px;border-radius:22px">${icon('sparkles', 'ic-lg')}</div>
      <h1>${t('ai_title')}</h1><p class="muted">${t('ai_sub')}</p>
      <div class="grid g3" style="text-align:left;margin-top:12px">${SECTIONS.slice(0, 6).map(([k, ic, tile]) => html`<div class="card card-pad-sm row"><div class="icon-tile ${tile}">${icon(ic, 'ic-sm')}</div><span class="small bold">${t('ai_' + k)}</span></div>`)}</div>
      <div><a href="/register?next=/ai-assistant" class="btn btn-ai btn-lg">${icon('sparkles', 'ic-sm')}${t('start_free')}</a></div></div></main>`;
    return send(ctx, 200, page(ctx, { title: t('ai_title'), description: t('ai_sub'), body }));
  }
  const report = q.get("SELECT * FROM ai_reports WHERE user_id = ? AND kind = 'career' ORDER BY id DESC LIMIT 1", user.id);
  const data = json.parse(report?.result, null);
  const files = q.get('SELECT COUNT(*) n FROM user_files WHERE user_id = ?', user.id).n;
  const complete = Boolean(user.bio && (user.cv_url || files));

  const sectionBody = (k) => {
    const v = data?.[k];
    if (k === 'matched_vacancies' || k === 'recommended_courses') {
      const table = k === 'matched_vacancies' ? 'vacancies' : 'courses';
      const items = (Array.isArray(v) ? v : []).map((it) => ({ ...it, row: q.get(`SELECT * FROM ${table} WHERE id = ?`, Number(it.id)) })).filter((it) => it.row);
      if (!items.length) return html`<p class="muted small">${t('ai_no_items')}</p>`;
      return html`<div class="stack-sm">${items.map((it) => html`<a href="/${table}/${it.row.slug}" class="card card-pad-sm row card-hover" style="align-items:flex-start">
        <div class="icon-tile ${k === 'matched_vacancies' ? 'tile-success' : 'tile-info'}">${icon(k === 'matched_vacancies' ? 'briefcase' : 'book', 'ic-sm')}</div>
        <div class="grow"><div class="bold small">${it.row.title}${it.row.organization ? html` <span class="muted">· ${it.row.organization}</span>` : ''}</div><p class="xs muted" style="margin-top:3px">${it.why || ''}</p></div>
        ${it.match != null ? html`<span class="badge b-success">${it.match}%</span>` : ''}</a>`)}</div>`;
    }
    return html`<div class="prose small">${markdown(typeof v === 'string' ? v : '')}</div>`;
  };

  const body = html`<main class="page"><div class="container" style="max-width:860px">
    <div class="center stack" style="margin-bottom:28px">
      <div class="icon-tile tile-solid" style="margin:0 auto;width:64px;height:64px;border-radius:20px;background:linear-gradient(135deg,var(--primary),var(--accent))">${icon('sparkles', 'ic-lg')}</div>
      <h1>${t('ai_title')}</h1><p class="muted">${t('ai_sub')}</p>
    </div>
    <div class="stack">
      ${!aiConfigured() ? aiNotConfigured(ctx) : ''}
      ${!complete ? html`<div class="alert alert-warn">${icon('alert')}<div class="grow"><strong>${t('ai_profile_incomplete')}</strong><div class="small">${t('ai_profile_hint')}</div></div><a href="/profile?tab=documents" class="btn btn-outline btn-sm">${t('complete_profile')}</a></div>` : ''}
      <form method="post" action="/ai-assistant" class="center">
        <button class="btn btn-ai btn-lg" data-busy="${t('ai_analyzing_long')}" ${!aiConfigured() ? raw('disabled') : ''}>${icon(data ? 'refresh' : 'sparkles', 'ic-sm')}<span>${t(data ? 'ai_reanalyze' : 'ai_analyze_btn')}</span></button>
        ${report ? html`<p class="xs muted" style="margin-top:8px">${t('last_analysis')}: ${fmtDate(report.created_at, lang, true)}</p>` : ''}
      </form>
      ${data ? html`<div>${SECTIONS.map(([k, ic, tile], i) => html`<details class="acc" ${i < 2 ? raw('open') : ''}><summary><span class="icon-tile ${tile}" style="width:36px;height:36px">${icon(ic, 'ic-sm')}</span>${t('ai_' + k)}${icon('chevronDown', 'ic-sm chev')}</summary><div class="acc-body" style="padding-top:16px">${sectionBody(k)}</div></details>`)}</div>`
        : html`<div class="card">${emptyState(t('ai_empty'), 'brain')}</div>`}
    </div></div></main>`;
  send(ctx, 200, page(ctx, { title: t('ai_title'), body, noindex: true }));
}

async function runAiAssistant(ctx) {
  const user = requireUser(ctx);
  rateLimit('career-ai:' + user.id, 6, 60 * 60 * 1000);
  const files = q.all('SELECT kind, name FROM user_files WHERE user_id = ?', user.id);
  const courseCerts = q.all('SELECT course_title, score FROM certificates WHERE user_id = ?', user.id);
  const enrolled = q.all('SELECT c.id, c.title FROM courses c JOIN enrollments e ON e.course_id = c.id WHERE e.user_id = ? AND e.verified = 1', user.id)
    .map((c) => `${c.title} (${courseProgress(user.id, c.id).percent}% done)`);
  const skill = q.get('SELECT * FROM skill_results WHERE user_id = ? ORDER BY id DESC LIMIT 1', user.id);
  const tests = q.all('SELECT t.title, MAX(r.percentage) best FROM test_results r JOIN tests t ON t.id = r.test_id WHERE r.user_id = ? GROUP BY r.test_id LIMIT 15', user.id);
  const vacancies = activeVacancies({ limit: 25 });
  const courses = publishedCourses({ limit: 20 });

  const prompt = `Analyse this user's profile and give personalised career guidance.

USER PROFILE
Name: ${user.full_name}
Account type: ${user.user_type || 'student'}
Bio: ${user.bio || 'not provided'}
Goals: ${user.future_goals || 'not provided'}
CV: ${user.cv_url ? (user.cv_url.toLowerCase().endsWith('.pdf') ? 'attached above as a PDF — read it carefully' : 'uploaded (not PDF, content unavailable)') : 'not uploaded'}
Uploaded certificates: ${files.filter((f) => f.kind === 'certificate').map((f) => f.name).join(', ') || 'none'}
Awards: ${files.filter((f) => f.kind === 'award').map((f) => f.name).join(', ') || 'none'}
Platform certificates: ${courseCerts.map((c) => c.course_title + (c.score != null ? ` (${c.score}%)` : '')).join(', ') || 'none'}
Enrolled courses: ${enrolled.join('; ') || 'none'}
Skill test (latest): ${skill ? Object.entries(json.parse(skill.category_scores, {})).map(([k, v]) => `${k} ${v.correct}/${v.total}`).join(', ') : 'not taken'}
Course test results: ${tests.map((x) => `${x.title}: ${x.best}%`).join('; ') || 'none'}

ACTIVE VACANCIES (id | title | organization | type | level | description)
${vacancies.map((v) => `${v.id} | ${v.title} | ${v.organization} | ${v.job_type} | ${v.experience_level} | ${(v.description || '').replace(/\s+/g, ' ').slice(0, 160)}`).join('\n') || 'none'}

PUBLISHED COURSES (id | title | category | description)
${courses.map((c) => `${c.id} | ${c.title} | ${c.category || ''} | ${(c.description || '').replace(/\s+/g, ' ').slice(0, 100)}`).join('\n') || 'none'}

Return JSON with exactly these keys:
{
 "cv_analysis": "markdown: skills, experience, education, strengths and weaknesses",
 "readiness": "markdown: readiness for junior / middle / senior roles with reasons",
 "skill_gaps": "markdown bullet list of missing skills for their likely target roles",
 "matched_vacancies": [{"id": <vacancy id from the list>, "match": <0-100>, "why": "one sentence"}],
 "recommended_courses": [{"id": <course id from the list>, "why": "one sentence"}],
 "roadmap": "markdown with three parts: 1–3 months, 3–6 months, 6–12 months"
}
Use only ids from the lists (max 4 vacancies, max 4 courses; empty arrays if nothing fits). Be specific and practical.`;

  let result;
  try {
    result = await askAI({
      lang: ctx.lang, json: true, maxTokens: 3500, pdfUrls: [user.cv_url], prompt,
      system: 'You are a professional career advisor for young people in Karakalpakstan and Uzbekistan.',
      mock: () => ({
        cv_analysis: '**Strengths:** motivated learner, good communication.\n\n**To improve:** add concrete projects and measurable results to your CV.',
        readiness: 'You are ready for **junior** and internship roles. Middle roles need 1–2 years of practice.',
        skill_gaps: '- Practical portfolio projects\n- English for technical reading\n- Teamwork tools (Git, Trello)',
        matched_vacancies: vacancies.slice(0, 2).map((v, i) => ({ id: v.id, match: 85 - i * 10, why: 'Matches your level and interests.' })),
        recommended_courses: courses.slice(0, 2).map((c) => ({ id: c.id, why: 'Closes one of your skill gaps.' })),
        roadmap: '**1–3 months:** finish one course and build a small project.\n\n**3–6 months:** apply to internships.\n\n**6–12 months:** aim for a junior position.',
      }),
    });
  } catch (e) {
    if (e.code === 'AI_NOT_CONFIGURED') return redirect(ctx, '/ai-assistant', { type: 'error', msg: ctx.t('ai_not_configured') });
    console.error(e.message);
    return redirect(ctx, '/ai-assistant', { type: 'error', msg: ctx.t('ai_error') });
  }
  q.insert('ai_reports', { user_id: user.id, kind: 'career', result: JSON.stringify(result) });
  redirect(ctx, '/ai-assistant', { msg: ctx.t('ai_done') });
}

// ─── Skill test ───────────────────────────────────────────────────────────────
const SKILL_SECONDS = 30;

function skillTest(ctx) {
  const { t, user } = ctx;
  const count = q.get('SELECT COUNT(*) n FROM skill_questions').n;
  const start = ctx.url.searchParams.get('start') === '1';
  let body;
  if (!count) body = html`<div class="card narrow">${emptyState(t('no_questions_admin'), 'brain')}</div>`;
  else if (!start || !user) {
    const last = user ? q.get('SELECT * FROM skill_results WHERE user_id = ? ORDER BY id DESC LIMIT 1', user.id) : null;
    const cats = q.all('SELECT category, COUNT(*) n FROM skill_questions GROUP BY category ORDER BY n DESC');
    body = html`<div class="narrow stack">
      <div class="card card-pad center stack" style="padding:44px 24px">
        <div class="icon-tile tile-primary" style="margin:0 auto;width:64px;height:64px;border-radius:20px">${icon('brain', 'ic-lg')}</div>
        <h1>${t('skill_title')}</h1><p class="muted">${t('skill_sub')}</p>
        <div class="chip-row" style="justify-content:center">${cats.map((c) => html`<span class="badge b-primary">${c.category}</span>`)}</div>
        <div class="row-wrap" style="justify-content:center;gap:28px"><div><div style="font-family:var(--font-head);font-size:1.8rem">${Math.min(20, count)}</div><div class="xs muted">${t('questions')}</div></div><div><div style="font-family:var(--font-head);font-size:1.8rem">${SKILL_SECONDS}s</div><div class="xs muted">${t('per_question')}</div></div></div>
        <div><a href="${user ? '/skill-test?start=1' : '/login?next=' + encodeURIComponent('/skill-test?start=1')}" class="btn btn-primary btn-lg">${icon('play', 'ic-sm')}${t('start_test')}</a></div>
      </div>
      ${last ? html`<a href="/skill-test/result/${last.id}" class="card card-pad-sm row card-hover"><span class="badge b-${percentColor(Math.round((last.score / last.total) * 100))}">${Math.round((last.score / last.total) * 100)}%</span><span class="grow small">${t('last_result')} · ${fmtDate(last.created_at, ctx.lang)}</span>${icon('chevronRight', 'ic-sm muted')}</a>` : ''}
    </div>`;
  } else {
    const questions = q.all('SELECT * FROM skill_questions ORDER BY RANDOM() LIMIT 20');
    body = quizForm(ctx, {
      action: '/skill-test', questions, seconds: SKILL_SECONDS, title: t('skill_title'), subtitle: `1 / ${questions.length}`,
      nextHidden: html`<input type="hidden" name="ids" value="${questions.map((x) => x.id).join(',')}">`,
    });
  }
  send(ctx, 200, page(ctx, { title: t('skill_title'), description: t('skill_sub'), body: html`<main class="page"><div class="container">${body}</div></main>`, noindex: start }));
}

async function submitSkillTest(ctx) {
  const user = requireUser(ctx);
  const form = await readForm(ctx);
  const ids = field(form, 'ids', 400).split(',').map(Number).filter(Boolean).slice(0, 30);
  if (!ids.length) throw new HttpError(400);
  const questions = q.all(`SELECT * FROM skill_questions WHERE id IN (${ids.map(() => '?').join(',')})`, ...ids);
  const g = grade(form, questions, 'category');
  let ai_analysis = null;
  try {
    ai_analysis = await askAI({
      lang: ctx.lang, maxTokens: 700,
      mock: '**Strengths:** the categories in green.\n\n**Grow next:** focus on the red categories with one short course each.',
      system: 'You give short, encouraging skill assessments with concrete next steps.',
      prompt: `General skill test: ${g.score}/${g.total}.\nBy category: ${Object.entries(g.topics).map(([k, v]) => `${k} ${v.correct}/${v.total}`).join(', ')}\n\nAnswers:\n${g.details.join('\n')}\n\nGive a 4-6 sentence assessment: strengths, weakest areas and what kind of courses or practice to do next.`,
    });
  } catch (e) { if (e.code !== 'AI_NOT_CONFIGURED') console.error(e.message); }
  const id = q.insert('skill_results', {
    user_id: user.id, score: g.score, total: g.total, category_scores: JSON.stringify(g.topics),
    answers: JSON.stringify(g.answers), ai_analysis, time_taken_seconds: Number(field(form, 'time_taken', 10)) || null,
  });
  redirect(ctx, `/skill-test/result/${id}`);
}

function skillResult(ctx) {
  const { t } = ctx;
  const user = requireUser(ctx);
  const r = q.get('SELECT * FROM skill_results WHERE id = ?', Number(ctx.params.id));
  if (!r || (r.user_id !== user.id && !isAdmin(user))) throw new HttpError(404);
  const p = Math.round((r.score / r.total) * 100);
  const color = percentColor(p);
  const cats = json.parse(r.category_scores, {});
  const strong = Object.fromEntries(Object.entries(cats).filter(([, v]) => v.correct / v.total >= 0.7));
  const weak = Object.fromEntries(Object.entries(cats).filter(([, v]) => v.correct / v.total < 0.7));
  const body = html`<main class="page"><div class="container narrow stack-lg">
    <div class="card card-pad center stack">
      <div class="score-ring" style="background:var(--${color}-soft);color:var(--${color === 'accent' ? 'warn' : color})">${p}%</div>
      <h1 style="font-size:1.6rem">${p >= 70 ? t('result_great') : p >= 40 ? t('result_ok') : t('result_low')}</h1>
      <p class="muted">${r.score} / ${r.total} ${t('correct')}${r.time_taken_seconds ? ` · ${Math.floor(r.time_taken_seconds / 60)}m ${r.time_taken_seconds % 60}s` : ''}</p>
      <div class="row" style="justify-content:center"><a href="/skill-test?start=1" class="btn btn-outline">${icon('refresh', 'ic-sm')}${t('retake')}</a><a href="/ai-assistant" class="btn btn-ai">${icon('sparkles', 'ic-sm')}${t('nav_ai')}</a></div>
    </div>
    ${r.ai_analysis ? html`<div class="card-soft card-pad"><div class="bold text-primary row" style="margin-bottom:10px">${icon('sparkles', 'ic-sm')}${t('ai_analysis')}</div><div class="prose">${markdown(r.ai_analysis)}</div></div>` : ''}
    <div class="grid g2">
      <div class="card card-pad"><h3 class="row text-success" style="margin-bottom:14px">${icon('trendUp', 'ic-sm')}${t('strengths')}</h3>${Object.keys(strong).length ? scoreBars(ctx, strong) : html`<p class="muted small">—</p>`}</div>
      <div class="card card-pad"><h3 class="row text-danger" style="margin-bottom:14px">${icon('trendDown', 'ic-sm')}${t('to_improve')}</h3>${Object.keys(weak).length ? scoreBars(ctx, weak) : html`<p class="muted small">—</p>`}</div>
    </div></div></main>`;
  send(ctx, 200, page(ctx, { title: t('skill_title'), body, noindex: true }));
}

// ─── Applying ─────────────────────────────────────────────────────────────────
async function apply(ctx) {
  const user = requireUser(ctx);
  const v = q.get('SELECT * FROM vacancies WHERE slug = ?', ctx.params.slug);
  if (!v) throw new HttpError(404);
  const back = `/vacancies/${v.slug}`;
  if (!v.is_active || (v.deadline && v.deadline < new Date().toISOString().slice(0, 10))) return redirect(ctx, back, { type: 'error', msg: ctx.t('vacancy_closed') });
  if (user.user_type === 'organization') throw new HttpError(403);
  if (q.get('SELECT id FROM applications WHERE vacancy_id = ? AND user_id = ?', v.id, user.id)) return redirect(ctx, back);
  rateLimit('apply:' + user.id, 30, 60 * 60 * 1000);
  const form = await readForm(ctx);
  const cv = fileField(form, 'cv');
  let cv_url = user.cv_url;
  if (cv) { cv_url = await saveUpload(cv, 'document'); if (!user.cv_url) q.update('users', user.id, { cv_url }); }
  q.insert('applications', { vacancy_id: v.id, user_id: user.id, cover_letter: field(form, 'cover_letter', 3000) || null, cv_url });
  if (v.owner_id) notify(v.owner_id, { type: 'application', title: `📄 ${v.title}`, body: `${user.full_name} — ${ctx.t('new_application')}`, link: `/org/vacancies/${v.id}/applications` });
  if (v.contact_email) {
    sendEmail({ to: v.contact_email, subject: `Jumıs AI — ${v.title}: new application`, text: `${user.full_name} (${user.email}) applied for "${v.title}".\n\n${config.siteUrl}/org/vacancies/${v.id}/applications` });
  }
  redirect(ctx, back, { msg: ctx.t('applied_ok') });
}

// ─── Vacancy management (shared by /org and /admin) ───────────────────────────
function canManage(user, v) { return isAdmin(user) || (v.owner_id === user.id && user.user_type === 'organization'); }
function requireManager(ctx, base) {
  const user = requireUser(ctx);
  if (base === '/admin' ? !isAdmin(user) : user.user_type !== 'organization' && !isAdmin(user)) throw new HttpError(403);
  return user;
}
function loadVacancy(ctx) {
  const v = q.get('SELECT * FROM vacancies WHERE id = ?', Number(ctx.params.id));
  if (!v || !canManage(ctx.user, v)) throw new HttpError(404);
  return v;
}

function vacancyList(base) {
  return (ctx) => {
    const { t, lang } = ctx;
    const user = requireManager(ctx, base);
    const list = base === '/admin'
      ? q.all('SELECT v.*, (SELECT COUNT(*) FROM applications a WHERE a.vacancy_id = v.id) apps FROM vacancies v ORDER BY v.created_at DESC')
      : q.all('SELECT v.*, (SELECT COUNT(*) FROM applications a WHERE a.vacancy_id = v.id) apps FROM vacancies v WHERE v.owner_id = ? ORDER BY v.created_at DESC', user.id);
    const content = list.length ? html`<div class="stack">${list.map((v) => html`<div class="card card-pad-sm stack-sm">
      <div class="row" style="align-items:flex-start;flex-wrap:wrap">
        <div class="icon-tile tile-purple">${icon('briefcase')}</div>
        <div class="grow"><a href="/vacancies/${v.slug}" class="bold">${v.title}</a><div class="xs muted">${v.organization}${v.address ? ' · ' + v.address : ''} · ${fmtDate(v.created_at, lang)}</div></div>
        <div class="row-wrap">${jobTypeBadge(ctx, v.job_type)}<span class="badge ${v.is_active ? 'b-success' : 'b-danger'}">${t(v.is_active ? 'active' : 'cancelled')}</span></div>
      </div>
      ${!v.is_active && v.cancellation_reason ? html`<div class="alert alert-danger small">${icon('alert', 'ic-sm')}<div><strong>${t('reason')}:</strong> ${v.cancellation_reason}${v.ai_analysis ? html`<div class="xs" style="margin-top:4px;opacity:.85">🤖 ${v.ai_analysis.slice(0, 240)}${v.ai_analysis.length > 240 ? '…' : ''}</div>` : ''}</div></div>` : ''}
      <div class="row-wrap">
        <a href="${base}/vacancies/${v.id}/applications" class="btn btn-outline btn-xs">${icon('users', 'ic-sm')}${t('applications')} (${v.apps})</a>
        <a href="${base}/vacancies/${v.id}/edit" class="btn btn-ghost btn-xs">${icon('pencil', 'ic-sm')}${t('edit')}</a>
        ${v.is_active ? html`<button type="button" class="btn btn-danger-ghost btn-xs" data-open="cancel-${v.id}">${icon('x', 'ic-sm')}${t('cancel_vacancy')}</button>`
          : html`<form method="post" action="${base}/vacancies/${v.id}/reopen"><button class="btn btn-ghost btn-xs">${icon('refresh', 'ic-sm')}${t('reopen')}</button></form>`}
        <form method="post" action="${base}/vacancies/${v.id}/delete" data-confirm="${t('confirm_delete')}"><button class="btn btn-danger-ghost btn-xs">${icon('trash', 'ic-sm')}${t('delete')}</button></form>
      </div>
      ${v.is_active ? html`<dialog class="modal" id="cancel-${v.id}"><form method="post" action="${base}/vacancies/${v.id}/cancel">
        <div class="modal-head"><h3 class="row">${icon('alert', 'ic-sm text-danger')}${t('cancel_vacancy')}</h3><button type="button" class="btn btn-ghost btn-xs" data-close>${icon('x', 'ic-sm')}</button></div>
        <div class="modal-body stack"><p class="small muted">${v.title} · ${v.organization}</p><div class="alert alert-danger small">${t('cancel_warning')}</div>
          <label class="field"><span>${t('reason')} *</span><textarea class="textarea" name="reason" rows="4" required maxlength="1500" placeholder="${t('cancel_reason_ph')}"></textarea></label>
          <div class="row" style="justify-content:flex-end"><button type="button" class="btn btn-ghost" data-close>${t('back')}</button><button class="btn btn-danger" data-busy="${t('ai_analyzing')}">${t('confirm_cancel')}</button></div></div></form></dialog>` : ''}
    </div>`)}</div>` : html`<div class="card">${emptyState(t('no_vacancies_org'), 'briefcase')}</div>`;
    send(ctx, 200, panelPage(ctx, { base, active: 'vacancies', title: t(base === '/org' ? 'my_vacancies' : 'nav_vacancies'), content,
      actions: html`<a href="${base}/vacancies/new" class="btn btn-primary">${icon('plus', 'ic-sm')}${t('post_vacancy')}</a>` }));
  };
}

function vacancyForm(base) {
  return (ctx) => {
    const { t } = ctx;
    const user = requireManager(ctx, base);
    const v = ctx.params.id ? loadVacancy(ctx) : { organization: user.user_type === 'organization' ? user.organization_name || '' : '', job_type: 'full_time', experience_level: 'junior', contact_email: user.email };
    const sel = (name, opts, pfx) => html`<select class="select" name="${name}">${opts.map((o) => html`<option value="${o}" ${v[name] === o ? raw('selected') : ''}>${t(pfx + o)}</option>`)}</select>`;
    const content = html`<form method="post" class="card card-pad stack">
      <div class="form-grid">
        <label class="field"><span>${t('vacancy_title')} *</span><input class="input" name="title" required maxlength="150" value="${v.title || ''}" placeholder="${t('vacancy_title_ph')}"></label>
        <label class="field"><span>${t('organization')} *</span><input class="input" name="organization" required maxlength="150" value="${v.organization || ''}" ${user.user_type === 'organization' && !isAdmin(user) ? raw('readonly') : ''}></label>
        <label class="field full"><span>${t('job_description')}</span><textarea class="textarea" name="description" rows="8" maxlength="8000" placeholder="${t('vacancy_desc_ph')}">${v.description || ''}</textarea><div class="hint">${t('markdown_hint')}</div></label>
        <label class="field"><span>${t('filter_job_type')}</span>${sel('job_type', JOB_TYPES, 'job_')}</label>
        <label class="field"><span>${t('filter_experience_level')}</span>${sel('experience_level', EXP_LEVELS, 'exp_')}</label>
        <label class="field"><span>${t('filter_address')}</span><input class="input" name="address" maxlength="150" value="${v.address || ''}" placeholder="Nókis"></label>
        <label class="field"><span>${t('salary')}</span><input class="input" name="salary" maxlength="80" value="${v.salary || ''}" placeholder="5 000 000 – 8 000 000 so'm"></label>
        <label class="field"><span>${t('contact_email')}</span><input class="input" type="email" name="contact_email" maxlength="200" value="${v.contact_email || ''}"></label>
        <label class="field"><span>${t('deadline')}</span><input class="input" type="date" name="deadline" value="${v.deadline || ''}"></label>
      </div>
      <div class="row"><button class="btn btn-primary">${t('save')}</button><a href="${base === '/org' ? '/org' : '/admin/vacancies'}" class="btn btn-ghost">${t('cancel')}</a></div>
    </form>`;
    send(ctx, 200, panelPage(ctx, { base, active: 'vacancies', title: t(ctx.params.id ? 'edit_vacancy' : 'post_vacancy'), content }));
  };
}

function saveVacancy(base) {
  return async (ctx) => {
    const user = requireManager(ctx, base);
    const existing = ctx.params.id ? loadVacancy(ctx) : null;
    const form = await readForm(ctx);
    const data = {
      title: field(form, 'title', 150), organization: field(form, 'organization', 150), description: field(form, 'description', 8000) || null,
      job_type: JOB_TYPES.includes(field(form, 'job_type')) ? field(form, 'job_type') : 'full_time',
      experience_level: EXP_LEVELS.includes(field(form, 'experience_level')) ? field(form, 'experience_level') : 'junior',
      address: field(form, 'address', 150) || null, salary: field(form, 'salary', 80) || null,
      contact_email: field(form, 'contact_email', 200) || null, deadline: /^\d{4}-\d{2}-\d{2}$/.test(field(form, 'deadline')) ? field(form, 'deadline') : null,
    };
    if (user.user_type === 'organization' && !isAdmin(user)) data.organization = user.organization_name || data.organization;
    if (!data.title || !data.organization) throw new HttpError(400, ctx.t('fill_required'));
    if (existing) {
      if (existing.title !== data.title) data.slug = uniqueSlug('vacancies', `${data.title}-${data.organization}`, existing.id);
      q.update('vacancies', existing.id, data);
    } else {
      q.insert('vacancies', { ...data, slug: uniqueSlug('vacancies', `${data.title}-${data.organization}`), owner_id: user.id });
    }
    redirect(ctx, base === '/org' ? '/org' : '/admin/vacancies', { msg: ctx.t('saved') });
  };
}

function cancelVacancy(base) {
  return async (ctx) => {
    const user = requireManager(ctx, base);
    const v = loadVacancy(ctx);
    const form = await readForm(ctx);
    const reason = field(form, 'reason', 1500);
    if (!reason) throw new HttpError(400, ctx.t('reason_required'));
    let ai_analysis = null;
    try {
      ai_analysis = await askAI({
        lang: ctx.lang, maxTokens: 500,
        mock: 'The position was closed for organisational reasons, not because of applicants. Keep your CV updated and apply to similar roles listed below.',
        system: 'You explain job cancellations to applicants professionally and kindly.',
        prompt: `The vacancy "${v.title}" at "${v.organization}" was cancelled. Reason given: "${reason}".\nIn 3-4 sentences: the main cause, the impact on applicants, and brief advice for affected job seekers.`,
      });
    } catch (e) { if (e.code !== 'AI_NOT_CONFIGURED') console.error(e.message); }
    q.update('vacancies', v.id, { is_active: 0, cancellation_reason: reason, cancelled_at: new Date().toISOString(), cancelled_by: user.id, ai_analysis });
    // Notify every applicant (in the app and by email)
    const applicants = q.all('SELECT a.id, u.id uid, u.email, u.full_name FROM applications a JOIN users u ON u.id = a.user_id WHERE a.vacancy_id = ?', v.id);
    for (const a of applicants) {
      q.run("UPDATE applications SET status = 'cancelled' WHERE id = ?", a.id);
      notify(a.uid, { type: 'vacancy_cancelled', title: `❌ ${v.title} — ${v.organization}`, body: `${ctx.t('reason')}: ${reason}${ai_analysis ? `\n\n🤖 ${ai_analysis}` : ''}`, link: `/vacancies/${v.slug}` });
      sendEmail({ to: a.email, subject: `Jumıs AI — ${v.title}: vacancy cancelled`, text: `${a.full_name},\n\n"${v.title}" (${v.organization}) was cancelled.\n\nReason: ${reason}\n${ai_analysis ? `\nAI analysis: ${ai_analysis}\n` : ''}\nSee similar vacancies: ${config.siteUrl}/vacancies\n\nJumıs AI` });
    }
    redirect(ctx, base === '/org' ? '/org' : '/admin/vacancies', { msg: ctx.t('vacancy_cancelled_ok', { n: applicants.length }) });
  };
}

function reopenVacancy(base) {
  return (ctx) => {
    requireManager(ctx, base);
    const v = loadVacancy(ctx);
    q.update('vacancies', v.id, { is_active: 1, cancellation_reason: null, cancelled_at: null, ai_analysis: null });
    redirect(ctx, base === '/org' ? '/org' : '/admin/vacancies', { msg: ctx.t('saved') });
  };
}

function deleteVacancy(base) {
  return (ctx) => {
    requireManager(ctx, base);
    const v = loadVacancy(ctx);
    q.run('DELETE FROM vacancies WHERE id = ?', v.id);
    redirect(ctx, base === '/org' ? '/org' : '/admin/vacancies', { msg: ctx.t('deleted') });
  };
}

const APP_STATUSES = ['submitted', 'reviewed', 'accepted', 'rejected'];
const APP_CLS = { submitted: 'b-info', reviewed: 'b-accent', accepted: 'b-success', rejected: 'b-danger', cancelled: 'b-danger' };

function applicationRows(ctx, apps, showVacancy = false) {
  const { t, lang } = ctx;
  return apps.length ? html`<div class="stack">${apps.map((a) => html`<div class="card card-pad-sm stack-sm" id="a${a.id}">
    <div class="row" style="flex-wrap:wrap">${avatar(a)}<div class="grow"><div class="bold">${a.full_name}</div><div class="xs muted">${a.email}${a.phone ? ' · ' + a.phone : ''} · ${fmtDate(a.created_at, lang)}</div>${showVacancy ? html`<div class="xs text-primary">${a.vtitle}</div>` : ''}</div>
      <span class="badge ${APP_CLS[a.status]}">${t('app_' + a.status)}</span></div>
    ${a.cover_letter ? html`<p class="small pre" style="background:var(--muted);padding:10px 12px;border-radius:12px">${a.cover_letter}</p>` : ''}
    ${a.bio ? html`<p class="xs muted clamp2">${a.bio}</p>` : ''}
    <div class="row-wrap">
      ${a.cv_url ? html`<a href="${a.cv_url}" target="_blank" rel="noopener" class="btn btn-outline btn-xs">${icon('file', 'ic-sm')}CV</a>` : html`<span class="xs muted">${t('no_cv')}</span>`}
      <a href="mailto:${a.email}" class="btn btn-ghost btn-xs">${icon('mail', 'ic-sm')}${t('email')}</a>
      ${a.status !== 'cancelled' ? html`<form method="post" action="/applications/${a.id}/status" class="row" style="gap:6px;margin-left:auto"><select class="select" name="status" style="padding:6px 10px;font-size:13px">${APP_STATUSES.map((s) => html`<option value="${s}" ${a.status === s ? raw('selected') : ''}>${t('app_' + s)}</option>`)}</select><button class="btn btn-primary btn-xs">${t('update')}</button></form>` : ''}
    </div></div>`)}</div>` : html`<div class="card">${emptyState(t('no_applications'), 'file')}</div>`;
}

function vacancyApplications(base) {
  return (ctx) => {
    requireManager(ctx, base);
    const v = loadVacancy(ctx);
    const apps = q.all('SELECT a.*, u.full_name, u.email, u.phone, u.photo_url, u.bio FROM applications a JOIN users u ON u.id = a.user_id WHERE a.vacancy_id = ? ORDER BY a.created_at DESC', v.id);
    send(ctx, 200, panelPage(ctx, { base, active: 'vacancies', title: v.title, subtitle: `${v.organization} · ${apps.length} ${ctx.t('applications').toLowerCase()}`, content: applicationRows(ctx, apps),
      actions: html`<a href="/vacancies/${v.slug}" class="btn btn-ghost btn-sm">${icon('external', 'ic-sm')}${ctx.t('view_public')}</a>` }));
  };
}

function orgApplications(ctx) {
  const user = requireManager(ctx, '/org');
  const apps = q.all(`SELECT a.*, v.title vtitle, u.full_name, u.email, u.phone, u.photo_url, u.bio FROM applications a JOIN vacancies v ON v.id = a.vacancy_id JOIN users u ON u.id = a.user_id
    WHERE v.owner_id = ? ORDER BY a.created_at DESC`, user.id);
  send(ctx, 200, panelPage(ctx, { base: '/org', active: 'applications', title: ctx.t('applications'), content: applicationRows(ctx, apps, true) }));
}

async function setApplicationStatus(ctx) {
  const user = requireUser(ctx);
  const a = q.get('SELECT a.*, v.owner_id, v.title, v.organization, v.slug FROM applications a JOIN vacancies v ON v.id = a.vacancy_id WHERE a.id = ?', Number(ctx.params.id));
  if (!a || !(isAdmin(user) || a.owner_id === user.id)) throw new HttpError(404);
  const form = await readForm(ctx);
  const status = field(form, 'status', 20);
  if (!APP_STATUSES.includes(status)) throw new HttpError(400);
  if (status !== a.status) {
    q.run('UPDATE applications SET status = ? WHERE id = ?', status, a.id);
    notify(a.user_id, { type: 'application_status', title: `${a.title} — ${a.organization}`, body: `${ctx.t('app_status')}: ${ctx.t('app_' + status)}`, link: '/profile?tab=activity' });
  }
  redirect(ctx, (ctx.req.headers.referer ? new URL(ctx.req.headers.referer).pathname : '/org/applications') + `#a${a.id}`, { msg: ctx.t('saved') });
}

function candidates(ctx) {
  const { t } = ctx;
  requireManager(ctx, '/org');
  const search = (ctx.url.searchParams.get('q') || '').trim().slice(0, 80);
  const list = q.all(`SELECT u.id, u.full_name, u.email, u.phone, u.photo_url, u.bio, u.cv_url, u.future_goals,
    (SELECT COUNT(*) FROM certificates c WHERE c.user_id = u.id) certs FROM users u
    WHERE u.open_to_work = 1 AND u.cv_url IS NOT NULL AND u.user_type = 'student' ${search ? 'AND (u.bio LIKE ? OR u.full_name LIKE ? OR u.future_goals LIKE ?)' : ''} ORDER BY u.id DESC LIMIT 100`,
  ...(search ? [`%${search}%`, `%${search}%`, `%${search}%`] : []));
  const content = html`<form method="get" class="search-bar">${icon('search')}<input class="input" name="q" value="${search}" placeholder="${t('search_candidates')}"></form>
    <p class="xs muted">${t('candidates_note')}</p>
    ${list.length ? html`<div class="grid g2">${list.map((u) => html`<div class="card card-pad-sm stack-sm"><div class="row">${avatar(u)}<div class="grow"><div class="bold">${u.full_name}</div><div class="xs muted">${u.email}</div></div>${u.certs ? html`<span class="badge b-accent">${icon('award', 'ic-sm')}${u.certs}</span>` : ''}</div>
      ${u.bio ? html`<p class="small muted clamp3">${u.bio}</p>` : ''}<div class="row-wrap"><a href="${u.cv_url}" target="_blank" rel="noopener" class="btn btn-outline btn-xs">${icon('file', 'ic-sm')}CV</a><a href="mailto:${u.email}" class="btn btn-primary btn-xs">${icon('mail', 'ic-sm')}${t('contact')}</a></div></div>`)}</div>` : html`<div class="card">${emptyState(t('no_candidates'), 'users')}</div>`}`;
  send(ctx, 200, panelPage(ctx, { base: '/org', active: 'candidates', title: t('candidates'), subtitle: t('candidates_sub'), content }));
}

export default function (r) {
  r.get('/ai-assistant', aiAssistant);
  r.post('/ai-assistant', runAiAssistant);
  r.get('/skill-test', skillTest);
  r.post('/skill-test', submitSkillTest);
  r.get('/skill-test/result/:id', skillResult);
  r.post('/vacancies/:slug/apply', apply);
  r.post('/applications/:id/status', setApplicationStatus);
  for (const base of ['/org', '/admin']) {
    if (base === '/org') r.get('/org', vacancyList(base));
    r.get(`${base}/vacancies`, vacancyList(base));
    r.get(`${base}/vacancies/new`, vacancyForm(base));
    r.post(`${base}/vacancies/new`, saveVacancy(base));
    r.get(`${base}/vacancies/:id/edit`, vacancyForm(base));
    r.post(`${base}/vacancies/:id/edit`, saveVacancy(base));
    r.post(`${base}/vacancies/:id/cancel`, cancelVacancy(base));
    r.post(`${base}/vacancies/:id/reopen`, reopenVacancy(base));
    r.post(`${base}/vacancies/:id/delete`, deleteVacancy(base));
    r.get(`${base}/vacancies/:id/applications`, vacancyApplications(base));
  }
  r.get('/org/applications', orgApplications);
  r.get('/org/candidates', candidates);
}
