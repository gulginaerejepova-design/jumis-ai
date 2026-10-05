// Page shell: <head> with SEO tags, navigation, footer, toasts.
import { html, raw, esc, cx } from './html.js';
import { icon, logoMark } from './icons.js';
import { LANGUAGES } from '../i18n.js';
import { config } from '../env.js';
import { isTeacher, isAdmin } from '../auth.js';

function navLinks(ctx) {
  const { t, user } = ctx;
  const links = [
    { href: '/courses', label: t('nav_courses'), ic: 'book' },
    { href: '/vacancies', label: t('nav_vacancies'), ic: 'briefcase' },
    { href: '/ai-assistant', label: t('nav_ai'), ic: 'sparkles' },
    { href: '/skill-test', label: t('nav_skill_test'), ic: 'brain' },
    { href: '/community', label: t('nav_community'), ic: 'handshake' },
  ];
  if (user) {
    links.unshift({ href: '/dashboard', label: t('nav_home'), ic: 'dashboard' });
    if (user.user_type === 'organization' && !isAdmin(user)) links.push({ href: '/org', label: t('nav_org'), ic: 'building' });
    if (isTeacher(user)) links.push({ href: '/admin', label: isAdmin(user) ? t('nav_admin') : t('nav_teaching'), ic: 'shield' });
  }
  return links;
}

const isActive = (ctx, href) => ctx.path === href || (href !== '/' && ctx.path.startsWith(href + '/'));

export function page(ctx, { title, description, body, canonical, noindex = false, jsonLd, ogImage, bare = false }) {
  const { t, lang, user } = ctx;
  const fullTitle = title ? `${title} · ${config.siteName}` : `${config.siteName} — ${t('meta_tagline')}`;
  const desc = description || t('meta_description');
  const url = config.siteUrl + (canonical ?? ctx.path);
  const img = ogImage || `${config.siteUrl}/public/img/og.png`;
  const links = navLinks(ctx);
  const nextParam = encodeURIComponent(ctx.url.pathname + ctx.url.search);
  const flash = ctx.flash;

  const doc = html`<!doctype html>
<html lang="${lang}" class="no-js">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${fullTitle}</title>
<meta name="description" content="${desc}">
${noindex ? raw('<meta name="robots" content="noindex, nofollow">') : html`<link rel="canonical" href="${url}">`}
<meta property="og:type" content="website">
<meta property="og:site_name" content="${config.siteName}">
<meta property="og:title" content="${fullTitle}">
<meta property="og:description" content="${desc}">
<meta property="og:url" content="${url}">
<meta property="og:image" content="${img}">
<meta name="twitter:card" content="summary_large_image">
<meta name="theme-color" content="#0E8A5F">
${config.googleVerification ? html`<meta name="google-site-verification" content="${config.googleVerification}">` : ''}
<link rel="icon" href="/public/img/logo.svg" type="image/svg+xml">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Fjord+One&family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
<link rel="stylesheet" href="/public/css/app.css?v=${ctx.assetVersion}">
<script>try{var th=localStorage.getItem('theme');if(th)document.documentElement.dataset.theme=th;}catch(e){}</script>
${jsonLd ? raw(`<script type="application/ld+json">${JSON.stringify(jsonLd).replace(/</g, '\\u003c')}</script>`) : ''}
</head>
<body>
${bare ? '' : html`
<header class="nav">
  <div class="container nav-inner">
    <a href="${user ? '/dashboard' : '/'}" class="brand" aria-label="Jumıs AI">${logoMark(32)}<span>Jumıs<b> AI</b></span></a>
    <nav class="nav-links" aria-label="Main">
      ${links.map((l) => html`<a href="${l.href}" class="${cx(isActive(ctx, l.href) && 'active')}">${icon(l.ic, 'ic-sm')}${l.label}</a>`)}
    </nav>
    <div class="nav-right">
      <details class="dropdown hide-mobile">
        <summary class="lang-btn">${icon('globe', 'ic-sm')}${LANGUAGES.find((l) => l.code === lang)?.label}</summary>
        <div class="dropdown-menu">
          ${LANGUAGES.map((l) => html`<a href="/lang/${l.code}?next=${nextParam}" class="${cx(l.code === lang && 'sel')}">${l.label}</a>`)}
        </div>
      </details>
      <button class="icon-btn hide-mobile" type="button" data-theme-toggle title="${t('toggle_theme')}" aria-label="${t('toggle_theme')}">${icon('moon', 'ic-sm')}</button>
      ${user ? html`
        <a href="/notifications" class="icon-btn" title="${t('notifications')}" aria-label="${t('notifications')}">${icon('bell', 'ic-sm')}${ctx.unread ? html`<span class="dot-count">${ctx.unread > 9 ? '9+' : ctx.unread}</span>` : ''}</a>
        <details class="dropdown">
          <summary class="icon-btn" aria-label="${t('nav_profile')}"><span class="avatar" style="width:30px;height:30px;font-size:13px">${user.photo_url ? html`<img src="${user.photo_url}" alt="">` : (user.full_name || user.email)[0].toUpperCase()}</span></summary>
          <div class="dropdown-menu">
            <div class="small" style="padding:8px 10px"><div class="bold truncate">${user.full_name || user.email}</div><div class="muted xs truncate">${user.email}</div></div>
            <hr>
            <a href="/profile">${icon('user', 'ic-sm')}${t('nav_profile')}</a>
            <a href="/dashboard">${icon('dashboard', 'ic-sm')}${t('nav_home')}</a>
            <a href="/notifications">${icon('bell', 'ic-sm')}${t('notifications')}</a>
            <hr>
            <form method="post" action="/logout"><button type="submit" class="text-danger">${icon('logout', 'ic-sm')}${t('nav_logout')}</button></form>
          </div>
        </details>` : html`
        <a href="/login?next=${nextParam}" class="btn btn-ghost btn-sm hide-mobile">${t('login')}</a>
        <a href="/register" class="btn btn-primary btn-sm">${t('get_started')}</a>`}
      <details class="dropdown mobile-only">
        <summary class="icon-btn" aria-label="Menu">${icon('menu', 'ic-sm')}</summary>
        <div class="dropdown-menu" style="min-width:250px">
          ${links.map((l) => html`<a href="${l.href}" class="${cx(isActive(ctx, l.href) && 'sel')}">${icon(l.ic, 'ic-sm')}${l.label}</a>`)}
          <hr>
          ${LANGUAGES.map((l) => html`<a href="/lang/${l.code}?next=${nextParam}" class="${cx(l.code === lang && 'sel')}">${icon('globe', 'ic-sm')}${l.label}</a>`)}
          <hr>
          <button type="button" data-theme-toggle>${icon('moon', 'ic-sm')}${t('toggle_theme')}</button>
          ${!user ? html`<a href="/login">${icon('lock', 'ic-sm')}${t('login')}</a>` : ''}
        </div>
      </details>
    </div>
  </div>
</header>`}
${body}
${bare ? '' : html`
<footer class="site">
  <div class="container">
    <div class="foot-grid">
      <div class="stack-sm">
        <a href="/" class="brand">${logoMark(30)}<span>Jumıs<b> AI</b></span></a>
        <p class="muted small" style="max-width:320px">${t('footer_about')}</p>
      </div>
      <div><h4>${t('footer_platform')}</h4>
        <a href="/courses">${t('nav_courses')}</a><a href="/vacancies">${t('nav_vacancies')}</a><a href="/teachers">${t('teachers')}</a><a href="/ai-assistant">${t('nav_ai')}</a>
      </div>
      <div><h4>${t('footer_community')}</h4>
        <a href="/community">${t('nav_community')}</a><a href="/community?tab=events">${t('tab_events')}</a><a href="/community?tab=news">${t('tab_news')}</a><a href="/community?tab=support">${t('tab_support')}</a>
      </div>
      <div><h4>${t('footer_language')}</h4>
        ${LANGUAGES.map((l) => html`<a href="/lang/${l.code}?next=${nextParam}">${l.label}</a>`)}
      </div>
    </div>
    <hr class="sep">
    <div class="row between small muted" style="flex-wrap:wrap">
      <span>© ${new Date().getFullYear()} Jumıs AI · ${t('footer_made')}</span>
      <a href="/privacy">${t('privacy')}</a>
    </div>
  </div>
</footer>`}
<div class="toast-wrap" id="toasts">${flash ? html`<div class="toast ${flash.type === 'error' ? 'error' : ''}">${icon(flash.type === 'error' ? 'alert' : 'check', 'ic-sm')}<span>${flash.msg}</span></div>` : ''}</div>
${user ? raw('<span data-reminders hidden></span>') : ''}
<script src="/public/js/app.js?v=${ctx.assetVersion}" defer></script>
</body>
</html>`;
  return doc.toString();
}

export function pageHead(title, subtitle, actions = '') {
  return html`<div class="page-head"><div><h1>${title}</h1>${subtitle ? html`<p>${subtitle}</p>` : ''}</div>${actions ? html`<div class="row-wrap">${actions}</div>` : ''}</div>`;
}

export { esc };
