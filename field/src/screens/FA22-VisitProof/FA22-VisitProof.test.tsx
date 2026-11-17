import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import { router, searchParams } from '@/test/expo-router-mock';
import { OfflineQueue } from '@/device/offline-queue/queue';
import { createMemoryQueueStore } from '@/device/offline-queue/types';
import { kiran, renderWithApp } from '@/test/render';
import { setFakeStamp } from '@/test/visit-fakes';
import { saveDraft } from '../_visits/visitDraft';
import VisitProofScreen from '.';

jest.mock('expo-router', () => require('@/test/expo-router-mock'));
jest.mock('@/device/camera', () => require('@/test/visit-fakes').cameraModule());

beforeEach(() => {
  jest.clearAllMocks();
  setFakeStamp(null);
  saveDraft({
    id: 'p-1', startedAt: '2026-11-09T05:58:00.000Z', latitude: 12.9116, longitude: 77.6101, accuracy: 8, shopName: 'Sri Krishna Hotel',
    businessId: null, businessName: null, spokeTo: 'owner', contactPhone: '', endedAt: '2026-11-09T06:12:00.000Z', proofDistance: null, proofAt: null,
  });
  searchParams.current = { id: 'p-1' };
});

describe('FA22 Visit a shop · proof', () => {
  it('a selfie at the same spot is sent and opens registration; time at the shop is shown', async () => {
    const sent: { path: string; files: unknown[] }[] = [];
    const queue = new OfflineQueue({ store: createMemoryQueueStore(), send: async (item) => void sent.push(item.request as never) });
    await renderWithApp(<VisitProofScreen />, { signedInAs: kiran, queue });
    expect(screen.getByTestId('fa22-time')).toHaveTextContent(/14 min/);
    expect(screen.getByTestId('fa22-continue').props.accessibilityState.disabled).toBe(true);
    setFakeStamp({ latitude: 12.91165 });
    await fireEvent.press(screen.getByTestId('fa22-take-selfie'));
    await fireEvent.press(screen.getByTestId('fake-camera-front'));
    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]).toMatchObject({ path: '/field-visits/p-1/proof', files: [{ field: 'photo', name: 'selfie.jpg' }] });
    expect(screen.getByTestId('fa22-distance')).toHaveTextContent(/Same spot · 6 m/);
    await fireEvent.press(screen.getByTestId('fa22-continue'));
    expect(router.push).toHaveBeenCalledWith({ pathname: '/visit/business', params: { visitId: 'p-1' } });
    expect(screen.getByTestId('step-counter')).toHaveTextContent('Step 3 of 7 · selfie with the board');
  });

  it('a selfie away from the shop is not sent', async () => {
    const send = jest.fn(async () => ({}));
    await renderWithApp(<VisitProofScreen />, { signedInAs: kiran, queue: new OfflineQueue({ store: createMemoryQueueStore(), send }) });
    setFakeStamp({ latitude: 12.93 });
    await fireEvent.press(screen.getByTestId('fa22-take-selfie'));
    await fireEvent.press(screen.getByTestId('fake-camera-front'));
    await waitFor(() => screen.getByTestId('fa22-problem'));
    expect(screen.getByTestId('fa22-problem')).toHaveTextContent(/Go back to the shop/);
    expect(send).not.toHaveBeenCalled();
    expect(screen.getByTestId('fa22-continue').props.accessibilityState.disabled).toBe(true);
  });

  it('a revisit of a shop already in Laboura skips the business form and opens its visit details for the next step', async () => {
    saveDraft({
      id: 'p-2', startedAt: '2026-11-09T05:58:00.000Z', latitude: 12.9116, longitude: 77.6101, accuracy: 8, shopName: 'Annapoorna Mess',
      businessId: 'b-1', businessName: 'Annapoorna Mess', spokeTo: 'owner', contactPhone: '', endedAt: '2026-11-09T06:12:00.000Z', proofDistance: null, proofAt: null,
    });
    searchParams.current = { id: 'p-2' };
    const queue = new OfflineQueue({ store: createMemoryQueueStore(), send: async () => ({}) });
    await renderWithApp(<VisitProofScreen />, { signedInAs: kiran, queue });
    setFakeStamp({ latitude: 12.91165 });
    await fireEvent.press(screen.getByTestId('fa22-take-selfie'));
    await fireEvent.press(screen.getByTestId('fake-camera-front'));
    await waitFor(() => expect(screen.getByTestId('fa22-continue').props.accessibilityState.disabled).toBe(false));
    // Revisit wording and its own four steps, never "register the business" or "of 7" (A8).
    expect(screen.getByTestId('step-counter')).toHaveTextContent('Step 3 of 4 · selfie with the board');
    expect(screen.getByTestId('fa22-continue')).toHaveTextContent('Continue to save the visit');
    expect(screen.queryByText(/register the business/)).toBeNull();
    expect(screen.getByText(/already in Laboura, so it is not registered again/)).toBeTruthy();
    await fireEvent.press(screen.getByTestId('fa22-continue'));
    expect(router.push).toHaveBeenCalledWith('/visit/details/p-2');
  });

  it('the revisit wording is in Kannada too', async () => {
    saveDraft({
      id: 'p-3', startedAt: '2026-11-09T05:58:00.000Z', latitude: 12.9116, longitude: 77.6101, accuracy: 8, shopName: 'Annapoorna Mess',
      businessId: 'b-1', businessName: 'Annapoorna Mess', spokeTo: 'owner', contactPhone: '', endedAt: '2026-11-09T06:12:00.000Z', proofDistance: null, proofAt: null,
    });
    searchParams.current = { id: 'p-3' };
    await renderWithApp(<VisitProofScreen />, { signedInAs: kiran });
    expect(screen.getByTestId('step-counter')).toHaveTextContent(/3.*4/);
    expect(screen.getByTestId('fa22-continue')).toHaveTextContent('Continue to save the visit');
  });
});
