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

  it('really translates (most Kannada and Hindi strings differ from English)', () => {
    const keys = Object.keys(en) as (keyof typeof en)[];
    const sameKn = keys.filter((k) => kn[k] === en[k]).length;
    const sameHi = keys.filter((k) => hi[k] === en[k]).length;
    expect(sameKn / keys.length).toBeLessThan(0.1);
    expect(sameHi / keys.length).toBeLessThan(0.1);
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
