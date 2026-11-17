import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { Text } from 'react-native';
import { LanguageSwitcher } from '@/components/LanguageSwitcher';
import { createMemoryStore } from '@/lib/storage';
import { en } from './en';
import { redesignEn } from './redesign.en';
import { fixes17En } from './fixes17.en';
import { hi } from './hi';
import { I18nProvider, useI18n } from './I18nProvider';
import { kn } from './kn';
import { LANGUAGE_STORAGE_KEY, LANGUAGES, translate, translatePlural } from './translate';

const placeholders = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort();

/** Keys added by the redesign (16 Nov): Laboura Field requires English and Kannada; Hindi is optional (hidden, English shows). */
const REDESIGN_KEYS = new Set(Object.keys(redesignEn));
/** Keys added on 17 Nov: English only (the software is English only from 17 Nov), so kn and hi have none. */
const ENGLISH_ONLY_KEYS = new Set(Object.keys(fixes17En));

describe('translations', () => {
  it('kn has exactly the English keys, none empty, with the same {slots}', () => {
    const knMessages = kn as Record<string, string>;
    const enKeys = Object.keys(en).filter((k) => !ENGLISH_ONLY_KEYS.has(k));
    expect(Object.keys(kn).sort()).toEqual(enKeys.sort());
    for (const key of enKeys as (keyof typeof en)[]) {
      expect(knMessages[key].trim()).not.toBe('');
      expect(placeholders(knMessages[key])).toEqual(placeholders(en[key]));
    }
  });

  it('hi keeps every key it had (the redesign keys are optional), none empty, with the same {slots}', () => {
    const hiMessages = hi as Record<string, string | undefined>;
    const required = Object.keys(en).filter((k) => !REDESIGN_KEYS.has(k) && !ENGLISH_ONLY_KEYS.has(k));
    expect(required.filter((k) => !(k in hiMessages))).toEqual([]);
    expect(Object.keys(hiMessages).filter((k) => !(k in en))).toEqual([]);
    for (const key of Object.keys(hiMessages) as (keyof typeof en)[]) {
      expect(hiMessages[key]!.trim()).not.toBe('');
      expect(placeholders(hiMessages[key]!)).toEqual(placeholders(en[key]));
    }
  });

  it('the Job seekers tab label is one short word in Kannada, so it fits one line at 360 px (A8)', () => {
    expect(kn['tabs.jobSeekersTab']).not.toMatch(/\s/);
    expect(kn['tabs.jobSeekersTab'].length).toBeLessThanOrEqual(12);
  });

  it('a key with no Hindi falls back to English', () => {
    expect(translate('hi', 'tabs.today')).toBe('Today');
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
    const hiMessages = hi as Record<string, string | undefined>;
    for (const key of Object.keys(en) as (keyof typeof en)[]) {
      if (SAME_AS_ENGLISH_ALLOWED.has(key) || hasNoWords(en[key])) continue;
      if (kn[key] === en[key]) copies.push(`kn ${key}`);
      if (hiMessages[key] === en[key]) copies.push(`hi ${key}`);
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

  it('offers ಕನ್ನಡ / EN in that order (Hindi hidden in Laboura Field for now)', () => {
    expect(LANGUAGES.map((l) => l.label)).toEqual(['ಕನ್ನಡ', 'EN']);
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
    const storage = createMemoryStore({ [LANGUAGE_STORAGE_KEY]: 'kn' });
    await render(
      <I18nProvider storage={storage}>
        <Probe />
      </I18nProvider>,
    );
    await waitFor(() => expect(screen.getByTestId('probe')).toHaveTextContent('ಮುಖಪುಟ'));
  });

  it('a phone that had Hindi saved opens in English (Hindi is hidden), and the switcher has no Hindi', async () => {
    const storage = createMemoryStore({ [LANGUAGE_STORAGE_KEY]: 'hi' });
    await render(
      <I18nProvider storage={storage}>
        <LanguageSwitcher />
        <Probe />
      </I18nProvider>,
    );
    await waitFor(() => expect(screen.getByTestId('probe')).toHaveTextContent('Home'));
    await fireEvent.press(screen.getByTestId('language-switcher'));
    expect(screen.queryByTestId('language-hi')).toBeNull();
    expect(screen.getByTestId('language-kn')).toBeTruthy();
    expect(screen.getByTestId('language-en')).toBeTruthy();
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
