import { Injectable } from '@nestjs/common';
import { JwtService, TokenExpiredError } from '@nestjs/jwt';
import { createHash, randomBytes } from 'node:crypto';
import {
  CUSTOMER_ACCESS_TOKEN_MINUTES,
  CUSTOMER_TOKEN_AUDIENCE,
  CUSTOMER_TOKEN_ISSUER,
  CUSTOMER_TOKEN_REALM,
} from './customer-app.constants';
import { CUSTOMER_ERROR_CODES, customerUnauthorized } from './customer-auth.errors';
import { getCustomerJwtSecret } from './customer-jwt-secret';

/** What a customer access token carries. No phone number, no name. */
export interface CustomerTokenPayload {
  /** CustomerAccount.id */
  sub: string;
  /** CustomerSession.id */
  sid: string;
  realm: typeof CUSTOMER_TOKEN_REALM;
}

/**
 * Signs and checks customer access tokens with the customer key, audience and
 * issuer. Its own JwtService instance, so the staff JwtModule's key and options
 * are never used for customers. Refresh tokens are random strings; only their
 * SHA-256 is stored.
 */
@Injectable()
export class CustomerTokenService {
  private readonly jwt = new JwtService({});

  private secret(): string {
    return getCustomerJwtSecret();
  }

  accessTokenMinutes(): number {
    const raw = Number(process.env.CUSTOMER_ACCESS_TOKEN_MINUTES);
    return Number.isFinite(raw) && raw >= 1 && raw <= 60 ? Math.floor(raw) : CUSTOMER_ACCESS_TOKEN_MINUTES;
  }

  signAccess(accountId: string, sessionId: string): { accessToken: string; expiresInSeconds: number } {
    const expiresInSeconds = this.accessTokenMinutes() * 60;
    const payload: CustomerTokenPayload = { sub: accountId, sid: sessionId, realm: CUSTOMER_TOKEN_REALM };
    const accessToken = this.jwt.sign(payload, {
      secret: this.secret(),
      algorithm: 'HS256',
      audience: CUSTOMER_TOKEN_AUDIENCE,
      issuer: CUSTOMER_TOKEN_ISSUER,
      expiresIn: expiresInSeconds,
    });
    return { accessToken, expiresInSeconds };
  }

  /** Throws a 401 with a CUSTOMER_* code unless the token is a valid customer token. */
  verifyAccess(token: string): CustomerTokenPayload {
    let payload: Record<string, unknown>;
    try {
      payload = this.jwt.verify<Record<string, unknown>>(token, {
        secret: this.secret(),
        algorithms: ['HS256'],
        audience: CUSTOMER_TOKEN_AUDIENCE,
        issuer: CUSTOMER_TOKEN_ISSUER,
      });
    } catch (error: unknown) {
      if (error instanceof TokenExpiredError) {
        throw customerUnauthorized(CUSTOMER_ERROR_CODES.TOKEN_EXPIRED, 'Your sign-in has expired: renew it with the refresh token');
      }
      throw customerUnauthorized(CUSTOMER_ERROR_CODES.TOKEN_INVALID, 'Not a valid Laboura app sign-in');
    }
    // Belt and braces: a staff token never has these, a customer token always does.
    if (
      payload.realm !== CUSTOMER_TOKEN_REALM ||
      typeof payload.sub !== 'string' ||
      typeof payload.sid !== 'string' ||
      'role' in payload
    ) {
      throw customerUnauthorized(CUSTOMER_ERROR_CODES.TOKEN_INVALID, 'Not a valid Laboura app sign-in');
    }
    return { sub: payload.sub, sid: payload.sid, realm: CUSTOMER_TOKEN_REALM };
  }

  newRefreshToken(): string {
    return randomBytes(32).toString('base64url');
  }

  hashRefreshToken(token: string): string {
    return createHash('sha256').update(`laboura:customer-refresh:${token}`).digest('hex');
  }
}
