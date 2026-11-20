import { useCallback, useEffect, useRef, useState } from 'react';
import { CameraStartError, openCameraStream, stopStream, type CameraDeps, type CameraErrorKind, type CameraFacing } from './openCamera';

export type LiveCameraState = 'starting' | 'ready' | CameraErrorKind;

/**
 * The live camera of a page (selfie, ID card, Aadhaar QR): opens it while
 * `active`, shows it in `videoRef`, and always stops it — when the screen
 * closes, before opening it again, and if it arrives after the screen closed.
 * `start` opens it again (Try again, or after a failed upload); `stop`
 * releases it (after a photo is taken).
 */
export function useLiveCamera(active: boolean, facing: CameraFacing, deps?: CameraDeps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const generation = useRef(0);
  const depsRef = useRef(deps);
  depsRef.current = deps;
  const [state, setState] = useState<LiveCameraState>('starting');

  const stop = useCallback(() => {
    generation.current += 1;
    stopStream(streamRef.current);
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
  }, []);

  const start = useCallback(async () => {
    // Android opens one camera at a time: the old one goes first.
    stop();
    const mine = generation.current;
    const cancelled = () => generation.current !== mine;
    setState('starting');
    let stream: MediaStream;
    try {
      stream = await openCameraStream(facing, { ...depsRef.current, cancelled });
    } catch (error) {
      if (!cancelled()) setState(error instanceof CameraStartError ? error.kind : 'in_use');
      return;
    }
    if (cancelled()) {
      stopStream(stream);
      return;
    }
    streamRef.current = stream;
    const video = videoRef.current;
    if (!video) {
      setState('ready');
      return;
    }
    video.srcObject = stream;
    video.muted = true;
    const ready = () => {
      if (!cancelled() && video.videoWidth > 0) setState('ready');
    };
    video.addEventListener('loadeddata', ready, { once: true });
    video.addEventListener('playing', ready, { once: true });
    try {
      await video.play();
    } catch {
      // A muted inline video may play; "ready" still comes from loadeddata.
    }
    ready();
  }, [facing, stop]);

  useEffect(() => {
    if (!active) return;
    void start();
    return stop;
  }, [active, start, stop]);

  return { videoRef, state, start, stop };
}
