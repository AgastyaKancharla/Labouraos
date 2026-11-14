/**
 * Getting this phone's Expo push token and telling the server
 * (PUT /me/device). Android needs its notification channels before the first
 * push; the ids match the server's (service, job-updates, promotions).
 *
 * Push works only in a real build (APK / TestFlight), not in Expo Go or on
 * the web; there the server simply gets "no token" and the inbox still works.
 */
import { Platform } from 'react-native';
import Constants from 'expo-constants';
import * as Notifications from 'expo-notifications';
import { AndroidImportance, AndroidNotificationVisibility } from 'expo-notifications';
import { deviceInfo } from '@/auth/installation';
import type { Language } from '@/i18n';
import type { PushApi } from './pushApi';
import { pushText } from './strings';

export const ANDROID_CHANNELS = [
  { id: 'service', key: 'channel.service', importance: AndroidImportance.HIGH },
  { id: 'job-updates', key: 'channel.jobUpdates', importance: AndroidImportance.DEFAULT },
  { id: 'promotions', key: 'channel.promotions', importance: AndroidImportance.LOW },
] as const;

export async function ensureAndroidChannels(language: Language): Promise<void> {
  if (Platform.OS !== 'android') return;
  for (const channel of ANDROID_CHANNELS) {
    await Notifications.setNotificationChannelAsync(channel.id, {
      name: pushText(language, channel.key),
      importance: channel.importance,
      lightColor: '#0055C0',
      // Lock screen: the text is already free of private details (server rule).
      lockscreenVisibility: AndroidNotificationVisibility.PRIVATE,
    });
  }
}

/** The EAS project id from app.config.js (extra.eas.projectId), needed for the token. */
export function easProjectId(): string | null {
  const fromExtra = (Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined)?.eas?.projectId;
  const fromEas = (Constants as unknown as { easConfig?: { projectId?: string } }).easConfig?.projectId;
  return fromExtra || fromEas || null;
}

export type PermissionState = 'granted' | 'denied' | 'undetermined';

export async function currentPermission(): Promise<PermissionState> {
  const { status } = await Notifications.getPermissionsAsync();
  return status === 'granted' ? 'granted' : status === 'denied' ? 'denied' : 'undetermined';
}

export async function askPermission(): Promise<PermissionState> {
  const { status } = await Notifications.requestPermissionsAsync();
  return status === 'granted' ? 'granted' : status === 'denied' ? 'denied' : 'undetermined';
}

/**
 * Reads the permission and, when granted, the push token, and reports both.
 * Never throws: a phone that cannot get a token (no Google Play services,
 * Expo Go, no project id yet) is reported without one.
 */
export async function registerDevice(api: PushApi, permission?: PermissionState, tokenOverride?: string | null): Promise<string | null> {
  if (Platform.OS === 'web') return null;
  try {
    const state = permission ?? (await currentPermission());
    let token: string | null = tokenOverride ?? null;
    if (state === 'granted' && token === null) {
      const projectId = easProjectId();
      if (projectId) {
        token = (await Notifications.getExpoPushTokenAsync({ projectId })).data;
      }
    }
    const device = await deviceInfo();
    await api.putDevice({ ...device, pushToken: state === 'granted' ? token : null, pushPermission: state });
    return token;
  } catch {
    return null;
  }
}
