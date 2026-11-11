import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import { useLocalSearchParams } from 'expo-router';
import { kiran, renderWithApp } from '@/test/render';
import { interview, routeTable, settings } from '@/test/selling-fixtures';
import InterviewDayScreen from '.';

jest.mock('expo-router', () => require('@/test/expo-router-mock'));

describe('FA16 Interview day', () => {
  it('shows the GPS distance from the shop and marks "candidate arrived" with GPS', async () => {
    (useLocalSearchParams as jest.Mock).mockReturnValue({ id: 'iv-3' });
    const future = new Date(Date.now() + 3600_000).toISOString();
    const { route, calls } = routeTable({
      '/screens/field-selling/interviews/iv-3': interview({ id: 'iv-3', interviewType: 'at_shop', firstWithBusiness: true, slotEndsAt: future }),
      '/screens/field-selling/settings': settings,
      'POST /field-selling/interviews/iv-3/arrival': { interviewId: 'iv-3', arrivedAt: '2026-11-11T05:24:00Z', distanceM: 0 },
    });
    await renderWithApp(<InterviewDayScreen />, { signedInAs: kiran, route });
    await waitFor(() => expect(screen.getByTestId('gps')).toHaveTextContent(/You are at the shopGPS · 0 m/));
    expect(screen.getByText(/first interview with this business/)).toBeTruthy();
    await fireEvent.press(screen.getByTestId('came-no_show'));
    expect(screen.getByTestId('save')).toBeDisabled(); // only after the interview time is over
    await fireEvent.press(screen.getByTestId('came-arrived'));
    await fireEvent.press(screen.getByTestId('save'));
    await waitFor(() => expect(calls).toContainEqual({
      method: 'POST', path: '/field-selling/interviews/iv-3/arrival',
      body: { arrived: true, latitude: 12.9116, longitude: 77.6389, accuracyM: 12 },
    }));
  });
});
