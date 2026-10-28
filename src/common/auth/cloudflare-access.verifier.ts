import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { createPublicKey, JsonWebKey as NodeJsonWebKey } from 'node:crypto';

export interface CloudflareAccessClaims {
  email?: string;
  sub?: string;
  aud?: string | string[];
  iss?: string;
  exp?: number;
}

interface Jwks {
  keys?: Array<NodeJsonWebKey & { kid?: string }>;
}

const JWKS_TTL_MS = 60 * 60 * 1000;
// A token naming an unknown `kid` forces a JWKS refetch (Cloudflare rotates
// keys). Without a cooldown a caller could make us hit Cloudflare on every request.
const JWKS_REFRESH_COOLDOWN_MS = 60 * 1000;
const JWKS_FETCH_TIMEOUT_MS = 5000;

/**
 * Verifies the `Cf-Access-Jwt-Assertion` token Cloudflare Access attaches to
 * requests: RS256 signature against the team's JWKS, plus audience, issuer and
 * expiry. Header presence alone proves nothing (any client can send one).
 *
 * Config (read per call so it can differ per environment):
 *   CLOUDFLARE_ACCESS_TEAM_DOMAIN  e.g. laboura.cloudflareaccess.com
 *   CLOUDFLARE_ACCESS_AUD          the Access application's AUD tag
 */
@Injectable()
export class CloudflareAccessVerifier implements OnModuleInit {
  private readonly logger = new Logger(CloudflareAccessVerifier.name);
  private keys = new Map<string, string>();
  private fetchedAt = 0;
  private lastRefreshAttempt = 0;

  // Deliberately NOT the injected app JwtService: that one is registered with the
  // app's HS256 signing secret, and @nestjs/jwt prefers a module-level `secret`
  // over a per-call `publicKey`, so it would verify Cloudflare's RS256 tokens
  // against our own secret. A bare instance has no secret to take precedence.
  private readonly jwt = new JwtService();

  /** Enforcement on with no team/AUD configured is a deploy mistake: fail loudly at boot. */
  onModuleInit(): void {
    if (process.env.CLOUDFLARE_ACCESS_ENFORCED === 'true') {
      this.readConfig();
    }
  }

  async verify(
    token: string,
    now: number = Date.now(),
  ): Promise<CloudflareAccessClaims> {
    const { teamDomain, aud } = this.readConfig();

    const header = this.decodeHeader(token);
    if (header.alg !== 'RS256') {
      throw new Error(`Unsupported JWT algorithm: ${String(header.alg)}`);
    }
    if (typeof header.kid !== 'string' || header.kid.length === 0) {
      throw new Error('JWT has no key id');
    }

    const publicKey = await this.getKey(teamDomain, header.kid, now);

    // `algorithms` is a whitelist: it is what stops `alg: none` and HS256 keyed
    // with the public key. exp/nbf are checked by the library.
    return this.jwt.verifyAsync<CloudflareAccessClaims>(token, {
      publicKey,
      algorithms: ['RS256'],
      audience: aud,
      issuer: `https://${teamDomain}`,
    });
  }

  private readConfig(): { teamDomain: string; aud: string } {
    const teamDomain = (process.env.CLOUDFLARE_ACCESS_TEAM_DOMAIN ?? '')
      .trim()
      .replace(/^https?:\/\//, '')
      .replace(/\/+$/, '');
    const aud = (process.env.CLOUDFLARE_ACCESS_AUD ?? '').trim();
    if (!teamDomain || !aud) {
      throw new Error(
        'CLOUDFLARE_ACCESS_TEAM_DOMAIN and CLOUDFLARE_ACCESS_AUD must be set when Cloudflare Access is enforced',
      );
    }
    return { teamDomain, aud };
  }

  private decodeHeader(token: string): { alg?: unknown; kid?: unknown } {
    const [rawHeader] = token.split('.');
    try {
      const parsed: unknown = JSON.parse(
        Buffer.from(rawHeader, 'base64url').toString('utf8'),
      );
      if (parsed && typeof parsed === 'object') {
        return parsed as { alg?: unknown; kid?: unknown };
      }
    } catch {
      // fall through
    }
    throw new Error('Malformed JWT header');
  }

  private async getKey(
    teamDomain: string,
    kid: string,
    now: number,
  ): Promise<string> {
    const fresh = now - this.fetchedAt < JWKS_TTL_MS;
    const cached = this.keys.get(kid);
    if (cached && fresh) return cached;

    if (now - this.lastRefreshAttempt >= JWKS_REFRESH_COOLDOWN_MS) {
      this.lastRefreshAttempt = now;
      await this.refreshKeys(teamDomain, now);
    }

    const key = this.keys.get(kid);
    if (!key) throw new Error('No signing key matches the JWT key id');
    return key;
  }

  private async refreshKeys(teamDomain: string, now: number): Promise<void> {
    const url = `https://${teamDomain}/cdn-cgi/access/certs`;
    const res = await fetch(url, {
      signal: AbortSignal.timeout(JWKS_FETCH_TIMEOUT_MS),
    });
    if (!res.ok) {
      this.logger.error(`JWKS fetch from ${url} failed with ${res.status}`);
      throw new Error('Could not fetch Cloudflare Access signing keys');
    }

    const body = (await res.json()) as Jwks;
    const next = new Map<string, string>();
    for (const jwk of body.keys ?? []) {
      if (jwk.kty !== 'RSA' || !jwk.kid) continue;
      next.set(
        jwk.kid,
        createPublicKey({ key: jwk, format: 'jwk' })
          .export({ type: 'spki', format: 'pem' })
          .toString(),
      );
    }
    if (next.size === 0) {
      throw new Error('Cloudflare Access JWKS contained no usable RSA keys');
    }
    this.keys = next;
    this.fetchedAt = now;
  }
}
