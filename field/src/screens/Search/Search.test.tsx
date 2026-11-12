import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import { router } from 'expo-router';
import { kiran, renderWithApp } from '@/test/render';
import { routeTable } from '@/test/selling-fixtures';
import { routes } from '@/navigation/routes';
import SearchScreen from '.';

jest.mock('expo-router', () => require('@/test/expo-router-mock'));
beforeEach(() => jest.clearAllMocks());

const result = {
  query: 'Ramesh',
  kind: 'name',
  counts: { all: 5, job_seeker: 2, business: 1, referral: 1, vacancy: 1, placement: 0 },
  results: [
    { type: 'job_seeker', id: 'js-1', code: 'JS-00198', name: 'Ramesh Gowda', maskedPhone: '******4412', status: 'active', trade: 'Electrician', locality: 'BTM Layout', openRef: 'JS-00198', extra: { paidAt: '2026-10-16T00:00:00Z' } },
    { type: 'job_seeker', id: 'js-2', code: 'JS-00311', name: 'Ramesh K', maskedPhone: '******9020', status: 'pending_activation', trade: 'Driver', locality: null, openRef: 'JS-00311', extra: { paidAt: null } },
    { type: 'business', id: 'b-1', code: 'BZ-00207', name: 'Ramesh Stores', maskedPhone: '******3310', status: 'verified', trade: 'retail', locality: 'Jayanagar', openRef: 'BZ-00207', extra: { openVacancies: 1 } },
    { type: 'referral', id: 'r-1', code: 'RF-00019', name: 'Ramesh Naik', maskedPhone: '******7781', status: 'individual', trade: 'auto driver', locality: null, openRef: 'RF-00019', extra: { referred: 3, joined: 1 } },
    { type: 'vacancy', id: 'v-1', code: 'VC-00412', name: 'Cook · Ramesh Darshini', maskedPhone: null, status: 'open', trade: 'Cook', locality: 'HSR Layout', openRef: 'BZ-00220', extra: { headcount: 2, businessCode: 'BZ-00220' } },
  ],
};

describe('Search (CA16 for the field app)', () => {
  it('searches as he types with the office search, shows masked phones and the counts, and opens each result in the app', async () => {
    const { route, calls } = routeTable({ '/search': result });
    await renderWithApp(<SearchScreen />, { signedInAs: kiran, route });
    expect(screen.getByText(/Type a name \(2 letters\)/)).toBeTruthy();
    await fireEvent.changeText(screen.getByTestId('search-input'), 'Ramesh');
    await waitFor(() => screen.getByTestId('search-results'));
    expect(calls.filter((c) => c.path.startsWith('/search')).map((c) => c.path)).toEqual(['/search?q=Ramesh']);
    expect(screen.getByTestId('search-row-JS-00198')).toHaveTextContent(/Ramesh Gowda.*Job seeker · JS-00198 · \*\*\*\*\*\*4412 · Electrician.*Active/);
    expect(screen.getByTestId('search-row-JS-00311')).toHaveTextContent(/Registration: payment pending/);
    expect(screen.getByTestId('search-row-BZ-00207')).toHaveTextContent(/Business · BZ-00207 · \*\*\*\*\*\*3310 · Jayanagar.*Verified · 1 open/);
    expect(screen.getByTestId('search-row-RF-00019')).toHaveTextContent(/Referral partner · RF-00019.*3 referred · 1 joined/);
    expect(screen.getByTestId('search-tab-all')).toHaveTextContent('All 5');
    expect(screen.getByTestId('search-tab-vacancy')).toHaveTextContent('Vacancies 1');
    expect(screen.queryByTestId('search-tab-placement')).toBeNull();
    // Never a full phone number on the screen.
    expect(screen.getByTestId('search-results')).not.toHaveTextContent(/\d{6,}/);

    await fireEvent.press(screen.getByTestId('search-row-JS-00198'));
    await fireEvent.press(screen.getByTestId('search-row-BZ-00207'));
    await fireEvent.press(screen.getByTestId('search-row-VC-00412'));
    await fireEvent.press(screen.getByTestId('search-row-RF-00019'));
    expect((router.push as jest.Mock).mock.calls.map((c) => c[0])).toEqual(['/job-seeker/js-1', '/business/b-1', '/business/BZ-00220']);
  });

  it('narrows to one kind with the chips', async () => {
    const { route, calls } = routeTable({ '/search': result });
    await renderWithApp(<SearchScreen />, { signedInAs: kiran, route });
    await fireEvent.changeText(screen.getByTestId('search-input'), 'Ramesh');
    await waitFor(() => screen.getByTestId('search-results'));
    await fireEvent.press(screen.getByTestId('search-tab-business'));
    await waitFor(() => expect(calls.some((c) => c.path === '/search?q=Ramesh&type=business')).toBe(true));
  });

  it('with no result offers to register a job seeker or a business (visit), and waits for 4 digits before searching a number', async () => {
    const { route, calls } = routeTable({ '/search': { query: '9020', kind: 'phone', counts: { all: 0, job_seeker: 0, business: 0, referral: 0, vacancy: 0, placement: 0 }, results: [] } });
    await renderWithApp(<SearchScreen />, { signedInAs: kiran, route });
    await fireEvent.changeText(screen.getByTestId('search-input'), '902');
    await fireEvent.press(screen.getByTestId('search-go'));
    expect(calls.filter((c) => c.path.startsWith('/search'))).toHaveLength(0);
    await fireEvent.changeText(screen.getByTestId('search-input'), '9020');
    await fireEvent.press(screen.getByTestId('search-go'));
    await waitFor(() => screen.getByTestId('search-none'));
    expect(screen.getByTestId('search-none')).toHaveTextContent('No one found for "9020".');
    expect(screen.getByTestId('search-register')).toHaveTextContent(/No one found\? Register them:/);
    await fireEvent.press(screen.getByTestId('search-register-seeker'));
    await fireEvent.press(screen.getByTestId('search-register-business'));
    expect((router.push as jest.Mock).mock.calls.map((c) => c[0])).toEqual([routes.jobSeekerNew, routes.visitStart]);
  });
});
