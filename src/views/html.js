// Tiny safe HTML templating: every ${value} is escaped unless wrapped with raw().
export class Raw {
  constructor(s) { this.s = String(s); }
  toString() { return this.s; }
}
export const raw = (s) => new Raw(s ?? '');

export const esc = (v) => String(v ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

function render(v) {
  if (v === null || v === undefined || v === false || v === true) return '';
  if (v instanceof Raw) return v.s;
  if (Array.isArray(v)) return v.map(render).join('');
  return esc(v);
}

export function html(strings, ...values) {
  let out = '';
  strings.forEach((s, i) => { out += s + (i < values.length ? render(values[i]) : ''); });
  return new Raw(out);
}

/** Conditional class names */
export const cx = (...a) => a.filter(Boolean).join(' ');

/** Minimal, safe Markdown → HTML (headings, bold, italics, lists, links, paragraphs) */
export function markdown(md) {
  const lines = esc(md || '').split(/\r?\n/);
  const out = [];
  let list = null;
  const inline = (s) => s
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*\s][^*]*?)\*(?!\*)/g, '$1<em>$2</em>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
  const closeList = () => { if (list) { out.push(`</${list}>`); list = null; } };
  for (const line of lines) {
    const t = line.trim();
    let m;
    if (!t) { closeList(); continue; }
    if ((m = t.match(/^(#{1,4})\s+(.*)$/))) { closeList(); const lvl = Math.min(6, m[1].length + 2); out.push(`<h${lvl}>${inline(m[2])}</h${lvl}>`); continue; }
    if ((m = t.match(/^[-*•]\s+(.*)$/))) { if (list !== 'ul') { closeList(); list = 'ul'; out.push('<ul>'); } out.push(`<li>${inline(m[1])}</li>`); continue; }
    if ((m = t.match(/^\d+[.)]\s+(.*)$/))) { if (list !== 'ol') { closeList(); list = 'ol'; out.push('<ol>'); } out.push(`<li>${inline(m[1])}</li>`); continue; }
    closeList();
    out.push(`<p>${inline(t)}</p>`);
  }
  closeList();
  return raw(out.join('\n'));
}
