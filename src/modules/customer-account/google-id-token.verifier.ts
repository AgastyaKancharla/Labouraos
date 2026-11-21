import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { createHash, createPublicKey, JsonWebKey } from 'node:crypto';
import { CUSTOMER_ERROR_CODES, CustomerApiError, CustomerErrorCode } from '../../common/customer-auth/customer-auth.errors';

const DEFAULT_KEY_CACHE_MS = 60 * 60 * 1000;
/** An unknown key id refetches the key set at most this often (negative cache). */
const UNKNOWN_KID_REFETCH_MS = 60 * 1000;

export interface ExternalIdentity {
  sub: string;
  email: string | null;
  emailVerified: boolean;
  name: string | null;
  /** When the provider issued the token (seconds), for "fresh sign-in" checks. */
  issuedAt: number | null;
}

type Jwk = JsonWebKey & { kid?: string; alg?: string };

function read(value: string | undefined): string | null {
  return value?.trim() ? value.trim() : null;
}

/**
 * Checks an OpenID Connect ID token on the server: RS256 signature against the
 * provider's published keys, the issuer, the audience (one of Laboura's client
 * ids), the expiry, a verified email when one is given, and the nonce when the
 * app sent one. Keeps the subject, email and name; never a picture.
 */
export abstract class OidcIdTokenVerifier {
  private readonly logger = new Logger(this.constructor.name);
  private readonly jwt = new JwtService({});
  private keys: Map<string, string> = new Map();
  private keysExpireAt = 0;
  private lastFetchAt = 0;

  protected abstract readonly jwksUrl: string;
  protected abstract readonly issuers: [string, ...string[]];
  protected abstract readonly invalidCode: CustomerErrorCode;
  protected abstract readonly notConfiguredCode: CustomerErrorCode;
  protected abstract readonly label: string;
  abstract audiences(): string[];

  /** When true, a sign-in without a nonce is refused. */
  protected nonceRequired(): boolean {
    return false;
  }

  configured(): boolean {
    return this.audiences().length > 0;
  }

  /** The key download; tests replace it. */
  protected async fetchKeys(): Promise<{ keys: Jwk[]; maxAgeMs: number }> {
    const response = await fetch(this.jwksUrl, { headers: { Accept: 'application/json' } });
    if (!response.ok) throw new Error(`${this.label} keys answered ${response.status}`);
    const body = (await response.json()) as { keys?: Jwk[] };
    const maxAge = /max-age=(\d+)/.exec(response.headers.get('cache-control') ?? '');
    return { keys: body.keys ?? [], maxAgeMs: maxAge ? Number(maxAge[1]) * 1000 : DEFAULT_KEY_CACHE_MS };
  }

  protected now(): number {
    return Date.now();
  }

  private async keyFor(kid: string): Promise<string | null> {
    const now = this.now();
    const expired = now >= this.keysExpireAt;
    const unknown = !this.keys.has(kid);
    // At most one download a minute, whether the keys expired or the key id is new
    // (also when the provider is down: a failed download is not retried at once).
    if ((expired || unknown) && (this.lastFetchAt === 0 || now - this.lastFetchAt >= UNKNOWN_KID_REFETCH_MS)) {
      this.lastFetchAt = now;
      try {
        const { keys, maxAgeMs } = await this.fetchKeys();
        const next = new Map<string, string>();
        for (const jwk of keys) {
          if (!jwk.kid) continue;
          next.set(jwk.kid, createPublicKey({ key: jwk, format: 'jwk' }).export({ type: 'spki', format: 'pem' }).toString());
        }
        this.keys = next;
        this.keysExpireAt = now + maxAgeMs;
      } catch (error) {
        this.logger.warn(`Could not load ${this.label} sign-in keys: ${(error as Error).message}`);
      }
    }
    return this.keys.get(kid) ?? null;
  }

  async verify(idToken: unknown, nonce?: unknown): Promise<ExternalIdentity> {
    const audiences = this.audiences();
    if (audiences.length === 0) {
      throw new CustomerApiError(HttpStatus.SERVICE_UNAVAILABLE, this.notConfiguredCode, `${this.label} sign-in is not switched on`);
    }
    const invalid = () => new CustomerApiError(HttpStatus.UNAUTHORIZED, this.invalidCode, `${this.label} sign-in could not be checked`);
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
        issuer: this.issuers,
        clockTimestamp: Math.floor(this.now() / 1000),
      });
    } catch {
      throw invalid();
    }
    if (typeof payload.sub !== 'string' || !payload.sub) throw invalid();
    if ((nonce === undefined || nonce === null || nonce === '') && this.nonceRequired()) throw invalid();
    if (nonce !== undefined && nonce !== null && nonce !== '') {
      // The app may send the raw nonce; the provider may hold it raw or as its SHA-256.
      if (typeof nonce !== 'string' || nonce.length > 200) throw invalid();
      const hashed = createHash('sha256').update(nonce).digest('hex');
      if (payload.nonce !== nonce && payload.nonce !== hashed) throw invalid();
    }
    const email = typeof payload.email === 'string' ? payload.email.trim().toLowerCase() : null;
    const emailVerified = payload.email_verified === true || payload.email_verified === 'true';
    if (email && !emailVerified) throw invalid();
    const name = typeof payload.name === 'string' && payload.name.trim() ? payload.name.trim().slice(0, 120) : null;
    return { sub: payload.sub, email, emailVerified, name, issuedAt: typeof payload.iat === 'number' ? payload.iat : null };
  }
}

/** Google's public keys for ID tokens (JWK set). */
export const GOOGLE_JWKS_URL = 'https://www.googleapis.com/oauth2/v3/certs';
/** The OAuth client ids of the Laboura app (Firebase / Google Cloud). */
export const GOOGLE_CLIENT_ID_SETTINGS = ['GOOGLE_CLIENT_ID_ANDROID', 'GOOGLE_CLIENT_ID_IOS', 'GOOGLE_CLIENT_ID_WEB'] as const;

export interface GoogleClientIds {
  android: string | null;
  ios: string | null;
  web: string | null;
}

export function googleClientIds(env: NodeJS.ProcessEnv = process.env): GoogleClientIds {
  return { android: read(env.GOOGLE_CLIENT_ID_ANDROID), ios: read(env.GOOGLE_CLIENT_ID_IOS), web: read(env.GOOGLE_CLIENT_ID_WEB) };
}

export type GoogleIdentity = ExternalIdentity;

/** "Continue with Google" (decided 14 Nov). */
@Injectable()
export class GoogleIdTokenVerifier extends OidcIdTokenVerifier {
  protected readonly jwksUrl = GOOGLE_JWKS_URL;
  protected readonly issuers: [string, ...string[]] = ['accounts.google.com', 'https://accounts.google.com'];
  protected readonly invalidCode = CUSTOMER_ERROR_CODES.GOOGLE_TOKEN_INVALID;
  protected readonly notConfiguredCode = CUSTOMER_ERROR_CODES.GOOGLE_NOT_CONFIGURED;
  protected readonly label = 'Google';

  audiences(): string[] {
    const ids = googleClientIds();
    return [ids.android, ids.ios, ids.web].filter((id): id is string => Boolean(id));
  }

  /**
   * GOOGLE_NONCE_REQUIRED=on refuses Google sign-ins without a nonce. Keep it
   * off: the customer app's free Google sign-in library has no nonce option
   * (docs/customer-app-api.md 3.2), so with it on every app Google sign-in fails.
   * Apple sign-ins from the app always carry a nonce.
   */
  protected nonceRequired(): boolean {
    return process.env.GOOGLE_NONCE_REQUIRED?.trim().toLowerCase() === 'on';
  }
}

/** Apple's public keys for identity tokens. */
export const APPLE_JWKS_URL = 'https://appleid.apple.com/auth/keys';
/** The iPhone app's bundle id and (for web) the Services ID: the audiences Apple signs for. */
export const APPLE_CLIENT_ID_SETTINGS = ['APPLE_CLIENT_ID_IOS', 'APPLE_CLIENT_ID_WEB'] as const;

export function appleClientIds(env: NodeJS.ProcessEnv = process.env): { ios: string | null; web: string | null } {
  return { ios: read(env.APPLE_CLIENT_ID_IOS), web: read(env.APPLE_CLIENT_ID_WEB) };
}

/**
 * "Sign in with Apple" for the iPhone app (Apple rule 4.8, proposal 3 point 6).
 * Off — and every Apple sign-in refused — until an Apple client id is set.
 */
@Injectable()
export class AppleIdTokenVerifier extends OidcIdTokenVerifier {
  protected readonly jwksUrl = APPLE_JWKS_URL;
  protected readonly issuers: [string, ...string[]] = ['https://appleid.apple.com'];
  protected readonly invalidCode = CUSTOMER_ERROR_CODES.APPLE_TOKEN_INVALID;
  protected readonly notConfiguredCode = CUSTOMER_ERROR_CODES.APPLE_NOT_CONFIGURED;
  protected readonly label = 'Apple';

  audiences(): string[] {
    const ids = appleClientIds();
    return [ids.ios, ids.web].filter((id): id is string => Boolean(id));
  }
}
