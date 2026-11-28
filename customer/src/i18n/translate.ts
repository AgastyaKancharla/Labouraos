import { en, type MessageKey } from './en';
import { hi } from './locales/hi';
import { kn } from './locales/kn';
import { ml } from './locales/ml';
import { ta } from './locales/ta';
import { te } from './locales/te';

/**
 * The app speaks six languages (28 Nov, Agastya): the person picks one on the
 * very first screen after installing, and can change it in Settings. English
 * is the source; a line not yet translated shows in English.
 *
 * What stays English whatever the choice: the legal texts (consent, terms,
 * business agreement — they come from the server and only the English text is
 * approved), the language recorded when someone accepts them, and every SMS,
 * WhatsApp and notification the server sends (Master Guide rev 193).
 */
export type Language = 'en' | 'kn' | 'hi' | 'te' | 'ta' | 'ml';

export interface LanguageOption {
  code: Language;
  /** The name in its own script, as the person reads it. */
  name: string;
  /** The English name, shown small under it. */
  english: string;
  /** For dates in the inbox. */
  locale: string;
}

/** In the order Agastya listed them, English last. */
export const LANGUAGES: readonly LanguageOption[] = [
  { code: 'kn', name: 'ಕನ್ನಡ', english: 'Kannada', locale: 'kn-IN' },
  { code: 'hi', name: 'हिन्दी', english: 'Hindi', locale: 'hi-IN' },
  { code: 'te', name: 'తెలుగు', english: 'Telugu', locale: 'te-IN' },
  { code: 'ta', name: 'தமிழ்', english: 'Tamil', locale: 'ta-IN' },
  { code: 'ml', name: 'മലയാളം', english: 'Malayalam', locale: 'ml-IN' },
  { code: 'en', name: 'English', english: 'English', locale: 'en-IN' },
];

export const DEFAULT_LANGUAGE: Language = 'en';

/** Legal texts, their acceptance and what the server is told: always English. */
export const LEGAL_LANGUAGE = 'en' as const;

export type Params = Record<string, string | number>;
export type Translations = Partial<Record<MessageKey, string>>;

const DICTIONARIES: Record<Language, Translations> = { en, kn, hi, te, ta, ml };

export function isLanguage(value: unknown): value is Language {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(DICTIONARIES, value);
}

export function languageOption(code: Language): LanguageOption {
  return LANGUAGES.find((l) => l.code === code) ?? LANGUAGES[LANGUAGES.length - 1]!;
}

/** Looks a key up in the language (then English, then the key) and fills `{name}` slots. */
export function translate(language: Language, key: MessageKey, params?: Params): string {
  const template = DICTIONARIES[language]?.[key] ?? en[key] ?? key;
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : match,
  );
}

/** Keys that have `.one` / `.other` forms, without the suffix. */
export type PluralKey = {
  [K in MessageKey]: K extends `${infer Base}.one` ? Base : never;
}[MessageKey];

/** One / many is enough for all six languages here. */
export function translatePlural(language: Language, key: PluralKey, count: number, params?: Params): string {
  const form = (count === 1 ? `${key}.one` : `${key}.other`) as MessageKey;
  return translate(language, form, { count, ...params });
}
