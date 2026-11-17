import { describe, expect, it, vi } from 'vitest';
import { BUSY_RETRY_MS, CameraStartError, classifyCameraError, constraintChain, openCameraStream } from './openCamera';

const err = (name: string) => Object.assign(new Error(name), { name });
const stream = () => {
  const track = { stop: vi.fn() };
  return { getTracks: () => [track], track } as unknown as MediaStream & { track: { stop: ReturnType<typeof vi.fn> } };
};
const noSleep = { sleep: async () => undefined };

describe('openCameraStream (Android Chrome camera, 17 Nov)', () => {
  it('opens with one getUserMedia and ideal constraints only — no permission probe, never exact', async () => {
    const getUserMedia = vi.fn().mockResolvedValue(stream());
    await openCameraStream('environment', { getUserMedia, ...noSleep });
    expect(getUserMedia).toHaveBeenCalledTimes(1);
    expect(getUserMedia.mock.calls[0][0]).toEqual({ audio: false, video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } } });
    for (const step of [...constraintChain('user'), ...constraintChain('environment')]) expect(JSON.stringify(step)).not.toMatch(/exact|min/);
  });

  it('a camera that fails right after the permission prompt (or while being released) is tried again, then opens', async () => {
    const sleep = vi.fn(async () => undefined);
    const getUserMedia = vi.fn().mockRejectedValueOnce(err('NotReadableError')).mockRejectedValueOnce(err('NotReadableError')).mockResolvedValue(stream());
    await expect(openCameraStream('environment', { getUserMedia, sleep })).resolves.toBeTruthy();
    expect(getUserMedia).toHaveBeenCalledTimes(3);
    expect(sleep.mock.calls.map((c) => (c as unknown as [number])[0])).toEqual([BUSY_RETRY_MS[0], BUSY_RETRY_MS[1]]);
  });

  it('an impossible constraint falls back to looser ones, then to any camera', async () => {
    const getUserMedia = vi.fn(async (c: MediaStreamConstraints) => {
      if (c.video !== true) throw err('OverconstrainedError');
      return stream();
    });
    await openCameraStream('user', { getUserMedia, ...noSleep });
    expect(getUserMedia.mock.calls.map((c) => c[0].video)).toEqual([{ facingMode: { ideal: 'user' }, width: { ideal: 720 } }, { facingMode: { ideal: 'user' } }, true]);
  });

  it('a blocked camera is "denied" at once; a busy one is "in_use" after the retries; none is "no_camera"; http is "insecure"', async () => {
    await expect(openCameraStream('user', { getUserMedia: vi.fn().mockRejectedValue(err('NotAllowedError')), ...noSleep })).rejects.toMatchObject({ kind: 'denied' });
    const busy = vi.fn().mockRejectedValue(err('NotReadableError'));
    await expect(openCameraStream('user', { getUserMedia: busy, ...noSleep })).rejects.toMatchObject({ kind: 'in_use' });
    expect(busy).toHaveBeenCalledTimes(BUSY_RETRY_MS.length + 1);
    await expect(openCameraStream('user', { getUserMedia: vi.fn().mockRejectedValue(err('NotFoundError')), ...noSleep })).rejects.toMatchObject({ kind: 'no_camera' });
    const noApi = { getUserMedia: undefined, isSecureContext: false, ...noSleep };
    Object.defineProperty(navigator, 'mediaDevices', { value: undefined, configurable: true });
    await expect(openCameraStream('user', noApi)).rejects.toBeInstanceOf(CameraStartError);
    await expect(openCameraStream('user', noApi)).rejects.toMatchObject({ kind: 'insecure' });
  });

  it('a stream that arrives after the screen closed is stopped, never kept', async () => {
    const late = stream();
    let closed = false;
    const getUserMedia = vi.fn(async () => {
      closed = true;
      return late;
    });
    await expect(openCameraStream('environment', { getUserMedia, cancelled: () => closed, ...noSleep })).rejects.toBeInstanceOf(CameraStartError);
    expect(late.track.stop).toHaveBeenCalled();
  });

  it('sorts error names, old Chrome ones included', () => {
    expect(classifyCameraError(err('PermissionDeniedError'))).toBe('denied');
    expect(classifyCameraError(err('TrackStartError'))).toBe('in_use');
    expect(classifyCameraError(err('ConstraintNotSatisfiedError'))).toBe('constraint');
    expect(classifyCameraError(err('DevicesNotFoundError'))).toBe('no_camera');
  });
});
