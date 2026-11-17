import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import { router } from '@/test/expo-router-mock';
import { kiran, renderWithApp } from '@/test/render';
import AllVisitsScreen from '.';

jest.mock('expo-router', () => require('@/test/expo-router-mock'));
beforeEach(() => jest.clearAllMocks());

const row = (id: string, title: string, at: string, extra: Record<string, unknown> = {}) => ({
  id, at, visitedAt: at, title, subtitle: 'Jayanagar', businessId: null, businessCode: null, purpose: 'shop_visit',
  status: 'not_interested', durationSeconds: 600, hasBoardPhoto: true, hasSelfie: false, ...extra,
});

describe('FA05c All visits', () => {
  it('lists my whole history newest first, searches, filters by dates and pages with Show more', async () => {
    const asked: string[] = [];
    await renderWithApp(<AllVisitsScreen />, {
      signedInAs: kiran,
      route: (url) => {
        if (!url.includes('/field-work/visits/all')) return undefined;
        const u = new URL(url);
        asked.push(u.search);
        if (u.searchParams.get('before') === 'c1') return { status: 200, body: { items: [row('v-3', 'Old Bakery', '2026-03-01T06:00:00Z')], nextBefore: null } };
        if (u.searchParams.get('q') === 'tiff') return { status: 200, body: { items: [row('v-2', 'Lakshmi Tiffins', '2026-11-08T06:00:00Z')], nextBefore: null } };
        return {
          status: 200,
          body: {
            items: [
              row('v-1', 'Green Leaf Café', '2026-11-09T05:10:00Z', { status: 'onboarded', businessCode: 'BZ-00291', businessId: 'b-1' }),
              row('v-2', 'Lakshmi Tiffins', '2026-11-08T06:00:00Z', { status: 'unfinished' }),
            ],
            nextBefore: 'c1',
          },
        };
      },
    });
    await waitFor(() => screen.getByTestId('all-visit-v-1'));
    expect(screen.getByTestId('all-visit-v-1')).toHaveTextContent(/Green Leaf Café.*Jayanagar · BZ-00291 · 10 min.*Onboarded/);
    expect(screen.getByTestId('all-visit-v-2')).toHaveTextContent(/Lakshmi Tiffins.*Not finished/);
    await fireEvent.press(screen.getByTestId('all-visits-more'));
    await waitFor(() => screen.getByTestId('all-visit-v-3'));
    expect(screen.queryByTestId('all-visits-more')).toBeNull();
    await fireEvent.press(screen.getByTestId('all-visit-v-3'));
    expect(router.push).toHaveBeenCalledWith('/visit/details/v-3');

    await fireEvent.changeText(screen.getByTestId('all-visits-search'), 'tiff');
    await waitFor(() => expect(asked.some((a) => a.includes('q=tiff'))).toBe(true));
    await waitFor(() => expect(screen.queryByTestId('all-visit-v-1')).toBeNull());
    expect(screen.getByTestId('all-visit-v-2')).toBeTruthy();
  });

  it('says so when nothing matches', async () => {
    await renderWithApp(<AllVisitsScreen />, {
      signedInAs: kiran,
      route: (url) => (url.includes('/field-work/visits/all') ? { status: 200, body: { items: [], nextBefore: null } } : undefined),
    });
    await waitFor(() => screen.getByText('No visits yet.'));
  });
});
