import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { en } from './en';
import { I18nProvider, interpolate, LANGUAGES, translate, useT } from './I18nProvider';

/** Kannada (U+0C80–U+0CFF) or Devanagari (U+0900–U+097F) letters. */
const INDIC = /\p{Script=Kannada}|\p{Script=Devanagari}/u;

/** Every source file of the web app (screens, portals, public pages), as text. */
const SOURCES = import.meta.glob(['../**/*.ts', '../**/*.tsx', '!../**/*.test.ts', '!../**/*.test.tsx'], { query: '?raw', import: 'default', eager: true }) as Record<string, string>;

describe('i18n — English only (Master Guide rev 193)', () => {
  it('offers English and nothing else', () => {
    expect(LANGUAGES).toEqual(['en']);
  });

  it('every English string is filled in', () => {
    for (const [key, value] of Object.entries(en)) expect(value.trim(), key).not.toBe('');
  });

  it('no screen, portal or public page carries Kannada or Hindi text', () => {
    expect(Object.keys(SOURCES).length).toBeGreaterThan(100);
    const offenders = Object.entries(SOURCES).filter(([, text]) => INDIC.test(text)).map(([file]) => file);
    expect(offenders).toEqual([]);
  });

  it('interpolates variables', () => {
    expect(interpolate('Hello {name}, {n} new', { name: 'Ravi', n: 3 })).toBe('Hello Ravi, 3 new');
    expect(interpolate('Keep {unknown}', {})).toBe('Keep {unknown}');
    expect(translate('en', 'common.logout')).toBe('Log out');
  });

  it('renders English and sets <html lang="en">, whatever an old saved choice says', () => {
    localStorage.setItem('laboura_lang', 'kn');
    function Probe() {
      const t = useT();
      return <p>{t('common.logout')}</p>;
    }
    render(
      <I18nProvider>
        <Probe />
      </I18nProvider>,
    );
    expect(screen.getByText('Log out')).toBeInTheDocument();
    expect(document.documentElement.lang).toBe('en');
    expect(screen.queryByRole('group', { name: 'Language' })).toBeNull();
  });
});
