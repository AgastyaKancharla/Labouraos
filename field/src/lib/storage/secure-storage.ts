import * as SecureStore from 'expo-secure-store';
import type { KeyValueStore } from './types';

/**
 * Phone app (Android / iPhone): the iOS Keychain or Android Keystore via
 * expo-secure-store. Used for the login session, the device id and settings.
 * Keys may only contain letters, numbers, ".", "-" and "_".
 */
export const secureStorage: KeyValueStore = {
  async getItem(key) {
    try {
      return await SecureStore.getItemAsync(key);
    } catch {
      return null;
    }
  },
  async setItem(key, value) {
    try {
      await SecureStore.setItemAsync(key, value);
    } catch {
      /* storage unavailable — the value lives only until the app closes */
    }
  },
  async removeItem(key) {
    try {
      await SecureStore.deleteItemAsync(key);
    } catch {
      /* nothing to remove */
    }
  },
};
