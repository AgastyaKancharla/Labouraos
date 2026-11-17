import { act, fireEvent, renderHook, screen, waitFor } from '@testing-library/react-native';
import { useLocalSearchParams } from 'expo-router';
import { kiran, renderWithApp } from '@/test/render';
import { routeTable, seekerStatus } from '@/test/selling-fixtures';
import { setDraftOwner, useFormDraft, clearAllFormDrafts } from '@/lib/formDraft';
import CaptureSeekerScreen from '@/screens/FA10-CaptureSeeker';
import { EMPTY_FORM, type JobSeekerForm } from '@/screens/FA10-CaptureSeeker/payload';
import SeekerSaved from '@/screens/FA10b-SeekerSaved';
import MyJobSeekersScreen from '@/screens/FA10d-MyJobSeekers';

jest.mock('expo-router', () => require('@/test/expo-router-mock'));

/**
 * Fix list A1 (16 Nov): a job seeker saved on the phone was not in My job
 * seekers until the page was reloaded, because the save never marked the
 * ['field-work'] lists out of date. Here My job seekers is open (as in its
 * tab) while the agent saves; it must show the new person straight away.
 */
const row = (id: string, name: string, linkSentAt: string | null = null) => ({
  id, code: `JS-${id}`, name, phoneLast4: '2345', status: 'active', registeredAt: '2026-11-16T06:00:00Z', stage: linkSentAt ? 'link_sent' : 'registered',
  steps: { linkSentAt, consentGivenAt: null, paidAt: null, idCheckedAt: null, idCheckPending: false, interviews: 0, placed: false },
});

const filled: JobSeekerForm = {
  ...EMPTY_FORM,
  name: 'Kavya Reddy',
  mobile: '9845012345',
  dateOfBirth: '1996-04-12',
  gender: 'female',
  bestTime: 'morning',
  place: { area: 'BTM Layout 2nd Stage', pincode: '560076', latitude: 12.91, longitude: 77.61 },
  travelKm: '5',
  trades: [{ trade: 'Housekeeping', other: '', years: '1-2' }],
  lookingSince: 'this_month',
  minSalaryPaise: 1600000,
  maxSalaryPaise: 2000000,
  availableFrom: '2026-11-20',
  shift: 'day',
  jobType: 'full_time',
  spoken: ['kn'],
};

beforeEach(() => {
  jest.clearAllMocks();
  clearAllFormDrafts();
});

describe('a save in the redesign refreshes the lists that show it (A1)', () => {
  it('a job seeker saved on the form is in My job seekers at once, without a reload', async () => {
    // The form as the agent filled it (kept in his draft), so the test only checks the OTP and saves.
    setDraftOwner(kiran.id);
    const seed = await renderHook(() => useFormDraft<JobSeekerForm>('fa10', EMPTY_FORM));
    await act(async () => seed.result.current[1](filled));
    let saved = false;
    const { route } = routeTable({
      '/screens/call-registration/options': { city: 'Bengaluru', areas: [{ name: 'BTM Layout 2nd Stage', pincode: '560076', latitude: 12.91, longitude: 77.61 }] },
      '/trades': [{ id: 't', name: 'Housekeeping', salaryMinPaise: 1600000, salaryMaxPaise: 2300000, minimumWageLevel: 'unskilled', legalMinimumPaise: 2340000 }],
      'POST /otp/send': { requestId: 'req-1', resendAvailableAt: '', resendsLeft: 3 },
      'POST /otp/verify': { verified: true },
      'POST /job-seekers': () => {
        saved = true;
        return { status: 201, body: { id: 'js-new', code: 'JS-1099' } };
      },
      '/field-work/job-seekers': () => ({ status: 200, body: { query: '', results: saved ? [row('js-new', 'Kavya Reddy')] : [] } }),
    });
    await renderWithApp(
      <>
        <MyJobSeekersScreen />
        <CaptureSeekerScreen />
      </>,
      { signedInAs: kiran, route },
    );
    await waitFor(() => expect(screen.getByTestId('fa10d-list')).toHaveTextContent(/You have not registered a job seeker yet/));
    await fireEvent.press(screen.getByTestId('mobile-otp-send'));
    await waitFor(() => screen.getByTestId('mobile-otp-code'));
    await fireEvent.changeText(screen.getByTestId('mobile-otp-code'), '123456');
    await waitFor(() => screen.getByTestId('change-number'));
    await fireEvent.press(screen.getByTestId('save-seeker'));
    await waitFor(() => expect(saved).toBe(true));
    await waitFor(() => screen.getByTestId('fa10d-seeker-js-new'));
    expect(screen.getByTestId('fa10d-seeker-js-new')).toHaveTextContent(/Kavya Reddy/);
  });

  it('sending the registration link updates the job seeker’s row in My job seekers', async () => {
    (useLocalSearchParams as jest.Mock).mockReturnValue({ id: 'js-uuid' });
    let sent = false;
    const { route } = routeTable({
      '/screens/call-registration/job-seekers/js-uuid': () => ({ status: 200, body: seekerStatus(sent ? { registrationLinkExpiresAt: '2099-01-01T00:00:00Z' } : {}) }),
      'POST /consent/links': () => {
        sent = true;
        return { status: 201, body: { expiresAt: '2099-01-01T00:00:00Z' } };
      },
      '/field-work/job-seekers': () => ({ status: 200, body: { query: '', results: [row('js-uuid', 'Kavya Reddy', sent ? '2026-11-16T06:05:00Z' : null)] } }),
    });
    await renderWithApp(
      <>
        <MyJobSeekersScreen />
        <SeekerSaved />
      </>,
      { signedInAs: kiran, route },
    );
    await waitFor(() => screen.getByTestId('fa10d-seeker-js-uuid'));
    expect(screen.getByTestId('fa10d-seeker-js-uuid')).not.toHaveTextContent(/Link sent ✓/);
    await waitFor(() => screen.getByTestId('send-link'));
    await fireEvent.press(screen.getByTestId('send-link'));
    await waitFor(() => expect(screen.getByTestId('fa10d-seeker-js-uuid')).toHaveTextContent(/Link sent ✓/));
  });
});
