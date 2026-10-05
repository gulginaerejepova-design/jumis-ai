// Languages: kaa = Karakalpak (default), uz = Uzbek, ru = Russian, en = English
import { STRINGS } from './strings.js';

export const LANGUAGES = [
  { code: 'kaa', label: 'Qaraqalpaqsha' },
  { code: 'uz', label: "O'zbekcha" },
  { code: 'ru', label: 'Русский' },
  { code: 'en', label: 'English' },
];
export const DEFAULT_LANG = process.env.DEFAULT_LANG || 'kaa';
const IDX = { kaa: 0, uz: 1, ru: 2, en: 3 };

export function detectLang(cookies, query, acceptLanguage = '') {
  const pick = query.get('lang') || cookies.lang;
  if (pick && pick in IDX) return pick;
  const al = acceptLanguage.toLowerCase();
  if (!cookies.lang && al) {
    if (al.startsWith('ru')) return 'ru';
    if (al.startsWith('uz')) return 'uz';
    if (al.startsWith('en') && DEFAULT_LANG === 'en') return 'en';
  }
  return DEFAULT_LANG;
}

/** Returns a translate function for a language: t(key, { n: 3 }) */
export function translator(lang) {
  const i = IDX[lang] ?? 0;
  return (key, vars) => {
    const row = STRINGS[key];
    let s = row ? (row[i] || row[3] || key) : key;
    if (vars) for (const [k, v] of Object.entries(vars)) s = s.replaceAll(`{${k}}`, String(v));
    return s;
  };
}
