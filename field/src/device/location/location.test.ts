import { classifyAccuracy, distanceMeters, formatCoordinates, readLocation } from './location';
import { LocationError, type GpsFix, type LocationProvider } from './types';

const fix: GpsFix = { latitude: 12.9116, longitude: 77.6389, accuracy: 12, timestamp: 1 };

function provider(overrides: Partial<LocationProvider> = {}): LocationProvider {
  return { requestPermission: async () => true, getPosition: async () => fix, ...overrides };
}

describe('GPS reading', () => {
  it('returns the fix with its accuracy level', async () => {
    await expect(readLocation(provider())).resolves.toMatchObject({ latitude: 12.9116, accuracy: 12, level: 'good' });
  });

  it('grades accuracy: ≤30 m good, ≤100 m fair, beyond that poor', () => {
    expect(classifyAccuracy(30)).toBe('good');
    expect(classifyAccuracy(31)).toBe('fair');
    expect(classifyAccuracy(100)).toBe('fair');
    expect(classifyAccuracy(250)).toBe('poor');
    expect(classifyAccuracy(Number.NaN)).toBe('poor');
  });

  it('refuses when permission is off', async () => {
    await expect(readLocation(provider({ requestPermission: async () => false }))).rejects.toMatchObject({ code: 'permission_denied' });
  });

  it('gives up after the timeout even if the phone never answers', async () => {
    jest.useFakeTimers();
    try {
      const pending = readLocation(provider({ getPosition: () => new Promise(() => undefined) }), { timeoutMs: 1000 });
      const assertion = expect(pending).rejects.toMatchObject({ code: 'timeout' });
      await Promise.resolve();
      jest.advanceTimersByTime(1001);
      await assertion;
    } finally {
      jest.useRealTimers();
    }
  });

  it('treats 0,0 and platform errors as unavailable', async () => {
    await expect(readLocation(provider({ getPosition: async () => ({ ...fix, latitude: 0, longitude: 0 }) }))).rejects.toMatchObject({
      code: 'unavailable',
    });
    await expect(
      readLocation(
        provider({
          getPosition: async () => {
            throw new Error('kCLErrorDomain');
          },
        }),
      ),
    ).rejects.toBeInstanceOf(LocationError);
  });

  it('formats coordinates and measures distance', () => {
    expect(formatCoordinates(fix)).toBe('12.91160, 77.63890');
    expect(Math.round(distanceMeters(fix, { latitude: 12.9126, longitude: 77.6389 }))).toBe(111);
  });
});
