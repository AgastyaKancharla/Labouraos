import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { secureStorage, type KeyValueStore } from '@/lib/storage';
import type { MessageKey } from './en';
import {
  DEFAULT_LANGUAGE,
  isLanguage,
  LANGUAGE_STORAGE_KEY,
  translate,
  translatePlural,
  type Language,
  type Params,
  type PluralKey,
} from './translate';

interface I18nValue {
  language: Language;
  setLanguage: (language: Language) => void;
  t: (key: MessageKey, params?: Params) => string;
  tn: (key: PluralKey, count: number, params?: Params) => string;
}

const I18nContext = createContext<I18nValue | null>(null);

interface Props {
  children: ReactNode;
  /** Tests pass a memory store and a starting language. */
  storage?: KeyValueStore;
  initialLanguage?: Language;
}

/**
 * Holds the app language and remembers the person's choice on the phone.
 * The saved choice is read once at start; until then English shows.
 */
export function I18nProvider({ children, storage = secureStorage, initialLanguage }: Props) {
  const [language, setLanguageState] = useState<Language>(initialLanguage ?? DEFAULT_LANGUAGE);

  useEffect(() => {
    if (initialLanguage) return;
    let cancelled = false;
    void storage.getItem(LANGUAGE_STORAGE_KEY).then((saved) => {
      if (!cancelled && isLanguage(saved)) setLanguageState(saved);
    });
    return () => {
      cancelled = true;
    };
  }, [storage, initialLanguage]);

  const setLanguage = useCallback(
    (next: Language) => {
      setLanguageState(next);
      void storage.setItem(LANGUAGE_STORAGE_KEY, next);
    },
    [storage],
  );

  const value = useMemo<I18nValue>(
    () => ({
      language,
      setLanguage,
      t: (key, params) => translate(language, key, params),
      tn: (key, count, params) => translatePlural(language, key, count, params),
    }),
    [language, setLanguage],
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nValue {
  const value = useContext(I18nContext);
  if (!value) throw new Error('useI18n must be used inside <I18nProvider>');
  return value;
}
