import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import { router } from '@/test/expo-router-mock';
import { kiran, renderWithApp } from '@/test/render';
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

describe('FA05 My visits', () => {
  it('lists planned visits, revisits due and every visit done today with its proof, time and outcome', async () => {
    await renderWithApp(<VisitsScreen />, { signedInAs: kiran, route: (url) => (url.endsWith('/field-work/visits') ? { status: 200, body: visits } : undefined) });
    await waitFor(() => screen.getByTestId('fa05-planned-a-1'));
    expect(screen.getByTestId('fa05-planned-a-1')).toHaveTextContent(/Annapoorna Mess.*Verification/);
    expect(screen.getByTestId('fa05-planned-a-2')).toHaveTextContent(/Sri Sai Hotel.*Ramesh G\..*Attend interview/);
    expect(screen.getByTestId('fa05-revisit-v-9')).toHaveTextContent(/Lakshmi Tiffins.*Owner said: “after Deepavali we’ll need 2 cooks”.*Come back today/);
    expect(screen.getByTestId('fa05-done-d-1')).toHaveTextContent(/Hotel Kamat.*9:50 AM · 6 min · 📷.*Not interested/);
    expect(screen.getByTestId('fa05-done-d-2')).toHaveTextContent(/22 min · 📷 \+ selfie.*Onboarded/);
    expect(screen.getByTestId('fa05-done-d-3')).toHaveTextContent(/Record outcome/);
    await fireEvent.press(screen.getByTestId('fa05-done-d-3'));
    expect(router.push).toHaveBeenCalledWith({ pathname: '/visit/outcome', params: { id: 'd-3' } });
    await fireEvent.press(screen.getByTestId('fa05-planned-a-1'));
    expect(router.push).toHaveBeenCalledWith({ pathname: '/visit/verify', params: { businessId: 'b-1', assignmentId: 'a-1' } });
    await fireEvent.press(screen.getByTestId('fa05-revisit-v-9'));
    expect(router.push).toHaveBeenCalledWith({ pathname: '/visit/start', params: { revisitOf: 'v-9', name: 'Lakshmi Tiffins' } });
    await fireEvent.press(screen.getByTestId('fa05-visit-shop'));
    expect(router.push).toHaveBeenCalledWith('/visit/start');
  });
});
