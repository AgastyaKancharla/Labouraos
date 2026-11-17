import { render, screen } from '@testing-library/react-native';
import { readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';
import { Text } from 'react-native';
import { createMemoryStore } from '@/lib/storage';
import { en } from './en';
import { I18nProvider, useI18n } from './I18nProvider';
import { LANGUAGES, translate } from './translate';

/** Kannada or Devanagari letters. */
const INDIC = /\p{Script=Kannada}|\p{Script=Devanagari}/u;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === 'test' ? [] : sourceFiles(path);
    return /\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
  });
}

describe('translations — English only (Master Guide rev 193)', () => {
  it('offers English and nothing else; there are no Kannada or Hindi files', () => {
    expect(LANGUAGES.map((l) => l.code)).toEqual(['en']);
    expect(readdirSync(__dirname).filter((f) => /^(kn|hi)\.ts$/.test(f))).toEqual([]);
  });

  it('every English string is filled in', () => {
    for (const [key, value] of Object.entries(en)) expect([key, value.trim().length > 0]).toEqual([key, true]);
  });

  it('no screen of the app carries Kannada or Hindi text', () => {
    const offenders = sourceFiles(join(__dirname, '..')).filter((file) => INDIC.test(readFileSync(file, 'utf8')));
    expect(offenders).toEqual([]);
  });

  it('fills {slots}', () => {
    expect(translate('en', 'jsHome.dayOf', { day: 12, total: 30 })).toBe('Day 12 of 30');
  });
});

function Probe() {
  const { t, language } = useI18n();
  return <Text testID="probe">{`${t('menu.help')} ${language}`}</Text>;
}

describe('the app language', () => {
  it('is English, even on a phone that had Hindi saved before, with no switcher', async () => {
    const storage = createMemoryStore({ laboura_language: 'hi' });
    await render(
      <I18nProvider storage={storage}>
        <Probe />
      </I18nProvider>,
    );
    expect(screen.getByTestId('probe')).toHaveTextContent('Help en');
    expect(screen.queryByTestId('language-switcher')).toBeNull();
  });
});
