import ru from '../../locales/ru.json' with { type: 'json' };
import en from '../../locales/en.json' with { type: 'json' };

const DICTIONARIES = { ru, en };
// en-GB keeps a 24-hour clock and "Mon 26 Oct" dates.
const LOCALES = { ru: 'ru-RU', en: 'en-GB' };

let language = 'ru';

export function setLanguage(next) {
  language = DICTIONARIES[next] ? next : 'en';
  document.documentElement.lang = language;
}

export const currentLanguage = () => language;
export const locale = () => LOCALES[language];

/**
 * t('clip.count', { count: 3 }) → "3 записи". Plural entries are objects keyed
 * by Intl.PluralRules categories; {name} placeholders are filled from vars.
 */
export function t(key, vars = {}) {
  let value = DICTIONARIES[language][key] ?? DICTIONARIES.ru[key] ?? key;
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const category = new Intl.PluralRules(locale()).select(Number(vars.count ?? 0));
    value = value[category] ?? value.other;
  }
  if (typeof value !== 'string') return value;
  return value.replace(/\{(\w+)\}/g, (match, name) => (name in vars ? String(vars[name]) : match));
}
