import * as Crypto from 'expo-crypto';

/**
 * A random id made on the phone. A shop visit gets its id here so the visit
 * and its later steps can wait in the offline queue and still be sent in order.
 */
export function newId(): string {
  try {
    return Crypto.randomUUID();
  } catch {
    const hex = (n: number) => Array.from({ length: n }, () => Math.floor(Math.random() * 16).toString(16)).join('');
    return `${hex(8)}-${hex(4)}-4${hex(3)}-${'89ab'[Math.floor(Math.random() * 4)]}${hex(3)}-${hex(12)}`;
  }
}
