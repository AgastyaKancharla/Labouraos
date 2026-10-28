import { CloudflareAccessVerifier } from './cloudflare-access.verifier';
import {
  AccessKeypair,
  hs256ConfusionJwt,
  jwksBody,
  makeAccessKeypair,
  mockJwksEndpoint,
  signAccessJwt,
  TEST_AUD,
  TEST_JWKS_URL,
  TEST_TEAM_DOMAIN,
  unsignedAccessJwt,
} from '../../test-support/cloudflare-access-test-keys';

describe('Phase 8: Cloudflare Access JWT verification', () => {
  const saved = {
    team: process.env.CLOUDFLARE_ACCESS_TEAM_DOMAIN,
    aud: process.env.CLOUDFLARE_ACCESS_AUD,
    enforced: process.env.CLOUDFLARE_ACCESS_ENFORCED,
  };
  const restore = (k: string, v: string | undefined) => {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  };

  let real: AccessKeypair;
  let attacker: AccessKeypair;
  let verifier: CloudflareAccessVerifier;

  beforeAll(() => {
    real = makeAccessKeypair('kid-real');
    attacker = makeAccessKeypair('kid-real'); // same kid, different private key
  });

  beforeEach(() => {
    process.env.CLOUDFLARE_ACCESS_TEAM_DOMAIN = TEST_TEAM_DOMAIN;
    process.env.CLOUDFLARE_ACCESS_AUD = TEST_AUD;
    verifier = new CloudflareAccessVerifier();
  });

  afterEach(() => jest.restoreAllMocks());

  afterAll(() => {
    restore('CLOUDFLARE_ACCESS_TEAM_DOMAIN', saved.team);
    restore('CLOUDFLARE_ACCESS_AUD', saved.aud);
    restore('CLOUDFLARE_ACCESS_ENFORCED', saved.enforced);
  });

  it('accepts a genuine token signed by a key in the (mocked) JWKS and returns its claims', async () => {
    const fetchSpy = mockJwksEndpoint(() => ({ body: jwksBody(real) }));

    const claims = await verifier.verify(signAccessJwt(real, { email: 'ceo@laboura.local' }));

    expect(claims.email).toBe('ceo@laboura.local');
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy.mock.calls[0][0]).toBe(TEST_JWKS_URL);
  });

  it('caches the JWKS: a second verification makes no further request', async () => {
    const fetchSpy = mockJwksEndpoint(() => ({ body: jwksBody(real) }));

    await verifier.verify(signAccessJwt(real));
    await verifier.verify(signAccessJwt(real));

    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('rejects a forged token: right kid, signed with a different private key', async () => {
    mockJwksEndpoint(() => ({ body: jwksBody(real) }));

    await expect(verifier.verify(signAccessJwt(attacker))).rejects.toThrow(/signature/i);
  });

  it('rejects an unsigned (alg: none) token without touching the network', async () => {
    const fetchSpy = mockJwksEndpoint(() => ({ body: jwksBody(real) }));

    await expect(verifier.verify(unsignedAccessJwt('kid-real'))).rejects.toThrow(/algorithm/i);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('rejects an HS256 token keyed with the public key (algorithm confusion)', async () => {
    const fetchSpy = mockJwksEndpoint(() => ({ body: jwksBody(real) }));

    await expect(verifier.verify(hs256ConfusionJwt(real))).rejects.toThrow(/algorithm/i);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('rejects a validly signed token for a different audience', async () => {
    mockJwksEndpoint(() => ({ body: jwksBody(real) }));

    await expect(
      verifier.verify(signAccessJwt(real, { aud: ['some-other-application'] })),
    ).rejects.toThrow(/audience/i);
  });

  it('rejects a validly signed token from a different issuer', async () => {
    mockJwksEndpoint(() => ({ body: jwksBody(real) }));

    await expect(
      verifier.verify(signAccessJwt(real, { iss: 'https://evil.cloudflareaccess.com' })),
    ).rejects.toThrow(/issuer/i);
  });

  it('rejects an expired token', async () => {
    mockJwksEndpoint(() => ({ body: jwksBody(real) }));

    await expect(
      verifier.verify(signAccessJwt(real, { exp: Math.floor(Date.now() / 1000) - 60 })),
    ).rejects.toThrow(/expired/i);
  });

  it('rejects garbage that is not a JWT', async () => {
    const fetchSpy = mockJwksEndpoint(() => ({ body: jwksBody(real) }));

    await expect(verifier.verify('not-a-jwt')).rejects.toThrow(/malformed/i);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('fails closed when the JWKS endpoint errors', async () => {
    mockJwksEndpoint(() => ({ status: 503, body: {} }));

    await expect(verifier.verify(signAccessJwt(real))).rejects.toThrow(/signing keys/i);
  });

  it('fails closed when team domain or AUD is not configured', async () => {
    delete process.env.CLOUDFLARE_ACCESS_AUD;
    const fetchSpy = mockJwksEndpoint(() => ({ body: jwksBody(real) }));

    await expect(verifier.verify(signAccessJwt(real))).rejects.toThrow(/must be set/i);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('refuses to boot with enforcement on and no Cloudflare config', () => {
    process.env.CLOUDFLARE_ACCESS_ENFORCED = 'true';
    delete process.env.CLOUDFLARE_ACCESS_TEAM_DOMAIN;

    expect(() => verifier.onModuleInit()).toThrow(/must be set/i);
  });

  describe('key rotation and refetch abuse', () => {
    it('an unknown kid refetches once, then is rate-limited so random kids cannot hammer Cloudflare', async () => {
      const fetchSpy = mockJwksEndpoint(() => ({ body: jwksBody(real) }));
      const stranger = makeAccessKeypair('kid-unknown');
      const t0 = 1_000_000;

      await expect(verifier.verify(signAccessJwt(stranger), t0)).rejects.toThrow(/key id/i);
      await expect(verifier.verify(signAccessJwt(stranger), t0 + 1_000)).rejects.toThrow(/key id/i);
      await expect(verifier.verify(signAccessJwt(stranger), t0 + 2_000)).rejects.toThrow(/key id/i);

      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });

    it('picks up a rotated-in key once the cooldown has passed', async () => {
      const rotated = makeAccessKeypair('kid-rotated');
      let body = jwksBody(real);
      const fetchSpy = mockJwksEndpoint(() => ({ body }));
      const t0 = 2_000_000;

      await verifier.verify(signAccessJwt(real), t0);
      await expect(verifier.verify(signAccessJwt(rotated), t0 + 1_000)).rejects.toThrow(/key id/i);

      body = jwksBody(real, rotated); // Cloudflare rotates
      const claims = await verifier.verify(signAccessJwt(rotated), t0 + 61_000);

      expect(claims.email).toBeDefined();
      expect(fetchSpy).toHaveBeenCalledTimes(2);
    });
  });
});
