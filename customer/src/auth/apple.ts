import { Platform } from 'react-native';
import * as AppleAuthentication from 'expo-apple-authentication';

/**
 * Sign in with Apple, iPhone only (Apple rule 4.8: an app that offers Google
 * sign-in must also offer an equivalent privacy-friendly option). Needs the
 * paid Apple developer account to test on a real iPhone.
 */
export async function appleSignInAvailable(): Promise<boolean> {
  if (Platform.OS !== 'ios') return false;
  try {
    return await AppleAuthentication.isAvailableAsync();
  } catch {
    return false;
  }
}

export type AppleResult = { status: 'ok'; identityToken: string; fullName: string | null } | { status: 'cancelled' } | { status: 'error' };

export async function appleSignIn(): Promise<AppleResult> {
  try {
    const credential = await AppleAuthentication.signInAsync({
      requestedScopes: [AppleAuthentication.AppleAuthenticationScope.FULL_NAME, AppleAuthentication.AppleAuthenticationScope.EMAIL],
    });
    if (!credential.identityToken) return { status: 'error' };
    const name = [credential.fullName?.givenName, credential.fullName?.familyName].filter(Boolean).join(' ');
    return { status: 'ok', identityToken: credential.identityToken, fullName: name || null };
  } catch (error) {
    if ((error as { code?: string }).code === 'ERR_REQUEST_CANCELED') return { status: 'cancelled' };
    return { status: 'error' };
  }
}
