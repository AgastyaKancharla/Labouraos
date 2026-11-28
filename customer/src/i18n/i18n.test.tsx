import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';
import { Text } from 'react-native';
import { createMemoryStore } from '@/lib/storage';
import { LanguagePicker } from '@/screens/Language';
import { en, type MessageKey } from './en';
import { I18nProvider, LANGUAGE_KEY, useI18n } from './I18nProvider';
import { hi } from './locales/hi';
import { kn } from './locales/kn';
import { ml } from './locales/ml';
import { ta } from './locales/ta';
import { te } from './locales/te';
import { LANGUAGES, translate } from './translate';

jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));

/** Letters of the five Indian languages of the app. */
const INDIC = /\p{Script=Kannada}|\p{Script=Devanagari}|\p{Script=Telugu}|\p{Script=Tamil}|\p{Script=Malayalam}/u;
const LOCALES = { kn, hi, te, ta, ml };

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === 'test' || name === 'locales' ? [] : sourceFiles(path);
    return /\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
  });
}

const slots = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort().join(',');

describe('translations (28 Nov: six languages)', () => {
  it('offers Kannada, Hindi, Telugu, Tamil, Malayalam and English, in that order', () => {
    expect(LANGUAGES.map((l) => l.code)).toEqual(['kn', 'hi', 'te', 'ta', 'ml', 'en']);
  });

  it('every English string is filled in', () => {
    for (const [key, value] of Object.entries(en)) expect([key, value.trim().length > 0]).toEqual([key, true]);
  });

  it.each(Object.entries(LOCALES))('%s: only known keys, each with the same {slots} as English', (_code, dict) => {
    for (const [key, value] of Object.entries(dict)) {
      expect([key, key in en]).toEqual([key, true]);
      expect([key, slots(value)]).toEqual([key, slots(en[key as MessageKey])]);
      expect([key, value.trim().length > 0]).toEqual([key, true]);
    }
  });

  it('screens carry no Indian-language text of their own: words live in i18n/locales (the picker titles excepted)', () => {
    const offenders = sourceFiles(join(__dirname, '..')).filter((file) => INDIC.test(readFileSync(file, 'utf8')) && !file.endsWith(join('screens', 'Language', 'index.tsx')) && !file.endsWith('translate.ts'));
    expect(offenders).toEqual([]);
  });

  it('fills {slots}, and a line not yet translated shows in English', () => {
    expect(translate('en', 'jsHome.dayOf', { day: 12, total: 30 })).toBe('Day 12 of 30');
    expect(translate('kn', 'common.brand')).toBe(kn['common.brand'] ?? 'Laboura');
  });
});

function Probe() {
  const { t, language, chosen } = useI18n();
  return <Text testID="probe">{`${t('language.continue')} ${language} ${chosen ? 'chosen' : 'not-chosen'}`}</Text>;
}

describe('the language choice', () => {
  it('a fresh install has no language yet; picking one saves it and the app speaks it', async () => {
    const storage = createMemoryStore();
    await render(
      <I18nProvider storage={storage}>
        <LanguagePicker mode="first" />
        <Probe />
      </I18nProvider>,
    );
    await waitFor(() => expect(screen.getByTestId('probe')).toHaveTextContent(/not-chosen$/));
    expect(screen.getByTestId('language-continue')).toBeDisabled();
    await fireEvent.press(screen.getByTestId('language-kn'));
    expect(screen.getByTestId('language-continue')).toHaveTextContent(translate('kn', 'language.continue'));
    await fireEvent.press(screen.getByTestId('language-continue'));
    await waitFor(() => expect(screen.getByTestId('probe')).toHaveTextContent(`${translate('kn', 'language.continue')} kn chosen`));
    expect(await storage.getItem(LANGUAGE_KEY)).toBe('kn');
  });

  it('the saved language comes back on the next start', async () => {
    const storage = createMemoryStore({ [LANGUAGE_KEY]: 'ta' });
    await render(
      <I18nProvider storage={storage}>
        <Probe />
      </I18nProvider>,
    );
    await waitFor(() => expect(screen.getByTestId('probe')).toHaveTextContent(/ ta chosen$/));
  });

  it('an unknown saved value means no choice yet', async () => {
    const storage = createMemoryStore({ [LANGUAGE_KEY]: 'fr' });
    await render(
      <I18nProvider storage={storage}>
        <Probe />
      </I18nProvider>,
    );
    await waitFor(() => expect(screen.getByTestId('probe')).toHaveTextContent('Continue en not-chosen'));
  });
});
