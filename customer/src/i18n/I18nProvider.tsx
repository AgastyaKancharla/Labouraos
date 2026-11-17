import { createContext, useContext, useMemo, type ReactNode } from 'react';
import type { KeyValueStore } from '@/lib/storage';
import type { MessageKey } from './en';
import { DEFAULT_LANGUAGE, translate, translatePlural, type Language, type Params, type PluralKey } from './translate';

interface I18nValue {
  /** Always "en" (English only, rev 193). */
  language: Language;
  t: (key: MessageKey, params?: Params) => string;
  tn: (key: PluralKey, count: number, params?: Params) => string;
}

const I18nContext = createContext<I18nValue | null>(null);

interface Props {
  children: ReactNode;
  /** Kept so existing callers and tests compile; there is no saved language any more. */
  storage?: KeyValueStore;
  initialLanguage?: Language;
}

/** English only (Master Guide rev 193): no language choice, nothing saved. */
export function I18nProvider({ children }: Props) {
  const value = useMemo<I18nValue>(
    () => ({
      language: DEFAULT_LANGUAGE,
      t: (key, params) => translate(DEFAULT_LANGUAGE, key, params),
      tn: (key, count, params) => translatePlural(DEFAULT_LANGUAGE, key, count, params),
    }),
    [],
  );
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nValue {
  const value = useContext(I18nContext);
  if (!value) throw new Error('useI18n must be used inside <I18nProvider>');
  return value;
}
