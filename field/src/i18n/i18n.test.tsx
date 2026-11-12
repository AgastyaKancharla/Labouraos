import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { Text } from 'react-native';
import { LanguageSwitcher } from '@/components/LanguageSwitcher';
import { createMemoryStore } from '@/lib/storage';
import { en } from './en';
import { hi } from './hi';
import { I18nProvider, useI18n } from './I18nProvider';
import { kn } from './kn';
import { LANGUAGE_STORAGE_KEY, LANGUAGES, translate, translatePlural } from './translate';

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

  // Kannada, English and Hindi stay everywhere they are offered (owner decision,
  // 11 Nov): a Kannada or Hindi string may equal the English one only when it is
  // a brand name, a code or a number. Anything else is an untranslated copy.
  const SAME_AS_ENGLISH_ALLOWED = new Set<string>([
    'common.appName', // Laboura Field (brand)
    'common.brand', // Laboura (brand)
    'fa01.staffCodePlaceholder', // FA-0017 (staff code)
    'fa10.qual.iti', // ITI (qualification code)
    'fa14.gst', // "GST {percent}%" (tax code)
    'fa15s.gstLine', // "GST {percent}%"
    'fa15q.smsWhatsapp', // SMS + WhatsApp (channel names)
    'fa17.extra.pfEsi', // PF/ESI
    'fa17b.role.hr', // HR
  ]);
  /** Nothing to translate: only {slots}, digits, signs and punctuation. */
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

  it('keeps the allow-list honest (every allowed key exists and has letters)', () => {
    for (const key of SAME_AS_ENGLISH_ALLOWED) {
      expect(en).toHaveProperty([key]);
      expect(hasNoWords(en[key as keyof typeof en])).toBe(false);
    }
  });

  it('fills {slots} and picks plural forms', () => {
    expect(translate('en', 'fa03.loggedInAt', { time: '9:12 AM' })).toBe('Logged in at 9:12 AM');
    expect(translate('en', 'fa03.lateBy')).toBe('{minutes} min late');
    expect(translatePlural('en', 'queue.photos', 1)).toBe('1 photo');
    expect(translatePlural('en', 'queue.photos', 3)).toBe('3 photos');
    expect(translate('kn', 'tabs.home')).toBe('ಮುಖಪುಟ');
  });

  it('offers ಕನ್ನಡ / हिंदी / EN in that order', () => {
    expect(LANGUAGES.map((l) => l.label)).toEqual(['ಕನ್ನಡ', 'हिंदी', 'EN']);
  });
});

function Probe() {
  const { t } = useI18n();
  return <Text testID="probe">{t('tabs.home')}</Text>;
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
    expect(screen.getByTestId('probe')).toHaveTextContent('Home');
    await fireEvent.press(screen.getByTestId('language-switcher'));
    await fireEvent.press(screen.getByTestId('language-kn'));
    expect(screen.getByTestId('probe')).toHaveTextContent('ಮುಖಪುಟ');
    await waitFor(async () => expect(await storage.getItem(LANGUAGE_STORAGE_KEY)).toBe('kn'));
  });

  it('starts in the saved language', async () => {
    const storage = createMemoryStore({ [LANGUAGE_STORAGE_KEY]: 'hi' });
    await render(
      <I18nProvider storage={storage}>
        <Probe />
      </I18nProvider>,
    );
    await waitFor(() => expect(screen.getByTestId('probe')).toHaveTextContent('होम'));
  });

  it('ignores a corrupt saved value', async () => {
    const storage = createMemoryStore({ [LANGUAGE_STORAGE_KEY]: 'fr' });
    await render(
      <I18nProvider storage={storage}>
        <Probe />
      </I18nProvider>,
    );
    await waitFor(() => expect(screen.getByTestId('probe')).toHaveTextContent('Home'));
  });
});
