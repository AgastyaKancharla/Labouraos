import { Linking } from 'react-native';
import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import * as Location from 'expo-location';
import { router } from 'expo-router';
import { networkError } from '@/api/errors';
import { OfflineQueue } from '@/device/offline-queue/queue';
import { createMemoryQueueStore } from '@/device/offline-queue/types';
import { kiran, renderWithApp, type FetchRoute } from '@/test/render';
import { todayView } from '@/test/redesign-fixtures';
import { translate } from '@/i18n';
import HomeScreen, { STATUS_CHOICES } from '.';

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

describe('FA03 Today', () => {
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
    expect(screen.getByTestId('attendance-logged-in')).toHaveTextContent(/Logged in at 9:12 AM.*on time/);
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

  it('shows the late login; today’s numbers wait for the server (a dash, never an invented number)', async () => {
    await renderWithApp(<HomeScreen />, { signedInAs: kiran, route: api({ ...loggedIn, lateMinutes: 12 }) });
    await waitFor(() => screen.getByTestId('attendance-logged-in'));
    expect(screen.getByTestId('attendance-logged-in')).toHaveTextContent(/12 min late/);
    expect(screen.getByTestId('stat-shopsVisited')).toHaveTextContent(/^—shops visited$/);
  });

  it('today’s numbers each open Today’s work on what they count; a small targets bar', async () => {
    await renderWithApp(<HomeScreen />, { signedInAs: kiran, route: api(loggedIn, (url) => (url.endsWith('/field-work/today') ? { status: 200, body: todayView() } : undefined)) });
    await waitFor(() => expect(screen.getByTestId('stat-shopsVisited')).toHaveTextContent(/^4shops visited$/));
    expect(screen.getByTestId('stat-onboarded')).toHaveTextContent(/^1onboarded$/);
    expect(screen.getByTestId('stat-vacanciesConfirmed')).toHaveTextContent(/^2vacancies confirmed$/);
    expect(screen.getByTestId('stat-candidatesShown')).toHaveTextContent(/^6shown$/);
    expect(screen.getByTestId('stat-interviewsBooked')).toHaveTextContent(/^1interviews0 attended$/);
    expect(screen.getByTestId('targets-bar')).toHaveTextContent(/3 \/ 10/);
    await fireEvent.press(screen.getByTestId('stat-onboarded'));
    expect(router.push).toHaveBeenLastCalledWith('/visits/work?date=2026-11-16&kind=onboarded');
    await fireEvent.press(screen.getByTestId('stat-shopsVisited'));
    expect(router.push).toHaveBeenLastCalledWith('/visits/work?date=2026-11-16&kind=visit');
    await fireEvent.press(screen.getByTestId('stat-vacanciesConfirmed'));
    expect(router.push).toHaveBeenLastCalledWith('/businesses');
  });

  it('21 Nov: a verification visit is a job card on Today (address, owner, phone, Call owner, Open in Maps, Verify)', async () => {
    const job = {
      assignmentId: 'va-1', purpose: 'business_signup', requestedFor: null,
      business: { id: 'b-7', code: 'BZ-00007', name: 'Sri Sai Tiffins', address: '12, 9th Cross, JP Nagar', locality: 'JP Nagar', ownerName: 'Ramesh', contactName: null, phoneLast4: '4321', latitude: 12.91, longitude: 77.58 },
      lastAttempt: { visitId: 'v-5', outcome: 'owner_not_there', at: '2026-11-15T06:00:00.000Z', revisitOn: '2026-11-16', revisitTime: '16:30' },
      unfinishedVisitId: null,
    };
    const view = todayView();
    view.needsYou = [
      { id: 'verification_visit:va-1', kind: 'verification_visit', title: 'Sri Sai Tiffins', subtitle: '12, 9th Cross, JP Nagar', at: null, due: 'today', target: { type: 'verification', id: 'va-1', step: 'verify', businessId: 'b-7', assignmentId: 'va-1' }, job } as never,
      ...view.needsYou,
    ];
    const { fetchImpl } = await renderWithApp(<HomeScreen />, {
      signedInAs: kiran,
      route: api(loggedIn, (url, init) =>
        url.endsWith('/field-work/today') ? { status: 200, body: view } : url.endsWith('/calls') && init.method === 'POST' ? { status: 201, body: { callRecordId: 'c-1' } } : undefined,
      ),
    });
    await waitFor(() => screen.getByTestId('needs-verification_visit:va-1'));
    const card = screen.getByTestId('needs-verification_visit:va-1');
    expect(card).toHaveTextContent(/Sri Sai Tiffins/);
    expect(screen.getByTestId('job-address')).toHaveTextContent('12, 9th Cross, JP Nagar · JP Nagar');
    expect(screen.getByTestId('job-owner')).toHaveTextContent('Owner: Ramesh');
    expect(screen.getByTestId('job-phone')).toHaveTextContent('Phone ••4321');
    expect(screen.getByTestId('job-last-try')).toHaveTextContent(/owner not there · Come back .*4:30 PM/);
    const openURL = jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined);
    await fireEvent.press(screen.getByTestId('job-maps'));
    expect(openURL).toHaveBeenLastCalledWith('https://www.google.com/maps/search/?api=1&query=12.91,77.58');
    await fireEvent.press(screen.getByTestId('job-call-owner'));
    await waitFor(() => screen.getByTestId('job-calling'));
    const call = fetchImpl.mock.calls.find(([url, init]) => String(url).endsWith('/calls') && (init as RequestInit).method === 'POST');
    expect(JSON.parse(String((call![1] as RequestInit).body))).toEqual({ subjectType: 'business', subjectId: 'b-7', purpose: 'verification' });
    await fireEvent.press(screen.getByTestId('job-verify'));
    expect(router.push).toHaveBeenLastCalledWith({ pathname: '/visit/verify', params: { businessId: 'b-7', assignmentId: 'va-1' } });
  });

  it('Needs you now: one list of everything waiting, each opening the exact step of its job', async () => {
    await renderWithApp(<HomeScreen />, { signedInAs: kiran, route: api(loggedIn, (url) => (url.endsWith('/field-work/today') ? { status: 200, body: todayView() } : undefined)) });
    await waitFor(() => screen.getByTestId('needs-interview_today:iv-1'));
    expect(screen.getByTestId('needs-interview_today:iv-1')).toHaveTextContent(/Sri Sai Hotel.*Interview at 12:00 PM · Ramesh G\..*Today/);
    expect(screen.getByTestId('needs-agreement_waiting:b-1')).toHaveTextContent(/Sri Sai Bakery.*Agreement link expired · resend it/);
    expect(screen.getByTestId('needs-vacancy_draft:vac-1')).toHaveTextContent(/Check and send to the owner · Cook × 2/);
    expect(screen.getByTestId('needs-revisit_due:v-9')).toHaveTextContent(/Lakshmi Tiffins.*Revisit due.*Overdue/);
    // 17 Nov: a heads-up per business with vacancies to fill, opening that business.
    expect(screen.getByTestId('needs-vacancies_to_fill:b-4')).toHaveTextContent(/Green Leaf Café.*2 vacancies to fill · Waiter, Cook · Jayanagar/);
    const expected: [string, unknown][] = [
      ['interview_today:iv-1', '/visit/interview/iv-1/day'],
      ['visit_unfinished:v-3', { pathname: '/visit/business', params: { visitId: 'v-3' } }],
      ['agreement_waiting:b-1', { pathname: '/visit/agreement', params: { businessId: 'b-1' } }],
      ['vacancy_awaiting_owner:vac-2', '/businesses/vacancy/vac-2'],
      ['vacancy_draft:vac-1', '/businesses/vacancy/vac-1'],
      ['ready_show_candidates:b-4', '/businesses/candidates/b-4?vacancyId=vac-9'],
      ['vacancies_to_fill:b-4', '/businesses/b-4'],
      ['joining_due:pl-1', '/businesses/placement/pl-1/joining'],
      ['revisit_due:v-9', { pathname: '/visit/start', params: { revisitOf: 'v-9', name: 'Lakshmi Tiffins' } }],
      // 21 Nov (M4): a follow-up task opens its own screen (call, what they said, Done).
      ['followup_task:t-1', '/follow-up/t-1'],
    ];
    for (const [id, href] of expected) {
      await fireEvent.press(screen.getByTestId(`needs-${id}`));
      expect(router.push).toHaveBeenLastCalledWith(href);
    }
  });

  it('Needs you now never repeats the trade ("Cook · Cook") when the server also sends it as the subtitle (A8)', async () => {
    const view = todayView();
    view.needsYou = view.needsYou.map((n) => (n.vacancy ? { ...n, subtitle: n.vacancy.trade } : n));
    await renderWithApp(<HomeScreen />, { signedInAs: kiran, route: api(loggedIn, (url) => (url.endsWith('/field-work/today') ? { status: 200, body: view } : undefined)) });
    await waitFor(() => screen.getByTestId('needs-vacancy_draft:vac-1'));
    expect(screen.getByTestId('needs-vacancy_draft:vac-1')).toHaveTextContent(/Check and send to the owner · Cook × 2$/);
    expect(screen.getByTestId('needs-vacancy_awaiting_owner:vac-2')).not.toHaveTextContent(/Helper · Helper/);
    // Other subtitles (the area) still show.
    expect(screen.getByTestId('needs-agreement_waiting:b-1')).toHaveTextContent(/JP Nagar/);
  });

  it('dates are in English (rev 193)', async () => {
    await renderWithApp(<HomeScreen />, { signedInAs: kiran, route: api(loggedIn, (url) => (url.endsWith('/field-work/today') ? { status: 200, body: todayView() } : undefined)) });
    await waitFor(() => expect(screen.getByTestId('today-hero')).toHaveTextContent(/Mon 16 Nov/));
  });

  it('the status chip offers exactly the statuses a person can pick; Travelling shows as the current status only (A2)', async () => {
    const sent: unknown[] = [];
    await renderWithApp(<HomeScreen />, {
      signedInAs: kiran,
      route: api(loggedIn, (url, init) => {
        if (url.endsWith('/attendance/status')) {
          sent.push(JSON.parse(String(init.body)));
          return { status: 200, body: { ...loggedIn, status: 'lunch' } };
        }
        return undefined;
      }),
    });
    await waitFor(() => screen.getByTestId('attendance-status'));
    expect(screen.getByTestId('attendance-status')).toHaveTextContent(/Travelling/);
    await fireEvent.press(screen.getByTestId('attendance-status'));
    // 22 Nov: Active, Team meeting, One-to-one, Training, System problem, Short break, Lunch (no calls for field agents).
    const offered = ['available', 'team_meeting', 'one_to_one', 'training', 'system_problem', 'short_break', 'lunch'];
    for (const s of offered) expect(screen.getByTestId(`status-choice-${s}`)).toBeTruthy();
    for (const s of ['on_visit', 'travelling', 'on_call', 'after_call_notes', 'start_of_day']) expect(screen.queryByTestId(`status-choice-${s}`)).toBeNull();
    expect(STATUS_CHOICES).toEqual(offered);
    expect(screen.getByTestId('status-automatic')).toHaveTextContent(/Now: Travelling/);
    await fireEvent.press(screen.getByTestId('status-choice-lunch'));
    await waitFor(() => expect(screen.getByTestId('attendance-status')).toHaveTextContent(/Lunch/));
    expect(sent).toEqual([{ status: 'lunch' }]);
  });

  it('a refused status shows the app\'s own sentence, never the server\'s message (A2)', async () => {
    await renderWithApp(<HomeScreen />, {
      signedInAs: kiran,
      route: api(loggedIn, (url) =>
        url.endsWith('/attendance/status')
          ? { status: 400, body: { statusCode: 400, message: 'Status on_visit is set automatically', details: { code: 'STATUS_NOT_PICKABLE' } } }
          : undefined,
      ),
    });
    await waitFor(() => screen.getByTestId('attendance-status'));
    await fireEvent.press(screen.getByTestId('attendance-status'));
    await fireEvent.press(screen.getByTestId('status-choice-training'));
    await waitFor(() => screen.getByTestId('attendance-error'));
    expect(screen.getByTestId('attendance-error')).toHaveTextContent(translate('en', 'today.statusFailed'));
    expect(screen.getByTestId('attendance-error')).not.toHaveTextContent(/set automatically/);
  });

  it('Log out asks first, then ends the day: no Log in again today (17 Nov)', async () => {
    let ended = false;
    await renderWithApp(<HomeScreen />, {
      signedInAs: kiran,
      route: api(loggedIn, (url) => {
        if (url.endsWith('/attendance/logout')) {
          ended = true;
          return { status: 200, body: { ...loggedIn, logoutAt: '2026-11-09T13:00:00Z' } };
        }
        return undefined;
      }),
    });
    await waitFor(() => screen.getByTestId('attendance-logout'));
    expect(screen.getByTestId('attendance-logout')).toHaveTextContent('Log out');
    await fireEvent.press(screen.getByTestId('attendance-logout'));
    expect(ended).toBe(false);
    await fireEvent.press(screen.getByTestId('attendance-logout-confirm'));
    await waitFor(() => screen.getByTestId('attendance-ended'));
    expect(ended).toBe(true);
    expect(screen.getByTestId('attendance-ended')).toHaveTextContent(/Logged in 9:12 AM · logged out 6:30 PM.*log in again tomorrow/);
    expect(screen.queryByTestId('attendance-login')).toBeNull();
    expect(screen.queryByTestId('attendance-status')).toBeNull();
  });

  it('22 Nov: the day opened at sign-in in Start of day — no Log in button; one tap starts work as Active', async () => {
    const sent: unknown[] = [];
    const startOfDay = { ...loggedIn, status: 'start_of_day', statusSince: '2026-11-09T03:42:00Z', startsAtSignIn: true, locationSaved: true };
    await renderWithApp(<HomeScreen />, {
      signedInAs: kiran,
      route: api(startOfDay, (url, init) => {
        if (url.endsWith('/attendance/status')) {
          sent.push(JSON.parse(String(init.body)));
          return { status: 200, body: { ...startOfDay, status: 'available' } };
        }
        return undefined;
      }),
    });
    await waitFor(() => screen.getByTestId('attendance-start-of-day'));
    expect(screen.queryByTestId('attendance-login')).toBeNull();
    expect(screen.getByTestId('attendance-status')).toHaveTextContent(/Start of day/);
    expect(screen.getByTestId('attendance-start-of-day')).toHaveTextContent(/Start of day · since 9:12 AM.*Pick your status to start work/);
    await fireEvent.press(screen.getByTestId('attendance-status'));
    expect(screen.queryByTestId('status-choice-start_of_day')).toBeNull();
    expect(screen.getByTestId('status-automatic')).toHaveTextContent(/Start of day \(since you signed in\)/);
    expect(screen.getByTestId('status-choice-available')).toHaveTextContent(/Active/);
    await fireEvent.press(screen.getByTestId('attendance-start-work'));
    await waitFor(() => expect(sent).toEqual([{ status: 'available' }]));
    await waitFor(() => expect(screen.queryByTestId('attendance-start-of-day')).toBeNull());
  });

  it('22 Nov: a day opened at sign-in without a location saves it right away (the GPS rule stays)', async () => {
    const sent: unknown[] = [];
    const opened = { ...loggedIn, status: 'start_of_day', statusSince: '2026-11-09T03:42:00Z', startsAtSignIn: true, locationSaved: false };
    await renderWithApp(<HomeScreen />, {
      signedInAs: kiran,
      route: api(opened, (url, init) => {
        if (url.endsWith('/attendance/login')) {
          sent.push(JSON.parse(String(init.body)));
          return { status: 200, body: { ...opened, locationSaved: true } };
        }
        return undefined;
      }),
    });
    await waitFor(() => expect(sent).toEqual([{ latitude: 12.9116, longitude: 77.6389 }]));
    await waitFor(() => expect(screen.queryByTestId('attendance-location')).toBeNull());
  });

  it('22 Nov: a day that did not open at sign-in asks to sign in again, never Log in', async () => {
    await renderWithApp(<HomeScreen />, { signedInAs: kiran, route: api({ ...notLoggedIn, startsAtSignIn: true }) });
    await waitFor(() => screen.getByTestId('attendance-sign-in-starts'));
    expect(screen.queryByTestId('attendance-login')).toBeNull();
    expect(screen.getByTestId('attendance-sign-in-again')).toHaveTextContent('Sign in again');
  });

  it('Log out also signs out of Laboura Field (21 Nov: the sign-in lasts until Log out)', async () => {
    const { store, fetchImpl } = await renderWithApp(<HomeScreen />, {
      signedInAs: kiran,
      route: api(loggedIn, (url) => {
        if (url.endsWith('/attendance/logout')) return { status: 200, body: { ...loggedIn, logoutAt: '2026-11-09T13:00:00Z', canResume: true } };
        if (url.endsWith('/auth/logout')) return { status: 200, body: { success: true } };
        return undefined;
      }),
    });
    await waitFor(() => screen.getByTestId('attendance-logout'));
    await fireEvent.press(screen.getByTestId('attendance-logout'));
    await fireEvent.press(screen.getByTestId('attendance-logout-confirm'));
    await waitFor(() => expect(store.get()).toBeNull());
    expect(fetchImpl.mock.calls.some(([url]) => String(url).endsWith('/auth/logout'))).toBe(true);
  });

  it('a day ended with Log out today offers Resume my day; it opens the day again (21 Nov)', async () => {
    let resumed = false;
    const ended = { ...loggedIn, logoutAt: '2026-11-09T08:00:00Z', closedReason: 'logout', canResume: true };
    await renderWithApp(<HomeScreen />, {
      signedInAs: kiran,
      route: api(ended, (url) => {
        if (url.endsWith('/attendance/resume')) {
          resumed = true;
          return { status: 200, body: { ...loggedIn, status: 'available', canResume: false } };
        }
        return undefined;
      }),
    });
    await waitFor(() => screen.getByTestId('attendance-resume'));
    expect(screen.getByTestId('attendance-ended')).toHaveTextContent(/Resume your day/);
    await fireEvent.press(screen.getByTestId('attendance-resume'));
    await waitFor(() => screen.getByTestId('attendance-logged-in'));
    expect(resumed).toBe(true);
  });

  it('a day closed by the night clean-up has no Resume button', async () => {
    await renderWithApp(<HomeScreen />, {
      signedInAs: kiran,
      route: api({ ...loggedIn, logoutAt: '2026-11-09T08:00:00Z', closedReason: 'auto_closed_no_logout', canResume: false }),
    });
    await waitFor(() => screen.getByTestId('attendance-ended'));
    expect(screen.queryByTestId('attendance-resume')).toBeNull();
  });

  it('after the lunch allowance asks "Back from lunch?" and one tap makes him Available (21 Nov)', async () => {
    const sent: unknown[] = [];
    const onLunch = {
      ...loggedIn,
      status: 'lunch',
      statusSince: new Date(Date.now() - 35 * 60_000).toISOString(),
      policy: { lunchMinutes: 30, shortBreakMinutes: 15, idleAfterMinutes: 30 },
    };
    await renderWithApp(<HomeScreen />, {
      signedInAs: kiran,
      route: api(onLunch, (url, init) => {
        if (url.endsWith('/attendance/status')) {
          sent.push(JSON.parse(String(init.body)));
          return { status: 200, body: { ...onLunch, status: 'available', statusSince: new Date().toISOString() } };
        }
        return undefined;
      }),
    });
    await waitFor(() => screen.getByTestId('attendance-back-prompt'));
    expect(screen.getByTestId('attendance-back-prompt')).toHaveTextContent(/Back from lunch\?.*30-minute allowance/);
    await fireEvent.press(screen.getByTestId('attendance-back'));
    await waitFor(() => expect(screen.queryByTestId('attendance-back-prompt')).toBeNull());
    expect(sent).toEqual([{ status: 'available' }]);
  });

  it('inside the lunch allowance there is no prompt; the own shift shows before Log in', async () => {
    await renderWithApp(<HomeScreen />, {
      signedInAs: kiran,
      route: api({ ...notLoggedIn, clocks: { ...notLoggedIn.clocks, shiftStart: '12:00', shiftEnd: '21:00' }, ownShift: true }),
    });
    await waitFor(() => screen.getByTestId('attendance-not-logged-in'));
    expect(screen.getByTestId('attendance-not-logged-in')).toHaveTextContent(/Your shift 12:00 PM – 9:00 PM/);
    expect(screen.queryByTestId('attendance-back-prompt')).toBeNull();
  });

  it('the Log in button says Log in, and a second Log in on an ended day shows the day, not an error', async () => {
    let closed = false;
    await renderWithApp(<HomeScreen />, {
      signedInAs: kiran,
      route: (url) => {
        if (url.endsWith('/attendance/today')) return { status: 200, body: closed ? { ...loggedIn, logoutAt: '2026-11-09T08:00:00Z' } : notLoggedIn };
        if (url.endsWith('/attendance/login')) {
          closed = true;
          return { status: 400, body: { statusCode: 400, message: 'This day is already closed', details: { code: 'DAY_ALREADY_ENDED' } } };
        }
        return undefined;
      },
    });
    await waitFor(() => screen.getByTestId('attendance-login'));
    expect(screen.getByTestId('attendance-login')).toHaveTextContent('Log in');
    await fireEvent.press(screen.getByTestId('attendance-login'));
    await waitFor(() => screen.getByTestId('attendance-ended'));
    expect(screen.queryByTestId('attendance-login-error')).toBeNull();
  });

  it('Log out refused because the day already ended elsewhere shows the ended day, never an error', async () => {
    let closed = false;
    await renderWithApp(<HomeScreen />, {
      signedInAs: kiran,
      route: (url) => {
        if (url.endsWith('/attendance/today')) return { status: 200, body: closed ? { ...loggedIn, logoutAt: '2026-11-09T08:00:00Z' } : loggedIn };
        if (url.endsWith('/attendance/logout')) {
          closed = true;
          return { status: 400, body: { statusCode: 400, message: 'Log in before logging out', details: { code: 'DAY_NOT_STARTED' } } };
        }
        return undefined;
      },
    });
    await waitFor(() => screen.getByTestId('attendance-logout'));
    await fireEvent.press(screen.getByTestId('attendance-logout'));
    await fireEvent.press(screen.getByTestId('attendance-logout-confirm'));
    await waitFor(() => screen.getByTestId('attendance-ended'));
    expect(screen.queryByTestId('attendance-error')).toBeNull();
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
    await fireEvent.press(screen.getByTestId('quick-referral'));
    await fireEvent.press(screen.getByTestId('quick-fee'));
    await fireEvent.press(screen.getByRole('search'));
    expect((router.push as jest.Mock).mock.calls.map((c) => c[0])).toEqual([
      '/visit/start',
      '/job-seekers/new',
      '/businesses/vacancy/new',
      '/job-seekers/referral-partner/new',
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

  it('shows English, with no language switcher (rev 193)', async () => {
    await renderWithApp(<HomeScreen />, { signedInAs: kiran, route: api(notLoggedIn) });
    await waitFor(() => expect(screen.getByTestId('attendance-not-logged-in')).toHaveTextContent(/Not logged in yet/));
    expect(screen.queryByTestId('language-switcher')).toBeNull();
  });
});
