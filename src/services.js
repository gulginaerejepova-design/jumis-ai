// External services: file uploads (local disk), Claude AI, and email.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { config } from './env.js';
import { HttpError } from './http.js';

// ─── Uploads ──────────────────────────────────────────────────────────────────
export const uploadDir = path.join(config.dataDir, 'uploads');
fs.mkdirSync(uploadDir, { recursive: true });

const KINDS = {
  image: ['.jpg', '.jpeg', '.png', '.webp', '.gif'],
  document: ['.pdf', '.doc', '.docx', '.ppt', '.pptx', '.xls', '.xlsx', '.txt', '.zip', '.jpg', '.jpeg', '.png'],
  video: ['.mp4', '.webm', '.mov', '.m4v', '.ogg'],
};

/** Save an uploaded File (from FormData) and return its public URL. */
export async function saveUpload(file, kind = 'document') {
  const ext = path.extname(file.name || '').toLowerCase();
  if (!KINDS[kind].includes(ext)) {
    throw new HttpError(400, `File type ${ext || '(none)'} is not allowed. Allowed: ${KINDS[kind].join(', ')}`);
  }
  const name = crypto.randomBytes(16).toString('hex') + ext;
  await fs.promises.writeFile(path.join(uploadDir, name), Buffer.from(await file.arrayBuffer()));
  return `/uploads/${name}`;
}

// ─── Claude AI ────────────────────────────────────────────────────────────────
const LANG_NAMES = { kaa: 'Karakalpak (Latin script)', uz: 'Uzbek (Latin script)', ru: 'Russian', en: 'English' };

export const aiConfigured = () => Boolean(process.env.ANTHROPIC_API_KEY) || process.env.AI_MOCK === '1';

/**
 * Ask Claude. Returns text (or parsed JSON when json=true).
 * Throws an Error with code 'AI_NOT_CONFIGURED' when no API key is set.
 */
export async function askAI({ prompt, system = '', lang = 'en', json = false, maxTokens = 1500, mock, pdfUrls = [] }) {
  if (process.env.AI_MOCK === '1') return typeof mock === 'function' ? mock() : (mock ?? 'AI analysis (demo mode).');
  if (!process.env.ANTHROPIC_API_KEY) throw Object.assign(new Error('AI is not configured'), { code: 'AI_NOT_CONFIGURED' });

  const languageRule = `Always write your answer in ${LANG_NAMES[lang] || 'English'}.`;
  const jsonRule = json ? ' Respond with ONLY one valid JSON object, no markdown fences, no extra text.' : '';
  // Attach uploaded PDFs (e.g. a CV) so Claude can read their content
  const content = [];
  for (const url of pdfUrls) {
    if (!url?.startsWith('/uploads/') || !url.toLowerCase().endsWith('.pdf')) continue;
    try {
      const file = path.join(uploadDir, path.basename(url));
      if (fs.statSync(file).size > 15 * 1024 * 1024) continue;
      content.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: fs.readFileSync(file).toString('base64') } });
    } catch {}
  }
  content.push({ type: 'text', text: prompt });
  const body = {
    model: process.env.ANTHROPIC_MODEL || 'claude-sonnet-5-5',
    max_tokens: maxTokens,
    system: `You are Ziyrek AI, the assistant of the Jumis AI learning and careers platform in Karakalpakstan, Uzbekistan. ${system} ${languageRule}${jsonRule}`.trim(),
    messages: [{ role: 'user', content }],
  };

  let lastErr;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': process.env.ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(90_000),
      });
      if (!res.ok) throw new Error(`Claude API ${res.status}: ${(await res.text()).slice(0, 300)}`);
      const data = await res.json();
      const text = (data.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('\n').trim();
      if (!json) return text;
      const match = text.match(/\{[\s\S]*\}/);
      return JSON.parse(match ? match[0] : text);
    } catch (e) {
      lastErr = e;
    }
  }
  console.error('[ai]', lastErr?.message);
  throw lastErr;
}

// ─── Email (Resend) ───────────────────────────────────────────────────────────
export async function sendEmail({ to, subject, text }) {
  if (!process.env.RESEND_API_KEY) {
    console.log(`\n[email:not-configured] To: ${to}\nSubject: ${subject}\n${text}\n`);
    return { ok: false, logged: true };
  }
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: process.env.EMAIL_FROM || 'Jumis AI <onboarding@resend.dev>', to: [to], subject, text }),
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) console.error('[email] failed', res.status, await res.text());
    return { ok: res.ok };
  } catch (e) {
    console.error('[email] error', e.message);
    return { ok: false };
  }
}
