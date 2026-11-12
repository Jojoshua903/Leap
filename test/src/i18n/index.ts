import { bus } from '../core/events';
import { en, type I18nKey } from './en';
import { nl } from './nl';

export type Language = 'en' | 'nl';
export type { I18nKey };

const DICTS: Record<Language, Record<string, string>> = { en, nl };
let lang: Language = 'en';

export function setLanguage(l: Language): void {
  if (!(l in DICTS)) l = 'en';
  const changed = l !== lang;
  lang = l;
  if (typeof document !== 'undefined') document.documentElement.lang = l;
  if (changed) bus.emit('languageChanged', {});
}
export const getLanguage = (): Language => lang;

/** True when a key exists in a dictionary (used by tests and by dynamic keys from data files). */
export function hasKey(key: string, l: Language = lang): boolean { return key in DICTS[l]; }

/**
 * Translate a key. `{name}` placeholders are replaced from params.
 * Unknown keys fall back to English, then to the key itself so a missing string is visible but never crashes.
 */
export function t(key: string, params: Record<string, string | number> = {}): string {
  const raw = DICTS[lang][key] ?? DICTS.en[key] ?? key;
  return raw.replace(/\{(\w+)\}/g, (_, k: string) => (k in params ? String(params[k]) : `{${k}}`));
}

export const LANGUAGES: Language[] = ['en', 'nl'];
export const dictionaries = DICTS;
