import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { secureStorage, type KeyValueStore } from '@/lib/storage';
import type { MessageKey } from './en';
import { DEFAULT_LANGUAGE, isLanguage, translate, translatePlural, type Language, type Params, type PluralKey } from './translate';

/** Where the chosen language is kept on the phone. */
export const LANGUAGE_KEY = 'laboura.language';

interface I18nValue {
  language: Language;
  /** False until the person has picked a language (first screen after installing). */
  chosen: boolean;
  /** False while the saved choice is being read. */
  ready: boolean;
  setLanguage: (language: Language) => Promise<void>;
  t: (key: MessageKey, params?: Params) => string;
  tn: (key: PluralKey, count: number, params?: Params) => string;
}

const I18nContext = createContext<I18nValue | null>(null);

interface Props {
  children: ReactNode;
  storage?: KeyValueStore;
  /** Tests: start in this language, already chosen. */
  initialLanguage?: Language;
}

export function I18nProvider({ children, storage = secureStorage, initialLanguage }: Props) {
  const [language, setLang] = useState<Language>(initialLanguage ?? DEFAULT_LANGUAGE);
  const [chosen, setChosen] = useState(Boolean(initialLanguage));
  const [ready, setReady] = useState(Boolean(initialLanguage));

  useEffect(() => {
    if (initialLanguage) return;
    let live = true;
    storage
      .getItem(LANGUAGE_KEY)
      .then((saved) => {
        if (!live) return;
        if (isLanguage(saved)) {
          setLang(saved);
          setChosen(true);
        }
      })
      .catch(() => undefined)
      .finally(() => live && setReady(true));
    return () => {
      live = false;
    };
  }, [storage, initialLanguage]);

  const setLanguage = useCallback(
    async (next: Language) => {
      setLang(next);
      setChosen(true);
      await storage.setItem(LANGUAGE_KEY, next).catch(() => undefined);
    },
    [storage],
  );

  const value = useMemo<I18nValue>(
    () => ({
      language,
      chosen,
      ready,
      setLanguage,
      t: (key, params) => translate(language, key, params),
      tn: (key, count, params) => translatePlural(language, key, count, params),
    }),
    [language, chosen, ready, setLanguage],
  );
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nValue {
  const value = useContext(I18nContext);
  if (!value) throw new Error('useI18n must be used inside <I18nProvider>');
  return value;
}
