import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import { router } from '@/test/expo-router-mock';
import { kiran, renderWithApp } from '@/test/render';
import { dayView } from '@/test/redesign-fixtures';
import { todayKeyIst, addDays } from '@/components/form';
import VisitsScreen from '.';

jest.mock('expo-router', () => require('@/test/expo-router-mock'));

const visits = {
  now: '2026-11-09T06:00:00Z',
  planned: [
    { assignmentId: 'a-1', purpose: 'verification', business: { id: 'b-1', code: 'BZ-00310', name: 'Annapoorna Mess', locality: 'BTM Layout', latitude: 12.91, longitude: 77.61 }, interview: null },
    { assignmentId: 'a-2', purpose: 'interview_attendance', business: { id: 'b-2', code: 'BZ-00300', name: 'Sri Sai Hotel', locality: null, latitude: null, longitude: null }, interview: { id: 'i-1', startsAt: '2026-11-10T05:00:00Z', candidateName: 'Ramesh G.', candidateArrivedAt: null } },
  ],
  revisitsDue: [
    { visitId: 'v-9', businessId: null, name: 'Lakshmi Tiffins', locality: null, outcome: 'interested_later', revisitOn: '2026-11-09', note: 'after Deepavali we’ll need 2 cooks', latitude: 1, longitude: 1, lastVisitAt: '', when: 'today' },
  ],
  doneToday: [
    { id: 'd-1', name: 'Hotel Kamat', business: null, purpose: 'shop_visit', startedAt: '2026-11-09T04:20:00Z', durationSeconds: 360, hasBoardPhoto: true, hasSelfie: false, outcome: 'not_interested', needsOutcome: false, needsProof: false },
    { id: 'd-2', name: 'Green Leaf Café', business: { id: 'b-3', code: 'BZ-00291', name: 'Green Leaf Café' }, purpose: 'shop_visit', startedAt: '2026-11-09T05:10:00Z', durationSeconds: 1320, hasBoardPhoto: true, hasSelfie: true, outcome: 'onboarded', needsOutcome: false, needsProof: false },
    { id: 'd-3', name: 'Sagar Stores', business: null, purpose: 'shop_visit', startedAt: '2026-11-09T05:35:00Z', durationSeconds: 240, hasBoardPhoto: true, hasSelfie: false, outcome: null, needsOutcome: true, needsProof: false },
  ],
};

beforeEach(() => jest.clearAllMocks());

const days: string[] = [];
const route = (url: string) => {
  if (url.endsWith('/field-work/visits')) return { status: 200, body: visits };
  if (url.includes('/field-work/day')) {
    const date = new URL(url).searchParams.get('date') ?? todayKeyIst();
    days.push(date);
    return { status: 200, body: dayView(date, { isToday: date === todayKeyIst() }) };
  }
  return undefined;
};

describe('FA05 Visits', () => {
  it('Visit a shop, planned today (interviews open the interview-day screen), revisits due, Today’s work and Shops near me', async () => {
    await renderWithApp(<VisitsScreen />, { signedInAs: kiran, route });
    await waitFor(() => screen.getByTestId('fa05-planned-a-1'));
    expect(screen.getByTestId('fa05-planned-a-1')).toHaveTextContent(/Annapoorna Mess.*Verification/);
    expect(screen.getByTestId('fa05-planned-a-2')).toHaveTextContent(/Sri Sai Hotel.*Ramesh G\..*Attend interview/);
    expect(screen.getByTestId('fa05-revisit-v-9')).toHaveTextContent(/Lakshmi Tiffins.*Owner said: “after Deepavali we’ll need 2 cooks”.*Come back today/);
    // An interview to attend opens the interview-day screen (candidate arrived), inside the Visits tab.
    await fireEvent.press(screen.getByTestId('fa05-planned-a-2'));
    expect(router.push).toHaveBeenCalledWith('/visit/interview/i-1/day');
    await fireEvent.press(screen.getByTestId('fa05-planned-a-1'));
    expect(router.push).toHaveBeenCalledWith({ pathname: '/visit/verify', params: { businessId: 'b-1', assignmentId: 'a-1' } });
    await fireEvent.press(screen.getByTestId('fa05-revisit-v-9'));
    expect(router.push).toHaveBeenCalledWith({ pathname: '/visit/start', params: { revisitOf: 'v-9', name: 'Lakshmi Tiffins' } });
    await fireEvent.press(screen.getByTestId('fa05-visit-shop'));
    expect(router.push).toHaveBeenCalledWith('/visit/start');
    await fireEvent.press(screen.getByTestId('fa05-near-me'));
    expect(router.push).toHaveBeenCalledWith('/visits/near');
    await fireEvent.press(screen.getByTestId('search-bar'));
    expect(router.push).toHaveBeenCalledWith('/visits/search');
  });

  it('Today’s work: every visit with its result and what was registered; Yesterday switches the day; rows open their page', async () => {
    days.length = 0;
    await renderWithApp(<VisitsScreen />, { signedInAs: kiran, route });
    await waitFor(() => screen.getByTestId('work-visit:v-1'));
    expect(days).toEqual([todayKeyIst()]);
    expect(screen.getByTestId('work-visit:v-1')).toHaveTextContent(/Sri Sai Bakery.*Visit.*Onboarded/);
    expect(screen.getByTestId('work-visit:v-3')).toHaveTextContent(/Sagar Stores.*Not finished/);
    expect(screen.getByTestId('work-business:b-1')).toHaveTextContent(/Business onboarded/);
    await fireEvent.press(screen.getByTestId('work-visit:v-3'));
    expect(router.push).toHaveBeenCalledWith('/visit/details/v-3');
    await fireEvent.press(screen.getByTestId('work-js:js-1'));
    expect(router.push).toHaveBeenCalledWith('/job-seekers/js-1');
    await fireEvent.press(screen.getByTestId('fa05-day-yesterday'));
    await waitFor(() => expect(days).toContain(addDays(todayKeyIst(), -1)));
  });

  it('shows a business that signed up in the app as a sign-up visit with the time the owner picked, opening the verification steps', async () => {
    const signup = {
      ...visits,
      planned: [
        {
          assignmentId: 'a-9',
          purpose: 'business_signup',
          business: { id: 'b-9', code: 'BZ-00456', name: 'Sri Sai Bakery', locality: 'Jayanagar', latitude: 12.93, longitude: 77.58 },
          interview: null,
          requestedFor: '2026-11-10T05:30:00Z',
        },
      ],
    };
    await renderWithApp(<VisitsScreen />, { signedInAs: kiran, route: (url) => (url.endsWith('/field-work/visits') ? { status: 200, body: signup } : undefined) });
    await waitFor(() => screen.getByTestId('fa05-planned-a-9'));
    expect(screen.getByTestId('fa05-planned-a-9')).toHaveTextContent(/Sri Sai Bakery.*Owner picked.*11:00 AM.*Jayanagar.*App sign-up visit/);
    await fireEvent.press(screen.getByTestId('fa05-planned-a-9'));
    expect(router.push).toHaveBeenCalledWith({ pathname: '/visit/verify', params: { businessId: 'b-9', assignmentId: 'a-9' } });
  });
});
