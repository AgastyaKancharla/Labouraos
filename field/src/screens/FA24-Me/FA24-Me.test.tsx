import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import { router } from '@/test/expo-router-mock';
import { kiran, renderWithApp } from '@/test/render';
import MeScreen from '.';

jest.mock('expo-router', () => require('@/test/expo-router-mock'));

describe('FA24 Me', () => {
  it('targets and leaderboard, my attendance, leave, corrections, payslips and log out; no language choice (rev 193)', async () => {
    const { store } = await renderWithApp(<MeScreen />, {
      signedInAs: kiran,
      route: (url) => (url.endsWith('/auth/logout') ? { status: 200, body: { success: true } } : undefined),
    });
    expect(screen.getByTestId('me-hero')).toHaveTextContent(/Kiran Kumar.*FA-00017 · Field agent/);
    expect(screen.queryByTestId('header-back')).toBeNull();
    const links: [string, string][] = [
      ['me-targets', '/me/targets'],
      ['me-today', '/me/today'],
      ['me-attendance', '/me/attendance'],
      ['me-leave', '/me/attendance/leave'],
      ['me-corrections', '/me/attendance/correction'],
      ['me-payslips', '/me/payslips'],
    ];
    for (const [id, href] of links) {
      await fireEvent.press(screen.getByTestId(id));
      expect(router.push).toHaveBeenLastCalledWith(href);
    }
    expect(screen.queryByTestId('me-language')).toBeNull();
    expect(screen.queryByTestId('me-lang-kn')).toBeNull();
    await fireEvent.press(screen.getByTestId('me-logout'));
    await waitFor(() => expect(store.get()).toBeNull());
  });
});
