import { LANGUAGE_NAMES, useI18n, type Language } from './I18nProvider';

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
