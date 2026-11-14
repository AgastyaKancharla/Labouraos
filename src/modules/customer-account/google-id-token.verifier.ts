import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { createPublicKey, JsonWebKey } from 'node:crypto';
import { CUSTOMER_ERROR_CODES, CustomerApiError } from '../../common/customer-auth/customer-auth.errors';

/** Google's public keys for ID tokens (JWK set). */
export const GOOGLE_JWKS_URL = 'https://www.googleapis.com/oauth2/v3/certs';
const GOOGLE_ISSUERS: [string, ...string[]] = ['accounts.google.com', 'https://accounts.google.com'];
const DEFAULT_KEY_CACHE_MS = 60 * 60 * 1000;

/** The OAuth client ids of the Laboura app (Firebase / Google Cloud). */
export const GOOGLE_CLIENT_ID_SETTINGS = ['GOOGLE_CLIENT_ID_ANDROID', 'GOOGLE_CLIENT_ID_IOS', 'GOOGLE_CLIENT_ID_WEB'] as const;

export interface GoogleClientIds {
  android: string | null;
  ios: string | null;
  web: string | null;
}

export function googleClientIds(env: NodeJS.ProcessEnv = process.env): GoogleClientIds {
  const read = (value: string | undefined) => (value?.trim() ? value.trim() : null);
  return {
    android: read(env.GOOGLE_CLIENT_ID_ANDROID),
    ios: read(env.GOOGLE_CLIENT_ID_IOS),
    web: read(env.GOOGLE_CLIENT_ID_WEB),
  };
}

export interface GoogleIdentity {
  sub: string;
  email: string | null;
  emailVerified: boolean;
  name: string | null;
}

type GoogleJwk = JsonWebKey & { kid?: string; alg?: string };

/**
 * Checks a Google ID token on the server (decided 14 Nov: Google sign-in): the
 * RS256 signature against Google's published keys, the issuer, the audience
 * (one of Laboura's client ids), the expiry, and that the email is verified.
 * Keeps the subject, email and name; the picture is never read.
 */
@Injectable()
export class GoogleIdTokenVerifier {
  private readonly logger = new Logger(GoogleIdTokenVerifier.name);
  private readonly jwt = new JwtService({});
  private keys: Map<string, string> = new Map();
  private keysExpireAt = 0;

  /** The key download; tests replace it. */
  protected async fetchKeys(): Promise<{ keys: GoogleJwk[]; maxAgeMs: number }> {
    const response = await fetch(GOOGLE_JWKS_URL, { headers: { Accept: 'application/json' } });
    if (!response.ok) throw new Error(`Google keys answered ${response.status}`);
    const body = (await response.json()) as { keys?: GoogleJwk[] };
    const cacheControl = response.headers.get('cache-control') ?? '';
    const maxAge = /max-age=(\d+)/.exec(cacheControl);
    return { keys: body.keys ?? [], maxAgeMs: maxAge ? Number(maxAge[1]) * 1000 : DEFAULT_KEY_CACHE_MS };
  }

  protected now(): number {
    return Date.now();
  }

  configured(): boolean {
    const ids = googleClientIds();
    return Boolean(ids.android || ids.ios || ids.web);
  }

  private async keyFor(kid: string): Promise<string | null> {
    if (this.now() >= this.keysExpireAt || !this.keys.has(kid)) {
      try {
        const { keys, maxAgeMs } = await this.fetchKeys();
        const next = new Map<string, string>();
        for (const jwk of keys) {
          if (!jwk.kid) continue;
          const pem = createPublicKey({ key: jwk, format: 'jwk' }).export({ type: 'spki', format: 'pem' }).toString();
          next.set(jwk.kid, pem);
        }
        this.keys = next;
        this.keysExpireAt = this.now() + maxAgeMs;
      } catch (error) {
        this.logger.warn(`Could not load Google sign-in keys: ${(error as Error).message}`);
      }
    }
    return this.keys.get(kid) ?? null;
  }

  async verify(idToken: unknown): Promise<GoogleIdentity> {
    const ids = googleClientIds();
    const audiences = [ids.android, ids.ios, ids.web].filter((id): id is string => Boolean(id));
    if (audiences.length === 0) {
      throw new CustomerApiError(HttpStatus.SERVICE_UNAVAILABLE, CUSTOMER_ERROR_CODES.GOOGLE_NOT_CONFIGURED, 'Google sign-in is not switched on');
    }
    const invalid = () => new CustomerApiError(HttpStatus.UNAUTHORIZED, CUSTOMER_ERROR_CODES.GOOGLE_TOKEN_INVALID, 'Google sign-in could not be checked');
    if (typeof idToken !== 'string' || idToken.length > 4096 || idToken.split('.').length !== 3) throw invalid();
    let header: { kid?: unknown; alg?: unknown };
    try {
      header = JSON.parse(Buffer.from(idToken.split('.')[0]!, 'base64url').toString('utf8')) as { kid?: unknown; alg?: unknown };
    } catch {
      throw invalid();
    }
    if (header.alg !== 'RS256' || typeof header.kid !== 'string') throw invalid();
    const key = await this.keyFor(header.kid);
    if (!key) throw invalid();
    let payload: Record<string, unknown>;
    try {
      payload = this.jwt.verify<Record<string, unknown>>(idToken, {
        publicKey: key,
        algorithms: ['RS256'],
        audience: audiences.length === 1 ? audiences[0] : (audiences as [string, ...string[]]),
        issuer: GOOGLE_ISSUERS,
        clockTimestamp: Math.floor(this.now() / 1000),
      });
    } catch {
      throw invalid();
    }
    if (typeof payload.sub !== 'string' || !payload.sub) throw invalid();
    const email = typeof payload.email === 'string' ? payload.email.trim().toLowerCase() : null;
    const emailVerified = payload.email_verified === true || payload.email_verified === 'true';
    if (email && !emailVerified) throw invalid();
    const name = typeof payload.name === 'string' && payload.name.trim() ? payload.name.trim().slice(0, 120) : null;
    return { sub: payload.sub, email, emailVerified, name };
  }
}
