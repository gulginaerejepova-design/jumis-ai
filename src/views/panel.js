// Shell for the management panels (admin/teacher at /admin, organizations at /org).
import { html, cx } from './html.js';
import { icon } from './icons.js';
import { page } from './layout.js';
import { isAdmin } from '../auth.js';

export function panelPage(ctx, { base, active, title, subtitle = '', actions = '', content }) {
  const { t, user } = ctx;
  let items;
  if (base === '/org') {
    items = [
      ['/org', 'vacancies', 'briefcase', t('my_vacancies')],
      ['/org/applications', 'applications', 'file', t('applications')],
      ['/org/candidates', 'candidates', 'users', t('candidates')],
      ['/profile', 'profile', 'building', t('org_profile')],
    ];
  } else {
    items = [
      ['/admin', 'overview', 'dashboard', t('overview')],
      ['/admin/courses', 'courses', 'book', t('nav_courses')],
      ['/admin/submissions', 'submissions', 'clipboard', t('submissions')],
      ['/admin/certificates', 'certificates', 'award', t('certificates')],
      ['/admin/questions', 'questions', 'brain', t('skill_questions')],
    ];
    if (isAdmin(user)) {
      items.push(
        ['/admin/vacancies', 'vacancies', 'briefcase', t('nav_vacancies')],
        ['/admin/users', 'users', 'users', t('users')],
        ['/admin/community', 'community', 'handshake', t('nav_community')],
      );
    }
  }
  const body = html`<main class="page"><div class="container">
    <div class="layout-side">
      <nav class="card side-menu" aria-label="Panel">
        <div class="xs muted bold hide-mobile" style="padding:8px 12px;text-transform:uppercase;letter-spacing:.06em">${base === '/org' ? t('nav_org') : isAdmin(user) ? t('nav_admin') : t('nav_teaching')}</div>
        ${items.map(([href, key, ic, label]) => html`<a href="${href}" class="${cx(active === key && 'on')}">${icon(ic, 'ic-sm')}${label}</a>`)}
      </nav>
      <div class="stack">
        <div class="page-head" style="margin-bottom:6px"><div><h1 style="font-size:1.7rem">${title}</h1>${subtitle ? html`<p>${subtitle}</p>` : ''}</div>${actions ? html`<div class="row-wrap">${actions}</div>` : ''}</div>
        ${content}
      </div>
    </div></div></main>`;
  return page(ctx, { title, body, noindex: true });
}
