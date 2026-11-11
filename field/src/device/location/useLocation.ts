import { useCallback, useState } from 'react';
import type { MessageKey } from '@/i18n';
import { readLocation, type AccuracyLevel } from './location';
import { locationProvider } from './provider';
import { LocationError, type GpsFix, type LocationErrorCode } from './types';

export type LocationReading = GpsFix & { level: AccuracyLevel };

export const LOCATION_ERROR_KEYS: Record<LocationErrorCode, MessageKey> = {
  permission_denied: 'device.location.permissionDenied',
  unavailable: 'device.location.unavailable',
  timeout: 'device.location.timeout',
};

/**
 * Reads the location on demand (never in the background — the guide says
 * location is recorded at events only). `read()` resolves the fix or null;
 * `errorKey` is the i18n key to show.
 */
export function useLocation() {
  const [fix, setFix] = useState<LocationReading | null>(null);
  const [errorCode, setErrorCode] = useState<LocationErrorCode | null>(null);
  const [loading, setLoading] = useState(false);

  const read = useCallback(async (): Promise<LocationReading | null> => {
    setLoading(true);
    setErrorCode(null);
    try {
      const next = await readLocation(locationProvider);
      setFix(next);
      return next;
    } catch (error) {
      setErrorCode(error instanceof LocationError ? error.code : 'unavailable');
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  return { fix, loading, errorCode, errorKey: errorCode ? LOCATION_ERROR_KEYS[errorCode] : null, read };
}
