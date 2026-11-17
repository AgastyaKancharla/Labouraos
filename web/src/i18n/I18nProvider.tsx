import { createContext, useContext, useEffect, useMemo, type ReactNode } from 'react';
import { en, type MessageKey } from './en';

/**
 * English only, everywhere (Master Guide rev 193, decided 17 Nov): every
 * portal, the call agent console and the public pages show English. There is
 * no language switcher and no per-person language. Words still go through
 * `t('key')` so they live in one place (en.ts).
 */
export const LANGUAGES = ['en'] as const;
export type Language = (typeof LANGUAGES)[number];

export type TranslateVars = Record<string, string | number>;
export type Translate = (key: MessageKey, vars?: TranslateVars) => string;

export function interpolate(template: string, vars?: TranslateVars): string {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in vars ? String(vars[name]) : match,
  );
}

export function translate(_language: Language, key: MessageKey, vars?: TranslateVars): string {
  return interpolate(en[key] ?? key, vars);
}

interface I18nValue {
  /** Always "en" (kept so date and number formatting keep one signature). */
  language: Language;
  t: Translate;
}

const I18nContext = createContext<I18nValue | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  useEffect(() => {
    document.documentElement.lang = 'en';
  }, []);
  const value = useMemo<I18nValue>(() => ({ language: 'en', t: (key, vars) => translate('en', key, vars) }), []);
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
