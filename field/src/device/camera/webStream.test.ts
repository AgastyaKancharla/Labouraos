import { BUSY_RETRY_MS, CameraStartError, classifyCameraError, constraintChain, openCameraStream } from './webStream';

const err = (name: string) => Object.assign(new Error(name), { name });
const fakeStream = () => {
  const track = { stop: jest.fn(), kind: 'video' };
  return { getTracks: () => [track], getVideoTracks: () => [track], track } as unknown as MediaStream & { track: { stop: jest.Mock } };
};
const noSleep = jest.fn(async (_ms: number) => undefined);

describe('opening the camera in the browser (17 Nov, Android Chrome)', () => {
  beforeEach(() => noSleep.mockClear());

  it('asks with ideal values only: no exact or min, no frame rate, no remembered deviceId', () => {
    for (const facing of ['back', 'front'] as const) {
      const text = JSON.stringify(constraintChain(facing));
      expect(text).not.toMatch(/exact|"min"|frameRate|deviceId/);
      expect(constraintChain(facing)[0].facingMode).toEqual({ ideal: facing === 'back' ? 'environment' : 'user' });
    }
  });

  it('tries the same step again while Android is still releasing the camera, then opens it', async () => {
    const stream = fakeStream();
    const getUserMedia = jest.fn().mockRejectedValueOnce(err('NotReadableError')).mockRejectedValueOnce(err('NotReadableError')).mockResolvedValue(stream);
    await expect(openCameraStream('back', { getUserMedia, sleep: noSleep })).resolves.toBe(stream);
    expect(getUserMedia).toHaveBeenCalledTimes(3);
    // The same (first) step each time: busy is not a constraint problem.
    expect(new Set(getUserMedia.mock.calls.map((c) => JSON.stringify(c[0])))).toEqual(new Set([JSON.stringify({ audio: false, video: constraintChain('back')[0] })]));
    expect(noSleep.mock.calls.map((c) => c[0])).toEqual([BUSY_RETRY_MS[0], BUSY_RETRY_MS[1]]);
  });

  it('a camera that stays busy is "in use" after the retries (not a loop through every step)', async () => {
    const getUserMedia = jest.fn().mockRejectedValue(err('NotReadableError'));
    await expect(openCameraStream('front', { getUserMedia, sleep: noSleep })).rejects.toMatchObject({ kind: 'in_use' });
    expect(getUserMedia).toHaveBeenCalledTimes(BUSY_RETRY_MS.length + 1);
  });

  it('a blocked camera is "denied" at once (the agent must allow it), never "close other apps"', async () => {
    const getUserMedia = jest.fn().mockRejectedValue(err('NotAllowedError'));
    await expect(openCameraStream('back', { getUserMedia, sleep: noSleep })).rejects.toMatchObject({ kind: 'denied' });
    expect(getUserMedia).toHaveBeenCalledTimes(1);
    expect(classifyCameraError(err('SecurityError'))).toBe('denied');
    expect(classifyCameraError(err('PermissionDeniedError'))).toBe('denied');
  });

  it('falls back step by step on constraints it cannot meet: looser sizes, a camera on that side from a fresh list, then any camera', async () => {
    const stream = fakeStream();
    const getUserMedia = jest.fn(async (c: MediaStreamConstraints) => {
      if (c.video === true) return stream;
      throw err('OverconstrainedError');
    });
    const enumerateDevices = jest.fn(async () => [] as MediaDeviceInfo[]);
    await expect(openCameraStream('front', { getUserMedia, enumerateDevices, sleep: noSleep })).resolves.toBe(stream);
    expect(getUserMedia.mock.calls.map((c) => c[0].video)).toEqual([...constraintChain('front'), true]);
    expect(enumerateDevices).toHaveBeenCalledTimes(1);
  });

  it('uses the front camera found in a fresh device list when facingMode is not understood', async () => {
    const stream = fakeStream();
    const getUserMedia = jest.fn(async (c: MediaStreamConstraints) => {
      if (typeof c.video === 'object' && 'deviceId' in c.video) return stream;
      throw err('OverconstrainedError');
    });
    const enumerateDevices = async () =>
      [
        { kind: 'videoinput', deviceId: 'cam-0', label: 'camera2 0, facing back' },
        { kind: 'videoinput', deviceId: 'cam-1', label: 'camera2 1, facing front' },
      ] as MediaDeviceInfo[];
    await expect(openCameraStream('front', { getUserMedia, enumerateDevices, sleep: noSleep })).resolves.toBe(stream);
    expect(getUserMedia.mock.calls.at(-1)![0].video).toEqual({ deviceId: { exact: 'cam-1' } });
  });

  it('no camera and no https are told apart', async () => {
    await expect(openCameraStream('back', { getUserMedia: jest.fn().mockRejectedValue(err('NotFoundError')), enumerateDevices: async () => [], sleep: noSleep })).rejects.toMatchObject({ kind: 'no_camera' });
    // No navigator.mediaDevices at all outside https.
    const original = Object.getOwnPropertyDescriptor(navigator, 'mediaDevices');
    Object.defineProperty(navigator, 'mediaDevices', { value: undefined, configurable: true });
    try {
      await expect(openCameraStream('back', { isSecureContext: false })).rejects.toMatchObject({ kind: 'insecure' });
    } finally {
      if (original) Object.defineProperty(navigator, 'mediaDevices', original);
    }
  });

  it('a stream that arrives after the screen closed is stopped at once (the camera is never left on)', async () => {
    const stream = fakeStream();
    let closed = false;
    const getUserMedia = jest.fn(async () => {
      closed = true;
      return stream;
    });
    await expect(openCameraStream('back', { getUserMedia, cancelled: () => closed, sleep: noSleep })).rejects.toBeInstanceOf(CameraStartError);
    expect(stream.track.stop).toHaveBeenCalled();
  });
});
