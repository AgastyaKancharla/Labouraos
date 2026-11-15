/**
 * Who signs in how (Master Guide rev 174–175, 15 Nov): the one list every
 * sign-in check uses.
 *
 * - CEO, Manager, Finance and Team Lead sign in with their own authenticator
 *   app (no login code from a senior).
 * - Call agents and field agents sign in with a login code revealed by a
 *   senior on the login code screen.
 *
 * Do not widen this list to mean "management": the Team Lead is an
 * authenticator role but not management.
 */
export const AUTHENTICATOR_ROLES: readonly string[] = ['ceo', 'manager', 'finance', 'team_lead'];

/** Call agents and field agents: a 6-digit login code from a senior at every sign-in. */
export const LOGIN_CODE_ROLES: readonly string[] = ['call_agent', 'field_agent'];

export function usesAuthenticator(role: string): boolean {
  return AUTHENTICATOR_ROLES.includes(role);
}

export function usesLoginCode(role: string): boolean {
  return LOGIN_CODE_ROLES.includes(role);
}
