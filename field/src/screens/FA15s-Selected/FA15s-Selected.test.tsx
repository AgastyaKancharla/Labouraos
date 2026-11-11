import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { todayKeyIst } from '@/components/form';
import { kiran, renderWithApp } from '@/test/render';
import { interview, routeTable, settings } from '@/test/selling-fixtures';
import SelectedScreen from '.';

jest.mock('expo-router', () => require('@/test/expo-router-mock'));
beforeEach(() => {
  jest.clearAllMocks();
  (useLocalSearchParams as jest.Mock).mockReturnValue({ id: 'iv-1' });
});

describe('FA15s Selected on the call', () => {
  it('the owner confirms salary and joining date by OTP; the fee is 50% + 18% GST from Settings', async () => {
    let decided = false;
    const { route, calls } = routeTable({
      '/screens/field-selling/interviews/iv-1': () => ({
        status: 200,
        body: decided
          ? interview({
            status: 'completed', result: 'selected', resultRecordedAt: '2026-11-11T06:56:00Z',
            placement: { id: 'pl-1', code: 'PL-1', status: 'awaiting_payment', agreedSalaryPaise: 1700000, feePaise: 850000, gstPaise: 153000, feePercent: 50, gstPercent: 18, paymentDueAt: null, paidAt: null, joiningDate: '2026-11-16T00:00:00.000Z', paymentStatus: 'pending' },
          })
          : interview(),
      }),
      '/screens/field-selling/settings': settings,
      'POST /field-selling/interviews/iv-1/owner-otp': { otpRequestId: 'otp-9', sentToLast4: '3310', contactName: 'Shankar' },
      'POST /field-selling/interviews/iv-1/decision': () => {
        decided = true;
        return { status: 201, body: { interviewId: 'iv-1', decision: 'selected', placement: { id: 'pl-1' } } };
      },
    });
    await renderWithApp(<SelectedScreen />, { signedInAs: kiran, route });
    await waitFor(() => screen.getByTestId('salary'));
    await fireEvent.changeText(screen.getByTestId('salary'), '17000');
    await waitFor(() => expect(screen.getByTestId('fee-total')).toHaveTextContent('Total₹10,030'));
    expect(screen.getByText('₹8,500')).toBeTruthy();
    expect(screen.getByText('₹1,530')).toBeTruthy();
    const today = todayKeyIst();
    await fireEvent.press(screen.getByTestId('joining'));
    await fireEvent.press(screen.getByTestId(`joining-day-${today}`));
    await fireEvent.press(screen.getByTestId('selected-otp-send'));
    await waitFor(() => screen.getByTestId('selected-otp-code'));
    await fireEvent.changeText(screen.getByTestId('selected-otp-code'), '123456');
    await waitFor(() => screen.getByTestId('confirmed-by-otp'));
    expect(calls).toContainEqual({
      method: 'POST', path: '/field-selling/interviews/iv-1/decision',
      body: { decision: 'selected', salaryPaise: 1700000, joiningDate: today, otpRequestId: 'otp-9', code: '123456' },
    });
    await fireEvent.press(screen.getByTestId('owner-paid'));
    expect(router.push).toHaveBeenCalledWith('/job-seekers/placement/pl-1');
  });
});
