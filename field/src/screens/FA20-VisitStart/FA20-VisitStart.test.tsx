import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import { router, searchParams } from '@/test/expo-router-mock';
import { OfflineQueue } from '@/device/offline-queue/queue';
import { createMemoryQueueStore } from '@/device/offline-queue/types';
import { networkError } from '@/api/errors';
import { kiran, renderWithApp } from '@/test/render';
import { getDraft } from '../_visits/visitDraft';
import VisitStartScreen from '.';

jest.mock('expo-router', () => require('@/test/expo-router-mock'));
jest.mock('@/device/camera', () => require('@/test/visit-fakes').cameraModule());

const nearby = {
  me: { latitude: 12.9116, longitude: 77.6389 },
  radiusMeters: 150,
  duplicateRadiusMeters: 50,
  shops: [
    { kind: 'prospect', id: 'v-0', businessId: null, visitId: 'v-0', code: null, name: 'Lakshmi Tiffins', latitude: 12.9117, longitude: 77.6389, status: 'revisit_due', revisitOn: '2026-11-09', lastVisitAt: null, isMine: true, distanceMeters: 40 },
  ],
  revisitsDue: [],
};

beforeEach(() => {
  jest.clearAllMocks();
  searchParams.current = {};
});

describe('FA20 Visit a shop · photo', () => {
  it('reads GPS, offers the nearby shop as a revisit, and sends the live board photo with a phone-made visit id', async () => {
    const sent: { fields: Record<string, string>; files: unknown[]; path: string; key: string }[] = [];
    const queue = new OfflineQueue({
      store: createMemoryQueueStore(),
      send: async (item) => {
        sent.push({ fields: item.request.fields!, files: item.request.files!, path: item.request.path, key: item.id });
        return {};
      },
    });
    await renderWithApp(<VisitStartScreen />, {
      signedInAs: kiran,
      queue,
      route: (url) => (url.includes('/field-work/map') ? { status: 200, body: nearby } : undefined),
    });
    await waitFor(() => expect(screen.getByTestId('fa20-gps')).toHaveTextContent(/GPS found you · 12.91160, 77.63890/));
    await waitFor(() => screen.getByTestId('fa20-nearby'));
    expect(screen.getByTestId('fa20-nearby')).toHaveTextContent(/Nearby already in Laboura: Lakshmi Tiffins \(40 m, Revisit due\)/);
    await fireEvent.press(screen.getByTestId('fa20-same-shop'));
    await fireEvent.press(screen.getByTestId('fa20-take-photo'));
    await fireEvent.press(screen.getByTestId('fake-camera-back'));
    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0].path).toBe('/field-visits');
    expect(sent[0].fields).toMatchObject({ source: 'live_camera', latitude: '12.9116', longitude: '77.6101', accuracy: '8', revisitOfVisitId: 'v-0' });
    expect(sent[0].fields.id).toMatch(/^uuid-/);
    expect(sent[0].files).toEqual([{ field: 'photo', name: 'shop.jpg', type: 'image/jpeg', uri: 'file:///back.jpg' }]);
    expect(router.replace).toHaveBeenCalledWith({ pathname: '/visit/talk', params: { id: sent[0].fields.id } });
    expect(getDraft(sent[0].fields.id)).toMatchObject({ shopName: 'Lakshmi Tiffins', startedAt: '2026-11-09T06:12:00.000Z' });
  });

  it('keeps going without signal: the photo waits on the phone', async () => {
    const queue = new OfflineQueue({ store: createMemoryQueueStore(), send: async () => Promise.reject(networkError()) });
    await renderWithApp(<VisitStartScreen />, { signedInAs: kiran, queue });
    await fireEvent.press(screen.getByTestId('fa20-take-photo'));
    await fireEvent.press(screen.getByTestId('fake-camera-back'));
    await waitFor(() => expect(router.replace).toHaveBeenCalled());
    expect(queue.list()).toHaveLength(1);
  });

  it('shows the server refusing a photo used before', async () => {
    await renderWithApp(<VisitStartScreen />, {
      signedInAs: kiran,
      queue: new OfflineQueue({
        store: createMemoryQueueStore(),
        send: async () => {
          const { apiErrorFromBody } = jest.requireActual('@/api/errors');
          throw apiErrorFromBody(409, { message: 'This photo was already used. Take a new photo with the app camera.' });
        },
      }),
    });
    await fireEvent.press(screen.getByTestId('fa20-take-photo'));
    await fireEvent.press(screen.getByTestId('fake-camera-back'));
    await waitFor(() => screen.getByTestId('fa20-error'));
    expect(screen.getByTestId('fa20-error')).toHaveTextContent(/already used/);
    expect(router.replace).not.toHaveBeenCalled();
  });
});
