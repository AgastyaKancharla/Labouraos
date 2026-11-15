import { createHmac } from 'node:crypto';
import { getJwtSecret } from '../../common/auth/jwt-secret';
import { publicLink } from '../../common/public-link';
import { signExpiringToken, verifyExpiringToken } from '../../common/signed-link-token';

/**
 * A payment receipt is opened either by staff with the right role or by the
 * payer through the link sent to them. That link carries a token signed with
 * the server secret, so knowing a payment id alone opens nothing.
 *
 * Security AC-5: the token also carries its expiry, signed with it. A receipt
 * link works for RECEIPT_LINK_VALID_DAYS after it was made; after that the
 * payer asks Laboura for the receipt again (staff screens make a fresh link
 * each time they show one).
 */
export const RECEIPT_LINK_VALID_DAYS = 90;
const RECEIPT_TOKEN_CONTEXT = 'laboura:payment-receipt:v2';

function receiptKey(): Buffer {
  return createHmac('sha256', getJwtSecret()).update(RECEIPT_TOKEN_CONTEXT).digest();
}

export function receiptToken(paymentId: string, now: Date = new Date()): string {
  return signExpiringToken(receiptKey(), paymentId, RECEIPT_LINK_VALID_DAYS, now);
}

export function isValidReceiptToken(paymentId: string, token: unknown, now: Date = new Date()): boolean {
  return verifyExpiringToken(receiptKey(), paymentId, token, now);
}

/** The receipt link sent to the payer. */
export function receiptLink(paymentId: string, now: Date = new Date()): string {
  return publicLink(
    `/payments/${encodeURIComponent(paymentId)}/receipt?token=${receiptToken(paymentId, now)}`,
  );
}
