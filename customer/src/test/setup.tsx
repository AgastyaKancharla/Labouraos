/* Native modules replaced with small fakes for Jest. */

jest.mock('react-native-safe-area-context', () => require('react-native-safe-area-context/jest/mock').default);

jest.mock('expo-secure-store', () => {
  const data = new Map<string, string>();
  return {
    getItemAsync: jest.fn(async (key: string) => data.get(key) ?? null),
    setItemAsync: jest.fn(async (key: string, value: string) => void data.set(key, value)),
    deleteItemAsync: jest.fn(async (key: string) => void data.delete(key)),
  };
});

jest.mock('expo-location', () => ({
  Accuracy: { Balanced: 3 },
  requestForegroundPermissionsAsync: jest.fn(async () => ({ granted: true })),
  getCurrentPositionAsync: jest.fn(async () => ({ coords: { latitude: 12.9166, longitude: 77.6101, accuracy: 15 }, timestamp: Date.now() })),
}));

jest.mock('expo-font', () => ({
  useFonts: () => [true, null],
  loadAsync: jest.fn(async () => undefined),
  isLoaded: () => true,
}));

jest.mock('expo-linear-gradient', () => {
  const { View } = require('react-native');
  return { LinearGradient: View };
});

jest.mock('expo-clipboard', () => ({ setStringAsync: jest.fn(async () => true) }));

jest.mock('expo-web-browser', () => ({
  openAuthSessionAsync: jest.fn(async () => ({ type: 'dismiss' })),
  openBrowserAsync: jest.fn(async () => ({ type: 'dismiss' })),
  dismissBrowser: jest.fn(async () => ({ type: 'dismiss' })),
  WebBrowserPresentationStyle: { PAGE_SHEET: 'pageSheet' },
}));

jest.mock('expo-apple-authentication', () => ({
  isAvailableAsync: jest.fn(async () => false),
  signInAsync: jest.fn(),
  AppleAuthenticationScope: { FULL_NAME: 0, EMAIL: 1 },
}));

jest.mock('@react-native-google-signin/google-signin', () => ({
  GoogleSignin: {
    configure: jest.fn(),
    hasPlayServices: jest.fn(async () => true),
    signIn: jest.fn(async () => ({ type: 'success', data: { idToken: 'google-id-token' } })),
    signOut: jest.fn(async () => null),
  },
  statusCodes: { SIGN_IN_CANCELLED: 'SIGN_IN_CANCELLED', IN_PROGRESS: 'IN_PROGRESS', PLAY_SERVICES_NOT_AVAILABLE: 'PLAY_SERVICES_NOT_AVAILABLE' },
  isErrorWithCode: (e: unknown) => !!e && typeof e === 'object' && 'code' in (e as object),
  isSuccessResponse: (r: { type: string }) => r.type === 'success',
}));

jest.mock('react-native-qrcode-svg', () => {
  const { View } = require('react-native');
  return function QRCode({ value }: { value: string }) {
    return <View testID="qr-code" accessibilityLabel={value} />;
  };
});

jest.mock('expo-crypto', () => ({ randomUUID: jest.fn(() => 'install-uuid') }));

// Push (Agent C's customer/src/push/ uses these).
jest.mock('expo-notifications', () => ({
  setNotificationHandler: jest.fn(),
  setNotificationChannelAsync: jest.fn(async () => null),
  getPermissionsAsync: jest.fn(async () => ({ status: 'undetermined', granted: false, canAskAgain: true })),
  requestPermissionsAsync: jest.fn(async () => ({ status: 'granted', granted: true, canAskAgain: true })),
  getExpoPushTokenAsync: jest.fn(async () => ({ type: 'expo', data: 'ExponentPushToken[test]' })),
  getDevicePushTokenAsync: jest.fn(async () => ({ type: 'android', data: 'device-token' })),
  addNotificationReceivedListener: jest.fn(() => ({ remove: jest.fn() })),
  addNotificationResponseReceivedListener: jest.fn(() => ({ remove: jest.fn() })),
  addPushTokenListener: jest.fn(() => ({ remove: jest.fn() })),
  getLastNotificationResponseAsync: jest.fn(async () => null),
  useLastNotificationResponse: jest.fn(() => null),
  setBadgeCountAsync: jest.fn(async () => true),
  dismissAllNotificationsAsync: jest.fn(async () => undefined),
  AndroidImportance: { DEFAULT: 3, HIGH: 4, MAX: 5, LOW: 2, MIN: 1 },
  PermissionStatus: { GRANTED: 'granted', DENIED: 'denied', UNDETERMINED: 'undetermined' },
}));

jest.mock('expo-constants', () => {
  const constants = { expoConfig: { version: '0.1.0', extra: { eas: { projectId: 'test-project-id' } } }, easConfig: { projectId: 'test-project-id' } };
  return { __esModule: true, default: constants, ...constants };
});
