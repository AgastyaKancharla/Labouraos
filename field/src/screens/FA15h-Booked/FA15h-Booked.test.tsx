import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { kiran, renderWithApp } from '@/test/render';
import { interview, routeTable, settings } from '@/test/selling-fixtures';
import BookedScreen from '.';

jest.mock('expo-router', () => require('@/test/expo-router-mock'));

describe('FA15h Interview booked', () => {
  it('lists what happens next (messages sent, you attend, result by 8 PM, fee within 24 hours)', async () => {
    (useLocalSearchParams as jest.Mock).mockReturnValue({ id: 'iv-2' });
    const { route } = routeTable({
      '/screens/field-selling/interviews/iv-2': interview({ id: 'iv-2', status: 'offered', interviewType: 'at_shop', agentWillAttend: true, slotStartsAt: '2026-11-10T05:30:00Z', slotEndsAt: '2026-11-10T06:30:00Z' }),
      '/screens/field-selling/settings': settings,
    });
    await renderWithApp(<BookedScreen />, { signedInAs: kiran, route });
    await waitFor(() => screen.getByTestId('booked'));
    expect(screen.getByTestId('booked')).toHaveTextContent('Interview booked · Tue 10 Nov, 11:00 AM');
    expect(screen.getByText('Manjunath gets the address and time by SMS and WhatsApp')).toBeTruthy();
    expect(screen.getByText('You attend and mark “candidate arrived”')).toBeTruthy();
    await waitFor(() => screen.getByText('Owner records the result by 8:00 PM (OTP)'));
    expect(screen.getByText('Selected → owner pays fee + GST within 24 hours')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('book-another'));
    expect(router.replace).toHaveBeenCalledWith('/job-seekers/biz-1?vacancyId=vac-1');
  });
});
