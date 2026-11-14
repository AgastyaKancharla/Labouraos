import type { Request } from 'express';
import { fieldAppAddress, isFieldHost } from '../../modules/web-app/site-hosts';

/**
 * Each app accepts only its own roles (owner decision 14 Nov).
 *
 *   office — the office web app at app.laboura.com: CEO, Manager, Team Lead,
 *            Finance and call agents (each opens only their own portal).
 *   field  — Laboura Field (field.laboura.com, or /field on other addresses):
 *            field agents only. The CEO no longer uses Laboura Field; the
 *            owners use their own field agent account.
 *
 * A sign-in names its app (`app` in POST /auth/login and
 * /auth/login/verify-code; the office app sends 'office', Laboura Field sends
 * 'field'). The app is stored on the device request, the login code request
 * and the session, and carried in the token; JwtStrategy accepts a token only
 * for its own app (the role must belong to the session's app — that is the
 * rule that protects data, together with each route's role guard).
 *
 * The Laboura Field address (FIELD_HOST) is also checked: sign-ins there are
 * 'field' and only field sessions are accepted there. The Host header comes
 * from the client, so this is defence in depth only, never a security
 * boundary on its own.
 *
 * Older clients that do not send `app` yet (a phone still running a cached
 * build): on the Laboura Field address the app is 'field'; anywhere else the
 * session gets the role's own app. That never gives anyone a session for the
 * wrong app; it only means such a client sees the role's own app instead of
 * the friendly refusal. Both apps are rebuilt with every deploy, so this only
 * covers the minutes until a phone reloads.
 */
export type StaffApp = 'office' | 'field';

export const STAFF_APPS: readonly StaffApp[] = ['office', 'field'];

export const OFFICE_APP_ROLES: readonly string[] = ['ceo', 'manager', 'team_lead', 'finance', 'call_agent'];
export const FIELD_APP_ROLES: readonly string[] = ['field_agent'];

export function isStaffApp(value: unknown): value is StaffApp {
  return value === 'office' || value === 'field';
}

/** The app a role signs in to. */
export function appForRole(role: string): StaffApp {
  return FIELD_APP_ROLES.includes(role) ? 'field' : 'office';
}

export function roleAllowedInApp(role: string, app: StaffApp): boolean {
  return (app === 'field' ? FIELD_APP_ROLES : OFFICE_APP_ROLES).includes(role);
}

/** Laboura Field refuses everyone but field agents with this sentence (the field app translates it). */
export const FIELD_APP_ONLY_MESSAGE = 'This app is for field agents. Please sign in at app.laboura.com.';

/** The office app refuses field agents, pointing them to Laboura Field's real address. */
export function officeAppRefusalMessage(env: NodeJS.ProcessEnv = process.env): string {
  return `Field agents use Laboura Field: ${fieldAppAddress(env)}`;
}

/** The refusal for a role signing in to the wrong app. */
export function wrongAppMessage(app: StaffApp, env: NodeJS.ProcessEnv = process.env): string {
  return app === 'field' ? FIELD_APP_ONLY_MESSAGE : officeAppRefusalMessage(env);
}

/** Message for a body that names an app that is not one of the two. */
export const UNKNOWN_APP_MESSAGE = "app must be 'office' or 'field'";

/**
 * The app a sign-in request asks for: 'field' on the Laboura Field address
 * whatever the body says (a body asking for another app there is refused by
 * the caller), otherwise the body's `app`, or null when an older client sent none.
 */
export function requestedApp(
  bodyApp: unknown,
  req: Pick<Request, 'hostname' | 'headers'> | undefined,
): { app: StaffApp | null; fieldHost: boolean; invalid: boolean } {
  const fieldHost = req ? isFieldHost(req) : false;
  if (bodyApp !== undefined && bodyApp !== null && bodyApp !== '' && !isStaffApp(bodyApp)) {
    return { app: null, fieldHost, invalid: true };
  }
  const named = isStaffApp(bodyApp) ? bodyApp : null;
  if (fieldHost) return { app: 'field', fieldHost, invalid: named !== null && named !== 'field' };
  return { app: named, fieldHost, invalid: false };
}

/** Labels shown to the senior approving a device or giving a login code. */
export function appLabel(app: string | null | undefined): string {
  if (app === 'field') return 'Laboura Field';
  if (app === 'office') return 'Office browser';
  return 'Login device';
}
