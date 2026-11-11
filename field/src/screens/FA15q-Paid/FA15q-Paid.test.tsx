import { screen, waitFor } from '@testing-library/react-native';
import { useLocalSearchParams } from 'expo-router';
import { kiran, renderWithApp } from '@/test/render';
import { placement, routeTable } from '@/test/selling-fixtures';
import PaidScreen from '.';

jest.mock('expo-router', () => require('@/test/expo-router-mock'));
beforeEach(() => (useLocalSearchParams as jest.Mock).mockReturnValue({ id: 'pl-1' }));

describe('FA15q Paid: details shared', () => {
  it('waits for the bank — nothing is shared before payment is confirmed', async () => {
    const { route } = routeTable({ '/screens/field-selling/placements/pl-1': placement() });
    await renderWithApp(<PaidScreen />, { signedInAs: kiran, route });
    await waitFor(() => screen.getByTestId('waiting-bank'));
    expect(screen.getByTestId('waiting-bank')).toHaveTextContent(/Waiting for the bank · ₹10,030.*screenshot is not proof/);
    expect(screen.getAllByText('After payment').length).toBe(4);
  });

  it('once the bank confirms: details shared, joining date told, invoice, joining calls; next role', async () => {
    const { route } = routeTable({
      '/screens/field-selling/placements/pl-1': placement({ status: 'confirmed', paidAt: '2026-11-11T07:01:00Z', paymentConfirmedAt: '2026-11-11T07:01:00Z', invoiceCode: 'INV-1' }),
    });
    await renderWithApp(<PaidScreen />, { signedInAs: kiran, route });
    await waitFor(() => screen.getByTestId('paid'));
    expect(screen.getByTestId('paid')).toHaveTextContent('Payment received · ₹10,030confirmed by the bank 12:31 PM');
    expect(screen.getByText('Manjunath’s full details shared with Shankar')).toBeTruthy();
    expect(screen.getByText('Manjunath told: joining Mon 16 Nov, address, contact')).toBeTruthy();
    expect(screen.getByTestId('next-role')).toHaveTextContent('Kitchen helper next');
  });
});
