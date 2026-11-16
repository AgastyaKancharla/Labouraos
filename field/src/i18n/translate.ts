import { en, type HindiMessages, type MessageKey, type Messages } from './en';
import { hi } from './hi';
import { kn } from './kn';

export type Language = 'kn' | 'en' | 'hi';

/**
 * Order and labels of the switcher: ಕನ್ನಡ / EN. Laboura Field offers Kannada
 * and English for now (redesign, 16 Nov); Hindi is hidden, its words are kept
 * in hi.ts for later, and a phone that had Hindi saved opens in English.
 */
export const LANGUAGES: readonly { code: Language; label: string; name: string }[] = [
  { code: 'kn', label: 'ಕನ್ನಡ', name: 'Kannada' },
  { code: 'en', label: 'EN', name: 'English' },
];

export const DEFAULT_LANGUAGE: Language = 'en';
export const LANGUAGE_STORAGE_KEY = 'laboura_field_language';

export const MESSAGES: Record<Language, Messages | HindiMessages> = { en, kn, hi };

export type Params = Record<string, string | number>;

export function isLanguage(value: unknown): value is Language {
  return value === 'kn' || value === 'en' || value === 'hi';
}

/** A language the switcher offers now (Kannada, English). */
export function isOfferedLanguage(value: unknown): value is Language {
  return LANGUAGES.some((l) => l.code === value);
}

/** Looks a key up (falling back to English, then the key) and fills `{name}` slots. */
export function translate(language: Language, key: MessageKey, params?: Params): string {
  const template = (MESSAGES[language] as Partial<Messages>)[key] ?? en[key] ?? key;
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
