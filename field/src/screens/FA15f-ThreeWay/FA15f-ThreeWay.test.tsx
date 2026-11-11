import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { kiran, renderWithApp } from '@/test/render';
import { interview, routeTable, settings } from '@/test/selling-fixtures';
import ThreeWayScreen from '.';

jest.mock('expo-router', () => require('@/test/expo-router-mock'));
beforeEach(() => {
  jest.clearAllMocks();
  (useLocalSearchParams as jest.Mock).mockReturnValue({ id: 'iv-1' });
});

describe('FA15f Owner on the phone', () => {
  it('Not selected: the owner gives the reason by OTP; no hit; back to the next candidate', async () => {
    const { route, calls } = routeTable({
      '/screens/field-selling/interviews/iv-1': interview(),
      '/screens/field-selling/settings': settings,
      'POST /field-selling/interviews/iv-1/owner-otp': { otpRequestId: 'otp-1', sentToLast4: '3310', contactName: 'Shankar' },
      'POST /field-selling/interviews/iv-1/decision': { interviewId: 'iv-1', decision: 'not_selected', placement: null },
    });
    await renderWithApp(<ThreeWayScreen />, { signedInAs: kiran, route });
    await waitFor(() => screen.getByTestId('owner-on-call'));
    expect(screen.getByText(/Kiran has handed his phone to Shankar\. This talk is the first interview\./)).toBeTruthy();
    await fireEvent.press(screen.getByTestId('decision-not_selected'));
    await fireEvent.press(screen.getByTestId('reason'));
    await fireEvent.press(screen.getByTestId('reason-option-experience'));
    await fireEvent.press(screen.getByTestId('not-selected-otp-send'));
    await waitFor(() => screen.getByTestId('not-selected-otp-sent'));
    expect(screen.getByText(/We sent an OTP to Shankar \(\*\*\*\*\*\*3310\)/)).toBeTruthy();
    await fireEvent.changeText(screen.getByTestId('not-selected-otp-code'), '714026');
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith('/job-seekers/biz-1?vacancyId=vac-1'));
    expect(calls).toContainEqual({ method: 'POST', path: '/field-selling/interviews/iv-1/owner-otp', body: { decision: 'not_selected', reason: 'experience' } });
    expect(calls).toContainEqual({
      method: 'POST', path: '/field-selling/interviews/iv-1/decision',
      body: { decision: 'not_selected', reason: 'experience', otpRequestId: 'otp-1', code: '714026' },
    });
  });

  it('Selected now and Wants to meet lead to FA15s and FA15g', async () => {
    const { route } = routeTable({ '/screens/field-selling/interviews/iv-1': interview(), '/screens/field-selling/settings': settings });
    await renderWithApp(<ThreeWayScreen />, { signedInAs: kiran, route });
    await waitFor(() => screen.getByTestId('decision-selected'));
    await fireEvent.press(screen.getByTestId('decision-selected'));
    await fireEvent.press(screen.getByTestId('go-selected'));
    expect(router.push).toHaveBeenCalledWith('/job-seekers/interview/iv-1/selected');
    await fireEvent.press(screen.getByTestId('decision-meet'));
    await fireEvent.press(screen.getByTestId('go-meet'));
    expect(router.push).toHaveBeenCalledWith('/job-seekers/book?vacancyId=vac-1&jobSeekerId=js-1&from=iv-1');
  });
});
