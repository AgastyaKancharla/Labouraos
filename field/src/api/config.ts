import Constants from 'expo-constants';
import { Platform } from 'react-native';

/**
 * Where the Nest API is.
 * - Installed web app: the same site that served the app (Nest serves it at
 *   the root of field.laboura.com, and at /field elsewhere), so the base is ''
 *   and calls go to /auth/login, /attendance/today… on that same address.
 * - Phone app (APK / App Store): EXPO_PUBLIC_API_URL at build time, or
 *   `extra.apiUrl` in app.json, e.g. https://app.laboura.com
 */
export function apiBaseUrl(): string {
  const fromEnv = process.env.EXPO_PUBLIC_API_URL;
  if (fromEnv) return fromEnv.replace(/\/+$/, '');
  if (Platform.OS === 'web') return '';
  const extra = Constants.expoConfig?.extra as { apiUrl?: string } | undefined;
  return (extra?.apiUrl ?? '').replace(/\/+$/, '');
}
