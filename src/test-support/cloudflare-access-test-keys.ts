import { JwtService } from '@nestjs/jwt';
import { generateKeyPairSync, KeyObject } from 'node:crypto';

export const TEST_TEAM_DOMAIN = 'laboura-test.cloudflareaccess.com';
export const TEST_AUD = 'test-aud-tag-0123456789abcdef0123456789abcdef';
export const TEST_JWKS_URL = `https://${TEST_TEAM_DOMAIN}/cdn-cgi/access/certs`;

export interface AccessKeypair {
  kid: string;
  privateKey: KeyObject;
  publicKey: KeyObject;
}

export function makeAccessKeypair(kid: string): AccessKeypair {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  return { kid, privateKey, publicKey };
}

/** The body Cloudflare serves at /cdn-cgi/access/certs. */
export function jwksBody(...pairs: AccessKeypair[]) {
  return {
    keys: pairs.map((p) => ({
      ...p.publicKey.export({ format: 'jwk' }),
      kid: p.kid,
      use: 'sig',
      alg: 'RS256',
    })),
  };
}

/**
 * Real RS256 token shaped like a Cloudflare Access assertion. Defaults are a
 * valid token for TEST_TEAM_DOMAIN / TEST_AUD; override a field to break it.
 */
export function signAccessJwt(
  pair: AccessKeypair,
  overrides: { aud?: string[]; iss?: string; exp?: number; email?: string } = {},
): string {
  return new JwtService().sign(
    {
      email: overrides.email ?? 'agent@laboura.local',
      sub: 'cf-user-1',
      aud: overrides.aud ?? [TEST_AUD],
      iss: overrides.iss ?? `https://${TEST_TEAM_DOMAIN}`,
      exp: overrides.exp ?? Math.floor(Date.now() / 1000) + 300,
    },
    { privateKey: pair.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(), algorithm: 'RS256', keyid: pair.kid },
  );
}

const b64url = (v: unknown) => Buffer.from(JSON.stringify(v)).toString('base64url');

/** `alg: none` token with no signature at all. */
export function unsignedAccessJwt(kid: string): string {
  return `${b64url({ alg: 'none', typ: 'JWT', kid })}.${b64url({
    email: 'attacker@evil.test',
    aud: [TEST_AUD],
    iss: `https://${TEST_TEAM_DOMAIN}`,
    exp: Math.floor(Date.now() / 1000) + 300,
  })}.`;
}

/** Classic algorithm-confusion forgery: HS256 keyed with the (public) RSA key. */
export function hs256ConfusionJwt(pair: AccessKeypair): string {
  return new JwtService().sign(
    { email: 'attacker@evil.test', aud: [TEST_AUD], iss: `https://${TEST_TEAM_DOMAIN}`, exp: Math.floor(Date.now() / 1000) + 300 },
    { secret: pair.publicKey.export({ type: 'spki', format: 'pem' }).toString(), algorithm: 'HS256', keyid: pair.kid },
  );
}

/** Replaces global fetch so only the team's JWKS URL answers; any other URL fails the test. */
export function mockJwksEndpoint(
  respond: () => { status?: number; body: unknown },
): jest.SpyInstance {
  return jest.spyOn(globalThis, 'fetch').mockImplementation(async (input: string | URL | Request) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    if (url !== TEST_JWKS_URL) throw new Error(`Unexpected network call to ${url}`);
    const { status = 200, body } = respond();
    return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  });
}
