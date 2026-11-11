import { screen, waitFor } from '@testing-library/react-native';
import { useLocalSearchParams } from 'expo-router';
import { kiran, renderWithApp } from '@/test/render';
import { business, matchesPage, routeTable } from '@/test/selling-fixtures';
import MapViewScreen, { offsetKm, ringsFor } from '.';

jest.mock('expo-router', () => require('@/test/expo-router-mock'));

describe('FA15c Matches · map', () => {
  it('opens on the map with the business in the middle and two rings', async () => {
    (useLocalSearchParams as jest.Mock).mockReturnValue({ businessId: 'biz-1' });
    const { route } = routeTable({
      '/screens/field-selling/businesses/biz-1': business,
      '/screens/field-selling/vacancies/vac-1/matches?page=1': matchesPage(1),
      'POST /vacancies/vac-1/introductions/in-person': { count: 3 },
    });
    await renderWithApp(<MapViewScreen />, { signedInAs: kiran, route });
    await waitFor(() => screen.getByTestId('matches-map'));
    expect(screen.getByText(/Rings: \d+ km · \d+ km/)).toBeTruthy();
    expect(screen.getByTestId('matches-map')).toHaveTextContent(/BAnnapoorna Mess/);
  });

  it('places candidates by their rough area, or by distance when the area is unknown', () => {
    const m = matchesPage(1).matches[0];
    const near = offsetKm({ latitude: 12.9166, longitude: 77.6101 }, m, 0);
    expect(Math.hypot(near.x, near.y)).toBeGreaterThan(0.5);
    const unknown = offsetKm({ latitude: null, longitude: null }, m, 1);
    expect(Math.round(Math.hypot(unknown.x, unknown.y))).toBe(2);
    expect(ringsFor(3.6)).toEqual([2, 4]);
    expect(ringsFor(0.4)).toEqual([1, 2]);
  });
});
