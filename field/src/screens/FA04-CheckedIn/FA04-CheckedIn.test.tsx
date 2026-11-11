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

describe('FA04 Checked in', () => {
  it('shows the login, production, the one GPS point with accuracy, and changes status from the dropdown', async () => {
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
    await waitFor(() => screen.getByTestId('fa04-logged-in'));
    expect(screen.getByTestId('fa04-logged-in')).toHaveTextContent(/Logged in at 9:12 AM · on time/);
    expect(screen.getByTestId('fa04-production')).toHaveTextContent('0h 12m of 8h');
    await waitFor(() => expect(screen.getByTestId('fa04-location')).toHaveTextContent(/12.91160, 77.63890.*±12 m.*Only now, at visits and at calls/));
    await fireEvent.press(screen.getByTestId('fa04-status'));
    expect(screen.getByTestId('fa04-status-on_visit').props.accessibilityState.disabled).toBe(true);
    await fireEvent.press(screen.getByTestId('fa04-status-team_meeting'));
    await waitFor(() => expect(statuses).toEqual([{ status: 'team_meeting' }]));
  });
});
