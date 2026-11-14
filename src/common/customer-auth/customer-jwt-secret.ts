import { createHmac } from 'node:crypto';
import { getJwtSecret } from '../auth/jwt-secret';

/**
 * The key that signs customer access tokens. Never the staff key: a customer
 * token must not verify as a staff token, and a staff token must not verify as
 * a customer token (separate realm, proposal 8.1).
 *
 * CUSTOMER_JWT_SECRET (at least 32 characters, different from JWT_SECRET) is
 * used when set; render.yaml generates one. When it is not set (local runs and
 * the automated tests), a separate key is derived from JWT_SECRET with HMAC, so
 * the two keys still differ and neither can be worked out from the other's tokens.
 */
export const CUSTOMER_JWT_DERIVATION_LABEL = 'laboura:customer-realm:v1';
/** The setting name (render.yaml generates it on the web service). */
export const CUSTOMER_JWT_SECRET_ENV = 'CUSTOMER_JWT_SECRET';

export function getCustomerJwtSecret(env: NodeJS.ProcessEnv = process.env): string {
  const own = env[CUSTOMER_JWT_SECRET_ENV]?.trim();
  const staff = getJwtSecret();
  if (own) {
    if (own.length < 32) {
      throw new Error(`CUSTOMER_JWT_SECRET must be at least 32 characters long (received ${own.length} characters).`);
    }
    if (own === staff) {
      throw new Error('CUSTOMER_JWT_SECRET must be different from JWT_SECRET: customer and staff tokens use separate keys.');
    }
    return own;
  }
  return createHmac('sha256', staff).update(CUSTOMER_JWT_DERIVATION_LABEL).digest('base64url');
}
