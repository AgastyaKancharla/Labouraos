import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import { router, searchParams } from '@/test/expo-router-mock';
import { OfflineQueue } from '@/device/offline-queue/queue';
import { createMemoryQueueStore } from '@/device/offline-queue/types';
import { kiran, renderWithApp } from '@/test/render';
import VerifyScreen from '.';

jest.mock('expo-router', () => require('@/test/expo-router-mock'));
jest.mock('@/device/camera', () => require('@/test/visit-fakes').cameraModule());

const business = {
  id: 'b-1', code: 'BZ-00310', name: 'Annapoorna Mess', businessType: 'restaurant_hotel', locality: 'BTM', latitude: 12.9119, longitude: 77.6389,
  verificationStatus: 'pending_visit', documentsStatus: 'documented', paused: false, inPersonOnboardedAt: null, canShowCandidates: false, isMine: false,
  agreement: null, contact: null, branches: [], vacancies: [], stats: { candidatesShown: 0, interviews: 0, placements: 0, inGuarantee: 0 }, visits: [],
};

beforeEach(() => jest.clearAllMocks());

/** Walks the whole verification visit; the server answers /verify with `verified` and /agreement-links with `agreementLink`. */
async function walk(verified: object, biz: object = business, agreementLink: { status: number; body?: unknown } = { status: 201, body: {} }) {
  searchParams.current = { businessId: 'b-1', assignmentId: 'a-1' };
  const queued: { path: string; fields: Record<string, string> }[] = [];
  const live: { url: string; body: unknown }[] = [];
  const queue = new OfflineQueue({ store: createMemoryQueueStore(), send: async (item) => void queued.push(item.request as never) });
  await renderWithApp(<VerifyScreen />, {
    signedInAs: kiran,
    queue,
    route: (url, init) => {
      if (url.endsWith('/field-work/businesses/b-1')) return { status: 200, body: biz };
      if (url.endsWith('/visit-assignments/a-1/owner-otp')) return { status: 201, body: { success: true, requestId: 'otp-1', phone: '******4321' } };
      if (url.endsWith('/agreement-links')) return agreementLink;
      if (url.includes('/verify')) {
        live.push({ url, body: JSON.parse(String(init.body)) });
        return { status: 201, body: verified };
      }
      return undefined;
    },
  });
  await waitFor(() => expect(screen.getByTestId('fa06-from-pin')).toHaveTextContent(/33 m from the map pin/));
  expect(screen.getByTestId('fa06-complete').props.accessibilityState.disabled).toBe(true);
  await fireEvent.press(screen.getByTestId('fa06-board'));
  await fireEvent.press(screen.getByTestId('fake-camera-back'));
  await waitFor(() => expect(queued).toHaveLength(1));
  expect(queued[0].fields).toMatchObject({ businessId: 'b-1', assignmentId: 'a-1', source: 'live_camera' });
  await fireEvent.press(screen.getByTestId('fa06-selfie'));
  await fireEvent.press(screen.getByTestId('fake-camera-front'));
  await waitFor(() => expect(queued).toHaveLength(2));
  expect(queued[1].path).toBe(`/field-visits/${queued[0].fields.id}/proof`);
  await fireEvent.press(screen.getByTestId('fa06-send-code'));
  await waitFor(() => screen.getByText(/We just sent an OTP to the owner \(\*{6}4321\)/));
  await fireEvent.changeText(screen.getByTestId('fa06-code'), '391108');
  return { queued, live };
}

async function complete(live: unknown[]) {
  await fireEvent.press(screen.getByTestId('fa06-complete'));
  await waitFor(() => expect(live).toHaveLength(1));
}

describe('FA06 Verification visit', () => {
  it('GPS against the pin, live photo + selfie queued, owner OTP and agreement live, then completes', async () => {
    const { queued, live } = await walk({ businessVerificationStatus: 'pending_tl_check' });
    await fireEvent.press(screen.getByTestId('fa06-agreement'));
    await waitFor(() => screen.getByText('Link sent'));
    await complete(live);
    expect(live[0]).toEqual({ url: `https://api.test/field-visits/${queued[0].fields.id}/verify`, body: { ownerOtpRequestId: 'otp-1', ownerOtpCode: '391108' } });
    expect(router.replace).toHaveBeenCalledWith({ pathname: '/visit/done', params: { businessId: 'b-1', visitId: queued[0].fields.id } });
  });

  it('became the account agent with this visit: goes on to the agreement step, which says so', async () => {
    const { queued, live } = await walk({ businessVerificationStatus: 'pending_tl_check', isAccountAgent: true, becameAccountAgent: true });
    await complete(live);
    expect(router.replace).toHaveBeenCalledWith({ pathname: '/visit/agreement', params: { businessId: 'b-1', visitId: queued[0].fields.id, accountAgent: 'new' } });
  });

  it('already the account agent, agreement signed: the finish step, without "You are now its account agent"', async () => {
    const { queued, live } = await walk(
      { businessVerificationStatus: 'pending_tl_check', isAccountAgent: true, becameAccountAgent: false },
      { ...business, isMine: true, agreement: { signedAt: '2026-11-15T10:40:00Z', signedName: 'Manjunath' } },
    );
    await complete(live);
    expect(router.replace).toHaveBeenCalledWith({ pathname: '/visit/done', params: { businessId: 'b-1', visitId: queued[0].fields.id } });
  });

  it('an agreement SMS the server could not send (502, details.code) shows a translated sentence', async () => {
    await walk({}, business, { status: 502, body: { statusCode: 502, message: 'Bad Gateway: vendor said no', details: { code: 'AGREEMENT_SMS_FAILED' } } });
    await fireEvent.press(screen.getByTestId('fa06-agreement'));
    await waitFor(() => screen.getByText('The SMS could not be sent. Try again.'));
    expect(screen.queryByText(/vendor said no/)).toBeNull();
  });
});

describe('FA06 fixes of 21 Nov', () => {
  const job = {
    assignmentId: 'a-1', purpose: 'business_signup', requestedFor: null,
    business: { id: 'b-1', code: 'BZ-00310', name: 'Annapoorna Mess', address: '4th Main, BTM', locality: 'BTM', ownerName: 'Manjunath', contactName: null, phoneLast4: '4321', latitude: 12.915, longitude: 77.6389 },
    lastAttempt: null, unfinishedVisitId: 'v-old',
  };

  it('shows the job card, resumes a started visit (photos not asked again) and moves a wrong pin with a reason', async () => {
    searchParams.current = { businessId: 'b-1', assignmentId: 'a-1', visitId: 'v-old' };
    const pins: unknown[] = [];
    await renderWithApp(<VerifyScreen />, {
      signedInAs: kiran,
      route: (url, init) => {
        if (url.endsWith('/field-work/businesses/b-1')) return { status: 200, body: { ...business, latitude: 12.915 } };
        if (url.endsWith('/field-work/verification-visits')) return { status: 200, body: [job] };
        if (url.endsWith('/field-visits/v-old')) return { status: 200, body: { id: 'v-old', hasBoardPhoto: true, hasSelfie: false } };
        if (url.endsWith('/field-work/verification-visits/a-1/pin')) {
          pins.push(JSON.parse(String(init.body)));
          return { status: 201, body: { businessId: 'b-1', latitude: 12.9116, longitude: 77.6389, movedMeters: 378 } };
        }
        return undefined;
      },
    });
    await waitFor(() => screen.getByTestId('fa06-job'));
    expect(screen.getByTestId('job-owner')).toHaveTextContent('Owner: Manjunath');
    // The shop photo of the started visit is done; the selfie is next.
    await waitFor(() => expect(screen.getByTestId('fa06-board').props.accessibilityState.disabled).toBe(true));
    expect(screen.getByTestId('fa06-selfie').props.accessibilityState.disabled).toBe(false);
    // GPS far from the pin: Try again, and "Update the pin" with a reason.
    await waitFor(() => screen.getByTestId('fa06-update-pin'));
    await fireEvent.press(screen.getByTestId('fa06-update-pin'));
    expect(screen.getByTestId('fa06-pin-save').props.accessibilityState.disabled).toBe(true);
    await fireEvent.changeText(screen.getByTestId('fa06-pin-reason'), 'Pin was on the next street');
    await fireEvent.press(screen.getByTestId('fa06-pin-save'));
    await waitFor(() => screen.getByTestId('fa06-pin-moved'));
    expect(screen.getByTestId('fa06-pin-moved')).toHaveTextContent('Pin moved here (378 m).');
    expect(pins).toEqual([{ latitude: 12.9116, longitude: 77.6389, accuracy: 12, reason: 'Pin was on the next street' }]);
  });

  it('the agreement is one button and turns Signed live when the owner signs on his phone', async () => {
    searchParams.current = { businessId: 'b-1', assignmentId: 'a-1' };
    let signed = false;
    await renderWithApp(<VerifyScreen />, {
      signedInAs: kiran,
      route: (url) => {
        if (url.endsWith('/field-work/businesses/b-1')) return { status: 200, body: business };
        if (url.endsWith('/field-work/verification-visits')) return { status: 200, body: [] };
        if (url.endsWith('/agreement-links')) return { status: 201, body: { smsSent: true } };
        if (url.endsWith('/field-work/businesses/b-1/agreement')) return { status: 200, body: { businessId: 'b-1', state: signed ? 'signed' : 'link_sent' } };
        return undefined;
      },
    });
    await waitFor(() => screen.getByTestId('fa06-agreement'));
    await fireEvent.press(screen.getByTestId('fa06-agreement'));
    await waitFor(() => screen.getByText('Link sent'));
    expect(screen.queryByTestId('fa06-agreement')).toBeNull();
    signed = true;
    await waitFor(() => screen.getByText('Signed'), { timeout: 15000 });
  }, 30000);
});
