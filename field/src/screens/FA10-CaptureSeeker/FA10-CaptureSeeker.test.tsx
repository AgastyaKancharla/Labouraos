import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import { router } from 'expo-router';
import { kiran, renderWithApp } from '@/test/render';
import { routeTable } from '@/test/selling-fixtures';
import CaptureSeekerScreen, { clearSeekerDraft } from '.';
import { createBody, EMPTY_FORM, validate } from './payload';

jest.mock('expo-router', () => require('@/test/expo-router-mock'));
beforeEach(() => {
  jest.clearAllMocks();
  clearSeekerDraft();
});

const base = {
  '/screens/call-registration/options': { city: 'Bengaluru', areas: [{ name: 'BTM Layout 2nd Stage', pincode: '560076', latitude: 12.91, longitude: 77.61 }] },
  '/trades': [{ id: 't', name: 'Housekeeping', salaryMinPaise: 1600000, salaryMaxPaise: 2300000, minimumWageLevel: 'unskilled', legalMinimumPaise: 2340000 }],
};

describe('FA10 Register a job seeker', () => {
  it('saving needs the mobile checked by OTP first (same rules as the call agent\'s form)', async () => {
    const { route, calls } = routeTable({
      ...base,
      'POST /otp/send': { requestId: 'req-1', resendAvailableAt: '', resendsLeft: 3 },
      'POST /otp/verify': { verified: true },
    });
    await renderWithApp(<CaptureSeekerScreen />, { signedInAs: kiran, route });
    expect(screen.getByTestId('save-seeker')).toBeDisabled();
    expect(screen.getByText('Check the mobile number by OTP first.')).toBeTruthy();
    await fireEvent.changeText(screen.getByTestId('mobile'), '9845012345');
    await fireEvent.press(screen.getByTestId('mobile-otp-send'));
    await waitFor(() => screen.getByTestId('mobile-otp-code'));
    await fireEvent.changeText(screen.getByTestId('mobile-otp-code'), '123456');
    await waitFor(() => screen.getByTestId('change-number'));
    expect(calls).toContainEqual({ method: 'POST', path: '/otp/send', body: { phone: '9845012345', purpose: 'job_seeker' } });
    expect(screen.getByTestId('save-seeker')).not.toBeDisabled();
    await fireEvent.press(screen.getByTestId('save-seeker'));
    await waitFor(() => screen.getByTestId('form-errors'));
    expect(calls.some((c) => c.path === '/job-seekers')).toBe(false);
    expect(screen.getByTestId('consent-script')).toHaveTextContent(/ಈ ಕರೆ ರೆಕಾರ್ಡ್ ಆಗುತ್ತಿದೆ/);
  });

  it('a number already registered shows "Already registered — open it" instead of a duplicate', async () => {
    const { route } = routeTable({ ...base, 'POST /otp/send': { alreadyRegistered: true, type: 'job_seeker', code: 'JS-01042' } });
    await renderWithApp(<CaptureSeekerScreen />, { signedInAs: kiran, route });
    await fireEvent.changeText(screen.getByTestId('mobile'), '9845012345');
    await fireEvent.press(screen.getByTestId('mobile-otp-send'));
    await waitFor(() => screen.getByTestId('already-registered'));
    await fireEvent.press(screen.getByText('Open it'));
    expect(router.push).toHaveBeenCalledWith('/job-seeker/JS-01042');
  });

  it('maps the form onto POST /job-seekers in paise (the call agent\'s payload)', () => {
    expect(validate(EMPTY_FORM)).toContain('name');
    const body = createBody({ ...EMPTY_FORM, name: ' Kavya Reddy ', mobile: '9845012345', minSalaryPaise: 1300000, trades: [{ trade: 'Housekeeping', other: '', years: '6-10' }] }, 'req-1');
    expect(body).toMatchObject({ name: 'Kavya Reddy', phone: '9845012345', otpRequestId: 'req-1', minSalary: 1300000, heardFrom: 'field_visit', trades: [{ trade: 'Housekeeping', yearsExperience: 6 }] });
  });
});
