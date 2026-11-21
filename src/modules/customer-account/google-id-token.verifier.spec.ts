import { HttpException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { generateKeyPairSync, KeyObject } from 'node:crypto';
import { AppleIdTokenVerifier, GoogleIdTokenVerifier } from './google-id-token.verifier';

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const other = generateKeyPairSync('rsa', { modulusLength: 2048 });

class TestVerifier extends GoogleIdTokenVerifier {
  fetches = 0;
  protected async fetchKeys() {
    this.fetches += 1;
    return { keys: [{ ...(publicKey as KeyObject).export({ format: 'jwk' }), kid: 'k1', alg: 'RS256' }], maxAgeMs: 3_600_000 };
  }
}

class TestApple extends AppleIdTokenVerifier {
  protected async fetchKeys() {
    return { keys: [{ ...(publicKey as KeyObject).export({ format: 'jwk' }), kid: 'k1', alg: 'RS256' }], maxAgeMs: 3_600_000 };
  }
}

function sign(claims: Record<string, unknown>, options: { key?: KeyObject; audience?: string; issuer?: string; kid?: string } = {}) {
  return new JwtService({}).sign({ email_verified: true, ...claims }, {
    privateKey: (options.key ?? (privateKey as KeyObject)).export({ type: 'pkcs8', format: 'pem' }).toString(),
    algorithm: 'RS256',
    keyid: options.kid ?? 'k1',
    audience: options.audience ?? 'android-client',
    issuer: options.issuer ?? 'https://accounts.google.com',
    expiresIn: 600,
  });
}

function code(error: unknown) {
  return error instanceof HttpException ? (error.getResponse() as { code?: string }).code : undefined;
}

/** Google sign-in is checked on the server against Google's keys and Laboura's client ids (decided 14 Nov). */
describe('GoogleIdTokenVerifier', () => {
  const saved = { ...process.env };
  beforeEach(() => {
    process.env.GOOGLE_CLIENT_ID_ANDROID = 'android-client';
    process.env.GOOGLE_CLIENT_ID_IOS = '';
    process.env.GOOGLE_CLIENT_ID_WEB = 'web-client';
  });
  afterAll(() => {
    process.env = saved;
  });

  async function failure(verifier: GoogleIdTokenVerifier | AppleIdTokenVerifier, token: unknown, nonce?: string) {
    try {
      await verifier.verify(token, nonce);
    } catch (error) {
      return code(error);
    }
    return 'accepted';
  }

  it('accepts a token signed by Google for one of Laboura\'s client ids, keeping no picture', async () => {
    const verifier = new TestVerifier();
    const identity = await verifier.verify(sign({ sub: 'g-1', email: 'Owner@Gmail.com', name: 'Lakshmi', picture: 'https://x/y.png' }, { audience: 'web-client' }));
    expect(identity).toEqual(expect.objectContaining({ sub: 'g-1', email: 'owner@gmail.com', emailVerified: true, name: 'Lakshmi', issuedAt: expect.any(Number) }));
    expect(identity).not.toHaveProperty('picture');
  });

  it('refuses another audience, another issuer, another key, an unknown key id and an unverified email', async () => {
    const verifier = new TestVerifier();
    expect(await failure(verifier, sign({ sub: 'g' }, { audience: 'someone-else' }))).toBe('GOOGLE_TOKEN_INVALID');
    expect(await failure(verifier, sign({ sub: 'g' }, { issuer: 'https://evil.example' }))).toBe('GOOGLE_TOKEN_INVALID');
    expect(await failure(verifier, sign({ sub: 'g' }, { key: other.privateKey as KeyObject }))).toBe('GOOGLE_TOKEN_INVALID');
    expect(await failure(verifier, sign({ sub: 'g' }, { kid: 'nope' }))).toBe('GOOGLE_TOKEN_INVALID');
    expect(await failure(verifier, sign({ sub: 'g', email: 'a@b.c', email_verified: false }))).toBe('GOOGLE_TOKEN_INVALID');
    expect(await failure(verifier, 'not-a-token')).toBe('GOOGLE_TOKEN_INVALID');
  });

  it('is off (503) when no client id is set', async () => {
    process.env.GOOGLE_CLIENT_ID_ANDROID = '';
    process.env.GOOGLE_CLIENT_ID_WEB = '';
    expect(await failure(new TestVerifier(), sign({ sub: 'g' }))).toBe('GOOGLE_NOT_CONFIGURED');
  });

  it('checks the nonce when the app sends one (raw or SHA-256 in the token)', async () => {
    const verifier = new TestVerifier();
    await expect(verifier.verify(sign({ sub: 'g', nonce: 'n-123' }), 'n-123')).resolves.toEqual(expect.objectContaining({ sub: 'g' }));
    expect(await failure(verifier, sign({ sub: 'g', nonce: 'other' }))).toBe('accepted');
    expect(await failure(verifier, sign({ sub: 'g', nonce: 'other' }), 'n-123')).toBe('GOOGLE_TOKEN_INVALID');
  });

  it('Sign in with Apple: off until configured, then checks Apple\'s issuer and the bundle id', async () => {
    process.env.APPLE_CLIENT_ID_IOS = '';
    process.env.APPLE_CLIENT_ID_WEB = '';
    expect(await failure(new TestApple(), sign({ sub: 'a' }, { issuer: 'https://appleid.apple.com', audience: 'com.laboura.app' }))).toBe('APPLE_NOT_CONFIGURED');
    process.env.APPLE_CLIENT_ID_IOS = 'com.laboura.app';
    const apple = new TestApple();
    await expect(apple.verify(sign({ sub: 'a' }, { issuer: 'https://appleid.apple.com', audience: 'com.laboura.app' }))).resolves.toEqual(expect.objectContaining({ sub: 'a' }));
    expect(await failure(apple, sign({ sub: 'a' }, { issuer: 'https://accounts.google.com', audience: 'com.laboura.app' }))).toBe('APPLE_TOKEN_INVALID');
  });

  it('caches Google\'s keys', async () => {
    const verifier = new TestVerifier();
    await verifier.verify(sign({ sub: 'g-1' }));
    await verifier.verify(sign({ sub: 'g-2' }));
    expect(verifier.fetches).toBe(1);
  });
});
