import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { kiran, renderWithApp } from '@/test/render';
import { hit, routeTable } from '@/test/selling-fixtures';
import JobSeekersScreen from '.';

jest.mock('expo-router', () => require('@/test/expo-router-mock'));
beforeEach(() => {
  jest.clearAllMocks();
  (useLocalSearchParams as jest.Mock).mockReturnValue({});
});

describe('FA15 Job seekers tab', () => {
  it('suggests registered businesses as he types two letters, and opens the matches of the one picked', async () => {
    const { route, calls } = routeTable({
      '/screens/field-selling/businesses': (_init: RequestInit, url: string) => ({
        status: 200,
        body: new URL(url).searchParams.get('q')
          ? { query: 'An', results: [hit(), hit({ id: 'biz-2', code: 'BZ-0144', name: 'Anand Bakery', openVacancies: 1 })] }
          : { query: '', results: [hit({ id: 'biz-9', code: 'BZ-0291', name: 'Lakshmi Tiffins', agreementSigned: false, openVacancies: 0 })] },
      }),
    });
    await renderWithApp(<JobSeekersScreen />, { signedInAs: kiran, route });
    await waitFor(() => screen.getByText('Lakshmi Tiffins'));
    expect(screen.getByText('Sign first')).toBeTruthy();
    expect(screen.getByText('Agreement not signed yet')).toBeTruthy();

    await fireEvent.changeText(screen.getByTestId('business-search'), 'A');
    await new Promise((r) => setTimeout(r, 300));
    expect(calls.some((c) => c.path.includes('q=A'))).toBe(false); // one letter: nothing yet

    await fireEvent.changeText(screen.getByTestId('business-search'), 'An');
    await waitFor(() => screen.getByTestId('business-BZ-0144'));
    expect(screen.getByTestId('business-BZ-0318')).toHaveTextContent(/Annapoorna Mess.*BZ-0318 · BTM Layout · signed today.*3 open/);
    await fireEvent.press(screen.getByTestId('business-BZ-0318'));
    expect(router.push).toHaveBeenCalledWith('/job-seekers/biz-1');
  });

  it('offers "Register this business" when the shop is not in the list', async () => {
    const { route } = routeTable({ '/screens/field-selling/businesses': { query: 'Zz', results: [] } });
    await renderWithApp(<JobSeekersScreen />, { signedInAs: kiran, route });
    await fireEvent.changeText(screen.getByTestId('business-search'), 'Zz');
    await waitFor(() => screen.getByTestId('business-search-register'));
    await fireEvent.press(screen.getByTestId('business-search-register'));
    expect(router.push).toHaveBeenCalledWith('/visit/start');
  });

  it("as the tab's anchor it ignores the params it inherits from a deep-linked screen above it, and shows the list", async () => {
    // expo-router hands the anchor the params of /job-seekers/biz-1?vacancyId=vac-1.
    (useLocalSearchParams as jest.Mock).mockReturnValue({ businessId: 'biz-1', vacancyId: 'vac-1' });
    const { route } = routeTable({ '/screens/field-selling/businesses': { query: '', results: [] } });
    await renderWithApp(<JobSeekersScreen />, { signedInAs: kiran, route });
    expect(screen.queryByTestId('redirect')).toBeNull();
    expect(screen.getByTestId('screen-FA15')).toBeTruthy();
    expect(router.push).not.toHaveBeenCalled();
    expect(router.replace).not.toHaveBeenCalled();
  });
});
