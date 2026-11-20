/**
 * Opening the live camera in the browser so that it works on Android Chrome
 * (17 Nov: "Other ID — taking the card photo does not work").
 *
 * Why the pages failed there: each opened the camera with one getUserMedia
 * and gave up on the first error. On Android Chrome the first open right
 * after the permission prompt, and an open while the previous camera (the
 * selfie, the QR scanner, the photo just taken) is still being released,
 * fail with NotReadableError for a moment — the page then said "This phone's
 * camera couldn't be opened. Try another phone", and a stream that arrived
 * after the screen had closed was never stopped, so it kept the camera busy
 * for every later open (Android opens one camera at a time).
 *
 * Here (the same approach as Laboura Field's web camera): one getUserMedia per
 * open — it is also the browser's permission prompt, no probe stream; a chain
 * of constraints from preferred to anything-that-works (ideal values only,
 * never exact or min); a short wait-and-retry while the camera is busy or
 * still being released; a stream that arrives after the screen closed is
 * stopped at once; and the failure sorted into what the person can do.
 */

export type CameraFacing = 'user' | 'environment';

/** What went wrong, in terms of what the person can do about it. */
export type CameraErrorKind =
  /** The site may not use the camera (blocked, or "Don't allow" was tapped): allow it in the browser. */
  | 'denied'
  /** The camera is busy (another app, or still being released): close other apps, try again. */
  | 'in_use'
  /** No camera at all. */
  | 'no_camera'
  /** The page is not on https, so the browser offers no camera. */
  | 'insecure';

export class CameraStartError extends Error {
  constructor(
    readonly kind: CameraErrorKind,
    readonly reason?: unknown,
  ) {
    super(`Camera could not start: ${kind}`);
    this.name = 'CameraStartError';
  }
}

export interface CameraDeps {
  getUserMedia?: (constraints: MediaStreamConstraints) => Promise<MediaStream>;
  enumerateDevices?: () => Promise<MediaDeviceInfo[]>;
  isSecureContext?: boolean;
  sleep?: (ms: number) => Promise<void>;
  /** True once the screen closed while the camera was opening: stop at once. */
  cancelled?: () => boolean;
}

/** Waits before trying a busy camera again (Android releases a stopped camera a moment later). */
export const BUSY_RETRY_MS = [350, 800, 1500] as const;

/** The constraint steps, most wanted first. Ideal values only: Android Chrome refuses exact / min ones it cannot meet. */
export function constraintChain(facing: CameraFacing): MediaTrackConstraints[] {
  const facingMode = { ideal: facing };
  return facing === 'user'
    ? [{ facingMode, width: { ideal: 720 } }, { facingMode }]
    : [{ facingMode, width: { ideal: 1920 }, height: { ideal: 1080 } }, { facingMode, width: { ideal: 1280 }, height: { ideal: 720 } }, { facingMode }];
}

/** Error names from the spec and from older Chrome versions. */
export function classifyCameraError(error: unknown): CameraErrorKind | 'constraint' {
  const name = (error as { name?: string } | null)?.name ?? '';
  switch (name) {
    case 'NotAllowedError':
    case 'PermissionDeniedError':
    case 'SecurityError':
      return 'denied';
    case 'OverconstrainedError':
    case 'ConstraintNotSatisfiedError':
    case 'TypeError':
      return 'constraint';
    case 'NotFoundError':
    case 'DevicesNotFoundError':
      return 'no_camera';
    default:
      // NotReadableError, TrackStartError, AbortError and anything unknown: busy.
      return 'in_use';
  }
}

/** A camera on the wanted side from a fresh device list (capabilities or label), never a remembered id. */
async function deviceFor(facing: CameraFacing, enumerate: (() => Promise<MediaDeviceInfo[]>) | undefined): Promise<string | null> {
  if (!enumerate) return null;
  try {
    const cameras = (await enumerate()).filter((d) => d.kind === 'videoinput' && d.deviceId);
    const words = facing === 'environment' ? ['back', 'rear', 'environment'] : ['front', 'user', 'face'];
    const byCapability = cameras.find((c) => (c as MediaDeviceInfo & { getCapabilities?: () => { facingMode?: string[] } }).getCapabilities?.()?.facingMode?.includes(facing));
    const byLabel = cameras.find((c) => words.some((w) => c.label.toLowerCase().includes(w)));
    return (byCapability ?? byLabel)?.deviceId ?? null;
  } catch {
    return null;
  }
}

/** Stops every track (safe on a stream that is already stopped, or none). */
export function stopStream(stream: MediaStream | null | undefined): void {
  stream?.getTracks().forEach((track) => {
    try {
      track.stop();
    } catch {
      // already stopped
    }
  });
}

/**
 * Opens the camera on `facing`, falling back step by step and retrying a busy
 * camera a few times. Throws CameraStartError with the reason. A stream that
 * arrives after `cancelled()` turned true is stopped, never leaked.
 */
export async function openCameraStream(facing: CameraFacing, deps: CameraDeps = {}): Promise<MediaStream> {
  const media = typeof navigator !== 'undefined' ? navigator.mediaDevices : undefined;
  const getUserMedia = deps.getUserMedia ?? (media?.getUserMedia ? (c: MediaStreamConstraints) => media.getUserMedia(c) : undefined);
  const enumerate = deps.enumerateDevices ?? (media?.enumerateDevices ? () => media.enumerateDevices() : undefined);
  const secure = deps.isSecureContext ?? (typeof window !== 'undefined' ? window.isSecureContext !== false : true);
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const cancelled = deps.cancelled ?? (() => false);
  if (!getUserMedia) throw new CameraStartError(secure ? 'no_camera' : 'insecure');

  let lastKind: CameraErrorKind = 'no_camera';
  let lastError: unknown;
  const attempt = async (video: MediaTrackConstraints | true): Promise<MediaStream | 'next'> => {
    for (let tries = 0; ; tries += 1) {
      if (cancelled()) throw new CameraStartError('in_use', 'cancelled');
      try {
        const stream = await getUserMedia({ video, audio: false });
        if (cancelled()) {
          stopStream(stream);
          throw new CameraStartError('in_use', 'cancelled');
        }
        return stream;
      } catch (error) {
        if (error instanceof CameraStartError) throw error;
        lastError = error;
        const kind = classifyCameraError(error);
        if (kind === 'denied') throw new CameraStartError('denied', error);
        if (kind === 'in_use') {
          // Busy is not about the constraints: wait and try the same step again, then give up.
          if (tries < BUSY_RETRY_MS.length) {
            await sleep(BUSY_RETRY_MS[tries]!);
            continue;
          }
          throw new CameraStartError('in_use', error);
        }
        // A constraint it cannot meet (or no camera on that side): the next, looser step.
        if (kind !== 'constraint') lastKind = kind;
        return 'next';
      }
    }
  };

  for (const video of constraintChain(facing)) {
    const got = await attempt(video);
    if (got !== 'next') return got;
  }
  const deviceId = await deviceFor(facing, enumerate);
  if (deviceId) {
    const got = await attempt({ deviceId: { exact: deviceId } });
    if (got !== 'next') return got;
  }
  const any = await attempt(true);
  if (any !== 'next') return any;
  throw new CameraStartError(lastKind, lastError);
}
