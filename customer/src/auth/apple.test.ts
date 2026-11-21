import { Platform } from 'react-native';
import * as AppleAuthentication from 'expo-apple-authentication';
import { appleSignIn, makeNonce } from './apple';

describe('Sign in with Apple', () => {
  const signInAsync = AppleAuthentication.signInAsync as jest.Mock;
  const os = Platform.OS;
  beforeEach(() => {
    signInAsync.mockReset();
    Platform.OS = 'ios';
  });
  afterAll(() => {
    Platform.OS = os;
  });

  it('makes a fresh random nonce and its SHA-256', async () => {
    const nonce = await makeNonce();
    expect(nonce.raw).toMatch(/^[0-9a-f]{64}$/);
    expect(nonce.hashed).toBe(`sha256(${nonce.raw})`);
  });

  it('gives Apple the hashed nonce and returns the raw one with the fields the server reads', async () => {
    signInAsync.mockResolvedValue({ identityToken: 'a.b.c', fullName: { givenName: 'Asha', familyName: 'Rao' } });
    const result = await appleSignIn();
    const raw = 'ab'.repeat(32);
    expect(signInAsync).toHaveBeenCalledWith(expect.objectContaining({ nonce: `sha256(${raw})` }));
    expect(result).toEqual({ status: 'ok', idToken: 'a.b.c', nonce: raw, name: 'Asha Rao' });
  });

  it('a cancelled sheet is cancelled; no token is an error', async () => {
    signInAsync.mockRejectedValueOnce(Object.assign(new Error('no'), { code: 'ERR_REQUEST_CANCELED' }));
    expect(await appleSignIn()).toEqual({ status: 'cancelled' });
    signInAsync.mockResolvedValueOnce({ identityToken: null, fullName: null });
    expect(await appleSignIn()).toEqual({ status: 'error' });
  });
});
