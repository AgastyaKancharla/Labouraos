import { Platform } from 'react-native';
import * as AppleAuthentication from 'expo-apple-authentication';
import * as Crypto from 'expo-crypto';

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

/**
 * `idToken` and `name` are the names the server reads (docs/customer-app-api.md
 * 3.2). `nonce` is the raw one-time value: Apple puts its SHA-256 into the
 * token and the server checks the two match, so a token caught on the way
 * cannot be used again from another sign-in.
 */
export type AppleResult = { status: 'ok'; idToken: string; nonce: string; name: string | null } | { status: 'cancelled' } | { status: 'error' };

/** A fresh random one-time value (32 random bytes as hex) and its SHA-256 for Apple. */
export async function makeNonce(): Promise<{ raw: string; hashed: string }> {
  const bytes = Crypto.getRandomBytes(32);
  const raw = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  const hashed = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, raw);
  return { raw, hashed };
}

export async function appleSignIn(): Promise<AppleResult> {
  try {
    const nonce = await makeNonce();
    const credential = await AppleAuthentication.signInAsync({
      requestedScopes: [AppleAuthentication.AppleAuthenticationScope.FULL_NAME, AppleAuthentication.AppleAuthenticationScope.EMAIL],
      nonce: nonce.hashed,
    });
    if (!credential.identityToken) return { status: 'error' };
    const name = [credential.fullName?.givenName, credential.fullName?.familyName].filter(Boolean).join(' ');
    return { status: 'ok', idToken: credential.identityToken, nonce: nonce.raw, name: name || null };
  } catch (error) {
    if ((error as { code?: string }).code === 'ERR_REQUEST_CANCELED') return { status: 'cancelled' };
    return { status: 'error' };
  }
}
