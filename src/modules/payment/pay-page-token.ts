import { createHash, createHmac } from 'node:crypto';
import { getJwtSecret } from '../../common/auth/jwt-secret';

/**
 * Security INF-1: the pay page (/p/pay/<token>) used to be opened by the UPI
 * reference itself — the sequential payment code plus 32 random bits, also
 * printed in the payer's UPI app as tr=. Now the page has its own token:
 *
 * - 256 bits, an HMAC of the payment id under a key derived from the server
 *   secret. It can be worked out again whenever the link is re-sent, or handed
 *   to the person's own OTP-verified page, without being stored.
 * - Only its SHA-256 is stored (Payment.pageTokenHash), for the lookup.
 * - upiReference stays the short reference for UPI tr= and bank matching.
 *
 * A paid page stays open PAY_PAGE_DAYS_AFTER_PAYMENT days after the bank
 * confirmed the money, then answers "expired". It never carries the receipt
 * or invoice links: those go to the payer by SMS / WhatsApp.
 */
export const PAY_PAGE_DAYS_AFTER_PAYMENT = 30;
const PAY_PAGE_TOKEN_CONTEXT = 'laboura:pay-page-token:v1';

function payPageKey(): Buffer {
  return createHmac('sha256', getJwtSecret()).update(PAY_PAGE_TOKEN_CONTEXT).digest();
}

export function payPageTokenFor(paymentId: string): string {
  return createHmac('sha256', payPageKey()).update(paymentId).digest('base64url');
}

export function payPageTokenHash(token: string): string {
  return createHash('sha256').update(String(token)).digest('hex');
}

/**
 * The page token of a payment, saving its hash on a row made before page
 * tokens existed (after that, the row's old /p/pay/<upiReference> link stops working).
 */
export async function ensurePayPageToken(
  prisma: { payment: { updateMany(args: { where: { id: string; pageTokenHash: null }; data: { pageTokenHash: string } }): Promise<unknown> } },
  paymentId: string,
): Promise<string> {
  const token = payPageTokenFor(paymentId);
  await prisma.payment.updateMany({ where: { id: paymentId, pageTokenHash: null }, data: { pageTokenHash: payPageTokenHash(token) } });
  return token;
}

/** True once a paid page is past its PAY_PAGE_DAYS_AFTER_PAYMENT. */
export function payPageExpired(confirmedAt: Date | null | undefined, now: Date): boolean {
  if (!confirmedAt) return false;
  return now.getTime() > confirmedAt.getTime() + PAY_PAGE_DAYS_AFTER_PAYMENT * 24 * 60 * 60 * 1000;
}
