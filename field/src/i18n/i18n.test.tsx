import { render, screen } from '@testing-library/react-native';
import { readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';
import { Text } from 'react-native';
import { createMemoryStore } from '@/lib/storage';
import { en } from './en';
import { I18nProvider, useI18n } from './I18nProvider';
import { LANGUAGES, translate, translatePlural } from './translate';

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
    expect(readdirSync(__dirname).filter((f) => /\.(kn|hi)\.ts$|^(kn|hi)\.ts$/.test(f))).toEqual([]);
  });

  it('every English string is filled in', () => {
    for (const [key, value] of Object.entries(en)) expect([key, value.trim().length > 0]).toEqual([key, true]);
  });

  it('no screen of Laboura Field carries Kannada or Hindi text', () => {
    const root = join(__dirname, '..');
    const offenders = sourceFiles(root).filter((file) => INDIC.test(readFileSync(file, 'utf8')));
    expect(offenders).toEqual([]);
  });

  it('fills {slots} and picks plural forms', () => {
    expect(translate('en', 'fa03.loggedInAt', { time: '9:12 AM' })).toBe('Logged in at 9:12 AM');
    expect(translate('en', 'fa03.lateBy')).toBe('{minutes} min late');
    expect(translatePlural('en', 'queue.photos', 1)).toBe('1 photo');
    expect(translatePlural('en', 'queue.photos', 3)).toBe('3 photos');
  });
});

function Probe() {
  const { t, language } = useI18n();
  return <Text testID="probe">{`${t('tabs.home')} ${language}`}</Text>;
}

describe('the app language', () => {
  it('is English, even on a phone that had Kannada saved before', async () => {
    const storage = createMemoryStore({ laboura_field_language: 'kn' });
    await render(
      <I18nProvider storage={storage}>
        <Probe />
      </I18nProvider>,
    );
    expect(screen.getByTestId('probe')).toHaveTextContent('Home en');
    expect(screen.queryByTestId('language-switcher')).toBeNull();
  });
});
