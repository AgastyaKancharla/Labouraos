import { Platform } from 'react-native';
import Constants from 'expo-constants';
import * as Crypto from 'expo-crypto';
import { secureStorage, type KeyValueStore } from '@/lib/storage';

/**
 * A random id made once per install (contract 1.3, `X-Laboura-Installation`):
 * used for the OTP limits per phone and to tie a session to a phone. Never the
 * IMEI or the advertising id.
 */
export const INSTALLATION_KEY = 'laboura_installation_id';
let cached: Promise<string> | null = null;

export function installationId(storage: KeyValueStore = secureStorage): Promise<string> {
  if (!cached) {
    cached = (async () => {
      const saved = await storage.getItem(INSTALLATION_KEY);
      if (saved) return saved;
      const fresh = Crypto.randomUUID();
      await storage.setItem(INSTALLATION_KEY, fresh);
      return fresh;
    })();
  }
  return cached;
}

/** For tests only. */
export function resetInstallationIdCache(): void {
  cached = null;
}

/** The `device` block sent with every sign-in. */
export async function deviceInfo(): Promise<{ installationId: string; platform: string; appVersion: string }> {
  return { installationId: await installationId(), platform: Platform.OS, appVersion: Constants.expoConfig?.version ?? '0.0.0' };
}
