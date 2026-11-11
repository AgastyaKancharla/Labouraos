import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { kiran, renderWithApp } from '@/test/render';
import { business, matchesPage, recordingQueue, routeTable } from '@/test/selling-fixtures';
import MatchesScreen from '.';

jest.mock('expo-router', () => require('@/test/expo-router-mock'));
beforeEach(() => {
  jest.clearAllMocks();
  (useLocalSearchParams as jest.Mock).mockReturnValue({ businessId: 'biz-1' });
});

function api() {
  return routeTable({
    '/screens/field-selling/businesses/biz-1': business,
    '/screens/field-selling/vacancies/vac-1/matches?page=1': matchesPage(1),
    '/screens/field-selling/vacancies/vac-1/matches?page=2': { ...matchesPage(2), total: 4 },
    'POST /vacancies/vac-1/introductions/in-person': { count: 3 },
  });
}

describe('FA15b Matches', () => {
  it('shows the best 3 with no phone numbers, and records them as shown in person', async () => {
    const { route, calls } = api();
    await renderWithApp(<MatchesScreen />, { signedInAs: kiran, route });
    await waitFor(() => screen.getByTestId('match-js-1'));
    expect(screen.getByTestId('match-count')).toHaveTextContent('Best matches · 1–3 of 11');
    expect(screen.getByTestId('match-js-1')).toHaveTextContent(/Manjunath, 27.*Cook · 5 yrs · 2 km · wants ₹17,000.*Speaks Kannada, Hindi/);
    expect(screen.getByTestId('vacancy-chip-VC-0001')).toHaveTextContent('Cook × 2 · ₹16–20k');
    expect(screen.queryByText(/\+91|98450/)).toBeNull();
    await waitFor(() => expect(calls).toContainEqual({ method: 'POST', path: '/vacancies/vac-1/introductions/in-person', body: { jobSeekerIds: ['js-1', 'js-2', 'js-3'] } }));
  });

  it('calls the owner\'s favourite first, and the heart is saved (queued without signal)', async () => {
    const { route } = api();
    const { queue, sent } = recordingQueue();
    await renderWithApp(<MatchesScreen />, { signedInAs: kiran, route, queue });
    await waitFor(() => screen.getByTestId('call-candidate'));
    expect(screen.getByTestId('call-candidate')).toHaveTextContent('Call Sunil');
    await fireEvent.press(screen.getByTestId('call-candidate'));
    expect(router.push).toHaveBeenCalledWith('/job-seekers/call?vacancyId=vac-1&jobSeekerId=js-2');
    await fireEvent.press(screen.getByTestId('like-js-1'));
    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0].request).toMatchObject({ method: 'POST', path: '/field-selling/vacancies/vac-1/favourites/js-1', json: { liked: true } });
  });

  it('Show next 3, then "No more matches" after the last page; the map view shows the same candidates', async () => {
    const { route } = api();
    await renderWithApp(<MatchesScreen />, { signedInAs: kiran, route });
    await waitFor(() => screen.getByTestId('show-next'));
    await fireEvent.press(screen.getByTestId('view-map'));
    expect(screen.getByTestId('matches-map')).toBeTruthy();
    expect(screen.getByTestId('map-candidate-js-1')).toHaveTextContent(/Manjunath · 2 km/);
    await fireEvent.press(screen.getByTestId('show-next'));
    await waitFor(() => screen.getByTestId('map-candidate-js-4'));
    await fireEvent.press(screen.getByTestId('show-next'));
    await waitFor(() => expect(router.push).toHaveBeenCalledWith('/job-seekers/no-more/vac-1?businessId=biz-1'));
  });

  it('a vacancy still waiting for the owner\'s OTP opens the confirmation', async () => {
    const { route } = api();
    await renderWithApp(<MatchesScreen />, { signedInAs: kiran, route });
    await waitFor(() => screen.getByTestId('vacancy-chip-VC-0002'));
    expect(screen.getByTestId('vacancy-chip-VC-0002')).toHaveTextContent(/Kitchen helper.*waiting for OTP/);
    await fireEvent.press(screen.getByTestId('vacancy-chip-VC-0002'));
    expect(router.push).toHaveBeenCalledWith('/vacancies/confirm/vac-2');
  });

  it('shows "Sign first" and no candidates when the agreement is not signed', async () => {
    const { route, calls } = routeTable({ '/screens/field-selling/businesses/biz-1': { ...business, agreementSigned: false, canShowCandidates: false } });
    await renderWithApp(<MatchesScreen />, { signedInAs: kiran, route });
    await waitFor(() => screen.getByTestId('sign-first'));
    expect(calls.some((c) => c.path.includes('/matches'))).toBe(false);
  });
});
