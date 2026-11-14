import * as Location from 'expo-location';
import type { Pin } from '@/api/types';

/**
 * "Use my location" for the map pin (shop, home area). Read once, only when
 * the person taps the button — never in the background. Asks permission at
 * that moment, with the reason in app.config.js.
 */
export type PinResult = { status: 'ok'; pin: Pin } | { status: 'denied' } | { status: 'error' };

export async function readPin(): Promise<PinResult> {
  try {
    const permission = await Location.requestForegroundPermissionsAsync();
    if (!permission.granted) return { status: 'denied' };
    const position = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
    return {
      status: 'ok',
      pin: {
        latitude: Number(position.coords.latitude.toFixed(6)),
        longitude: Number(position.coords.longitude.toFixed(6)),
        accuracyM: position.coords.accuracy === null ? null : Math.round(position.coords.accuracy),
      },
    };
  } catch {
    return { status: 'error' };
  }
}
