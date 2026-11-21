/**
 * The browser or app family and the platform of a User-Agent header, e.g.
 * "chrome/android", "safari/ios", "edge/windows", "app/android". Used by the
 * "login code once a day" shortcut (21 Nov hardening): a later sign-in without
 * a code is allowed only from the same family as the sign-in that had the
 * code, because the device id itself is sent by the client. Version numbers
 * are ignored so a browser update the same day does not ask for a code.
 */
export function userAgentFamily(userAgent: string | null | undefined): string {
  const ua = (userAgent ?? '').toLowerCase();
  if (!ua.trim()) return 'unknown/unknown';
  const browser =
    /okhttp|expo|reactnative|react-native|laboura ?field|cfnetwork|dalvik/.test(ua)
      ? 'app'
      : /edg(e|a|ios)?\//.test(ua)
        ? 'edge'
        : /opr\/|opera/.test(ua)
          ? 'opera'
          : /samsungbrowser/.test(ua)
            ? 'samsung'
            : /firefox|fxios/.test(ua)
              ? 'firefox'
              : /chrome|crios|chromium/.test(ua)
                ? 'chrome'
                : /safari/.test(ua)
                  ? 'safari'
                  : 'other';
  const platform = /android/.test(ua)
    ? 'android'
    : /iphone|ipad|ipod|ios/.test(ua)
      ? 'ios'
      : /cros/.test(ua)
        ? 'chromeos'
        : /windows/.test(ua)
          ? 'windows'
          : /mac os|macintosh/.test(ua)
            ? 'mac'
            : /linux/.test(ua)
              ? 'linux'
              : 'other';
  return `${browser}/${platform}`;
}
