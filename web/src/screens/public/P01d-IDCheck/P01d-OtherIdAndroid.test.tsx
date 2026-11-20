import { act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import { apiError, mockApi, renderScreen } from '../../../test/utils';
import { openStatus, TOKEN, verifiedInThisTab } from '../shared/testData';
import IdCheck from './index';

/**
 * 17 Nov, item 1: "Another ID" with the real live camera (LiveSelfie) on an
 * Android-Chrome-like camera — the first open right after the permission
 * prompt fails with NotReadableError, a camera stopped a moment ago is still
 * being released, and only one camera can be open at a time.
 */
const err = (name: string) => Object.assign(new Error(name), { name });

function androidCamera() {
  const live = new Set<{ stop: () => void; readyState: string }>();
  const log: string[] = [];
  let prompted = false;
  const getUserMedia = vi.fn(async (c: MediaStreamConstraints) => {
    log.push(`open ${JSON.stringify(c.video)}`);
    const video = c.video as MediaTrackConstraints | true;
    if (video !== true && typeof video.facingMode === 'object' && 'exact' in (video.facingMode as object)) throw err('OverconstrainedError');
    if (!prompted) {
      prompted = true;
      log.push('-> NotReadable (just after the permission prompt)');
      throw err('NotReadableError');
    }
    if ([...live].some((t) => t.readyState === 'live')) throw err('NotReadableError');
    const track = {
      readyState: 'live',
      stop: vi.fn(() => {
        track.readyState = 'ended';
        live.delete(track);
        log.push('stop');
      }),
    };
    live.add(track);
    log.push('-> ok');
    return { getTracks: () => [track], getVideoTracks: () => [track] } as unknown as MediaStream;
  });
  Object.defineProperty(navigator, 'mediaDevices', { value: { getUserMedia }, configurable: true });
  Object.defineProperty(HTMLVideoElement.prototype, 'videoWidth', { get: () => 1280, configurable: true });
  Object.defineProperty(HTMLVideoElement.prototype, 'videoHeight', { get: () => 720, configurable: true });
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ translate: vi.fn(), scale: vi.fn(), drawImage: vi.fn() } as unknown as CanvasRenderingContext2D);
  vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(function (cb: BlobCallback) {
    cb(new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xe0])], { type: 'image/jpeg' }));
  });
  vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue('data:image/jpeg;base64,AAAA');
  return { getUserMedia, live, log };
}

const atId = (extra: Partial<ReturnType<typeof openStatus>> = {}) =>
  openStatus({ currentStep: 'id_check', steps: { consent: true, selfie: true, idCheck: false, payment: false }, ...extra });
const render = () => renderScreen(<IdCheck />, { portal: 'public', path: `/p/register/${TOKEN}/id-check`, route: '/p/register/:token/id-check' });

async function openCardCamera() {
  await userEvent.click(await screen.findByRole('button', { name: 'Another ID' }));
  await userEvent.click(screen.getByRole('button', { name: 'PAN card' }));
  await userEvent.type(screen.getByLabelText(/PAN number/), 'abcde1234f');
  await userEvent.click(screen.getByRole('button', { name: 'Next: photo of the card' }));
}

describe('P01d "Another ID" on Android Chrome (17 Nov)', () => {
  afterEach(() => vi.useRealTimers());

  it('the card camera opens even when the first open after the permission prompt fails, and the photo reaches the Team Lead with the typed number', async () => {
    verifiedInThisTab();
    const camera = androidCamera();
    let pending = false;
    const api = mockApi({
      [`GET /registration/${TOKEN}/status`]: () => atId({ idCheck: { waitingForTeamLead: pending, lastResult: pending ? 'pending' : 'none' } }),
      [`POST /registration/${TOKEN}/other-id/capture-nonce`]: { captureNonce: 'camera-token-1', expiresInSeconds: 120 },
      [`POST /registration/${TOKEN}/other-id`]: () => {
        pending = true;
        return { verificationId: 'v2', method: 'pan', status: 'pending', idNumberLast4: '234F' };
      },
    });
    render();
    await openCardCamera();
    // Back camera, ideal constraints only; the NotReadableError is retried, so no "couldn't be opened".
    const take = await screen.findByRole('button', { name: 'Take photo of the card' });
    await waitFor(() => expect(take).toBeEnabled(), { timeout: 3000 });
    expect(screen.queryByTestId('camera-problem')).toBeNull();
    expect(camera.getUserMedia).toHaveBeenCalledTimes(2);
    expect(camera.getUserMedia.mock.calls[0]![0]).toMatchObject({ audio: false, video: { facingMode: { ideal: 'environment' } } });
    expect(JSON.stringify(camera.getUserMedia.mock.calls)).not.toMatch(/exact/);
    // Live camera only: no file input, no gallery.
    expect(document.querySelector('input[type="file"]')).toBeNull();
    await userEvent.click(take);
    expect(await screen.findByTestId('id-pending')).toHaveTextContent(/Sent to a Team Lead/);
    // The camera is released once the photo is taken.
    expect(camera.live.size).toBe(0);
    const sent = api.fetch.mock.calls.find(([url]) => String(url).endsWith(`/registration/${TOKEN}/other-id`));
    const form = sent![1]!.body as FormData;
    expect(form.get('idType')).toBe('pan');
    expect(form.get('idNumber')).toBe('ABCDE1234F');
    expect(form.get('captureSource')).toBe('live_camera');
    expect(form.get('captureNonce')).toBe('camera-token-1');
    expect(form.get('photo')).toBeInstanceOf(Blob);
    // One camera token for the one time the card camera opened (not one per re-render of the page).
    expect(api.calls(`POST /registration/${TOKEN}/other-id/capture-nonce`)).toHaveLength(1);
  });

  it('a failed upload opens the camera again while Android is still releasing it — retried, no error', async () => {
    verifiedInThisTab();
    const camera = androidCamera();
    let tries = 0;
    mockApi({
      [`GET /registration/${TOKEN}/status`]: atId(),
      [`POST /registration/${TOKEN}/other-id/capture-nonce`]: () => ({ captureNonce: `camera-token-${tries + 1}`, expiresInSeconds: 120 }),
      [`POST /registration/${TOKEN}/other-id`]: () => {
        tries += 1;
        return apiError(400, 'The camera was open too long, or this photo was already sent. Take the photo of the card again.');
      },
    });
    render();
    await openCardCamera();
    const take = await screen.findByRole('button', { name: 'Take photo of the card' });
    await waitFor(() => expect(take).toBeEnabled(), { timeout: 3000 });
    // Releasing: the next open right after the stop fails once, then works.
    const opens = camera.getUserMedia.mock.calls.length;
    camera.getUserMedia.mockImplementationOnce(async () => {
      throw err('NotReadableError');
    });
    await userEvent.click(take);
    await waitFor(() => expect(camera.getUserMedia.mock.calls.length).toBeGreaterThanOrEqual(opens + 2), { timeout: 3000 });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Take photo of the card' })).toBeEnabled(), { timeout: 3000 });
    expect(screen.queryByTestId('camera-problem')).toBeNull();
    expect(camera.live.size).toBe(1);
  });

  it('a camera that stays blocked or busy says what to do, and Try again opens it again', async () => {
    verifiedInThisTab();
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const getUserMedia = vi.fn().mockRejectedValue(err('NotReadableError'));
    Object.defineProperty(navigator, 'mediaDevices', { value: { getUserMedia }, configurable: true });
    mockApi({
      [`GET /registration/${TOKEN}/status`]: atId(),
      [`POST /registration/${TOKEN}/other-id/capture-nonce`]: { captureNonce: 'camera-token-1', expiresInSeconds: 120 },
    });
    render();
    await openCardCamera();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(await screen.findByTestId('camera-problem')).toHaveTextContent(/camera is busy or still starting\. Close other apps/);
    expect(screen.queryByText(/Try another phone/)).toBeNull();
    const calls = getUserMedia.mock.calls.length;
    getUserMedia.mockRejectedValue(err('NotAllowedError'));
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText(/Camera access is blocked/)).toBeInTheDocument();
    expect(getUserMedia.mock.calls.length).toBe(calls + 1);
  });

  it('leaving the card camera before it opened stops the stream that arrives late (it would keep the camera busy)', async () => {
    verifiedInThisTab();
    androidCamera();
    let resolve: (s: MediaStream) => void = () => undefined;
    const track = { stop: vi.fn(), readyState: 'live' };
    Object.defineProperty(navigator, 'mediaDevices', {
      value: { getUserMedia: vi.fn(() => new Promise<MediaStream>((r) => (resolve = r))) },
      configurable: true,
    });
    mockApi({
      [`GET /registration/${TOKEN}/status`]: atId(),
      [`POST /registration/${TOKEN}/other-id/capture-nonce`]: { captureNonce: 'camera-token-1', expiresInSeconds: 120 },
    });
    render();
    await openCardCamera();
    await userEvent.click(screen.getByRole('button', { name: 'Change the ID or number' }));
    await act(async () => resolve({ getTracks: () => [track], getVideoTracks: () => [track] } as unknown as MediaStream));
    expect(track.stop).toHaveBeenCalled();
  });
});
