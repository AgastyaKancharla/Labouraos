import { createHash } from 'crypto';

/**
 * Security AC-3 / AUTH-2: a code sent from a person's own public page
 * (/p/..., "Send code") carries a purpose bound to that one link. Staff
 * `POST /otp/send` only accepts OTP_PURPOSES, so a code an agent asked for
 * (even one the person read aloud) is never accepted on the person's page,
 * and a code from one link never opens another. Only a hash of the token is
 * kept in the purpose.
 */
export const PUBLIC_PAGE_OTP_PREFIX = 'public_link:';

export function publicPageOtpPurpose(linkToken: string): string {
  const digest = createHash('sha256').update(`laboura-public-page-otp:${String(linkToken ?? '')}`).digest('hex');
  return `${PUBLIC_PAGE_OTP_PREFIX}${digest.slice(0, 40)}`;
}

export function isPublicPageOtpPurpose(purpose: string | null | undefined): boolean {
  return typeof purpose === 'string' && purpose.startsWith(PUBLIC_PAGE_OTP_PREFIX);
}
