// Reusable UI pieces.
import { html, cx } from './html.js';
import { icon } from './icons.js';

export const JOB_TYPES = ['full_time', 'part_time', 'contract', 'internship', 'remote'];
export const EXP_LEVELS = ['no_experience', 'junior', 'mid', 'senior', 'lead'];
const JOB_TYPE_CLS = { full_time: 'b-success', part_time: 'b-info', contract: 'b-accent', internship: 'b-purple', remote: 'b-primary' };

export const initial = (u) => ((u?.full_name || u?.email || '?').trim()[0] || '?').toUpperCase();

export function avatar(u, cls = '') {
  return html`<span class="avatar ${cls}">${u?.photo_url ? html`<img src="${u.photo_url}" alt="">` : initial(u)}</span>`;
}

export function fmtDate(iso, lang, withTime = false) {
  if (!iso) return '';
  // 'YYYY-MM-DD' → local date; 'YYYY-MM-DD HH:MM:SS' (SQLite, UTC) → UTC; 'YYYY-MM-DDTHH:MM' (form input) → wall time as entered
  const d = new Date(iso.length <= 10 ? iso + 'T00:00:00' : iso.includes(' ') ? iso.replace(' ', 'T') + 'Z' : iso);
  if (isNaN(d)) return iso;
  const locale = { kaa: 'uz-Latn-UZ', uz: 'uz-Latn-UZ', ru: 'ru-RU', en: 'en-GB' }[lang] || 'en-GB';
  const opts = withTime ? { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' } : { day: 'numeric', month: 'short', year: 'numeric' };
  try { return d.toLocaleString(locale, opts); } catch { return d.toISOString().slice(0, withTime ? 16 : 10).replace('T', ' '); }
}

export function courseCard(ctx, c) {
  const { t } = ctx;
  return html`<a href="/courses/${c.slug}" class="card card-hover course-card">
    <div class="course-thumb">
      ${c.thumbnail_url ? html`<img src="${c.thumbnail_url}" alt="${c.title}" loading="lazy">` : icon('book', 'ic-xl')}
      ${!c.is_published ? html`<span class="badge">${t('unpublished')}</span>` : ''}
    </div>
    <div class="course-body">
      <div class="row-wrap">${c.category ? html`<span class="badge b-primary">${c.category}</span>` : ''}${c.level ? html`<span class="badge">${t('level_' + c.level)}</span>` : ''}</div>
      <h3 class="clamp2">${c.title}</h3>
      ${c.description ? html`<p class="muted small clamp2">${c.description}</p>` : ''}
      <div class="meta" style="margin-top:12px">
        <span>${icon('play', 'ic-sm')}${c.lesson_count ?? 0} ${t('lessons_count')}</span>
        ${c.teacher_name ? html`<span>${icon('cap', 'ic-sm')}${c.teacher_name}</span>` : ''}
      </div>
    </div>
  </a>`;
}

export function jobTypeBadge(ctx, type) {
  return html`<span class="badge ${JOB_TYPE_CLS[type] || ''}">${ctx.t('job_' + type)}</span>`;
}

export function vacancyCard(ctx, v) {
  const { t } = ctx;
  return html`<a href="/vacancies/${v.slug}" class="card card-hover vac-card">
    <div class="row" style="align-items:flex-start">
      <div class="icon-tile tile-accent">${icon('building')}</div>
      <div class="grow">
        <h3 class="clamp2">${v.title}</h3>
        <p class="muted small">${v.organization}</p>
      </div>
      ${jobTypeBadge(ctx, v.job_type)}
    </div>
    <div class="meta" style="margin-top:12px">
      ${v.address ? html`<span>${icon('pin', 'ic-sm')}${v.address}</span>` : ''}
      <span>${icon('trendUp', 'ic-sm')}${t('exp_' + v.experience_level)}</span>
      ${v.deadline ? html`<span>${icon('calendar', 'ic-sm')}${fmtDate(v.deadline, ctx.lang)}</span>` : ''}
    </div>
    ${v.salary ? html`<div class="salary small" style="margin-top:8px">${icon('wallet', 'ic-sm')} ${v.salary}</div>` : ''}
  </a>`;
}

export function statCard(label, value, ic, tile = 'tile-primary', href) {
  const inner = html`<div class="icon-tile ${tile}">${icon(ic)}</div><div class="val">${value}</div><div class="lbl">${label}</div>`;
  return href ? html`<a href="${href}" class="card card-hover stat">${inner}</a>` : html`<div class="card stat">${inner}</div>`;
}

export function emptyState(text, ic = 'search', action = '') {
  return html`<div class="empty">${icon(ic, 'ic-xl')}<p>${text}</p>${action ? html`<div style="margin-top:14px">${action}</div>` : ''}</div>`;
}

export function sectionTitle(title, ic, tile, link) {
  return html`<div class="row between" style="margin-bottom:16px">
    <div class="row"><div class="icon-tile ${tile}" style="width:34px;height:34px;border-radius:10px">${icon(ic, 'ic-sm')}</div><h2 style="font-size:1.25rem">${title}</h2></div>
    ${link ? html`<a href="${link.href}" class="small text-primary row" style="gap:4px">${link.label}${icon('chevronRight', 'ic-sm')}</a>` : ''}
  </div>`;
}

/** A submit button that shows a spinner and a message while the form is posting (for slow AI calls) */
export function busyButton(label, busyLabel, cls = 'btn btn-primary', ic) {
  return html`<button type="submit" class="${cls}" data-busy="${busyLabel}">${ic ? icon(ic, 'ic-sm') : ''}<span>${label}</span></button>`;
}

export function percentColor(p) { return p >= 70 ? 'success' : p >= 40 ? 'accent' : 'danger'; }

export function scoreBars(ctx, scores) {
  return html`<div class="stack-sm">${Object.entries(scores || {}).map(([topic, v]) => {
    const p = v.total ? Math.round((v.correct / v.total) * 100) : 0;
    return html`<div><div class="row between small" style="margin-bottom:4px"><span class="row" style="gap:6px">${icon(p >= 70 ? 'trendUp' : 'trendDown', 'ic-sm ' + (p >= 70 ? 'text-success' : 'text-danger'))}${topic}</span><span class="${p >= 70 ? 'text-success' : 'text-danger'} bold">${p}%</span></div>
      <div class="bar thin ${cx(p < 40 && 'red', p >= 40 && p < 70 && 'amber')}"><i style="width:${p}%"></i></div></div>`;
  })}</div>`;
}

export function aiNotConfigured(ctx) {
  return html`<div class="alert alert-warn">${icon('alert')}<div>${ctx.t('ai_not_configured')}</div></div>`;
}
