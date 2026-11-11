import { createHmac, timingSafeEqual } from 'node:crypto';
import { getJwtSecret } from '../../common/auth/jwt-secret';
import { publicLink } from '../../common/public-link';

/**
 * The business opens its GST invoice through the link sent after it pays.
 * The link carries a token signed with the server secret (as receipts do),
 * so a placement id on its own opens nothing. Staff use the logged-in route.
 */
const INVOICE_TOKEN_CONTEXT = 'laboura:placement-invoice:v1';

function invoiceKey(): Buffer {
  return createHmac('sha256', getJwtSecret()).update(INVOICE_TOKEN_CONTEXT).digest();
}

export function invoiceToken(placementId: string): string {
  return createHmac('sha256', invoiceKey()).update(placementId).digest('base64url');
}

export function isValidInvoiceToken(placementId: string, token: unknown): boolean {
  if (typeof token !== 'string' || !token || !placementId) return false;
  const expected = Buffer.from(invoiceToken(placementId));
  const supplied = Buffer.from(token);
  return expected.length === supplied.length && timingSafeEqual(expected, supplied);
}

/** Path of the business's read-only invoice copy. */
export function invoicePath(placementId: string): string {
  return `/placements/${encodeURIComponent(placementId)}/invoice/copy?token=${invoiceToken(placementId)}`;
}

/** The invoice link sent to the business by SMS and WhatsApp. */
export function invoiceLink(placementId: string): string {
  return publicLink(invoicePath(placementId));
}
