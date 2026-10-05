// Public pages — visible without login and indexable by Google.
import { q } from '../db.js';
import { send, redirect, setCookie, safeNext, HttpError } from '../http.js';
import { page, pageHead } from '../views/layout.js';
import { html, raw, cx, markdown } from '../views/html.js';
import { icon, logoMark } from '../views/icons.js';
import { courseCard, vacancyCard, emptyState, jobTypeBadge, fmtDate, avatar, JOB_TYPES, EXP_LEVELS, sectionTitle } from '../views/components.js';
import { config } from '../env.js';
import { LANGUAGES } from '../i18n.js';

// ─── Shared queries ───────────────────────────────────────────────────────────
export const COURSE_SELECT = `SELECT c.*, (SELECT COUNT(*) FROM lessons l WHERE l.course_id = c.id) AS lesson_count,
  u.full_name AS teacher_name FROM courses c LEFT JOIN users u ON u.id = c.owner_id`;

export function publishedCourses({ search = '', category = '', limit = 200 } = {}) {
  const where = ['c.is_published = 1'];
  const params = [];
  if (search) { where.push('(c.title LIKE ? OR c.description LIKE ? OR c.category LIKE ?)'); params.push(`%${search}%`, `%${search}%`, `%${search}%`); }
  if (category) { where.push('c.category = ?'); params.push(category); }
  return q.all(`${COURSE_SELECT} WHERE ${where.join(' AND ')} ORDER BY c.created_at DESC LIMIT ?`, ...params, limit);
}

export function activeVacancies({ search = '', job_type = '', experience_level = '', organization = '', address = '', limit = 500 } = {}) {
  const where = ['is_active = 1', "(deadline IS NULL OR deadline = '' OR deadline >= date('now'))"];
  const params = [];
  if (search) { where.push('(title LIKE ? OR organization LIKE ? OR description LIKE ?)'); params.push(`%${search}%`, `%${search}%`, `%${search}%`); }
  if (job_type) { where.push('job_type = ?'); params.push(job_type); }
  if (experience_level) { where.push('experience_level = ?'); params.push(experience_level); }
  if (organization) { where.push('organization = ?'); params.push(organization); }
  if (address) { where.push('address LIKE ?'); params.push(`%${address}%`); }
  return q.all(`SELECT * FROM vacancies WHERE ${where.join(' AND ')} ORDER BY created_at DESC LIMIT ?`, ...params, limit);
}

// ─── Landing ──────────────────────────────────────────────────────────────────
function landing(ctx) {
  const { t } = ctx;
  const courses = publishedCourses({ limit: 6 });
  const vacancies = activeVacancies({ limit: 4 });
  const stats = {
    courses: q.get('SELECT COUNT(*) n FROM courses WHERE is_published = 1').n,
    lessons: q.get('SELECT COUNT(*) n FROM lessons l JOIN courses c ON c.id = l.course_id WHERE c.is_published = 1').n,
    vacancies: q.get("SELECT COUNT(*) n FROM vacancies WHERE is_active = 1").n,
    learners: q.get('SELECT COUNT(*) n FROM users').n,
  };
  const founders = q.all("SELECT * FROM community_content WHERE type = 'director' AND is_active = 1 ORDER BY sort_order LIMIT 3");
  const features = [
    ['book', 'tile-primary', 'feat_courses_t', 'feat_courses_d'],
    ['flask', 'tile-accent', 'feat_tests_t', 'feat_tests_d'],
    ['clipboard', 'tile-info', 'feat_assign_t', 'feat_assign_d'],
    ['sparkles', 'tile-purple', 'feat_ai_t', 'feat_ai_d'],
    ['briefcase', 'tile-success', 'feat_jobs_t', 'feat_jobs_d'],
    ['target', 'tile-danger', 'feat_purpose_t', 'feat_purpose_d'],
  ];

  const body = html`<main>
  <section class="hero">
    <div class="container hero-grid">
      <div>
        <span class="badge b-primary" style="margin-bottom:18px">${icon('sparkles', 'ic-sm')} ${t('hero_badge')}</span>
        <h1>${t('hero_title_1')} <em>${t('hero_title_2')}</em> ${t('hero_title_3')}</h1>
        <p class="hero-lead">${t('hero_lead')}</p>
        <div class="hero-cta">
          <a href="${ctx.user ? '/dashboard' : '/register'}" class="btn btn-primary btn-lg">${t(ctx.user ? 'go_dashboard' : 'start_free')} ${icon('arrowRight', 'ic-sm')}</a>
          <a href="/courses" class="btn btn-outline btn-lg">${icon('book', 'ic-sm')} ${t('browse_courses')}</a>
        </div>
        <div class="row-wrap small muted" style="margin-top:22px;gap:18px">
          <span class="row" style="gap:6px">${icon('check', 'ic-sm text-success')}${t('hero_point_1')}</span>
          <span class="row" style="gap:6px">${icon('check', 'ic-sm text-success')}${t('hero_point_2')}</span>
          <span class="row" style="gap:6px">${icon('check', 'ic-sm text-success')}${t('hero_point_3')}</span>
        </div>
      </div>
      <div class="hero-path">
        <div class="hero-card">
          <div class="row between" style="margin-bottom:16px"><div class="row">${logoMark(28)}<strong>${t('your_path')}</strong></div><span class="badge b-accent">Ziyrek AI</span></div>
          <div class="path-steps">
            ${[['book', 'path_1'], ['flask', 'path_2'], ['award', 'path_3'], ['briefcase', 'path_4']].map(([ic, k], i) => html`
              <div class="path-step ${i < 2 ? 'done' : ''}"><span class="num">${i + 1}</span><div class="grow"><div class="bold small">${t(k)}</div><div class="xs muted">${t(k + '_d')}</div></div>${icon(ic, 'ic-sm text-primary')}</div>`)}
          </div>
        </div>
        <div class="hero-float" style="left:-30px;bottom:0"><span class="icon-tile tile-success" style="width:32px;height:32px">${icon('check', 'ic-sm')}</span>${t('float_report')}</div>
        <div class="hero-float" style="right:-16px;top:0"><span class="icon-tile tile-accent" style="width:32px;height:32px">${icon('briefcase', 'ic-sm')}</span>${t('float_jobs', { n: stats.vacancies })}</div>
      </div>
    </div>
    <div class="container" style="margin-top:56px;position:relative;z-index:1">
      <div class="stats-strip">
        <div><strong>${stats.courses}</strong><span class="small muted">${t('stat_courses')}</span></div>
        <div><strong>${stats.lessons}</strong><span class="small muted">${t('stat_lessons')}</span></div>
        <div><strong>${stats.vacancies}</strong><span class="small muted">${t('stat_vacancies')}</span></div>
        <div><strong>${stats.learners}</strong><span class="small muted">${t('stat_users')}</span></div>
      </div>
    </div>
  </section>

  <section class="section band">
    <div class="container">
      <div class="section-head"><div><div class="eyebrow">${t('features_eyebrow')}</div><h2 style="margin-top:6px">${t('features_title')}</h2><p>${t('features_sub')}</p></div></div>
      <div class="grid g3">
        ${features.map(([ic, tile, tt, dd]) => html`<div class="card card-pad"><div class="feature-ic icon-tile ${tile}">${icon(ic, 'ic-lg')}</div><h3>${t(tt)}</h3><p class="muted small" style="margin-top:8px">${t(dd)}</p></div>`)}
      </div>
    </div>
  </section>

  <section class="section">
    <div class="container">
      <div class="section-head"><div><div class="eyebrow">${t('nav_courses')}</div><h2 style="margin-top:6px">${t('popular_courses')}</h2></div><a href="/courses" class="btn btn-outline btn-sm">${t('view_all')} ${icon('chevronRight', 'ic-sm')}</a></div>
      ${courses.length ? html`<div class="grid g3">${courses.map((c) => courseCard(ctx, c))}</div>` : emptyState(t('no_courses'), 'book')}
    </div>
  </section>

  <section class="section band">
    <div class="container">
      <div class="section-head"><div><div class="eyebrow">${t('how_eyebrow')}</div><h2 style="margin-top:6px">${t('how_title')}</h2></div></div>
      <div class="grid g4">
        ${['how_1', 'how_2', 'how_3', 'how_4'].map((k, i) => html`<div class="card card-pad"><div class="row" style="margin-bottom:10px"><span class="icon-tile tile-solid" style="width:34px;height:34px;border-radius:50%;font-weight:700">${i + 1}</span></div><h3>${t(k)}</h3><p class="muted small" style="margin-top:6px">${t(k + '_d')}</p></div>`)}
      </div>
    </div>
  </section>

  <section class="section">
    <div class="container">
      <div class="section-head"><div><div class="eyebrow">${t('nav_vacancies')}</div><h2 style="margin-top:6px">${t('latest_vacancies')}</h2></div><a href="/vacancies" class="btn btn-outline btn-sm">${t('view_all')} ${icon('chevronRight', 'ic-sm')}</a></div>
      ${vacancies.length ? html`<div class="grid g2">${vacancies.map((v) => vacancyCard(ctx, v))}</div>` : emptyState(t('no_vacancies'), 'briefcase')}
      <div class="card card-soft card-pad row between" style="margin-top:22px;flex-wrap:wrap">
        <div class="row"><div class="icon-tile tile-purple">${icon('building')}</div><div><h3>${t('for_orgs_t')}</h3><p class="muted small">${t('for_orgs_d')}</p></div></div>
        <a href="/register?type=organization" class="btn btn-primary">${t('post_vacancy')}</a>
      </div>
    </div>
  </section>

  ${founders.length ? html`<section class="section band"><div class="container">
    <div class="section-head"><div><div class="eyebrow">${t('tab_founders')}</div><h2 style="margin-top:6px">${t('team_title')}</h2></div></div>
    <div class="grid g3">${founders.map((f) => html`<div class="card card-pad center stack-sm">
      ${f.photo_url ? html`<img src="${f.photo_url}" alt="${f.title}" style="width:84px;height:84px;border-radius:50%;object-fit:cover;margin:0 auto">` : html`<span class="avatar avatar-lg" style="margin:0 auto">${f.title[0]}</span>`}
      <h3>${f.title}</h3>${f.description ? html`<p class="muted small">${f.description}</p>` : ''}</div>`)}</div>
  </div></section>` : ''}

  <section class="section"><div class="container">
    <div class="cta-band">
      <h2 style="font-size:clamp(1.6rem,3vw,2.2rem);max-width:640px">${t('cta_title')}</h2>
      <p style="opacity:.85;margin-top:10px;max-width:560px">${t('cta_sub')}</p>
      <div class="row-wrap" style="margin-top:22px"><a href="${ctx.user ? '/dashboard' : '/register'}" class="btn btn-accent btn-lg">${t(ctx.user ? 'go_dashboard' : 'start_free')}</a><a href="/vacancies" class="btn btn-lg" style="color:#F5F0E8;border-color:rgba(245,240,232,.35)">${t('nav_vacancies')}</a></div>
    </div>
  </div></section>
  </main>`;

  const jsonLd = {
    '@context': 'https://schema.org',
    '@graph': [
      { '@type': 'Organization', name: 'Jumıs AI', url: config.siteUrl, logo: `${config.siteUrl}/public/img/logo.png`, areaServed: 'Karakalpakstan, Uzbekistan' },
      { '@type': 'WebSite', name: 'Jumıs AI', url: config.siteUrl, inLanguage: LANGUAGES.map((l) => l.code),
        potentialAction: { '@type': 'SearchAction', target: `${config.siteUrl}/courses?q={search_term_string}`, 'query-input': 'required name=search_term_string' } },
    ],
  };
  send(ctx, 200, page(ctx, { body, canonical: '/', jsonLd }));
}

// ─── Courses ──────────────────────────────────────────────────────────────────
function coursesList(ctx) {
  const { t } = ctx;
  const search = (ctx.url.searchParams.get('q') || '').trim().slice(0, 100);
  const category = ctx.url.searchParams.get('category') || '';
  const courses = publishedCourses({ search, category });
  const cats = q.all("SELECT DISTINCT category FROM courses WHERE is_published = 1 AND category IS NOT NULL AND category != '' ORDER BY category").map((r) => r.category);
  const qs = (c) => `/courses?${new URLSearchParams({ ...(search && { q: search }), ...(c && { category: c }) })}`;
  const body = html`<main class="page"><div class="container">
    ${pageHead(t('courses_title'), t('courses_sub'))}
    <form class="search-bar" method="get" action="/courses" style="margin-bottom:16px">
      ${icon('search')}<input class="input" name="q" value="${search}" placeholder="${t('search_courses')}" aria-label="${t('search_courses')}">
      ${category ? html`<input type="hidden" name="category" value="${category}">` : ''}
    </form>
    ${cats.length ? html`<div class="pills" style="margin-bottom:24px"><a href="${qs('')}" class="${cx(!category && 'on')}">${t('all')}</a>${cats.map((c) => html`<a href="${qs(c)}" class="${cx(category === c && 'on')}">${c}</a>`)}</div>` : ''}
    ${courses.length ? html`<div class="grid g3">${courses.map((c) => courseCard(ctx, c))}</div>` : emptyState(t('no_courses_found'), 'search')}
  </div></main>`;
  send(ctx, 200, page(ctx, { title: t('courses_title'), description: t('courses_sub'), body, canonical: category || search ? '/courses' : undefined }));
}

export function getCourseBySlug(slug) {
  return q.get(`${COURSE_SELECT} WHERE c.slug = ?`, slug);
}

function courseDetail(ctx) {
  const { t, user } = ctx;
  const c = getCourseBySlug(ctx.params.slug);
  const canSee = c && (c.is_published || (user && (user.role === 'admin' || c.owner_id === user.id)));
  if (!canSee) throw new HttpError(404);
  const lessons = q.all('SELECT id, title, duration, video_type FROM lessons WHERE course_id = ? ORDER BY sort_order, id', c.id);
  const tests = q.all('SELECT test_type, COUNT(*) n FROM tests WHERE course_id = ? GROUP BY test_type', c.id);
  const assignmentsCount = q.get('SELECT COUNT(*) n FROM assignments WHERE course_id = ?', c.id).n;
  const teacher = c.owner_id ? q.get('SELECT u.id, u.full_name, u.photo_url, tp.headline, tp.specialization, tp.is_visible FROM users u LEFT JOIN teacher_profiles tp ON tp.user_id = u.id WHERE u.id = ?', c.owner_id) : null;
  const enrollment = user ? q.get('SELECT * FROM enrollments WHERE user_id = ? AND course_id = ?', user.id, c.id) : null;
  const students = q.get('SELECT COUNT(*) n FROM enrollments WHERE course_id = ? AND verified = 1', c.id).n;

  const cta = !user
    ? html`<a href="/register?next=${encodeURIComponent('/learn/' + c.slug)}" class="btn btn-primary btn-lg btn-block">${t('start_learning')}</a><p class="xs muted center" style="margin-top:8px">${t('login_to_learn')}</p>`
    : html`<a href="/learn/${c.slug}" class="btn btn-primary btn-lg btn-block">${t(enrollment?.verified ? 'continue_learning' : 'start_learning')}</a>`;

  const body = html`<main class="page"><div class="container">
    <a href="/courses" class="back">${icon('arrowLeft', 'ic-sm')} ${t('back_to_courses')}</a>
    <div class="layout-main">
      <div class="stack-lg">
        <div class="stack">
          <div class="row-wrap">${c.category ? html`<span class="badge b-primary">${c.category}</span>` : ''}${c.level ? html`<span class="badge">${t('level_' + c.level)}</span>` : ''}${!c.is_published ? html`<span class="badge b-danger">${t('unpublished')}</span>` : ''}</div>
          <h1>${c.title}</h1>
          ${c.description ? html`<div class="prose muted">${markdown(c.description)}</div>` : ''}
          <div class="meta"><span>${icon('play', 'ic-sm')}${lessons.length} ${t('lessons_count')}</span><span>${icon('users', 'ic-sm')}${students} ${t('students_count')}</span>${assignmentsCount ? html`<span>${icon('clipboard', 'ic-sm')}${assignmentsCount} ${t('assignments')}</span>` : ''}</div>
        </div>
        ${c.thumbnail_url ? html`<img src="${c.thumbnail_url}" alt="${c.title}" style="border-radius:20px;aspect-ratio:16/9;object-fit:cover;width:100%">` : ''}
        <div class="card">
          <div class="card-head"><h2 style="font-size:1.2rem">${t('curriculum')}</h2><span class="muted small">${lessons.length} ${t('lessons_count')}</span></div>
          ${lessons.length ? html`<div class="divide">${lessons.map((l, i) => html`<div class="list-item"><span class="badge">${i + 1}</span><span class="grow">${l.title}</span>${l.duration ? html`<span class="muted small row" style="gap:4px">${icon('clock', 'ic-sm')}${l.duration}</span>` : ''}${icon(user ? 'play' : 'lock', 'ic-sm muted')}</div>`)}</div>` : emptyState(t('no_lessons'), 'play')}
        </div>
      </div>
      <aside class="stack" style="position:sticky;top:84px">
        <div class="card card-pad stack">
          ${cta}
          <hr class="sep" style="margin:6px 0">
          <div class="stack-sm small">
            <div class="row">${icon('play', 'ic-sm text-primary')}<span>${lessons.length} ${t('video_lessons')}</span></div>
            ${tests.map((x) => html`<div class="row">${icon('flask', 'ic-sm text-primary')}<span>${x.n} × ${t('test_' + x.test_type)}</span></div>`)}
            <div class="row">${icon('sparkles', 'ic-sm text-primary')}<span>${t('ai_feedback_included')}</span></div>
            <div class="row">${icon('award', 'ic-sm text-primary')}<span>${t('certificate_included')}</span></div>
          </div>
        </div>
        ${teacher ? html`<a href="${teacher.is_visible ? `/teachers/${teacher.id}` : '#'}" class="card card-pad row card-hover">${avatar(teacher)}<div class="grow"><div class="xs muted">${t('teacher')}</div><div class="bold">${teacher.full_name}</div>${teacher.headline ? html`<div class="xs muted">${teacher.headline}</div>` : ''}</div></a>` : ''}
      </aside>
    </div>
  </div></main>`;

  const jsonLd = {
    '@context': 'https://schema.org', '@type': 'Course', name: c.title, description: (c.description || c.title).slice(0, 500),
    url: `${config.siteUrl}/courses/${c.slug}`, inLanguage: ctx.lang,
    provider: { '@type': 'Organization', name: 'Jumıs AI', sameAs: config.siteUrl },
    hasCourseInstance: { '@type': 'CourseInstance', courseMode: 'online', courseWorkload: `PT${Math.max(1, lessons.length)}H` },
    offers: { '@type': 'Offer', category: 'Free', price: 0, priceCurrency: 'UZS' },
  };
  send(ctx, 200, page(ctx, { title: c.title, description: (c.description || '').slice(0, 155) || t('courses_sub'), body, jsonLd, ogImage: c.thumbnail_url?.startsWith('http') ? c.thumbnail_url : undefined, noindex: !c.is_published }));
}

// ─── Vacancies ────────────────────────────────────────────────────────────────
function vacanciesList(ctx) {
  const { t } = ctx;
  const p = ctx.url.searchParams;
  const filters = { search: (p.get('q') || '').trim().slice(0, 100), job_type: p.get('job_type') || '', experience_level: p.get('experience_level') || '', organization: p.get('organization') || '', address: (p.get('address') || '').slice(0, 60) };
  const list = activeVacancies(filters);
  const orgs = q.all('SELECT DISTINCT organization FROM vacancies WHERE is_active = 1 ORDER BY organization').map((r) => r.organization);
  const anyFilter = Object.values(filters).some(Boolean);
  const sel = (name, options, labelFn) => html`<select class="select" name="${name}" onchange="this.form.submit()"><option value="">${t('filter_' + name)}: ${t('all')}</option>${options.map((o) => html`<option value="${o}" ${filters[name] === o ? raw('selected') : ''}>${labelFn(o)}</option>`)}</select>`;
  const body = html`<main class="page"><div class="container">
    ${pageHead(t('vacancies_title'), t('vacancies_sub'))}
    <form method="get" action="/vacancies" class="card card-pad-sm stack" style="margin-bottom:22px">
      <div class="search-bar">${icon('search')}<input class="input" name="q" value="${filters.search}" placeholder="${t('search_vacancies')}" aria-label="${t('search_vacancies')}"></div>
      <div class="grid g4" style="gap:10px">
        ${sel('job_type', JOB_TYPES, (o) => t('job_' + o))}
        ${sel('experience_level', EXP_LEVELS, (o) => t('exp_' + o))}
        ${sel('organization', orgs, (o) => o)}
        <input class="input" name="address" value="${filters.address}" placeholder="${t('filter_address')}">
      </div>
      <div class="row between small"><span class="muted">${list.length} ${t('vacancies_found')}</span><div class="row">${anyFilter ? html`<a href="/vacancies" class="btn btn-ghost btn-sm">${icon('x', 'ic-sm')}${t('clear_filters')}</a>` : ''}<button class="btn btn-primary btn-sm">${icon('filter', 'ic-sm')}${t('apply_filters')}</button></div></div>
    </form>
    ${list.length ? html`<div class="grid g2">${list.map((v) => vacancyCard(ctx, v))}</div>` : emptyState(t('no_vacancies_found'), 'briefcase')}
  </div></main>`;
  send(ctx, 200, page(ctx, { title: t('vacancies_title'), description: t('vacancies_sub'), body, canonical: '/vacancies' }));
}

const EMPLOYMENT = { full_time: 'FULL_TIME', part_time: 'PART_TIME', contract: 'CONTRACTOR', internship: 'INTERN', remote: 'FULL_TIME' };

function vacancyDetail(ctx) {
  const { t, user } = ctx;
  const v = q.get('SELECT * FROM vacancies WHERE slug = ?', ctx.params.slug);
  if (!v) throw new HttpError(404);
  const application = user ? q.get('SELECT * FROM applications WHERE vacancy_id = ? AND user_id = ?', v.id, user.id) : null;
  const expired = v.deadline && v.deadline < new Date().toISOString().slice(0, 10);
  const canApply = v.is_active && !expired;
  const similar = q.all('SELECT * FROM vacancies WHERE is_active = 1 AND id != ? AND (job_type = ? OR organization = ?) ORDER BY created_at DESC LIMIT 3', v.id, v.job_type, v.organization);

  let applyBox;
  if (!canApply) applyBox = html`<div class="alert alert-warn">${icon('alert')}<div>${t(v.is_active ? 'vacancy_expired' : 'vacancy_closed')}</div></div>`;
  else if (!user) applyBox = html`<a href="/login?next=${encodeURIComponent('/vacancies/' + v.slug)}" class="btn btn-primary btn-block btn-lg">${t('login_to_apply')}</a>`;
  else if (application) applyBox = html`<div class="alert alert-success">${icon('check')}<div><div class="bold">${t('applied')}</div><div class="xs">${t('app_status')}: ${t('app_' + application.status)}</div></div></div>`;
  else if (user.user_type === 'organization') applyBox = html`<p class="small muted">${t('orgs_cannot_apply')}</p>`;
  else applyBox = html`<form method="post" action="/vacancies/${v.slug}/apply" enctype="multipart/form-data" class="stack">
      <label class="field"><span>${t('cover_letter')}</span><textarea class="textarea" name="cover_letter" rows="4" maxlength="3000" placeholder="${t('cover_letter_ph')}"></textarea></label>
      ${user.cv_url ? html`<p class="xs muted row" style="gap:6px">${icon('file', 'ic-sm')}${t('cv_attached_auto')}</p>` : html`<label class="file-drop">${icon('upload', 'ic-sm')}<span data-file-label>${t('attach_cv')}</span><input type="file" name="cv" accept=".pdf,.doc,.docx"></label>`}
      <button class="btn btn-primary btn-block" data-busy="${t('sending')}">${icon('send', 'ic-sm')} ${t('apply_now')}</button>
    </form>`;

  const body = html`<main class="page"><div class="container">
    <a href="/vacancies" class="back">${icon('arrowLeft', 'ic-sm')} ${t('back_to_vacancies')}</a>
    <div class="layout-main">
      <div class="stack-lg">
        <div class="card card-pad stack">
          <div class="row" style="align-items:flex-start"><div class="icon-tile tile-accent" style="width:54px;height:54px">${icon('building', 'ic-lg')}</div>
            <div class="grow"><h1 style="font-size:1.8rem">${v.title}</h1><p class="muted">${v.organization}</p></div></div>
          <div class="row-wrap">${jobTypeBadge(ctx, v.job_type)}<span class="badge">${t('exp_' + v.experience_level)}</span>${!v.is_active ? html`<span class="badge b-danger">${t('cancelled')}</span>` : ''}</div>
          <div class="meta">
            ${v.address ? html`<span>${icon('pin', 'ic-sm')}${v.address}</span>` : ''}
            ${v.salary ? html`<span class="salary">${icon('wallet', 'ic-sm')}${v.salary}</span>` : ''}
            ${v.deadline ? html`<span>${icon('calendar', 'ic-sm')}${t('deadline')}: ${fmtDate(v.deadline, ctx.lang)}</span>` : ''}
            <span>${icon('clock', 'ic-sm')}${t('posted')}: ${fmtDate(v.created_at, ctx.lang)}</span>
          </div>
        </div>
        ${!v.is_active && v.cancellation_reason ? html`<div class="card card-pad stack-sm" style="border-color:var(--danger)">
          <h3 class="text-danger row">${icon('alert', 'ic-sm')} ${t('vacancy_cancelled_title')}</h3>
          <p><strong>${t('reason')}:</strong> ${v.cancellation_reason}</p>
          ${v.ai_analysis ? html`<div class="card-soft card-pad-sm"><div class="xs bold text-primary row" style="gap:6px;margin-bottom:6px">${icon('sparkles', 'ic-sm')} ${t('ai_analysis')}</div><div class="prose small">${markdown(v.ai_analysis)}</div></div>` : ''}
        </div>` : ''}
        <div class="card card-pad"><h2 style="font-size:1.2rem;margin-bottom:12px">${t('job_description')}</h2><div class="prose">${v.description ? markdown(v.description) : html`<p class="muted">—</p>`}</div></div>
      </div>
      <aside class="stack" style="position:sticky;top:84px">
        <div class="card card-pad stack"><h3>${t('apply_title')}</h3>${applyBox}
          ${v.contact_email ? html`<p class="xs muted row" style="gap:6px">${icon('mail', 'ic-sm')}${v.contact_email}</p>` : ''}</div>
        ${similar.length ? html`<div class="stack-sm"><h3 style="font-size:1rem">${t('similar_vacancies')}</h3>${similar.map((s) => vacancyCard(ctx, s))}</div>` : ''}
      </aside>
    </div>
  </div></main>`;

  const jsonLd = canApply ? {
    '@context': 'https://schema.org', '@type': 'JobPosting', title: v.title,
    description: (v.description || v.title).replace(/\n/g, '<br>'),
    datePosted: v.created_at.slice(0, 10), ...(v.deadline && { validThrough: `${v.deadline}T23:59:59+05:00` }),
    employmentType: EMPLOYMENT[v.job_type] || 'FULL_TIME',
    hiringOrganization: { '@type': 'Organization', name: v.organization },
    ...(v.job_type === 'remote'
      ? { jobLocationType: 'TELECOMMUTE', applicantLocationRequirements: { '@type': 'Country', name: 'Uzbekistan' } }
      : { jobLocation: { '@type': 'Place', address: { '@type': 'PostalAddress', addressLocality: v.address || 'Nukus', addressRegion: 'Karakalpakstan', addressCountry: 'UZ' } } }),
    directApply: true,
  } : undefined;
  send(ctx, 200, page(ctx, { title: `${v.title} — ${v.organization}`, description: (v.description || '').replace(/\s+/g, ' ').slice(0, 155), body, jsonLd, noindex: !canApply }));
}

// ─── Community ────────────────────────────────────────────────────────────────
const TABS = [
  ['videos', 'play', 'video_explanation'], ['links', 'link', 'useful_link'], ['investors', 'trendUp', 'investor'],
  ['events', 'calendar', 'event'], ['news', 'news', 'news'], ['support', 'phone', 'support_info'], ['founders', 'users', 'director'],
];

export function embedFor(url) {
  if (!url) return null;
  const yt = url.match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|embed\/|shorts\/|live\/))([a-zA-Z0-9_-]{11})/);
  if (yt) return { type: 'iframe', src: `https://www.youtube-nocookie.com/embed/${yt[1]}` };
  const vm = url.match(/vimeo\.com\/(?:video\/)?(\d+)/);
  if (vm) return { type: 'iframe', src: `https://player.vimeo.com/video/${vm[1]}` };
  if (/\.(mp4|webm|ogg|mov|m4v)(\?.*)?$/i.test(url) || url.startsWith('/uploads/')) return { type: 'video', src: url };
  return { type: 'external', src: url };
}

function community(ctx) {
  const { t } = ctx;
  const tab = TABS.find((x) => x[0] === ctx.url.searchParams.get('tab')) || TABS[0];
  const items = q.all('SELECT * FROM community_content WHERE type = ? AND is_active = 1 ORDER BY sort_order, id DESC', tab[2]);
  const empty = emptyState(t('nothing_yet'), tab[1]);
  let content;
  switch (tab[0]) {
    case 'videos':
      content = items.length ? html`<div class="grid g2">${items.map((it) => { const e = embedFor(it.url); return html`<div class="card" style="overflow:hidden">
        ${e?.type === 'iframe' ? html`<div class="player" style="border-radius:0"><iframe src="${e.src}" title="${it.title}" loading="lazy" allowfullscreen allow="accelerometer; autoplay; encrypted-media; picture-in-picture"></iframe></div>`
          : e?.type === 'video' ? html`<div class="player" style="border-radius:0"><video src="${e.src}" controls preload="metadata"></video></div>`
          : e ? html`<a href="${e.src}" target="_blank" rel="noopener" class="player player-ext" style="border-radius:0">${icon('play', 'ic-xl')}<span>${t('open_video')}</span></a>` : ''}
        <div class="card-pad-sm"><h3>${it.title}</h3>${it.description ? html`<p class="muted small" style="margin-top:4px">${it.description}</p>` : ''}</div></div>`; })}</div>` : empty;
      break;
    case 'links': {
      const ic = { instagram: 'instagram', telegram: 'send', youtube: 'youtube' };
      content = items.length ? html`<div class="grid g3">${items.map((it) => html`<a href="${it.url}" target="_blank" rel="noopener" class="card card-pad card-hover stack-sm">
        <div class="icon-tile tile-solid">${icon(ic[it.platform] || 'link')}</div><h3>${it.title}</h3>${it.description ? html`<p class="muted small">${it.description}</p>` : ''}<span class="small text-primary row" style="gap:4px">${icon('external', 'ic-sm')}${t('open')}</span></a>`)}</div>` : empty;
      break;
    }
    case 'investors':
      content = items.length ? html`<div class="grid g2">${items.map((it) => html`<div class="card card-pad row" style="align-items:flex-start">
        ${it.photo_url ? html`<img src="${it.photo_url}" alt="" style="width:64px;height:64px;border-radius:14px;object-fit:cover">` : html`<div class="icon-tile tile-primary" style="width:64px;height:64px">${icon('trendUp', 'ic-lg')}</div>`}
        <div class="grow stack-sm"><h3>${it.title}</h3>${it.description ? html`<p class="muted small">${it.description}</p>` : ''}${it.contact ? html`<a class="small text-primary" href="${it.url || 'mailto:' + it.contact}" target="_blank" rel="noopener">${it.contact}</a>` : ''}</div></div>`)}</div>` : empty;
      break;
    case 'events':
      content = items.length ? html`<div class="stack">${items.map((it) => html`<div class="card card-pad row" style="align-items:flex-start">
        <div class="icon-tile tile-primary" style="width:60px;height:60px;flex-direction:column;font-size:12px;font-weight:700">${icon('calendar', 'ic-sm')}${it.date ? fmtDate(it.date, ctx.lang).split(' ').slice(0, 2).join(' ') : ''}</div>
        <div class="grow stack-sm"><h3>${it.title}</h3>${it.description ? html`<p class="muted small">${it.description}</p>` : ''}${it.url ? html`<a class="small text-primary" href="${it.url}" target="_blank" rel="noopener">${t('details')} →</a>` : ''}</div></div>`)}</div>` : empty;
      break;
    case 'news':
      content = items.length ? html`<div class="grid g2">${items.map((it) => html`<a href="${it.url || '#'}" ${it.url ? raw('target="_blank" rel="noopener"') : ''} class="card card-pad card-hover stack-sm">
        <span class="badge b-primary">${it.date ? fmtDate(it.date, ctx.lang) : t('tab_news')}</span><h3>${it.title}</h3>${it.description ? html`<p class="muted small clamp3">${it.description}</p>` : ''}</a>`)}</div>` : empty;
      break;
    case 'support': {
      const info = items[0];
      content = html`<div class="narrow"><div class="card-soft card-pad center stack" style="padding:40px 24px">
        <div class="icon-tile tile-solid" style="margin:0 auto;width:64px;height:64px;border-radius:20px">${icon('phone', 'ic-lg')}</div>
        <h2>${t('support_title')}</h2><p class="muted">${t('support_sub')}</p>
        ${info?.contact ? html`<a href="tel:${info.contact.replace(/\s/g, '')}" class="btn btn-outline btn-lg">${icon('phone', 'ic-sm')}${info.contact}</a>` : ''}
        ${info?.url ? html`<a href="${info.url}" target="_blank" rel="noopener" class="btn btn-primary btn-lg">${icon('send', 'ic-sm')}Telegram</a>` : ''}
        ${info?.description ? html`<p class="small muted">${info.description}</p>` : ''}
        ${!info ? html`<p class="muted">${t('coming_soon')}</p>` : ''}
      </div></div>`;
      break;
    }
    case 'founders':
      content = items.length ? html`<div class="grid g3">${items.map((it) => html`<div class="card card-pad center stack-sm">
        ${it.photo_url ? html`<img src="${it.photo_url}" alt="${it.title}" style="width:84px;height:84px;border-radius:50%;object-fit:cover;margin:0 auto">` : html`<span class="avatar avatar-lg" style="margin:0 auto">${it.title[0]}</span>`}
        <h3>${it.title}</h3>${it.description ? html`<p class="muted small">${it.description}</p>` : ''}${it.contact ? html`<a href="mailto:${it.contact}" class="xs text-primary">${it.contact}</a>` : ''}</div>`)}</div>` : empty;
      break;
  }
  const body = html`<main class="page"><div class="container">
    ${pageHead(t('community_title'), t('community_sub'), ctx.user ? html`<a href="/profile?tab=purpose" class="btn btn-primary btn-sm">${icon('users', 'ic-sm')}${t('find_people')}</a>` : '')}
    <div class="pills" style="margin-bottom:24px">${TABS.map(([k, ic]) => html`<a href="/community?tab=${k}" class="${cx(tab[0] === k && 'on')}">${t('tab_' + k)}</a>`)}</div>
    ${content}
  </div></main>`;
  send(ctx, 200, page(ctx, { title: t('community_title'), description: t('community_sub'), body, canonical: tab[0] === 'videos' ? '/community' : `/community?tab=${tab[0]}` }));
}

// ─── Teachers ─────────────────────────────────────────────────────────────────
function teachers(ctx) {
  const { t } = ctx;
  const list = q.all(`SELECT u.id, u.full_name, u.photo_url, tp.headline, tp.specialization, tp.experience_years,
    (SELECT COUNT(*) FROM courses c WHERE c.owner_id = u.id AND c.is_published = 1) AS courses
    FROM users u JOIN teacher_profiles tp ON tp.user_id = u.id WHERE tp.is_visible = 1 AND u.role IN ('teacher','admin') ORDER BY courses DESC, u.full_name`);
  const body = html`<main class="page"><div class="container">
    ${pageHead(t('teachers'), t('teachers_sub'))}
    ${list.length ? html`<div class="grid g3">${list.map((x) => html`<a href="/teachers/${x.id}" class="card card-pad card-hover center stack-sm">
      ${avatar(x, 'avatar-lg')}<h3 style="margin-top:6px">${x.full_name}</h3>${x.headline ? html`<p class="muted small">${x.headline}</p>` : ''}
      <div class="row-wrap" style="justify-content:center">${x.specialization ? html`<span class="badge b-primary">${x.specialization}</span>` : ''}<span class="badge">${x.courses} ${t('nav_courses').toLowerCase()}</span></div></a>`)}</div>` : emptyState(t('nothing_yet'), 'cap')}
  </div></main>`;
  send(ctx, 200, page(ctx, { title: t('teachers'), description: t('teachers_sub'), body }));
}

function teacherDetail(ctx) {
  const { t } = ctx;
  const x = q.get(`SELECT u.id, u.full_name, u.photo_url, tp.* FROM users u JOIN teacher_profiles tp ON tp.user_id = u.id WHERE u.id = ? AND tp.is_visible = 1`, Number(ctx.params.id));
  if (!x) throw new HttpError(404);
  const courses = q.all(`${COURSE_SELECT} WHERE c.owner_id = ? AND c.is_published = 1 ORDER BY c.created_at DESC`, x.id);
  const body = html`<main class="page"><div class="container">
    <a href="/teachers" class="back">${icon('arrowLeft', 'ic-sm')} ${t('teachers')}</a>
    <div class="layout-main">
      <div class="stack-lg">
        <div class="card card-pad row" style="align-items:flex-start;gap:20px">${avatar(x, 'avatar-lg')}<div class="grow stack-sm"><h1 style="font-size:1.8rem">${x.full_name}</h1>${x.headline ? html`<p class="muted">${x.headline}</p>` : ''}
          <div class="row-wrap">${x.specialization ? html`<span class="badge b-primary">${x.specialization}</span>` : ''}${x.experience_years ? html`<span class="badge">${t('years_exp', { n: x.experience_years })}</span>` : ''}</div></div></div>
        ${x.bio ? html`<div class="card card-pad"><h2 style="font-size:1.2rem;margin-bottom:10px">${t('about')}</h2><div class="prose">${markdown(x.bio)}</div></div>` : ''}
        <div>${sectionTitle(t('nav_courses'), 'book', 'tile-primary')}${courses.length ? html`<div class="grid g2">${courses.map((c) => courseCard(ctx, c))}</div>` : emptyState(t('no_courses'), 'book')}</div>
      </div>
      <aside class="card card-pad stack-sm small">
        ${x.education ? html`<div><div class="xs muted">${t('education')}</div>${x.education}</div>` : ''}
        ${x.contact_email ? html`<div class="row">${icon('mail', 'ic-sm')}<a class="link" href="mailto:${x.contact_email}">${x.contact_email}</a></div>` : ''}
        ${x.contact_phone ? html`<div class="row">${icon('phone', 'ic-sm')}${x.contact_phone}</div>` : ''}
        ${x.telegram ? html`<div class="row">${icon('send', 'ic-sm')}${x.telegram}</div>` : ''}
        ${x.linkedin ? html`<div class="row">${icon('link', 'ic-sm')}<a class="link" href="${x.linkedin}" target="_blank" rel="noopener">LinkedIn</a></div>` : ''}
        ${x.website ? html`<div class="row">${icon('globe', 'ic-sm')}<a class="link" href="${x.website}" target="_blank" rel="noopener">${t('website')}</a></div>` : ''}
      </aside>
    </div></div></main>`;
  const jsonLd = { '@context': 'https://schema.org', '@type': 'Person', name: x.full_name, jobTitle: x.headline || x.specialization || 'Teacher', worksFor: { '@type': 'Organization', name: 'Jumıs AI' } };
  send(ctx, 200, page(ctx, { title: x.full_name, description: (x.headline || x.bio || '').slice(0, 155), body, jsonLd }));
}

// ─── Misc ─────────────────────────────────────────────────────────────────────
function privacy(ctx) {
  const { t } = ctx;
  const body = html`<main class="page"><div class="container narrow"><div class="card card-pad prose">
    <h1>${t('privacy')}</h1>${markdown(t('privacy_text'))}</div></div></main>`;
  send(ctx, 200, page(ctx, { title: t('privacy'), body }));
}

function sitemap(ctx) {
  const u = (loc, lastmod, pri = '0.7') => `<url><loc>${config.siteUrl}${loc}</loc>${lastmod ? `<lastmod>${lastmod.slice(0, 10)}</lastmod>` : ''}<priority>${pri}</priority></url>`;
  const urls = [u('/', null, '1.0'), u('/courses', null, '0.9'), u('/vacancies', null, '0.9'), u('/community', null, '0.6'), u('/teachers', null, '0.6'), u('/privacy', null, '0.2')];
  for (const c of q.all('SELECT slug, created_at FROM courses WHERE is_published = 1')) urls.push(u(`/courses/${c.slug}`, c.created_at, '0.8'));
  for (const v of activeVacancies()) urls.push(u(`/vacancies/${v.slug}`, v.created_at, '0.8'));
  for (const x of q.all('SELECT user_id FROM teacher_profiles WHERE is_visible = 1')) urls.push(u(`/teachers/${x.user_id}`, null, '0.5'));
  for (const tab of ['links', 'events', 'news', 'founders']) urls.push(u(`/community?tab=${tab}`, null, '0.4'));
  send(ctx, 200, `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls.join('')}</urlset>`, { 'Content-Type': 'application/xml; charset=utf-8' });
}

function robots(ctx) {
  const body = `User-agent: *\nAllow: /\nDisallow: /admin\nDisallow: /org\nDisallow: /dashboard\nDisallow: /profile\nDisallow: /learn\nDisallow: /notifications\nDisallow: /api/\nDisallow: /tests/\nDisallow: /results/\nDisallow: /onboarding\n\nSitemap: ${config.siteUrl}/sitemap.xml\n`;
  send(ctx, 200, body, { 'Content-Type': 'text/plain; charset=utf-8' });
}

function setLang(ctx) {
  const code = ctx.params.code;
  if (LANGUAGES.some((l) => l.code === code)) setCookie(ctx, 'lang', code, { maxAge: 31536000 });
  redirect(ctx, safeNext(ctx.url.searchParams.get('next'), '/'));
}

function health(ctx) { send(ctx, 200, 'ok', { 'Content-Type': 'text/plain' }); }

export default function (r) {
  r.get('/', landing);
  r.get('/courses', coursesList);
  r.get('/courses/:slug', courseDetail);
  r.get('/vacancies', vacanciesList);
  r.get('/vacancies/:slug', vacancyDetail);
  r.get('/community', community);
  r.get('/teachers', teachers);
  r.get('/teachers/:id', teacherDetail);
  r.get('/privacy', privacy);
  r.get('/sitemap.xml', sitemap);
  r.get('/robots.txt', robots);
  r.get('/lang/:code', setLang);
  r.get('/health', health);
}
