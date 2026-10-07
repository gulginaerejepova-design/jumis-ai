# Jumıs AI

A learning and careers platform for Karakalpakstan: online courses, tests with AI analysis, assignments with AI feedback, certificates, a job board, and **Ziyrek AI**, a career advisor that reads your CV. The site comes in four languages: Karakalpak (default), Uzbek, Russian and English.

This is the standalone version of the original Base44 app. It keeps the same design and features, and adds a public landing page, Google-ready pages and fixes.

---

## 1. Run it on your computer (5 minutes)

You only need **Node.js 22.13 or newer** ([download](https://nodejs.org)). There is nothing to install with npm: the project has zero dependencies.

```bash
cd jumis-ai
cp .env.example .env        # then open .env and add your keys (optional for a first try)
npm run seed                # adds starter courses, tests, vacancies and demo accounts
npm start                   # → http://localhost:3000
```

- The **first account you register becomes the admin.** To make any other account an admin, put its email or phone in `ADMIN_LOGINS` (comma-separated) and restart; it becomes admin the next time it opens the site.
- Demo accounts (password `demo12345`): `student@demo.jumis`, `teacher@demo.jumis`, `org@demo.jumis`. Delete them in **Admin → Users** before going public.
- To try every AI feature without an API key, put `AI_MOCK=1` in `.env`. AI answers will be samples.

## 2. Keys you will want

| What | Where to get it | `.env` variable |
|---|---|---|
| Claude AI (Ziyrek AI, test analysis, feedback, question generator) | [console.anthropic.com](https://console.anthropic.com) → API Keys | `ANTHROPIC_API_KEY` |
| Email (enrollment codes, password reset, vacancy notices) | [resend.com](https://resend.com) → verify your domain → API key | `RESEND_API_KEY`, `EMAIL_FROM` |
| Google Search Console verification | see section 4 | `GOOGLE_SITE_VERIFICATION` |

Without a Claude key the site still works: AI buttons are disabled with a clear message, and tests are graded normally. Without an email key, enrollment is confirmed straight away (no code) and emails are printed in the server log.

## 3. Put it online

The app stores its database and uploaded files in the `data/` folder. **Your host must keep this folder between deploys** (a "volume" or "disk"). Otherwise you lose data on every update.

### Option A — Railway (easiest)
1. Put the project on GitHub (in Claude Code: *"create a GitHub repo for this project and push it"*).
2. On [railway.app](https://railway.app): **New Project → Deploy from GitHub repo**. Railway finds the `Dockerfile`.
3. **Add a Volume** to the service, with mount path **`/app/data`**.
4. **Variables:** add `SITE_URL`, `ANTHROPIC_API_KEY`, `RESEND_API_KEY`, `EMAIL_FROM`, `NODE_ENV=production`.
5. **Settings → Networking → Generate Domain**, or add your own domain (for example `jumis.uz`) and follow the DNS instructions.
6. Open the site and register: you become the admin. To add starter content, open Railway's shell and run `npm run seed -- --no-demo`.

### Option B — Render
**New → Web Service** from your GitHub repo, using the Docker runtime. Add a **Disk** mounted at `/app/data` (needs a paid instance). Set the same environment variables.

### Option C — Your own server (VPS, e.g. Ubuntu)
```bash
# install Node 22, then:
git clone <your repo> jumis-ai && cd jumis-ai
cp .env.example .env && nano .env      # set SITE_URL, keys, NODE_ENV=production
npm run seed -- --no-demo
npx pm2 start "npm start" --name jumis && npx pm2 save   # keeps it running
```
Put Nginx in front with HTTPS (`certbot --nginx`), proxying to `localhost:3000`. Set `client_max_body_size 100m;` so video uploads work.

**Backups:** copy the `data/` folder (it contains `jumis.db` and `uploads/`). For example, run a nightly `tar czf backup-$(date +%F).tgz data`.

## 4. Get it on Google

Everything on the Google side is already built in:
- every public page is rendered on the server with a title, description, canonical link and social share image
- `/sitemap.xml` and `/robots.txt`
- structured data for Google: `Course` on course pages, `JobPosting` on vacancy pages (so they can appear in **Google for Jobs**), and `Organization` and `WebSite` on the home page
- private pages (dashboard, admin, learning) are hidden from search

Steps:
1. Set `SITE_URL` to your real address (with `https://`) and redeploy.
2. Open [Google Search Console](https://search.google.com/search-console) and **add a property**:
   - **Domain property** (recommended): add the TXT record Google gives you at your domain registrar.
   - or **URL prefix**: choose *HTML tag*, copy only the `content="…"` value into `GOOGLE_SITE_VERIFICATION`, redeploy, then click **Verify**.
3. Go to **Sitemaps** → enter `sitemap.xml` → **Submit**.
4. Go to **URL Inspection**, paste your home page URL, and click **Request indexing**. Do the same for your most important course and vacancy pages.
5. Check a vacancy page with the [Rich Results Test](https://search.google.com/test/rich-results). It should show a valid *Job posting*.
6. Indexing usually takes a few days to two weeks. Adding real courses and vacancies regularly, and sharing links on Telegram and Instagram, helps.

## 5. Keep building with Claude Code

Open this folder in Claude Code and describe what you want, for example:
- *"Add a 'Favorites' button to vacancies that students can save."*
- *"Translate the new texts into Karakalpak, Uzbek, Russian and English."*
- *"Deploy the latest changes to Railway."*

`CLAUDE.md` explains the project structure to Claude Code automatically.

## Project map

```
server.js              start here — the web server
src/app.js             request handling, routing, error pages, security checks
src/db.js              database (SQLite built into Node) — all tables are defined here
src/auth.js            passwords, sessions, roles
src/services.js        Claude AI, email, file uploads
src/strings.js         ALL interface text in 4 languages
src/routes/            pages and actions
  public.js            landing, courses, vacancies, community, teachers, sitemap
  auth.js              login, register, onboarding, password reset
  learn.js             enrollment, lessons, tests, assignments, certificates
  profile.js           dashboards, profile, Purpose Space, schedule, notifications
  career.js            Ziyrek AI, skill test, job applications, vacancy management
  admin.js             admin & teacher panel
src/views/             layout, components, icons
public/                CSS, JavaScript, images
scripts/               seed, make-admin, translation checker
```

Useful commands: `npm run dev` (auto-restart on save), `npm run check` (find missing translations), `npm run make-admin -- email@example.com`.

## What changed compared to the Base44 version

- **Enrollment codes are no longer shown on screen.** The code is emailed, stored hashed, valid for 15 minutes and limited to 5 tries.
- **Organizations can post and manage their own vacancies**, see applicants and change application status. Candidates are listed only if a student chose "Open to work".
- **Applying to jobs** is now a real feature (cover letter + CV). Cancelling a vacancy notifies every applicant in the app and by email, together with an AI explanation.
- **Ziyrek AI reads the actual CV PDF**, uses certificates, awards, test results and goals, and links matched vacancies and courses.
- **Purpose Space matching runs on the server**, so other users' emails are no longer exposed. A contact is only shared after a connection is accepted. Without AI it falls back to keyword matching.
- **Schedule reminders work reliably.**
- **New:** a public landing page, lesson progress tracking, automatic and verifiable certificates, an AI test-question generator, bulk question import, teacher approval, public teacher profiles, password reset, dark mode, a mobile menu and full translation of every page.
