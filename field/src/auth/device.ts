import { randomUUID } from 'expo-crypto';
import type { KeyValueStore } from '@/lib/storage/types';

/**
 * The device id sent with every login. Approvals are per phone, so the id
 * must survive restarts. On the web it uses the same key as the old
 * /field-agent console, so a phone approved there stays approved here.
 */
export const DEVICE_ID_KEY = 'laboura_device_id';

export async function getDeviceId(storage: KeyValueStore, makeId: () => string = randomUUID): Promise<string> {
  const existing = await storage.getItem(DEVICE_ID_KEY);
  if (existing) return existing;
  const created = makeId();
  await storage.setItem(DEVICE_ID_KEY, created);
  return created;
}

/** The short form the agent reads to the Team Lead: first 8 characters, upper case. */
export function shortDeviceId(deviceId: string): string {
  return deviceId.replace(/-/g, '').slice(0, 8).toUpperCase();
}
