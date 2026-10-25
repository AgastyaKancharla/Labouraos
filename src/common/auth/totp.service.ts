import { Injectable } from '@nestjs/common';
import { authenticator } from 'otplib';

export interface TotpSetupResult {
  secret: string;
  otpauthUrl: string;
}

@Injectable()
export class TotpService {
  /**
   * Generates a standard RFC 6238 Base32 secret string.
   */
  generateSecret(): string {
    return authenticator.generateSecret();
  }

  /**
   * Generates a new secret along with an otpauth:// URL for authenticator QR codes.
   */
  generateSetup(email: string, issuer = 'Laboura'): TotpSetupResult {
    const secret = this.generateSecret();
    const otpauthUrl = authenticator.keyuri(email, issuer, secret);
    return { secret, otpauthUrl };
  }

  /**
   * Validates a 6-digit TOTP code against the stored base32 secret.
   * Returns true if valid, false if invalid or expired.
   */
  verify(token: string, secret: string): boolean {
    if (!token || !secret) {
      return false;
    }
    const cleanToken = token.trim();
    if (cleanToken.length !== 6) {
      return false;
    }
    try {
      return authenticator.check(cleanToken, secret);
    } catch {
      return false;
    }
  }

  /**
   * Helper (useful for testing) to generate current valid 6-digit token for a secret.
   */
  generateToken(secret: string): string {
    return authenticator.generate(secret);
  }
}
