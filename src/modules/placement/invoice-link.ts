import { createHmac } from 'node:crypto';
import { getJwtSecret } from '../../common/auth/jwt-secret';
import { publicLink } from '../../common/public-link';
import { signExpiringToken, verifyExpiringToken } from '../../common/signed-link-token';

/**
 * The business opens its GST invoice through the link sent after it pays.
 * The link carries a token signed with the server secret (as receipts do),
 * so a placement id on its own opens nothing. Staff use the logged-in route.
 *
 * Security AC-5: the token also carries its expiry, signed with it. An invoice
 * link works for INVOICE_LINK_VALID_DAYS after it was made; after that the
 * business asks Laboura (Finance) for a fresh copy.
 */
export const INVOICE_LINK_VALID_DAYS = 90;
const INVOICE_TOKEN_CONTEXT = 'laboura:placement-invoice:v2';

function invoiceKey(): Buffer {
  return createHmac('sha256', getJwtSecret()).update(INVOICE_TOKEN_CONTEXT).digest();
}

export function invoiceToken(placementId: string, now: Date = new Date()): string {
  return signExpiringToken(invoiceKey(), placementId, INVOICE_LINK_VALID_DAYS, now);
}

export function isValidInvoiceToken(placementId: string, token: unknown, now: Date = new Date()): boolean {
  return verifyExpiringToken(invoiceKey(), placementId, token, now);
}

/** Path of the business's read-only invoice copy. */
export function invoicePath(placementId: string, now: Date = new Date()): string {
  return `/placements/${encodeURIComponent(placementId)}/invoice/copy?token=${invoiceToken(placementId, now)}`;
}

/** The invoice link sent to the business by SMS and WhatsApp. */
export function invoiceLink(placementId: string, now: Date = new Date()): string {
  return publicLink(invoicePath(placementId, now));
}
