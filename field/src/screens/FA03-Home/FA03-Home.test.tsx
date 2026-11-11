import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import * as Location from 'expo-location';
import { router } from 'expo-router';
import { networkError } from '@/api/errors';
import { OfflineQueue } from '@/device/offline-queue/queue';
import { createMemoryQueueStore } from '@/device/offline-queue/types';
import { kiran, renderWithApp, type FetchRoute } from '@/test/render';
import HomeScreen from '.';

jest.mock('expo-router', () => require('@/test/expo-router-mock'));

const notLoggedIn = {
  date: '2026-11-09',
  status: null,
  loginAt: null,
  logoutAt: null,
  lateMinutes: 0,
  productionSeconds: 0,
  breakSeconds: 0,
  idleSeconds: 0,
  shortfallSeconds: 28800,
  clocks: { shiftStart: '09:30', shiftEnd: '18:30', now: '2026-11-09T03:30:00Z' },
  flagged: false,
  closedReason: null,
  dayType: 'open',
};
const loggedIn = { ...notLoggedIn, status: 'travelling', loginAt: '2026-11-09T03:42:00Z' };
const dashboard = {
  scope: 'agent',
  period: { year: 2026, month: 11, daysInMonth: 30, currentDay: 9, asOf: '' },
  agent: {
    staff: { id: 'fa-1', code: 'FA-00017', name: 'Kiran Kumar', role: 'field_agent' },
    achieved: { placementsClosed: 9 },
    metrics: { placementsClosed: { metric: 'placementsClosed', achieved: 9, effectiveTarget: 12 } },
    isBehindPace: false,
    isBreached: false,
  },
};

function api(today: object, extra?: FetchRoute): FetchRoute {
  return (url, init) => {
    const hit = extra?.(url, init);
    if (hit) return hit;
    if (url.endsWith('/attendance/today')) return { status: 200, body: today };
    if (url.endsWith('/targets/dashboard')) return { status: 200, body: dashboard };
    return undefined;
  };
}

beforeEach(() => jest.clearAllMocks());

describe('FA03 Home', () => {
  it('shows the agent, the shift and the Login button before the day starts', async () => {
    await renderWithApp(<HomeScreen />, { signedInAs: kiran, route: api(notLoggedIn) });
    await waitFor(() => screen.getByTestId('attendance-not-logged-in'));
    expect(screen.getByTestId('attendance-not-logged-in')).toHaveTextContent(/Not logged in yet.*Shift 9:30 AM – 6:30 PM/);
    expect(screen.getByText('Kiran Kumar · Mon 9 Nov')).toBeTruthy();
  });

  it('starts the day with the GPS location (field agents\' location is saved at login)', async () => {
    const sent: unknown[] = [];
    await renderWithApp(<HomeScreen />, {
      signedInAs: kiran,
      route: api(notLoggedIn, (url, init) => {
        if (url.endsWith('/attendance/login')) {
          sent.push(JSON.parse(String(init.body)));
          return { status: 200, body: loggedIn };
        }
        return undefined;
      }),
    });
    await waitFor(() => screen.getByTestId('attendance-login'));
    await fireEvent.press(screen.getByTestId('attendance-login'));
    await waitFor(() => screen.getByTestId('attendance-logged-in'));
    expect(sent).toEqual([{ latitude: 12.9116, longitude: 77.6389 }]);
    expect(screen.getByTestId('attendance-logged-in')).toHaveTextContent(/Logged in at 9:12 AM · on time/);
    expect(screen.getByText('Travelling')).toBeTruthy();
  });

  it('explains when location is off instead of logging in without it', async () => {
    (Location.getForegroundPermissionsAsync as jest.Mock).mockResolvedValueOnce({ granted: false, canAskAgain: false });
    const { fetchImpl } = await renderWithApp(<HomeScreen />, { signedInAs: kiran, route: api(notLoggedIn) });
    await waitFor(() => screen.getByTestId('attendance-login'));
    await fireEvent.press(screen.getByTestId('attendance-login'));
    await waitFor(() => expect(screen.getByTestId('attendance-login-error')).toHaveTextContent(/location is saved at login.*turned off/i));
    expect(fetchImpl.mock.calls.some(([url]) => String(url).endsWith('/attendance/login'))).toBe(false);
  });

  it('shows the late login, placements this month and the placeholder counters', async () => {
    await renderWithApp(<HomeScreen />, { signedInAs: kiran, route: api({ ...loggedIn, lateMinutes: 12 }) });
    await waitFor(() => screen.getByTestId('placements-card'));
    expect(screen.getByTestId('attendance-logged-in')).toHaveTextContent(/12 min late/);
    expect(screen.getByTestId('placements-card')).toHaveTextContent(/9.*\/ 12/);
    expect(screen.getByTestId('stat-shops')).toHaveTextContent(/^—shops visited$/);
    expect(screen.getByTestId('today-placeholder-note')).toBeTruthy();
  });

  it('shows "Saved on phone, sends when signal returns" with the photo count', async () => {
    const queue = new OfflineQueue({ store: createMemoryQueueStore(), send: async () => Promise.reject(networkError()) });
    await queue.enqueue('fa-1', 'Shop photo', {
      method: 'POST',
      path: '/businesses/BZ-1/photo',
      files: [{ field: 'photo', name: 'a.jpg', type: 'image/jpeg', uri: 'file:///a.jpg' }],
    });
    await renderWithApp(<HomeScreen />, { signedInAs: kiran, route: api(loggedIn), queue });
    await waitFor(() => screen.getByTestId('queue-row'));
    expect(screen.getByTestId('queue-row')).toHaveTextContent(/Saved on phone, sends when signal returns.*1 photo/);
  });

  it('opens the quick actions and search', async () => {
    await renderWithApp(<HomeScreen />, { signedInAs: kiran, route: api(loggedIn) });
    await fireEvent.press(screen.getByTestId('quick-visit'));
    await fireEvent.press(screen.getByTestId('quick-job-seeker'));
    await fireEvent.press(screen.getByTestId('quick-vacancy'));
    await fireEvent.press(screen.getByTestId('quick-fee'));
    await fireEvent.press(screen.getByRole('search'));
    expect((router.push as jest.Mock).mock.calls.map((c) => c[0])).toEqual([
      '/visit/start',
      '/job-seeker/new',
      '/vacancy/new',
      '/fee-calculator',
      '/search',
    ]);
  });

  it('shows a retry when attendance cannot load, and signs out on 401', async () => {
    const { store } = await renderWithApp(<HomeScreen />, {
      signedInAs: kiran,
      route: (url) =>
        url.endsWith('/attendance/today') ? { status: 401, body: { message: 'Session ended after being idle' } } : undefined,
    });
    await waitFor(() => expect(store.get()).toBeNull());
  });

  it('logs out from the avatar menu', async () => {
    const { store, fetchImpl } = await renderWithApp(<HomeScreen />, {
      signedInAs: kiran,
      route: api(loggedIn, (url) => (url.endsWith('/auth/logout') ? { status: 200, body: { success: true } } : undefined)),
    });
    await fireEvent.press(screen.getByTestId('account-menu'));
    await fireEvent.press(screen.getByTestId('logout-button'));
    await waitFor(() => expect(store.get()).toBeNull());
    expect(fetchImpl.mock.calls.some(([url]) => String(url).endsWith('/auth/logout'))).toBe(true);
  });

  it('switches to Kannada', async () => {
    await renderWithApp(<HomeScreen />, { signedInAs: kiran, route: api(notLoggedIn), language: 'kn' });
    await waitFor(() => expect(screen.getByTestId('attendance-not-logged-in')).toHaveTextContent(/ಇನ್ನೂ ಲಾಗಿನ್ ಆಗಿಲ್ಲ/));
  });
});
