/**
 * "Or pay with" UPI app buttons (Master Guide rev 204, 21 Nov): direct UPI to
 * the company account, no gateway. Every button opens the person's UPI app
 * with exactly what the QR carries — the payee UPI ID (pa), payee name (pn),
 * exact amount (am), note (tn), the payment reference (tr) and INR — read
 * from the request's own upi://pay link, so nothing is retyped or changed.
 *
 * Android: an intent link names the app's package (reliable in Chrome), with
 * the plain upi://pay link as the fallback. iPhone: each app's own scheme
 * where it is known to work (PhonePe, Google Pay, Paytm); BHIM and "Other
 * UPI app" use upi://pay. On a laptop no buttons are shown, only the QR.
 */
export type UpiApp = 'phonepe' | 'gpay' | 'paytm' | 'bhim' | 'other';
export type UpiPlatform = 'android' | 'ios' | 'desktop';

export const UPI_APPS: readonly UpiApp[] = ['phonepe', 'gpay', 'paytm', 'bhim', 'other'];

const ANDROID_PACKAGE: Record<Exclude<UpiApp, 'other'>, string> = {
  phonepe: 'com.phonepe.app',
  gpay: 'com.google.android.apps.nbu.paisa.user',
  paytm: 'net.one97.paytm',
  bhim: 'in.org.npci.upiapp',
};

/** iPhone schemes that open the app's UPI payment screen with the fields filled. */
const IOS_SCHEME: Partial<Record<UpiApp, string>> = {
  phonepe: 'phonepe://pay',
  gpay: 'tez://upi/pay',
  paytm: 'paytmmp://pay',
};

/** Only the UPI fields of the request's link, in a fixed order (nothing else is passed on). */
const FIELDS = ['pa', 'pn', 'am', 'tn', 'tr', 'cu'] as const;

/** The query of a upi://pay link ("pa=…&pn=…"), or null when it is not one. */
export function upiQuery(upiUri: string): string | null {
  const m = /^upi:\/\/pay\?(.*)$/i.exec(upiUri ?? '');
  if (!m) return null;
  const given = new URLSearchParams(m[1]);
  if (!given.get('pa') || !given.get('am')) return null;
  const out = new URLSearchParams();
  for (const key of FIELDS) {
    const value = given.get(key);
    if (value !== null) out.set(key, value);
  }
  return out.toString();
}

/** The link one button opens on this platform (null on a laptop, or for a link that is not upi://pay). */
export function upiAppLink(app: UpiApp, upiUri: string, platform: UpiPlatform): string | null {
  const query = upiQuery(upiUri);
  if (!query || platform === 'desktop') return null;
  const plain = `upi://pay?${query}`;
  if (app === 'other') return plain;
  if (platform === 'android') {
    return `intent://pay?${query}#Intent;scheme=upi;package=${ANDROID_PACKAGE[app]};S.browser_fallback_url=${encodeURIComponent(plain)};end`;
  }
  const scheme = IOS_SCHEME[app];
  return scheme ? `${scheme}?${query}` : plain;
}

/** Phone or laptop, from the browser's user agent (iPadOS reports a Mac with touch). */
export function detectUpiPlatform(nav: { userAgent?: string; maxTouchPoints?: number } | undefined = typeof navigator === 'undefined' ? undefined : navigator): UpiPlatform {
  const ua = nav?.userAgent ?? '';
  if (/android/i.test(ua)) return 'android';
  if (/iphone|ipad|ipod/i.test(ua) || (/macintosh/i.test(ua) && (nav?.maxTouchPoints ?? 0) > 1)) return 'ios';
  return 'desktop';
}
