import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { en } from './en';
import { hi } from './hi';
import { I18nProvider, interpolate, translate, useT } from './I18nProvider';
import { kn } from './kn';
import { LanguageSwitcher } from './LanguageSwitcher';

describe('i18n', () => {
  it('Kannada and Hindi have exactly the English keys and placeholders', () => {
    const keys = Object.keys(en).sort();
    expect(Object.keys(kn).sort()).toEqual(keys);
    expect(Object.keys(hi).sort()).toEqual(keys);
    const vars = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort();
    for (const key of keys as (keyof typeof en)[]) {
      expect(vars(kn[key]), `kn ${key}`).toEqual(vars(en[key]));
      expect(vars(hi[key]), `hi ${key}`).toEqual(vars(en[key]));
      expect(kn[key].trim(), `kn ${key}`).not.toBe('');
      expect(hi[key].trim(), `hi ${key}`).not.toBe('');
    }
  });

  it('interpolates variables', () => {
    expect(interpolate('Hello {name}, {n} new', { name: 'Ravi', n: 3 })).toBe('Hello Ravi, 3 new');
    expect(interpolate('Keep {unknown}', {})).toBe('Keep {unknown}');
    expect(translate('hi', 'common.notificationsCount', { count: 2 })).toBe('सूचनाएँ, 2 नई');
  });

  it('switches language with ಕನ್ನಡ · हिंदी · EN and remembers it', async () => {
    function Probe() {
      const t = useT();
      return <p>{t('common.logout')}</p>;
    }
    render(
      <I18nProvider>
        <LanguageSwitcher />
        <Probe />
      </I18nProvider>,
    );
    expect(screen.getByText('Log out')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'ಕನ್ನಡ' }));
    expect(screen.getByText('ಲಾಗ್ ಔಟ್')).toBeInTheDocument();
    expect(document.documentElement.lang).toBe('kn');
    expect(localStorage.getItem('laboura_lang')).toBe('kn');
    await userEvent.click(screen.getByRole('button', { name: 'हिंदी' }));
    expect(screen.getByText('लॉग आउट')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'हिंदी' })).toHaveAttribute('aria-pressed', 'true');
  });
});
