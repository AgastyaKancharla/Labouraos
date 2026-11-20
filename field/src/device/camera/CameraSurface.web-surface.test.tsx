/**
 * The web app's camera (CameraSurface.web.tsx), run with a fake
 * navigator.mediaDevices that behaves like Android Chrome (17 Nov, item 4).
 */
import { createRef } from 'react';
import { act, render, waitFor } from '@testing-library/react-native';
import { CameraSurface, type CameraSurfaceHandle } from './CameraSurface.web';

const err = (name: string) => Object.assign(new Error(name), { name });
type Track = { stop: jest.Mock; addEventListener: jest.Mock; readyState: string };
function stream() {
  const track: Track = { stop: jest.fn(() => (track.readyState = 'ended')), addEventListener: jest.fn(), readyState: 'live' };
  return { getTracks: () => [track], getVideoTracks: () => [track], track };
}
let getUserMedia: jest.Mock;
const original = Object.getOwnPropertyDescriptor(globalThis.navigator ?? {}, 'mediaDevices');

beforeEach(() => {
  jest.useFakeTimers();
  getUserMedia = jest.fn();
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia, enumerateDevices: jest.fn(async () => []) } });
});
afterEach(() => {
  jest.useRealTimers();
  if (original) Object.defineProperty(navigator, 'mediaDevices', original);
});

async function mount(facing: 'back' | 'front' = 'back') {
  const onReady = jest.fn();
  const onError = jest.fn();
  const ref = createRef<CameraSurfaceHandle>();
  const view = await render(<CameraSurface ref={ref} facing={facing} onReady={onReady} onError={onError} />);
  return { view, onReady, onError, ref };
}

describe('the web app camera (Android Chrome)', () => {
  it('opens the camera with one getUserMedia and ideal constraints (no permission probe stream)', async () => {
    getUserMedia.mockResolvedValue(stream());
    const { onError } = await mount();
    await waitFor(() => expect(getUserMedia).toHaveBeenCalledTimes(1));
    expect(getUserMedia.mock.calls[0][0]).toEqual({ audio: false, video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } } });
    expect(onError).not.toHaveBeenCalled();
  });

  it('a camera still being released is tried again and then opens — no error', async () => {
    getUserMedia.mockRejectedValueOnce(err('NotReadableError')).mockResolvedValue(stream());
    const { onError } = await mount();
    await act(async () => {
      await jest.advanceTimersByTimeAsync(400);
    });
    await waitFor(() => expect(getUserMedia).toHaveBeenCalledTimes(2));
    expect(onError).not.toHaveBeenCalled();
  });

  it('a blocked camera is reported as "denied", a busy one as "in use" after the retries', async () => {
    getUserMedia.mockRejectedValue(err('NotAllowedError'));
    const denied = await mount();
    await waitFor(() => expect(denied.onError).toHaveBeenCalledWith('denied'));
    await denied.view.unmount();

    getUserMedia.mockReset().mockRejectedValue(err('NotReadableError'));
    const busy = await mount('front');
    await act(async () => {
      await jest.advanceTimersByTimeAsync(5000);
    });
    await waitFor(() => expect(busy.onError).toHaveBeenCalledWith('in_use'));
  });

  it('stops the camera when the screen closes, also a stream that arrives after it closed', async () => {
    const first = stream();
    getUserMedia.mockResolvedValue(first);
    const a = await mount();
    await waitFor(() => expect(getUserMedia).toHaveBeenCalledTimes(1));
    await a.view.unmount();
    expect(first.track.stop).toHaveBeenCalled();

    let resolve: (s: unknown) => void = () => undefined;
    const late = stream();
    getUserMedia.mockReset().mockImplementation(() => new Promise((r) => (resolve = r)));
    const b = await mount();
    await waitFor(() => expect(getUserMedia).toHaveBeenCalledTimes(1));
    await b.view.unmount();
    await act(async () => {
      resolve(late);
    });
    expect(late.track.stop).toHaveBeenCalled();
    expect(b.onError).not.toHaveBeenCalled();
  });

  it('switching camera stops the old one before opening the other (Android opens one camera at a time)', async () => {
    const back = stream();
    const front = stream();
    getUserMedia.mockResolvedValueOnce(back).mockImplementation(async () => {
      if (back.track.readyState === 'live') throw err('NotReadableError');
      return front;
    });
    const onError = jest.fn();
    const view = await render(<CameraSurface key="back" facing="back" onReady={jest.fn()} onError={onError} />);
    await waitFor(() => expect(getUserMedia).toHaveBeenCalledTimes(1));
    await view.rerender(<CameraSurface key="front" facing="front" onReady={jest.fn()} onError={onError} />);
    await waitFor(() => expect(getUserMedia).toHaveBeenCalledTimes(2));
    expect(back.track.stop).toHaveBeenCalled();
    expect(getUserMedia.mock.calls[1][0].video.facingMode).toEqual({ ideal: 'user' });
    expect(onError).not.toHaveBeenCalled();
  });
});
