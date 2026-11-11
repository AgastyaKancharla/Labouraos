import type { KeyValueStore } from '@/lib/storage/types';

/**
 * The signed-in field agent, kept on the phone (Keychain/Keystore on the
 * phone app, localStorage in the installed web app) so closing the app does
 * not sign him out before the session limits.
 *
 * The server is the authority on every limit (it answers 401). The phone
 * also ends the session itself when a limit has clearly passed, so a phone
 * left in a pocket shows the sign-in screen instead of failing requests:
 * - 1 hour without activity (guide: "Automatic logout after 1 hour"),
 * - 2 hours after login (guide: "every login lasts at most 2 hours"),
 * - the access token expired (it lives 15 minutes and is refreshed while
 *   the app is in use) — unless the session has a refresh token: then the
 *   app asks POST /auth/field/refresh for a new one when it is reopened, and
 *   the server answers with the idle or 2-hour reason once a limit passed.
 */
export const SESSION_STORAGE_KEY = 'laboura_field_session';
export const IDLE_LIMIT_MS = 60 * 60 * 1000;
export const MAX_SESSION_MS = 2 * 60 * 60 * 1000;
/** Activity is written to storage at most this often. */
export const ACTIVITY_SAVE_INTERVAL_MS = 60 * 1000;

export type StaffRole = 'ceo' | 'manager' | 'team_lead' | 'call_agent' | 'field_agent' | 'finance';

export interface StaffIdentity {
  id: string;
  code: string;
  name: string;
  role: StaffRole | string;
}

export interface Session {
  token: string;
  sessionId: string | null;
  staff: StaffIdentity;
  /** Token expiry, ms since epoch (from the JWT `exp`). */
  tokenExpiresAt: number;
  /** When the login code was accepted, ms since epoch. */
  loginAt: number;
  /** Last tap or keypress, ms since epoch. */
  lastActivityAt: number;
  /**
   * Single-use refresh token from the login (field agents). Restores the
   * session after the app was closed; replaced on every refresh.
   */
  refreshToken?: string | null;
}

export type SignOutReason = 'logout' | 'idle' | 'max_length' | 'revoked' | 'expired' | 'unauthorized';

interface JwtClaims {
  exp?: number;
  sub?: string;
  role?: string;
}

function base64UrlDecode(part: string): string {
  const b64 = part.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(part.length / 4) * 4, '=');
  if (typeof atob === 'function') return atob(b64);
  // Hermes before atob support: decode by hand.
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  let output = '';
  let buffer = 0;
  let bits = 0;
  for (const c of b64.replace(/=+$/, '')) {
    buffer = (buffer << 6) | chars.indexOf(c);
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      output += String.fromCharCode((buffer >> bits) & 0xff);
    }
  }
  return output;
}

/** Reads the JWT payload without verifying it — only to know when it expires. */
export function decodeJwt(token: string): JwtClaims | null {
  const part = token.split('.')[1];
  if (!part) return null;
  try {
    return JSON.parse(base64UrlDecode(part)) as JwtClaims;
  } catch {
    return null;
  }
}

/** Which limit (if any) has passed for this session at `now`. */
export function sessionLimitReached(session: Session, now: number): SignOutReason | null {
  if (now - session.loginAt > MAX_SESSION_MS) return 'max_length';
  if (now - session.lastActivityAt > IDLE_LIMIT_MS) return 'idle';
  // With a refresh token an expired access token is renewed, not the end.
  if (now >= session.tokenExpiresAt && !session.refreshToken) return 'expired';
  return null;
}

/** True when the access token has run out or is about to (within `marginMs`). */
export function tokenNeedsRefresh(session: Session, now: number, marginMs: number): boolean {
  return session.tokenExpiresAt - now <= marginMs;
}

/** Maps the API's 401 messages to a reason the sign-in screen can explain. */
export function reasonFromMessage(message: string | undefined): SignOutReason {
  const m = (message ?? '').toLowerCase();
  if (m.includes('idle')) return 'idle';
  if (m.includes('maximum length')) return 'max_length';
  if (m.includes('revoked') || m.includes('not active') || m.includes('session not found')) return 'revoked';
  if (m.includes('expired')) return 'expired';
  return 'unauthorized';
}

type Listener = (session: Session | null, reason?: SignOutReason) => void;

export class SessionStore {
  private session: Session | null = null;
  private listeners = new Set<Listener>();
  private lastSavedActivity = 0;

  constructor(
    private readonly storage: KeyValueStore,
    private readonly now: () => number = () => Date.now(),
  ) {}

  /** Reads the saved session; drops it when a limit has passed. */
  async load(): Promise<Session | null> {
    const raw = await this.storage.getItem(SESSION_STORAGE_KEY);
    if (!raw) {
      this.session = null;
      return null;
    }
    try {
      const saved = JSON.parse(raw) as Session;
      if (!saved.token || !saved.staff?.id) throw new Error('bad session');
      const reason = sessionLimitReached(saved, this.now());
      if (reason) {
        await this.storage.removeItem(SESSION_STORAGE_KEY);
        this.session = null;
        this.emit(null, reason);
        return null;
      }
      this.session = saved;
      return saved;
    } catch {
      await this.storage.removeItem(SESSION_STORAGE_KEY);
      this.session = null;
      return null;
    }
  }

  get(): Session | null {
    return this.session;
  }

  token(): string | null {
    return this.session?.token ?? null;
  }

  /** Starts a session from the login response. */
  async start(
    token: string,
    staff: StaffIdentity,
    sessionId: string | null,
    refreshToken: string | null = null,
  ): Promise<Session> {
    const now = this.now();
    const exp = decodeJwt(token)?.exp;
    const session: Session = {
      token,
      sessionId,
      staff,
      tokenExpiresAt: exp ? exp * 1000 : now + 15 * 60 * 1000,
      loginAt: now,
      lastActivityAt: now,
      refreshToken,
    };
    await this.save(session);
    this.emit(session);
    return session;
  }

  /** Swaps in a refreshed token (and the next refresh token) for the same person. */
  async replaceToken(token: string, refreshToken?: string): Promise<void> {
    if (!this.session) return;
    const exp = decodeJwt(token)?.exp;
    const next: Session = {
      ...this.session,
      token,
      tokenExpiresAt: exp ? exp * 1000 : this.now() + 15 * 60 * 1000,
      ...(refreshToken ? { refreshToken } : {}),
    };
    await this.save(next);
    this.emit(next);
  }

  /** Records activity (a tap). Saved to storage at most once a minute. */
  touch(): void {
    if (!this.session) return;
    const now = this.now();
    this.session = { ...this.session, lastActivityAt: now };
    if (now - this.lastSavedActivity >= ACTIVITY_SAVE_INTERVAL_MS) {
      void this.save(this.session);
    }
  }

  /** Ends the session if a limit has passed. Returns the reason, if any. */
  async enforceLimits(): Promise<SignOutReason | null> {
    if (!this.session) return null;
    const reason = sessionLimitReached(this.session, this.now());
    if (reason) await this.clear(reason);
    return reason;
  }

  async clear(reason: SignOutReason): Promise<void> {
    const had = this.session !== null;
    this.session = null;
    await this.storage.removeItem(SESSION_STORAGE_KEY);
    if (had || reason !== 'logout') this.emit(null, reason);
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private async save(session: Session): Promise<void> {
    this.session = session;
    this.lastSavedActivity = this.now();
    await this.storage.setItem(SESSION_STORAGE_KEY, JSON.stringify(session));
  }

  private emit(session: Session | null, reason?: SignOutReason) {
    for (const listener of this.listeners) listener(session, reason);
  }
}
