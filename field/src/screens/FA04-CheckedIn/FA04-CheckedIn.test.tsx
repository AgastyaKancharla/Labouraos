import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import { kiran, renderWithApp } from '@/test/render';
import CheckedInScreen from '.';

jest.mock('expo-router', () => require('@/test/expo-router-mock'));

const today = {
  date: '2026-11-09', status: 'travelling', loginAt: '2026-11-09T03:42:00Z', logoutAt: null, lateMinutes: 0, productionSeconds: 720,
  breakSeconds: 0, idleSeconds: 0, shortfallSeconds: 0, clocks: { shiftStart: '09:30', shiftEnd: '18:30', now: '2026-11-09T03:54:00Z' },
  flagged: false, closedReason: null, dayType: 'open',
};
const home = { now: '', today: { shopsVisited: 0, onboarded: 0, vacanciesAdded: 0, candidatesShown: 0, interviewsBooked: 0 }, alerts: [], todos: [], checkIn: { latitude: 12.9116, longitude: 77.6389, accuracyMeters: 12, at: '2026-11-09T03:42:00Z' } };

describe('FA04 My day', () => {
  it('shows the login, production, the one GPS point with accuracy, and changes status from the picker', async () => {
    const statuses: unknown[] = [];
    await renderWithApp(<CheckedInScreen />, {
      signedInAs: kiran,
      route: (url, init) => {
        if (url.endsWith('/attendance/today')) return { status: 200, body: today };
        if (url.endsWith('/field-work/home')) return { status: 200, body: home };
        if (url.endsWith('/attendance/status')) {
          statuses.push(JSON.parse(String(init.body)));
          return { status: 200, body: { ...today, status: 'team_meeting' } };
        }
        return undefined;
      },
    });
    await waitFor(() => screen.getByTestId('fa04-day-logged-in'));
    expect(screen.getByTestId('fa04-day-logged-in')).toHaveTextContent(/Logged in at 9:12 AM.*on time/);
    expect(screen.getByTestId('fa04-day-logout')).toHaveTextContent('Log out');
    expect(screen.getByTestId('fa04-production')).toHaveTextContent('0h 12m of 8h');
    await waitFor(() => expect(screen.getByTestId('fa04-location')).toHaveTextContent(/area shown when online.*±12 m.*Only now, at visits and at calls/));
    await fireEvent.press(screen.getByTestId('fa04-day-status'));
    // On visit / Travelling are set by the server, never offered (A2).
    expect(screen.queryByTestId('status-choice-on_visit')).toBeNull();
    expect(screen.queryByTestId('status-choice-travelling')).toBeNull();
    expect(screen.getByTestId('status-choice-one_to_one')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('status-choice-team_meeting'));
    await waitFor(() => expect(statuses).toEqual([{ status: 'team_meeting' }]));
  });

  it('after Log out the day shows as ended, with no status picker and no Log in (bug 17 Nov: the picker stayed and the server refused it)', async () => {
    const calls: string[] = [];
    await renderWithApp(<CheckedInScreen />, {
      signedInAs: kiran,
      route: (url) => {
        if (url.endsWith('/attendance/today')) return { status: 200, body: { ...today, status: null, logoutAt: '2026-11-09T12:00:00Z' } };
        if (url.endsWith('/field-work/home')) return { status: 200, body: home };
        if (url.includes('/attendance/')) calls.push(url);
        return undefined;
      },
    });
    await waitFor(() => screen.getByTestId('fa04-day-ended'));
    expect(screen.getByTestId('fa04-day-ended')).toHaveTextContent(/Logged in 9:12 AM · logged out 5:30 PM.*log in again tomorrow/);
    expect(screen.queryByTestId('fa04-day-status')).toBeNull();
    expect(screen.queryByTestId('fa04-day-login')).toBeNull();
    expect(screen.queryByTestId('fa04-day-logout')).toBeNull();
    expect(calls).toEqual([]);
  });

  it('a status refused because the day is no longer open shows the day again, not an error', async () => {
    let ended = false;
    await renderWithApp(<CheckedInScreen />, {
      signedInAs: kiran,
      route: (url) => {
        if (url.endsWith('/attendance/today')) return { status: 200, body: ended ? { ...today, status: null, logoutAt: '2026-11-09T12:00:00Z' } : today };
        if (url.endsWith('/field-work/home')) return { status: 200, body: home };
        if (url.endsWith('/attendance/status')) {
          ended = true;
          return { status: 400, body: { statusCode: 400, message: 'Your working day has ended', details: { code: 'DAY_ENDED' } } };
        }
        return undefined;
      },
    });
    await waitFor(() => screen.getByTestId('fa04-day-status'));
    await fireEvent.press(screen.getByTestId('fa04-day-status'));
    await fireEvent.press(screen.getByTestId('status-choice-lunch'));
    await waitFor(() => screen.getByTestId('fa04-day-ended'));
    expect(screen.queryByTestId('fa04-day-error')).toBeNull();
  });
});
