/**
 * What this process does, from the PROCESS_ROLE setting.
 *
 * - `web` (or unset): serves the API, the screens and the webhooks. Runs no
 *   scheduled job. Watches that the nightly sweep still runs.
 * - `worker`: runs every scheduled job and queue worker, serves nothing
 *   (`npm run start:worker`, the paid Render Background Worker).
 * - `all`: one process does both. Used on Render's free tier, which has no
 *   Background Worker: the single free web service serves the site AND runs
 *   the jobs (see render.free.yaml and DEPLOY.md, "Free tier for testing").
 *
 * Every job checks `runsJobs()`; anything only the web side does checks
 * `servesWeb()`. Never read PROCESS_ROLE directly.
 */
export type ProcessRole = 'web' | 'worker' | 'all';

export const PROCESS_ROLES: readonly ProcessRole[] = ['web', 'worker', 'all'];

export function processRole(env: NodeJS.ProcessEnv = process.env): ProcessRole {
  const raw = env.PROCESS_ROLE?.trim().toLowerCase();
  if (raw === 'worker') return 'worker';
  if (raw === 'all') return 'all';
  return 'web';
}

/** True when this process registers job schedules and runs the queue workers. */
export function runsJobs(env: NodeJS.ProcessEnv = process.env): boolean {
  const role = processRole(env);
  return role === 'worker' || role === 'all';
}

/** True when this process serves the API (and does the web side's own checks). */
export function servesWeb(env: NodeJS.ProcessEnv = process.env): boolean {
  return processRole(env) !== 'worker';
}

/**
 * Start-up check: a misspelt PROCESS_ROLE (for example `both`) would silently
 * mean `web`, and no job would ever run. Refuse to start instead.
 */
export function assertKnownProcessRole(env: NodeJS.ProcessEnv = process.env): ProcessRole {
  const raw = env.PROCESS_ROLE?.trim().toLowerCase();
  if (raw && !(PROCESS_ROLES as readonly string[]).includes(raw)) {
    throw new Error(
      `PROCESS_ROLE is "${env.PROCESS_ROLE}", which is not one of web, worker or all. ` +
        'Use web (site only), worker (jobs only) or all (one process does both, Render free tier).',
    );
  }
  return processRole(env);
}

/** The line the web process logs once it is listening, so the deploy log shows what it does. */
export function startupRoleMessage(role: ProcessRole): string {
  if (role === 'all') return 'PROCESS_ROLE=all: serving the API and running every scheduled job';
  if (role === 'worker') return 'PROCESS_ROLE=worker on the web entry point: serving the API and running the jobs (use all instead)';
  return 'PROCESS_ROLE=web: serving the API; scheduled jobs run in the worker';
}
