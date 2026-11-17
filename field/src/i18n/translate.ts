import { en, type MessageKey } from './en';

/**
 * English only, everywhere (Master Guide rev 193, decided 17 Nov): Laboura
 * Field has no language switcher and shows English. Words still go through
 * `t('key')`, so every screen keeps its keys and everything lives in en.ts.
 */
export type Language = 'en';

export const LANGUAGES: readonly { code: Language; label: string; name: string }[] = [{ code: 'en', label: 'EN', name: 'English' }];

export const DEFAULT_LANGUAGE: Language = 'en';

export type Params = Record<string, string | number>;

export function isLanguage(value: unknown): value is Language {
  return value === 'en';
}

/** Looks a key up (falling back to the key) and fills `{name}` slots. */
export function translate(_language: Language, key: MessageKey, params?: Params): string {
  const template = en[key] ?? key;
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : match,
  );
}

/** Keys that have `.one` / `.other` forms, without the suffix. */
export type PluralKey = {
  [K in MessageKey]: K extends `${infer Base}.one` ? Base : never;
}[MessageKey];

export function translatePlural(language: Language, key: PluralKey, count: number, params?: Params): string {
  const form = (count === 1 ? `${key}.one` : `${key}.other`) as MessageKey;
  return translate(language, form, { count, ...params });
}
