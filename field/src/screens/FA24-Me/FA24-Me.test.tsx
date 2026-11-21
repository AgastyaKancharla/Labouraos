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

describe('FA24 Me: your calling phone (21 Nov, B2)', () => {
  it('not set: says so and saves his own number (PUT /staff/:id/call-routing-phone)', async () => {
    const sent: unknown[] = [];
    let set = false;
    await renderWithApp(<MeScreen />, {
      signedInAs: kiran,
      route: (url, init) => {
        if (url.endsWith('/field-work/calling-phone')) return { status: 200, body: set ? { set: true, last4: '6789' } : { set: false, last4: null } };
        if (url.endsWith('/staff/fa-1/call-routing-phone') && init.method === 'PUT') {
          sent.push(JSON.parse(String(init.body)));
          set = true;
          return { status: 200, body: { set: true } };
        }
        return undefined;
      },
    });
    await waitFor(() => expect(screen.getByTestId('me-calling-phone-state')).toHaveTextContent('Not set yet. Calls from the app need it.'));
    expect(screen.getByTestId('me-calling-phone-save')).toBeDisabled();
    await fireEvent.changeText(screen.getByTestId('me-calling-phone-input'), '98765 46789');
    await fireEvent.press(screen.getByTestId('me-calling-phone-save'));
    await waitFor(() => screen.getByTestId('me-calling-phone-saved'));
    expect(sent).toEqual([{ phone: '9876546789' }]);
    await waitFor(() => expect(screen.getByTestId('me-calling-phone-state')).toHaveTextContent('Set: ••6789'));
  });
});
