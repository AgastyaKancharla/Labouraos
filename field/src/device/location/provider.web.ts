import { LocationError, type LocationProvider } from './types';

/**
 * Installed web app: the browser's geolocation (needs HTTPS). iPhone Safari
 * asks for permission on the first reading, so requestPermission only checks
 * that geolocation exists; a refusal arrives as PERMISSION_DENIED.
 */
export const locationProvider: LocationProvider = {
  async requestPermission() {
    return typeof navigator !== 'undefined' && !!navigator.geolocation;
  },
  getPosition({ timeoutMs, maxAgeMs }) {
    return new Promise((resolve, reject) => {
      navigator.geolocation.getCurrentPosition(
        (position) =>
          resolve({
            latitude: position.coords.latitude,
            longitude: position.coords.longitude,
            accuracy: position.coords.accuracy,
            timestamp: position.timestamp,
          }),
        (error) => {
          if (error.code === error.PERMISSION_DENIED) reject(new LocationError('permission_denied'));
          else if (error.code === error.TIMEOUT) reject(new LocationError('timeout'));
          else reject(new LocationError('unavailable', error.message));
        },
        { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: maxAgeMs },
      );
    });
  },
};
