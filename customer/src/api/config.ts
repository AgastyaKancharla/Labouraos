import Constants from 'expo-constants';

/**
 * Build-time settings (app.config.js `extra`, filled from EXPO_PUBLIC_* and
 * eas.json build profiles). EXPO_PUBLIC_* variables win so `npx expo start`
 * can switch without editing anything.
 */
interface Extra {
  apiUrl?: string;
  apiMode?: string;
  linkPagesUrl?: string;
}

function extra(): Extra {
  return (Constants.expoConfig?.extra as Extra | undefined) ?? {};
}

const trim = (url: string) => url.replace(/\/+$/, '');

/** Where the Nest API is, e.g. https://app.laboura.com (test setup). */
export function apiBaseUrl(): string {
  return trim(process.env.EXPO_PUBLIC_API_URL || extra().apiUrl || 'https://app.laboura.com');
}

/**
 * "mock" = pretend data, no server (src/api/mock.ts). Anything else = the real API.
 * Pretend data is only for local development (`npx expo start`) and the automated
 * tests. A release build — the APK people install, Play Store, App Store — always
 * talks to the real server, whatever its settings say (28 Nov: no test data in the
 * real app), and its bundle does not even contain the pretend server.
 */
export function apiMode(): 'mock' | 'live' {
  if (!__DEV__) return 'live';
  return (process.env.EXPO_PUBLIC_API_MODE || extra().apiMode) === 'mock' ? 'mock' : 'live';
}

/** Where the link pages (/p/...) live. Only links on this address open in the secure sheet. */
export function linkPagesBaseUrl(): string {
  return trim(process.env.EXPO_PUBLIC_LINK_PAGES_URL || extra().linkPagesUrl || apiBaseUrl());
}
