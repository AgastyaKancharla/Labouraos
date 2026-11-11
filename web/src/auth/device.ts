/**
 * The device id sent with every login. Approvals are per device, so the id
 * must survive browser restarts: it lives in localStorage under the same key
 * the old consoles use, so a device approved there stays approved here.
 */
export const DEVICE_ID_KEY = 'laboura_device_id';

export function getDeviceId(): string {
  try {
    const existing = localStorage.getItem(DEVICE_ID_KEY);
    if (existing) return existing;
    const created =
      typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : `dev-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    localStorage.setItem(DEVICE_ID_KEY, created);
    return created;
  } catch {
    // Storage blocked (private mode): a per-tab id still lets the login reach
    // the server, which will treat it as a new device waiting for approval.
    return `tab-${Date.now()}`;
  }
}
