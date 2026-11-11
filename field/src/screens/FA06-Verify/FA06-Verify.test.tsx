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

describe('FA06 Verification visit', () => {
  it('GPS against the pin, live photo + selfie queued, owner OTP and agreement live, then completes', async () => {
    searchParams.current = { businessId: 'b-1', assignmentId: 'a-1' };
    const queued: { path: string; fields: Record<string, string> }[] = [];
    const live: { url: string; body: unknown }[] = [];
    const queue = new OfflineQueue({ store: createMemoryQueueStore(), send: async (item) => void queued.push(item.request as never) });
    await renderWithApp(<VerifyScreen />, {
      signedInAs: kiran,
      queue,
      route: (url, init) => {
        if (url.endsWith('/field-work/businesses/b-1')) return { status: 200, body: business };
        if (url.endsWith('/visit-assignments/a-1/owner-otp')) return { status: 201, body: { success: true, requestId: 'otp-1', phone: '******4321' } };
        if (url.endsWith('/agreement-links')) return { status: 201, body: {} };
        if (url.includes('/verify')) {
          live.push({ url, body: JSON.parse(String(init.body)) });
          return { status: 201, body: { businessVerificationStatus: 'pending_tl_check' } };
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
    await fireEvent.press(screen.getByTestId('fa06-agreement'));
    await waitFor(() => screen.getByText('Link sent'));
    await fireEvent.press(screen.getByTestId('fa06-complete'));
    await waitFor(() => expect(live).toHaveLength(1));
    expect(live[0]).toEqual({ url: `https://api.test/field-visits/${queued[0].fields.id}/verify`, body: { ownerOtpRequestId: 'otp-1', ownerOtpCode: '391108' } });
    expect(router.replace).toHaveBeenCalledWith({ pathname: '/visit/done', params: { businessId: 'b-1', visitId: queued[0].fields.id } });
  });
});
