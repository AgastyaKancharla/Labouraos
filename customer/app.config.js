/**
 * Laboura — the customer app (job seekers, businesses, referral partners).
 * One config for every build. Everything that changes between the test setup
 * and the live setup comes from environment variables, set per build profile
 * in eas.json (or in your shell for `npx expo start`):
 *
 *   EXPO_PUBLIC_API_URL             where the Nest API is. Test setup: https://app.laboura.com
 *   EXPO_PUBLIC_API_MODE            "live" (default) or "mock" (pretend data, no server needed).
 *                                   "mock" works only in local development (`npx expo start`): a
 *                                   release build (APK, Play Store, App Store) is always live (28 Nov).
 *
 * Sign-in is by mobile number only (24 Nov): no Google or Apple sign-in.
 * Over-the-air updates (expo-updates): a fix that changes only the app's
 * screens and logic can reach installed phones without a store review; a
 * change to native parts (new permission, new native module, SDK upgrade)
 * needs a new store build and raises the version (runtime = app version).

 *   EXPO_PUBLIC_LINK_PAGES_URL      where the link pages (/p/...) are; defaults to the API URL
 *   GOOGLE_SERVICES_JSON            path to Firebase's google-services.json (Android push). On EAS: a
 *                                   "file" environment variable. Locally: ./google-services.json if present.
 *                                   Never committed; when missing, the app still builds (no Android push).
 *   EAS_PROJECT_ID                  overrides the Expo project id (default: Agastya's project
 *                                   @agastyaks-team/laboura, created 21 Nov; push tokens and EAS builds need it)
 *
 * The Android package and iOS bundle identifier are FINAL: com.laboura.app
 * (confirmed by Agastya, 21 Nov). They can never change after the first Play
 * Store / App Store upload, so there is no setting to override them.
 */
const ANDROID_PACKAGE = 'com.laboura.app';
const IOS_BUNDLE_ID = 'com.laboura.app';
const API_URL = process.env.EXPO_PUBLIC_API_URL || 'https://app.laboura.com';

const fs = require('fs');
const path = require('path');

/** Only point at google-services.json when it exists, so local and CI builds work without it. */
function googleServicesFile() {
  const candidate = process.env.GOOGLE_SERVICES_JSON || './google-services.json';
  return fs.existsSync(path.resolve(__dirname, candidate)) ? candidate : undefined;
}
const GOOGLE_SERVICES_FILE = googleServicesFile();
/** The Expo project @agastyaks-team/laboura (not a secret: it only names the project). */
const EAS_OWNER = 'agastyaks-team';
const EAS_PROJECT_ID = process.env.EAS_PROJECT_ID || '4bd5337d-e2c5-458a-ab29-928d6c582e35';

const CAMERA_REASON = 'Laboura uses the camera for your live selfie and to scan your ID card during registration.';
const LOCATION_REASON = 'Laboura uses your location only when you tap "Locate me" to place your shop or home on the map.';

module.exports = () => ({
  name: 'Laboura',
  slug: 'laboura',
  owner: EAS_OWNER,
  scheme: 'laboura',
  // The version people see in the stores. Raise it with every store release that changes native parts.
  version: '1.0.0',
  runtimeVersion: { policy: 'appVersion' },
  updates: { url: `https://u.expo.dev/${EAS_PROJECT_ID}`, checkAutomatically: 'ON_LOAD', fallbackToCacheTimeout: 0 },
  orientation: 'portrait',
  icon: './assets/icon.png',
  userInterfaceStyle: 'light',
  backgroundColor: '#EEF3FC',
  primaryColor: '#0055C0',
  ios: {
    bundleIdentifier: IOS_BUNDLE_ID,
    supportsTablet: false,
    infoPlist: {
      NSCameraUsageDescription: CAMERA_REASON,
      NSLocationWhenInUseUsageDescription: LOCATION_REASON,
      ITSAppUsesNonExemptEncryption: false,
    },
  },
  android: {
    package: ANDROID_PACKAGE,
    // versionCode is counted by EAS for store builds (eas.json: appVersionSource remote, autoIncrement).
    ...(GOOGLE_SERVICES_FILE ? { googleServicesFile: GOOGLE_SERVICES_FILE } : {}),
    adaptiveIcon: {
      foregroundImage: './assets/adaptive-icon.png',
      backgroundColor: '#0055C0',
    },
    // Camera: the native selfie, Aadhaar QR scan and ID card photo (21 Nov). Location only for "Use my location".
    permissions: ['CAMERA', 'ACCESS_FINE_LOCATION', 'ACCESS_COARSE_LOCATION'],
    blockedPermissions: ['READ_MEDIA_IMAGES', 'READ_EXTERNAL_STORAGE', 'RECORD_AUDIO', 'ACCESS_BACKGROUND_LOCATION'],
  },
  web: {
    output: 'single',
    bundler: 'metro',
    name: 'Laboura',
    shortName: 'Laboura',
    themeColor: '#0055C0',
    backgroundColor: '#EEF3FC',
    favicon: './assets/favicon.png',
  },
  plugins: [
    'expo-router',
    'expo-secure-store',
    'expo-font',
    'expo-web-browser',
    ['expo-location', { locationWhenInUsePermission: LOCATION_REASON }],
    // Native verification steps (21 Nov): live camera only, never the gallery or the microphone.
    ['expo-camera', { cameraPermission: CAMERA_REASON, microphonePermission: false, recordAudioAndroid: false }],
    // Push (Agent C, customer/src/push/): small icon tint and the default Android channel.
    ['expo-notifications', { color: '#0055C0', defaultChannel: 'service' }],
  ],
  extra: {
    apiUrl: API_URL,
    apiMode: process.env.EXPO_PUBLIC_API_MODE || 'live',
    linkPagesUrl: process.env.EXPO_PUBLIC_LINK_PAGES_URL || API_URL,
    // EAS builds and getExpoPushTokenAsync need the project id.
    eas: { projectId: EAS_PROJECT_ID },
  },
});
