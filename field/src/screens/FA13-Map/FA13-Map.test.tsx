import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import { router } from '@/test/expo-router-mock';
import { kiran, renderWithApp } from '@/test/render';
import MapScreen from '.';

jest.mock('expo-router', () => require('@/test/expo-router-mock'));

const shop = (id: string, name: string, status: string, distanceMeters: number, businessId: string | null) => ({
  kind: businessId ? 'business' : 'prospect', id, businessId, visitId: businessId ? null : id, code: null, name, latitude: 12.912, longitude: 77.639, status, revisitOn: null, lastVisitAt: null, isMine: true, distanceMeters,
});

describe('FA13 Map', () => {
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
    expect(router.push).toHaveBeenCalledWith('/business/b-1');
  });
});
