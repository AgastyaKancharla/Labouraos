import * as Location from 'expo-location';
import { LocationError, type LocationProvider } from './types';

/** Phone app: expo-location, foreground permission only (no background tracking). */
export const locationProvider: LocationProvider = {
  async requestPermission() {
    const current = await Location.getForegroundPermissionsAsync();
    if (current.granted) return true;
    if (!current.canAskAgain) return false;
    const asked = await Location.requestForegroundPermissionsAsync();
    return asked.granted;
  },
  async getPosition() {
    try {
      const position = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
      return {
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
        accuracy: position.coords.accuracy ?? Number.POSITIVE_INFINITY,
        timestamp: position.timestamp,
      };
    } catch (error) {
      throw new LocationError('unavailable', error instanceof Error ? error.message : undefined);
    }
  },
};
