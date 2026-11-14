import { Platform } from 'react-native';
import { GoogleSignin, isErrorWithCode, isSuccessResponse, statusCodes } from '@react-native-google-signin/google-signin';
import { apiMode, googleClientIds } from '@/api/config';

/**
 * "Continue with Google" with @react-native-google-signin/google-signin: the
 * native Google account picker (Android Credential Manager / Google Play
 * services, iOS Google Sign-In SDK). It works in EAS development and preview
 * builds, NOT in Expo Go (no native code there) — see customer/README.md.
 *
 * The app sends only the Google ID token to the server, which checks it
 * against the Web client id and creates or finds the account. The Google
 * profile picture is not used (proposal 7.1).
 */
export type GoogleResult =
  | { status: 'ok'; idToken: string }
  | { status: 'cancelled' }
  | { status: 'unavailable'; reason: 'not_configured' | 'no_play_services' | 'not_in_this_build' }
  | { status: 'error'; message: string };

let configured = false;

/**
 * The Web client id comes from the build (EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID)
 * or, when the build has none, from the server's GET /config — so a new
 * client id needs no new app build. (iPhone also needs its URL scheme in the
 * build: GOOGLE_IOS_URL_SCHEME.)
 */
function configure(fromServer?: { webClientId: string | null; iosClientId: string | null }): boolean {
  const built = googleClientIds();
  const webClientId = built.webClientId || fromServer?.webClientId || '';
  const iosClientId = built.iosClientId || fromServer?.iosClientId || '';
  if (!webClientId) return false;
  if (!configured) {
    GoogleSignin.configure({ webClientId, ...(iosClientId ? { iosClientId } : {}), scopes: ['email', 'profile'] });
    configured = true;
  }
  return true;
}

export async function googleSignIn(fromServer?: { webClientId: string | null; iosClientId: string | null }): Promise<GoogleResult> {
  // Pretend data: no Google account needed (works in Expo Go and on the web).
  if (apiMode() === 'mock') return { status: 'ok', idToken: 'mock-google-id-token' };
  if (Platform.OS === 'web') return { status: 'unavailable', reason: 'not_in_this_build' };
  try {
    if (!configure(fromServer)) return { status: 'unavailable', reason: 'not_configured' };
    if (Platform.OS === 'android') await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });
    const response = await GoogleSignin.signIn();
    if (!isSuccessResponse(response)) return { status: 'cancelled' };
    const idToken = response.data.idToken;
    if (!idToken) return { status: 'error', message: 'no_id_token' };
    return { status: 'ok', idToken };
  } catch (error) {
    if (isErrorWithCode(error)) {
      if (error.code === statusCodes.SIGN_IN_CANCELLED) return { status: 'cancelled' };
      if (error.code === statusCodes.IN_PROGRESS) return { status: 'cancelled' };
      if (error.code === statusCodes.PLAY_SERVICES_NOT_AVAILABLE) return { status: 'unavailable', reason: 'no_play_services' };
      return { status: 'error', message: String(error.code) };
    }
    // The native module is missing (Expo Go).
    return { status: 'unavailable', reason: 'not_in_this_build' };
  }
}

/** Forget the Google account choice on this phone (sign-out). Never throws. */
export async function googleSignOut(): Promise<void> {
  if (!configured) return;
  try {
    await GoogleSignin.signOut();
  } catch {
    /* nothing to do */
  }
}
