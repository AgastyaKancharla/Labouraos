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
  googleWebClientId?: string;
  googleIosClientId?: string;
}

function extra(): Extra {
  return (Constants.expoConfig?.extra as Extra | undefined) ?? {};
}

const trim = (url: string) => url.replace(/\/+$/, '');

/** Where the Nest API is, e.g. https://app.laboura.com (test setup). */
export function apiBaseUrl(): string {
  return trim(process.env.EXPO_PUBLIC_API_URL || extra().apiUrl || 'https://app.laboura.com');
}

/** "mock" = pretend data, no server (src/api/mock.ts). Anything else = the real API. */
export function apiMode(): 'mock' | 'live' {
  return (process.env.EXPO_PUBLIC_API_MODE || extra().apiMode) === 'mock' ? 'mock' : 'live';
}

/** Where the link pages (/p/...) live. Only links on this address open in the secure sheet. */
export function linkPagesBaseUrl(): string {
  return trim(process.env.EXPO_PUBLIC_LINK_PAGES_URL || extra().linkPagesUrl || apiBaseUrl());
}

export function googleClientIds(): { webClientId: string; iosClientId: string } {
  return {
    webClientId: process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID || extra().googleWebClientId || '',
    iosClientId: process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID || extra().googleIosClientId || '',
  };
}
