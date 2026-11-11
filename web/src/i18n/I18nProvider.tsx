import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { en, type MessageKey, type Messages } from './en';
import { hi } from './hi';
import { kn } from './kn';

/**
 * Three languages: English (complete, the source of every key), Kannada and
 * Hindi. The translation files are typed as Record<MessageKey, string>, so a
 * missing or extra key fails the build.
 */
export const LANGUAGES = ['en', 'kn', 'hi'] as const;
export type Language = (typeof LANGUAGES)[number];
export const LANGUAGE_STORAGE_KEY = 'laboura_lang';

const MESSAGES: Record<Language, Messages> = { en, kn, hi };

/** What the switcher shows for each language, in its own script (P* designs). */
export const LANGUAGE_NAMES: Record<Language, string> = { kn: 'ಕನ್ನಡ', hi: 'हिंदी', en: 'EN' };

export type TranslateVars = Record<string, string | number>;
export type Translate = (key: MessageKey, vars?: TranslateVars) => string;

export function interpolate(template: string, vars?: TranslateVars): string {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in vars ? String(vars[name]) : match,
  );
}

export function translate(language: Language, key: MessageKey, vars?: TranslateVars): string {
  return interpolate(MESSAGES[language][key] ?? en[key], vars);
}

interface I18nValue {
  language: Language;
  setLanguage: (language: Language) => void;
  t: Translate;
}

const I18nContext = createContext<I18nValue | null>(null);

function initialLanguage(): Language {
  try {
    const stored = localStorage.getItem(LANGUAGE_STORAGE_KEY);
    if (stored && (LANGUAGES as readonly string[]).includes(stored)) return stored as Language;
  } catch {
    /* storage blocked */
  }
  return 'en';
}

export function I18nProvider({ children, language: forced }: { children: ReactNode; language?: Language }) {
  const [language, setLanguageState] = useState<Language>(() => forced ?? initialLanguage());

  const setLanguage = useCallback((next: Language) => {
    setLanguageState(next);
    try {
      localStorage.setItem(LANGUAGE_STORAGE_KEY, next);
    } catch {
      /* storage blocked */
    }
  }, []);

  useEffect(() => {
    document.documentElement.lang = language;
  }, [language]);

  const value = useMemo<I18nValue>(
    () => ({ language, setLanguage, t: (key, vars) => translate(language, key, vars) }),
    [language, setLanguage],
  );
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nValue {
  const value = useContext(I18nContext);
  if (!value) throw new Error('useI18n must be used inside <I18nProvider>');
  return value;
}

/** The translate function: `const t = useT(); t('common.save')`. */
export function useT(): Translate {
  return useI18n().t;
}
