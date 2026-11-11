/** One GPS reading. */
export interface GpsFix {
  latitude: number;
  longitude: number;
  /** Radius in metres within which the true position lies (68% confidence). */
  accuracy: number;
  /** When the phone took the reading, ms since epoch. */
  timestamp: number;
}

export type LocationErrorCode = 'permission_denied' | 'unavailable' | 'timeout';

export class LocationError extends Error {
  constructor(readonly code: LocationErrorCode, message?: string) {
    super(message ?? code);
    this.name = 'LocationError';
  }
}

/** The platform part: expo-location on the phone, navigator.geolocation on the web. */
export interface LocationProvider {
  /** Asks for permission if needed. Resolves true when allowed. */
  requestPermission(): Promise<boolean>;
  /** One high-accuracy reading. Rejects with LocationError. */
  getPosition(options: { timeoutMs: number; maxAgeMs: number }): Promise<GpsFix>;
}
