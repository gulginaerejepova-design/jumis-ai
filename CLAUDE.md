# Jumıs AI — notes for Claude Code

Learning + careers platform for Karakalpakstan. Plain Node.js (>= 22.13), **zero npm dependencies**: keep it that way unless the owner agrees to add one.

## Run
- `npm run dev` — server with auto-restart (http://localhost:3000)
- `npm run seed` — starter content + demo users (password `demo12345`); `-- --no-demo` for content only
- `npm run check` — must pass: every `t('key')` needs an entry in `src/strings.js`
- `AI_MOCK=1` in `.env` — AI features return sample answers (no API key needed)

## Architecture
- `server.js` → `src/app.js` (static files, context, CSRF origin check, router, error pages)
- Routes register with `r.get(path, handler)` / `r.post(...)` in `src/routes/*.js`; params like `/courses/:slug` → `ctx.params.slug`
- `ctx` has `user`, `t` (translator), `lang`, `url`, `path`, `params`, `flash`
- HTML is built with the `html\`\`` tagged template in `src/views/html.js` — it **escapes everything** automatically; use `raw()` only for trusted markup. Never concatenate user input into HTML strings.
- Pages: `send(ctx, 200, page(ctx, { title, description, body }))`. Forms post and then `redirect(ctx, url, { msg })` (flash toast).
- Management screens use `panelPage()` from `src/views/panel.js`
- Database: `node:sqlite` in `src/db.js`. Use `q.get / q.all / q.run / q.insert / q.update` with `?` parameters. **Schema changes: append a new string to the `migrations` array, never edit old ones.**
- Forms: `readForm(ctx)` (handles multipart), `field(form, name, maxLen)`, `fileField(form, name)`, `saveUpload(file, 'image'|'document'|'video')`
- AI: `askAI({ prompt, system, lang, json, mock, pdfUrls })` in `src/services.js` (Claude Messages API via fetch). Always provide a `mock` and handle `e.code === 'AI_NOT_CONFIGURED'`.
- Email: `sendEmail({ to, subject, text })` (Resend; logs to console when not configured)
- In-app notifications: `notify(userId, { type, title, body, link })`
- Roles: `user.role` = admin | teacher | user; `user.user_type` = student | teacher | organization. Helpers in `src/auth.js`: `requireUser`, `requireRole(ctx, isTeacher)`, `isAdmin`, `isOrg`.

## Conventions
- All UI text goes in `src/strings.js` as `key: [Karakalpak, Uzbek, Russian, English]`. Karakalpak uses Latin script (á, ó, ú, ı, ń, ǵ).
- Styling: `public/css/app.css` (design tokens at the top: Sand #F5F0E8, Night #0D1B2A, Forest #0E8A5F, Apricot #F2A83A; Fjord One for headings, Inter for text). Reuse the existing classes (`card`, `btn btn-primary`, `badge`, `grid g3`, `stack`, `row`).
- Icons: `icon('name', 'ic-sm')` from `src/views/icons.js`
- Public pages must stay server-rendered and include a good `title` and `description` (SEO). Add new public URLs to `sitemap()` in `src/routes/public.js`.
- Private pages pass `noindex: true` to `page()`.
- Keep pages working without JavaScript; `public/js/app.js` only enhances.
