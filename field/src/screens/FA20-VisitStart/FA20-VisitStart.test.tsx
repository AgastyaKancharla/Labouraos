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
    // 22 Nov (rev 207): the area in words (offline here: the accuracy and "area shown when online"), never coordinates.
    await waitFor(() => expect(screen.getByTestId('fa20-gps')).toHaveTextContent(/GPS found you.*area shown when online/));
    expect(screen.getByTestId('fa20-gps')).not.toHaveTextContent(/12.91160/);
    await waitFor(() => screen.getByTestId('fa20-nearby'));
    expect(screen.getByTestId('fa20-nearby')).toHaveTextContent(/Nearby already in Laboura: Lakshmi Tiffins \(40 m, Revisit due\)/);
    await fireEvent.press(screen.getByTestId('fa20-same-shop'));
    await fireEvent.press(screen.getByTestId('fa20-take-photo'));
    await fireEvent.press(screen.getByTestId('fake-camera-back'));
    await fireEvent.press(screen.getByTestId('fa20-preview-continue'));
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
    await fireEvent.press(screen.getByTestId('fa20-preview-continue'));
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
    await fireEvent.press(screen.getByTestId('fa20-preview-continue'));
    await waitFor(() => screen.getByTestId('fa20-error'));
    expect(screen.getByTestId('fa20-error')).toHaveTextContent(/already used/);
    expect(router.replace).not.toHaveBeenCalled();
  });

  it('another agent’s shop nearby is view-only: it cannot be taken as this visit’s revisit', async () => {
    const theirs = { ...nearby, shops: nearby.shops.map((sh: Record<string, unknown>) => ({ ...sh, isMine: false, canAct: false })) };
    await renderWithApp(<VisitStartScreen />, { signedInAs: kiran, route: (url) => (url.includes('/field-work/map') ? { status: 200, body: theirs } : undefined) });
    await waitFor(() => screen.getByTestId('fa20-nearby'));
    expect(screen.queryByTestId('fa20-same-shop')).toBeNull();
    expect(screen.getByTestId('fa20-not-yours')).toHaveTextContent('Another agent’s shop: view only.');
  });

  it('22 Nov (rev 207): the board photo is shown back (tap to enlarge) with the area in words; Retake takes it again, Continue sends it', async () => {
    const sent: unknown[] = [];
    const queue = new OfflineQueue({ store: createMemoryQueueStore(), send: async (item) => void sent.push(item.request) });
    await renderWithApp(<VisitStartScreen />, {
      signedInAs: kiran,
      queue,
      route: (url) => (url.endsWith('/maps-link/where') ? { status: 200, body: { latitude: 12.9116, longitude: 77.6101, area: 'Kothnur, JP Nagar 8th Phase', address: null } } : undefined),
    });
    await waitFor(() => expect(screen.getByTestId('fa20-place')).toHaveTextContent('Kothnur, JP Nagar 8th Phase'));
    expect(screen.getByTestId('fa20-gps')).not.toHaveTextContent(/12\.91/);
    await fireEvent.press(screen.getByTestId('fa20-take-photo'));
    await fireEvent.press(screen.getByTestId('fake-camera-back'));
    await waitFor(() => screen.getByTestId('fa20-preview'));
    expect(sent).toHaveLength(0);
    await waitFor(() => expect(screen.getByTestId('fa20-preview-place')).toHaveTextContent('Kothnur, JP Nagar 8th Phase · ±8 m'));
    await fireEvent.press(screen.getByTestId('fa20-preview-thumb'));
    expect(screen.getByTestId('fa20-preview-large')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('fa20-preview-retake'));
    await fireEvent.press(screen.getByTestId('fake-camera-back'));
    await fireEvent.press(screen.getByTestId('fa20-preview-continue'));
    await waitFor(() => expect(sent).toHaveLength(1));
  });

  it('22 Nov: a revisit starts at step 1 with the shop name and the last visit\'s note on top', async () => {
    searchParams.current = { revisitOf: 'v-9', name: 'Reddy mess', lastNote: 'currently he does not have the staff requirements', lastAt: '2026-11-20T06:00:00.000Z' };
    await renderWithApp(<VisitStartScreen />, { signedInAs: kiran });
    expect(screen.getByTestId('fa20-last-visit')).toHaveTextContent('Last visit Fri 20 Nov: “currently he does not have the staff requirements”');
    expect(screen.getByText(/Reddy mess/)).toBeTruthy();
    expect(screen.getByTestId('fa20-take-photo')).toBeTruthy();
  });
});
