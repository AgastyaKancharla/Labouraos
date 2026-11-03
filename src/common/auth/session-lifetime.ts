/** Rewriting lastActivityAt more often than this is skipped. */
export const ACTIVITY_TOUCH_INTERVAL_MS = 60 * 1000;

export type SessionLifetimeEnd = 'idle' | 'max_length';

export function minutesToMs(minutes: number): number {
  return minutes * 60 * 1000;
}

/**
 * Absolute length wins over idle, so a session that is still being used is
 * refused once login + maxSessionMinutes has passed.
 * A request is late when it is strictly after the deadline.
 */
export function sessionLifetimeEnd(
  session: { lastActivityAt: Date; absoluteExpiresAt: Date },
  now: Date,
  idleLogoutMinutes: number,
): SessionLifetimeEnd | null {
  if (now.getTime() > session.absoluteExpiresAt.getTime()) {
    return 'max_length';
  }
  const idleDeadline = session.lastActivityAt.getTime() + minutesToMs(idleLogoutMinutes);
  if (now.getTime() > idleDeadline) {
    return 'idle';
  }
  return null;
}

export function sessionEndMessage(reason: SessionLifetimeEnd): string {
  if (reason === 'idle') {
    return 'Session ended after being idle';
  }
  return 'Session has reached its maximum length';
}

export function shouldTouchActivity(lastActivityAt: Date, now: Date): boolean {
  return now.getTime() - lastActivityAt.getTime() >= ACTIVITY_TOUCH_INTERVAL_MS;
}
