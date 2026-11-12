import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { ATT_NOW, openToday } from '../attendance/fixtures';
import { mockApi, renderScreen, signInAs } from '../test/utils';
import { LANGUAGE_STORAGE_KEY } from './I18nProvider';
import { personLanguageKey } from './LanguageSwitcher';

function Blank() {
  return <p>page</p>;
}

describe('Call agent console language switcher', () => {
  it('offers Kannada, English and Hindi, sets <html lang> and remembers the choice for this person', async () => {
    mockApi({ 'GET /attendance/today': openToday() });
    const staff = signInAs('call_agent');
    const view = renderScreen(<Blank />, { portal: 'call-agent', path: '/call-agent', now: ATT_NOW });
    const select = screen.getByRole('combobox', { name: 'Language' });
    expect(Array.from((select as HTMLSelectElement).options).map((o) => o.textContent)).toEqual(['EN', 'ಕನ್ನಡ', 'हिंदी']);
    expect(screen.getByRole('link', { name: 'Attendance' })).toBeInTheDocument();
    await userEvent.selectOptions(select, 'hi');
    expect(document.documentElement.lang).toBe('hi');
    expect(screen.getByRole('link', { name: 'हाज़िरी' })).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: /^मेरी स्थिति: उपलब्ध/ })).toBeInTheDocument();
    expect(localStorage.getItem(personLanguageKey(staff.id))).toBe('hi');
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'भाषा' }), 'kn');
    expect(document.documentElement.lang).toBe('kn');
    expect(localStorage.getItem(personLanguageKey(staff.id))).toBe('kn');
    view.unmount();

    // Next time on this computer, even after someone else switched the app to English, it opens in Kannada for her.
    localStorage.setItem(LANGUAGE_STORAGE_KEY, 'en');
    mockApi({ 'GET /attendance/today': openToday() });
    signInAs('call_agent');
    renderScreen(<Blank />, { portal: 'call-agent', path: '/call-agent', now: ATT_NOW });
    await waitFor(() => expect(document.documentElement.lang).toBe('kn'));
    expect(screen.getByRole('link', { name: 'ಹಾಜರಾತಿ' })).toBeInTheDocument();
  });

  it('keeps working when storage is blocked', async () => {
    mockApi({ 'GET /attendance/today': openToday() });
    signInAs('call_agent');
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = () => {
      throw new Error('blocked');
    };
    try {
      renderScreen(<Blank />, { portal: 'call-agent', path: '/call-agent', now: ATT_NOW });
      await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Language' }), 'kn');
      expect(document.documentElement.lang).toBe('kn');
    } finally {
      Storage.prototype.setItem = original;
    }
  });
});
