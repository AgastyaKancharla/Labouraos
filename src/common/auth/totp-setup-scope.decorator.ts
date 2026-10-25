import { SetMetadata } from '@nestjs/common';

export const TOTP_SETUP_SCOPE_KEY = 'auth_allow_totp_setup_scope';

/**
 * Marks a route as reachable with a scope-limited ("totp_setup") token, i.e.
 * one issued on a password-only login for an account that has not enrolled in
 * TOTP yet. Every route without this marker rejects such a token.
 */
export const AllowTotpSetupScope = () =>
  SetMetadata(TOTP_SETUP_SCOPE_KEY, true);
