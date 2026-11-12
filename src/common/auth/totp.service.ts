import { Injectable } from '@nestjs/common';
import { authenticator } from 'otplib';

/** Seconds in one authenticator time step (RFC 6238 default; otplib's too). */
export const TOTP_STEP_SECONDS = 30;

type StepClaimer = {
  staff: { updateMany(args: { where: Record<string, unknown>; data: { totpLastStep: number } }): Promise<{ count: number }> };
};

/**
 * Accepts an authenticator code's time step for a person once (security check L9):
 * succeeds only if no code of this step or a later one was accepted before. Atomic,
 * so two requests with the same code at the same moment can't both pass.
 */
export async function claimTotpStep(db: StepClaimer, staffId: string, step: number): Promise<boolean> {
  const claimed = await db.staff.updateMany({
    where: { id: staffId, OR: [{ totpLastStep: null }, { totpLastStep: { lt: step } }] },
    data: { totpLastStep: step },
  });
  return claimed.count === 1;
}

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
   * The time step a valid 6-digit code belongs to, or null when the code is wrong.
   * Callers then claim the step (claimTotpStep) so a code works only once.
   */
  verifyStep(token: string, secret: string, nowMs: number = Date.now()): number | null {
    if (!token || !secret) return null;
    const cleanToken = token.trim();
    if (cleanToken.length !== 6) return null;
    try {
      const delta = authenticator.checkDelta(cleanToken, secret);
      if (delta === null) return null;
      return Math.floor(nowMs / 1000 / TOTP_STEP_SECONDS) + delta;
    } catch {
      return null;
    }
  }

  /**
   * Helper (useful for testing) to generate current valid 6-digit token for a secret.
   */
  generateToken(secret: string): string {
    return authenticator.generate(secret);
  }
}
