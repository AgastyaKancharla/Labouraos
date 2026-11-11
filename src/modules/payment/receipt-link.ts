import { createHmac, timingSafeEqual } from 'node:crypto';
import { getJwtSecret } from '../../common/auth/jwt-secret';
import { publicLink } from '../../common/public-link';

/**
 * A payment receipt is opened either by staff with the right role or by the
 * payer through the link sent to them. That link carries a token signed with
 * the server secret, so knowing a payment id alone opens nothing.
 */
const RECEIPT_TOKEN_CONTEXT = 'laboura:payment-receipt:v1';

function receiptKey(): Buffer {
  return createHmac('sha256', getJwtSecret()).update(RECEIPT_TOKEN_CONTEXT).digest();
}

export function receiptToken(paymentId: string): string {
  return createHmac('sha256', receiptKey()).update(paymentId).digest('base64url');
}

export function isValidReceiptToken(paymentId: string, token: unknown): boolean {
  if (typeof token !== 'string' || !token || !paymentId) {
    return false;
  }
  const expected = Buffer.from(receiptToken(paymentId));
  const supplied = Buffer.from(token);
  return expected.length === supplied.length && timingSafeEqual(expected, supplied);
}

/** The receipt link sent to the payer. */
export function receiptLink(paymentId: string): string {
  return publicLink(
    `/payments/${encodeURIComponent(paymentId)}/receipt?token=${receiptToken(paymentId)}`,
  );
}
