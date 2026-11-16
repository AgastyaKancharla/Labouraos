import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import { kiran, renderWithApp } from '@/test/render';
import { routeTable } from '@/test/selling-fixtures';
import CaptureSeekerScreen, { clearSeekerDraft } from '.';

jest.mock('expo-router', () => require('@/test/expo-router-mock'));
beforeEach(() => {
  jest.clearAllMocks();
  clearSeekerDraft();
});

const base = {
  '/screens/call-registration/options': { city: 'Bengaluru', areas: [{ name: 'BTM Layout 2nd Stage', pincode: '560076', latitude: 12.91, longitude: 77.61 }] },
  '/trades': [{ id: 't', name: 'Housekeeping', salaryMinPaise: 1600000, salaryMaxPaise: 2300000, minimumWageLevel: 'unskilled', legalMinimumPaise: 2340000 }],
};

describe('FA10 Send OTP: other records and empty answers (testing fixes, 16 Nov)', () => {
  it("a business's number says it is a business, and offers no job seeker page to open", async () => {
    const { route } = routeTable({ ...base, 'POST /otp/send': { alreadyRegistered: true, type: 'business', code: 'BZ-00031' } });
    await renderWithApp(<CaptureSeekerScreen />, { signedInAs: kiran, route });
    await fireEvent.changeText(screen.getByTestId('mobile'), '9845012345');
    await fireEvent.press(screen.getByTestId('mobile-otp-send'));
    await waitFor(() => screen.getByTestId('already-registered'));
    expect(screen.getByTestId('already-registered')).toHaveTextContent(/already registered as a business \(BZ-00031\)/);
    expect(screen.queryByText('Open it')).toBeNull();
  });

  it('an answer with neither requestId nor alreadyRegistered shows a clear error', async () => {
    const { route } = routeTable({ ...base, 'POST /otp/send': { success: true } });
    await renderWithApp(<CaptureSeekerScreen />, { signedInAs: kiran, route });
    await fireEvent.changeText(screen.getByTestId('mobile'), '9845012345');
    await fireEvent.press(screen.getByTestId('mobile-otp-send'));
    await waitFor(() => screen.getByText('The code was not sent: the server gave no answer. Try again.'));
    expect(screen.queryByTestId('mobile-otp-code')).toBeNull();
  });
});
