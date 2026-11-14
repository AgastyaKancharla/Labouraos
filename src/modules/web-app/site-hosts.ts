import type { Request } from 'express';

/**
 * Which web address a request came in on (decided 14 Nov):
 *   - app.laboura.com — one login page and every office portal at the root
 *     (/login, /ceo, /manager, /team-lead, /finance, /call-agent), the public
 *     pages (/p/...), and the API at its usual paths;
 *   - field.laboura.com — Laboura Field at the root, installable as a phone app;
 *   - the Render test address (*.onrender.com) — the portals at the root and
 *     Laboura Field at /field.
 * Nothing is hard-coded: FIELD_HOST names the field address (a comma-separated
 * list is allowed). Every host that is not a field host gets the office app.
 */
export const FIELD_HOST_ENV = 'FIELD_HOST';

/** "Field.Laboura.com:443" or "https://field.laboura.com/" → "field.laboura.com". */
export function normaliseHost(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/^[a-z]+:\/\//, '')
    .replace(/\/.*$/, '')
    .replace(/:\d+$/, '')
    .replace(/\.$/, '');
}

/** The configured Laboura Field host names (empty when FIELD_HOST is unset). */
export function fieldHosts(env: NodeJS.ProcessEnv = process.env): string[] {
  return (env[FIELD_HOST_ENV] ?? '')
    .split(',')
    .map(normaliseHost)
    .filter(Boolean);
}

/** The host name the browser asked for (from the Host header; behind a trusted proxy, X-Forwarded-Host). */
export function requestHost(req: Pick<Request, 'hostname' | 'headers'>): string {
  const raw = req.hostname || (typeof req.headers.host === 'string' ? req.headers.host : '');
  return normaliseHost(raw ?? '');
}

export function isFieldHost(req: Pick<Request, 'hostname' | 'headers'>, env: NodeJS.ProcessEnv = process.env): boolean {
  const hosts = fieldHosts(env);
  return hosts.length > 0 && hosts.includes(requestHost(req));
}

/** Laboura Field's address: the root of FIELD_HOST when one is set, otherwise /field on this address. */
export function fieldAppAddress(env: NodeJS.ProcessEnv = process.env): string {
  const host = fieldHosts(env)[0];
  return host ? `https://${host}/` : '/field/';
}
