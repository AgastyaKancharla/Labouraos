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
    expect(router.push).toHaveBeenCalledWith({ pathname: '/business/new', params: { visitId: 'p-1' } });
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
});
