import { useEffect } from 'react';
import { LANGUAGES, LANGUAGE_NAMES, LANGUAGE_STORAGE_KEY, useI18n, type Language } from './I18nProvider';

/**
 * "ಕನ್ನಡ · हिंदी · EN" from the public phone designs (P00…P06). Shown in the
 * header of the public pages; staff screens can place it too.
 */
const ORDER: Language[] = ['kn', 'hi', 'en'];

export function LanguageSwitcher({ tone = 'onDark' }: { tone?: 'onDark' | 'onLight' }) {
  const { language, setLanguage, t } = useI18n();
  return (
    <div className={`lb-lang lb-lang--${tone}`} role="group" aria-label={t('lang.label')}>
      {ORDER.map((lang, i) => (
        <span key={lang} className="lb-lang__item">
          {i > 0 && (
            <span aria-hidden="true" className="lb-lang__sep">
              ·
            </span>
          )}
          <button
            type="button"
            lang={lang}
            aria-pressed={language === lang}
            className={language === lang ? 'lb-lang__btn is-on' : 'lb-lang__btn'}
            onClick={() => setLanguage(lang)}
          >
            {LANGUAGE_NAMES[lang]}
          </button>
        </span>
      ))}
    </div>
  );
}

/** Where one staff member's own language is remembered on this computer (shared office PCs). */
export function personLanguageKey(staffId: string): string {
  return `${LANGUAGE_STORAGE_KEY}.staff.${staffId}`;
}

function readPersonLanguage(staffId: string): Language | null {
  try {
    const stored = localStorage.getItem(personLanguageKey(staffId));
    return stored && (LANGUAGES as readonly string[]).includes(stored) ? (stored as Language) : null;
  } catch {
    return null;
  }
}

function savePersonLanguage(staffId: string, language: Language) {
  try {
    localStorage.setItem(personLanguageKey(staffId), language);
  } catch {
    /* storage blocked: the choice still applies until the tab closes */
  }
}

/** On sign-in, switch to the language this person picked last time on this computer. */
export function usePersonLanguage(staffId: string | undefined) {
  const { setLanguage } = useI18n();
  useEffect(() => {
    if (!staffId) return;
    const saved = readPersonLanguage(staffId);
    if (saved) setLanguage(saved);
  }, [staffId, setLanguage]);
}

/**
 * The language picker of the staff headers (FA03 design: a small "EN ▾"
 * select on the blue header). The call agent console offers Kannada,
 * English and Hindi (owner decision 11 Nov); the choice is remembered per
 * person and sets <html lang>.
 */
export function LanguageSelect({ staffId }: { staffId?: string }) {
  const { language, setLanguage, t } = useI18n();
  return (
    <select
      className="lb-lang-select"
      aria-label={t('lang.label')}
      value={language}
      onChange={(e) => {
        const next = e.target.value as Language;
        setLanguage(next);
        if (staffId) savePersonLanguage(staffId, next);
      }}
    >
      {(['en', 'kn', 'hi'] as Language[]).map((lang) => (
        <option key={lang} value={lang} lang={lang}>
          {LANGUAGE_NAMES[lang]}
        </option>
      ))}
    </select>
  );
}
