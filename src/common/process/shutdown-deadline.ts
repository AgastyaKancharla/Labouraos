/**
 * Graceful shutdown with a hard stop.
 *
 * On SIGTERM (Render stops the old instance once the new one is healthy) Nest
 * runs every shutdown hook: the job worker stops and every Redis connection is
 * closed (JobQueueLifecycle), so the old instance gives its connections back.
 * If a hook still hangs (for example Redis does not answer at all), the
 * process exits anyway after SHUTDOWN_TIMEOUT_MS (default 20 s), well inside
 * Render's 30-second grace period, instead of holding connections until it is
 * killed.
 */
export const DEFAULT_SHUTDOWN_TIMEOUT_MS = 20_000;

export function shutdownTimeoutMs(env: NodeJS.ProcessEnv = process.env): number {
  const raw = Number(env.SHUTDOWN_TIMEOUT_MS);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_SHUTDOWN_TIMEOUT_MS;
}

let installed = false;

export function installShutdownDeadline(
  log: (message: string) => void,
  timeoutMs: number = shutdownTimeoutMs(),
  exit: (code: number) => void = (code) => process.exit(code),
): void {
  if (installed) return;
  installed = true;
  for (const signal of ['SIGTERM', 'SIGINT'] as const) {
    process.once(signal, () => {
      const timer = setTimeout(() => {
        log(`Shutdown did not finish within ${timeoutMs}ms after ${signal}; exiting now`);
        exit(0);
      }, timeoutMs);
      timer.unref();
    });
  }
}
