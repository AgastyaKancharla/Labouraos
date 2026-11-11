/**
 * Web app: the browser's online/offline events. `navigator.onLine` can say
 * "online" on Wi-Fi with no internet, so it only triggers send attempts —
 * a failed send is what really decides.
 */
export async function getOnline(): Promise<boolean> {
  return typeof navigator === 'undefined' ? true : navigator.onLine !== false;
}

export function subscribeOnline(listener: (online: boolean) => void): () => void {
  if (typeof window === 'undefined') return () => undefined;
  const on = () => listener(true);
  const off = () => listener(false);
  window.addEventListener('online', on);
  window.addEventListener('offline', off);
  return () => {
    window.removeEventListener('online', on);
    window.removeEventListener('offline', off);
  };
}
