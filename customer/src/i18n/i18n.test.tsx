import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { Text } from 'react-native';
import { LanguageSwitcher } from '@/components/LanguageSwitcher';
import { createMemoryStore } from '@/lib/storage';
import { en } from './en';
import { hi } from './hi';
import { I18nProvider, useI18n } from './I18nProvider';
import { kn } from './kn';
import { LANGUAGE_STORAGE_KEY, LANGUAGES, translate } from './translate';

const placeholders = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort();

describe('translations', () => {
  it.each([
    ['kn', kn],
    ['hi', hi],
  ])('%s has exactly the English keys, none empty, with the same {slots}', (_code, messages) => {
    expect(Object.keys(messages).sort()).toEqual(Object.keys(en).sort());
    for (const key of Object.keys(en) as (keyof typeof en)[]) {
      expect(messages[key].trim()).not.toBe('');
      expect(placeholders(messages[key])).toEqual(placeholders(en[key]));
    }
  });

  // Kannada, English and Hindi everywhere (owner decision, 11 Nov): a Kannada
  // or Hindi string may equal the English one only for a brand or a code.
  const SAME_AS_ENGLISH_ALLOWED = new Set<string>(['common.brand', 'contactRole.hr', 'business.gstin', 'business.pan']);
  const hasNoWords = (s: string) => !/\p{L}/u.test(s.replace(/\{\w+\}/g, ''));

  it('never leaves a Kannada or Hindi string as a copy of the English one', () => {
    const copies: string[] = [];
    for (const key of Object.keys(en) as (keyof typeof en)[]) {
      if (SAME_AS_ENGLISH_ALLOWED.has(key) || hasNoWords(en[key])) continue;
      if (kn[key] === en[key]) copies.push(`kn ${key}`);
      if (hi[key] === en[key]) copies.push(`hi ${key}`);
    }
    expect(copies).toEqual([]);
  });

  it('keeps the allow-list honest', () => {
    for (const key of SAME_AS_ENGLISH_ALLOWED) expect(en).toHaveProperty([key]);
  });

  it('fills {slots}', () => {
    expect(translate('en', 'jsHome.dayOf', { day: 12, total: 30 })).toBe('Day 12 of 30');
    expect(translate('kn', 'role.jobSeeker')).toBe('ನನಗೆ ಕೆಲಸ ಬೇಕು');
    expect(translate('hi', 'role.jobSeeker')).toBe('मुझे नौकरी चाहिए');
  });

  it('offers ಕನ್ನಡ / हिंदी / EN in that order', () => {
    expect(LANGUAGES.map((l) => l.label)).toEqual(['ಕನ್ನಡ', 'हिंदी', 'EN']);
  });
});

function Probe() {
  const { t } = useI18n();
  return <Text testID="probe">{t('menu.help')}</Text>;
}

describe('language switcher', () => {
  it('switches the language and remembers the choice on the phone', async () => {
    const storage = createMemoryStore();
    await render(
      <I18nProvider storage={storage}>
        <LanguageSwitcher />
        <Probe />
      </I18nProvider>,
    );
    expect(screen.getByTestId('probe')).toHaveTextContent('Help');
    await fireEvent.press(screen.getByTestId('language-switcher'));
    await fireEvent.press(screen.getByTestId('language-kn'));
    expect(screen.getByTestId('probe')).toHaveTextContent('ಸಹಾಯ');
    await waitFor(async () => expect(await storage.getItem(LANGUAGE_STORAGE_KEY)).toBe('kn'));
  });

  it('starts in the saved language', async () => {
    const storage = createMemoryStore({ [LANGUAGE_STORAGE_KEY]: 'hi' });
    await render(
      <I18nProvider storage={storage}>
        <Probe />
      </I18nProvider>,
    );
    await waitFor(() => expect(screen.getByTestId('probe')).toHaveTextContent('मदद'));
  });
});
