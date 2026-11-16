import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import { router } from '@/test/expo-router-mock';
import { kiran, renderWithApp } from '@/test/render';
import MapScreen from '.';

jest.mock('expo-router', () => require('@/test/expo-router-mock'));

const shop = (id: string, name: string, status: string, distanceMeters: number, businessId: string | null, canAct = true) => ({
  kind: businessId ? 'business' : 'prospect', id, businessId, visitId: businessId ? null : id, code: null, name, latitude: 12.912, longitude: 77.639, status, revisitOn: null, lastVisitAt: null, isMine: canAct, canAct, distanceMeters,
});

beforeEach(() => jest.clearAllMocks());

describe('FA13 Shops near me', () => {
  it('shows where he is with accuracy, shops by status, and revisits due first in "Near you"', async () => {
    const urls: string[] = [];
    await renderWithApp(<MapScreen />, {
      signedInAs: kiran,
      route: (url) => {
        urls.push(url);
        if (url.includes('/field-work/map'))
          return {
            status: 200,
            body: {
              me: { latitude: 12.9116, longitude: 77.6389 }, radiusMeters: 3000, duplicateRadiusMeters: 50,
              shops: [shop('b-1', 'Annapoorna Mess', 'onboarded', 900, 'b-1'), shop('v-2', 'Lakshmi Tiffins', 'revisit_due', 600, null)],
              revisitsDue: [],
            },
          };
        return undefined;
      },
    });
    await waitFor(() => expect(screen.getByTestId('fa13-me')).toHaveTextContent(/You are here · 12.91160, 77.63890/));
    expect(screen.getByText('accuracy 12 m')).toBeTruthy();
    expect(urls.find((u) => u.includes('/field-work/map'))).toMatch(/lat=12.9116&lng=77.6389/);
    await waitFor(() => screen.getByTestId('fa13-shop-v-2'));
    const near = screen.getByTestId('fa13-near');
    expect(near).toHaveTextContent(/Lakshmi Tiffins.*Revisit due · 600 m.*Visit →.*Annapoorna Mess.*Onboarded · 900 m.*Open →/);
    await fireEvent.press(screen.getByTestId('fa13-shop-v-2'));
    expect(router.push).toHaveBeenCalledWith({ pathname: '/visit/start', params: { revisitOf: 'v-2', name: 'Lakshmi Tiffins' } });
    await fireEvent.press(screen.getByTestId('fa13-shop-b-1'));
    expect(router.push).toHaveBeenCalledWith('/businesses/b-1');
  });

  it('markers open the shop too; another agent’s shop is view-only and his revisit cannot be started', async () => {
    await renderWithApp(<MapScreen />, {
      signedInAs: kiran,
      route: (url) =>
        url.includes('/field-work/map')
          ? {
              status: 200,
              body: {
                me: { latitude: 12.9116, longitude: 77.6389 }, radiusMeters: 3000, duplicateRadiusMeters: 50,
                shops: [shop('b-5', 'Sagar Hotel', 'onboarded', 300, 'b-5', false), shop('v-7', 'Ravi Stores', 'revisit_due', 200, null, false)],
                revisitsDue: [],
              },
            }
          : undefined,
    });
    await waitFor(() => screen.getByTestId('fa13-shop-v-7'));
    expect(screen.getByTestId('fa13-shop-b-5')).toHaveTextContent(/Sagar Hotel.*View only/);
    expect(screen.getByTestId('fa13-shop-v-7')).toHaveTextContent(/Ravi Stores.*View only/);
    await fireEvent.press(screen.getByTestId('fa13-shop-v-7'));
    expect(router.push).not.toHaveBeenCalled();
    // The map draws once it knows its width; the marker of a business opens its page (view-only there).
    await fireEvent(screen.getByTestId('fa13-map'), 'layout', { nativeEvent: { layout: { width: 358, height: 380, x: 0, y: 0 } } });
    await fireEvent.press(screen.getByTestId('marker-b-5'));
    expect(router.push).toHaveBeenCalledWith('/businesses/b-5');
    expect(screen.queryByTestId('marker-v-7')).toBeNull();
  });
});
