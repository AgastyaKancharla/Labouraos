import { ALL_STAFF_ROLES } from '../rbac/rbac.types';

/**
 * A staff access token, and nothing else: a staff id and a staff role, and
 * none of the claims other tokens carry — no `scope` (the old limited
 * "totp_setup" token), no customer-app `realm`, `aud` or `iss`. Checked
 * wherever a staff token is verified (JwtStrategy and AuthService.verifyToken).
 */
export function isStaffAccessToken(payload: unknown, options: { scopeRefusedLater?: boolean } = {}): boolean {
  if (!payload || typeof payload !== 'object') return false;
  const claims = payload as Record<string, unknown>;
  // JwtAuthGuard refuses a scoped token with 403 right after the strategy; elsewhere it is refused here.
  if (!options.scopeRefusedLater && 'scope' in claims) return false;
  if ('realm' in claims || 'aud' in claims || 'iss' in claims) return false;
  if (typeof claims.sub !== 'string' || !claims.sub) return false;
  return typeof claims.role === 'string' && (ALL_STAFF_ROLES as readonly string[]).includes(claims.role);
}
