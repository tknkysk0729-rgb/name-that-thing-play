export const LANGS = ['ja', 'en'];
export const DEFAULT_LANG = 'ja';

export function detectLanguage(stored, navigatorLanguage) {
  if (LANGS.includes(stored)) return stored;
  return String(navigatorLanguage || '').toLowerCase().startsWith('ja') ? 'ja' : 'en';
}

/** Picks the text for `lang` from a { ja, en } object, falling back to Japanese. */
export function pick(obj, lang) {
  if (obj == null) return '';
  if (typeof obj === 'string') return obj;
  return obj[lang] ?? obj[DEFAULT_LANG] ?? '';
}

export function createTranslator(dictionaries, lang) {
  const dict = dictionaries[lang] ?? {};
  const fallback = dictionaries[DEFAULT_LANG] ?? {};
  return function t(key, params = {}) {
    const raw = dict[key] ?? fallback[key] ?? key;
    return raw.replace(/\{(\w+)\}/g, (m, name) => (name in params ? String(params[name]) : m));
  };
}
