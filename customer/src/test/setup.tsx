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

jest.mock('expo-crypto', () => ({
  randomUUID: jest.fn(() => 'install-uuid'),
  getRandomBytes: jest.fn((n: number) => new Uint8Array(n).fill(171)),
  digestStringAsync: jest.fn(async (_algorithm: string, value: string) => `sha256(${value})`),
  CryptoDigestAlgorithm: { SHA256: 'SHA-256' },
}));

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

// The native verification steps (src/verify/): a fake camera that is always
// allowed and "takes" a 1600×1200 picture; tests drive the QR scan through
// `global.__scanQr(text)`.
jest.mock('expo-camera', () => {
  const React = require('react');
  const { View } = require('react-native');
  const permission = { granted: true, status: 'granted', canAskAgain: true, expires: 'never' };
  const CameraView = React.forwardRef(function CameraView(props: { onCameraReady?: () => void; onBarcodeScanned?: (r: { data: string; type: string }) => void; testID?: string }, ref: unknown) {
    React.useImperativeHandle(ref, () => ({ takePictureAsync: jest.fn(async () => ({ uri: 'file:///camera/shot.jpg', width: 1600, height: 1200 })) }));
    React.useEffect(() => {
      props.onCameraReady?.();
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);
    (globalThis as { __scanQr?: (text: string) => void }).__scanQr = (text: string) => props.onBarcodeScanned?.({ data: text, type: 'qr' });
    return <View testID={props.testID ?? 'camera-view'} />;
  });
  return { CameraView, useCameraPermissions: () => [permission, jest.fn(async () => permission)] };
});

jest.mock('expo-image-manipulator', () => {
  // `__size` is the size of the drawn picture; tests change it to try other shapes.
  const size = { width: 1600, height: 1200 };
  const saveAsync = jest.fn(async () => ({ uri: 'file:///cache/prepared.jpg', width: 1280, height: 960 }));
  const makeContext = () => {
    const context: { resize: jest.Mock; renderAsync: jest.Mock } = { resize: jest.fn(), renderAsync: jest.fn(async () => ({ width: size.width, height: size.height, saveAsync })) };
    context.resize.mockImplementation(() => context);
    return context;
  };
  return { ImageManipulator: { manipulate: jest.fn(() => makeContext()) }, SaveFormat: { JPEG: 'jpeg', PNG: 'png' }, __size: size };
});

// Photos are deleted from the cache after use; `__deleted` lists what was deleted.
jest.mock('expo-file-system', () => {
  const deleted: string[] = [];
  class File {
    uri: string;
    exists = true;
    constructor(uri: string) {
      this.uri = uri;
    }
    delete() {
      deleted.push(this.uri);
    }
  }
  return { File, __deleted: deleted };
});

