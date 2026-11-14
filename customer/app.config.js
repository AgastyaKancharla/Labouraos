/**
 * Laboura — the customer app (job seekers, businesses, referral partners).
 * One config for every build. Everything that changes between the test setup
 * and the live setup comes from environment variables, set per build profile
 * in eas.json (or in your shell for `npx expo start`):
 *
 *   EXPO_PUBLIC_API_URL             where the Nest API is. Test setup: https://app.laboura.com
 *   EXPO_PUBLIC_API_MODE            "live" (default) or "mock" (pretend data, no server needed)
 *   EXPO_PUBLIC_LINK_PAGES_URL      where the link pages (/p/...) are; defaults to the API URL
 *   EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID      Google OAuth "Web application" client id (the server checks the id token against it)
 *   EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID      Google OAuth "iOS" client id
 *   GOOGLE_IOS_URL_SCHEME                 the iOS client id reversed (com.googleusercontent.apps.…), used at build time
 *   LABOURA_ANDROID_PACKAGE / LABOURA_IOS_BUNDLE_ID   override the placeholder identifiers below
 *
 * The Android package and iOS bundle identifier are PLACEHOLDERS
 * (com.laboura.app) until the owner confirms them. They cannot be changed
 * after the first Play Store / App Store upload, so confirm before that.
 * See customer/README.md, "What the owner sets up".
 */
const ANDROID_PACKAGE = process.env.LABOURA_ANDROID_PACKAGE || 'com.laboura.app';
const IOS_BUNDLE_ID = process.env.LABOURA_IOS_BUNDLE_ID || 'com.laboura.app';
const API_URL = process.env.EXPO_PUBLIC_API_URL || 'https://app.laboura.com';
// Placeholder scheme so `expo prebuild` works before the real iOS client exists.
const GOOGLE_IOS_URL_SCHEME = process.env.GOOGLE_IOS_URL_SCHEME || 'com.googleusercontent.apps.replace-with-ios-client-id';

const CAMERA_REASON = 'Laboura uses the camera for your live selfie and to scan your ID card during registration.';
const LOCATION_REASON = 'Laboura uses your location only when you tap "Use my location" to place your shop or area on the map.';

module.exports = () => ({
  name: 'Laboura',
  slug: 'laboura',
  scheme: 'laboura',
  version: '0.1.0',
  orientation: 'portrait',
  icon: './assets/icon.png',
  userInterfaceStyle: 'light',
  backgroundColor: '#EEF3FC',
  primaryColor: '#0055C0',
  ios: {
    bundleIdentifier: IOS_BUNDLE_ID,
    supportsTablet: false,
    usesAppleSignIn: true,
    infoPlist: {
      NSCameraUsageDescription: CAMERA_REASON,
      NSLocationWhenInUseUsageDescription: LOCATION_REASON,
      ITSAppUsesNonExemptEncryption: false,
    },
  },
  android: {
    package: ANDROID_PACKAGE,
    versionCode: 1,
    adaptiveIcon: {
      foregroundImage: './assets/adaptive-icon.png',
      backgroundColor: '#0055C0',
    },
    // The camera itself is used inside the secure browser sheet (Chrome), which
    // asks for its own permission. Location only for "Use my location".
    permissions: ['ACCESS_FINE_LOCATION', 'ACCESS_COARSE_LOCATION'],
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
    'expo-apple-authentication',
    ['@react-native-google-signin/google-signin', { iosUrlScheme: GOOGLE_IOS_URL_SCHEME }],
    ['expo-location', { locationWhenInUsePermission: LOCATION_REASON }],
  ],
  extra: {
    apiUrl: API_URL,
    apiMode: process.env.EXPO_PUBLIC_API_MODE || 'live',
    linkPagesUrl: process.env.EXPO_PUBLIC_LINK_PAGES_URL || API_URL,
    googleWebClientId: process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID || '',
    googleIosClientId: process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID || '',
    // Filled by `eas init` once the owner's Expo account exists:
    // eas: { projectId: '…' },
  },
});
