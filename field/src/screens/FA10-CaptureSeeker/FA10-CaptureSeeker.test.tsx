import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import { router } from 'expo-router';
import { kiran, renderWithApp } from '@/test/render';
import { routeTable } from '@/test/selling-fixtures';
import CaptureSeekerScreen, { clearSeekerDraft } from '.';
import { createBody, EMPTY_FORM, hasDriverTrade, profileBody, validate, type JobSeekerForm } from './payload';

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
    expect(screen.getByTestId('consent-script')).toHaveTextContent(/This call is recorded/);
    expect(screen.queryByTestId('message-language')).toBeNull();
    expect(screen.queryByTestId('script-language')).toBeNull();
  });

  it('a number already registered shows "Already registered — open it" instead of a duplicate', async () => {
    const { route } = routeTable({ ...base, 'POST /otp/send': { alreadyRegistered: true, type: 'job_seeker', code: 'JS-01042' } });
    await renderWithApp(<CaptureSeekerScreen />, { signedInAs: kiran, route });
    await fireEvent.changeText(screen.getByTestId('mobile'), '9845012345');
    await fireEvent.press(screen.getByTestId('mobile-otp-send'));
    await waitFor(() => screen.getByTestId('already-registered'));
    await fireEvent.press(screen.getByText('Open it'));
    expect(router.push).toHaveBeenCalledWith('/job-seekers/JS-01042');
  });

  it('date of birth is typed as numbers with the dashes added; under 18 and impossible days are refused (21 Nov)', async () => {
    const { route } = routeTable(base);
    await renderWithApp(<CaptureSeekerScreen />, { signedInAs: kiran, route });
    const dob = screen.getByTestId('dob');
    await fireEvent.changeText(dob, '22092000');
    expect(screen.getByTestId('dob').props.value).toBe('22-09-2000');
    expect(screen.queryByTestId('dob-error')).toBeNull();
    await fireEvent.changeText(screen.getByTestId('dob'), '31-02-2000');
    expect(screen.getByTestId('dob-error')).toHaveTextContent(/not a real date/);
    await fireEvent.changeText(screen.getByTestId('dob'), '01012020');
    expect(screen.getByTestId('dob-error')).toHaveTextContent('Must be 18 or older.');
    // The calendar is still there as an option.
    expect(screen.getByTestId('dob-calendar')).toBeTruthy();
  });

  it('sets the pin from a typed address after confirming it on the map (21 Nov)', async () => {
    const { route, calls } = routeTable({
      ...base,
      'POST /maps-link/locate': { latitude: 12.9063, longitude: 77.5857, source: 'address', placeName: null, matched: '24th Main Road, JP Nagar, Bengaluru, 560078, India', address: { shopNumber: null, street: '24th Main Road', area: 'JP Nagar', city: 'Bengaluru', state: 'Karnataka', pincode: '560078', displayName: 'x' }, shortLink: false },
    });
    await renderWithApp(<CaptureSeekerScreen />, { signedInAs: kiran, route });
    expect(screen.getByTestId('pin')).toHaveTextContent(/No pin yet/);
    await fireEvent.changeText(screen.getByTestId('pin-finder-text'), '24th Main, JP Nagar');
    await fireEvent.press(screen.getByTestId('pin-finder-find'));
    await waitFor(() => screen.getByTestId('pin-finder-confirm'));
    expect(screen.getByTestId('pin-finder-matched')).toHaveTextContent('24th Main Road, JP Nagar, Bengaluru, 560078, India');
    expect(calls).toContainEqual({ method: 'POST', path: '/maps-link/locate', body: { text: '24th Main, JP Nagar' } });
    expect(screen.getByTestId('pin')).toHaveTextContent(/No pin yet/);
    await fireEvent.press(screen.getByTestId('pin-finder-use'));
    await waitFor(() => expect(screen.getByTestId('pin')).toHaveTextContent(/Pin set/));
    expect(screen.getByTestId('pincode').props.value).toBe('560078');
  });

  it('22 Nov: no "Has" ticks; the driving licence is asked only for a Driver trade', async () => {
    const { route } = routeTable(base);
    await renderWithApp(<CaptureSeekerScreen />, { signedInAs: kiran, route });
    expect(screen.queryByText('Own vehicle')).toBeNull();
    expect(screen.queryByText('Police verification')).toBeNull();
    expect(screen.queryByText('Smartphone')).toBeNull();
    expect(screen.queryByText('Driving licence')).toBeNull();
  });

  it('22 Nov: the licence is sent only for a driver; the ticks never', () => {
    const housekeeping = { ...EMPTY_FORM, trades: [{ trade: 'Housekeeping', other: '', years: '2' }], licence: 'lmv', ownVehicle: true, police: true, smartphone: true } as JobSeekerForm;
    expect(hasDriverTrade(housekeeping)).toBe(false);
    expect(profileBody(housekeeping)).not.toHaveProperty('drivingLicenceType');
    for (const key of ['ownVehicle', 'policeVerified', 'hasSmartphone']) expect(profileBody(housekeeping)).not.toHaveProperty(key);
    const driver = { ...housekeeping, trades: [{ trade: 'Housekeeping', other: '', years: '2' }, { trade: 'Driver', other: '', years: '4' }] };
    expect(hasDriverTrade(driver)).toBe(true);
    expect(profileBody(driver)).toMatchObject({ drivingLicenceType: 'lmv', reason: 'Filled on the registration form' });
    for (const key of ['ownVehicle', 'policeVerified', 'hasSmartphone']) expect(profileBody(driver)).not.toHaveProperty(key);
  });

  it('maps the form onto POST /job-seekers in paise (the call agent\'s payload)', () => {
    expect(validate(EMPTY_FORM)).toContain('name');
    const body = createBody({ ...EMPTY_FORM, name: ' Kavya Reddy ', mobile: '9845012345', minSalaryPaise: 1300000, trades: [{ trade: 'Housekeeping', other: '', years: '6-10' }] }, 'req-1');
    expect(body).toMatchObject({ name: 'Kavya Reddy', phone: '9845012345', otpRequestId: 'req-1', minSalary: 1300000, heardFrom: 'field_visit', trades: [{ trade: 'Housekeeping', yearsExperience: 6 }] });
  });
});
