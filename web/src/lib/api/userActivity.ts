/**
 * When the person last used the page (click, key, touch, scroll). The API
 * client marks GET requests made while nobody is using the page — the 30-second
 * polls, bells and badges — as background (`X-Laboura-Background: 1`), so they
 * do not keep the session's idle clock alive (21 Nov: outside an open
 * attendance day the 1-hour idle sign-out works again).
 */
export const BACKGROUND_HEADER = 'X-Laboura-Background';
/** A GET within this long of the last input counts as the person's own. */
export const USER_ACTIVE_WINDOW_MS = 60_000;

const EVENTS = ['pointerdown', 'keydown', 'touchstart', 'wheel', 'scroll'] as const;
let lastInput = Date.now();
let listening = false;

function mark() {
  lastInput = Date.now();
}

function listen() {
  if (listening || typeof window === 'undefined') return;
  listening = true;
  for (const name of EVENTS) window.addEventListener(name, mark, { passive: true, capture: true });
}

/** True when nobody has used the page for a minute. */
export function isBackgroundNow(now: number = Date.now()): boolean {
  listen();
  return now - lastInput > USER_ACTIVE_WINDOW_MS;
}

/** Tests: the person just used the page. */
export function markUserActivity(at: number = Date.now()): void {
  listen();
  lastInput = at;
}
