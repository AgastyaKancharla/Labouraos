import { isStaffRole, type StaffRole } from './roles';

/**
 * The signed-in staff session, kept in sessionStorage so that closing the
 * browser signs the person out (guide: "closing the browser or app also logs
 * out"). The token key is shared with the old consoles.
 */
export const TOKEN_KEY = 'laboura_token';
export const STAFF_KEY = 'laboura_staff';

export interface StaffIdentity {
  id: string;
  code: string;
  name: string;
  role: StaffRole;
  email: string | null;
}

export interface Session {
  token: string;
  staff: StaffIdentity;
  /** Token expiry, ms since epoch (from the JWT `exp`). */
  expiresAt: number;
  /** Token only allows authenticator enrolment (management not enrolled yet). */
  totpSetupOnly: boolean;
}

export type SignOutReason = 'logout' | 'expired' | 'idle' | 'max_length' | 'revoked' | 'unauthorized';

interface JwtClaims {
  exp?: number;
  sub?: string;
  role?: string;
  code?: string;
  email?: string | null;
  scope?: string;
}

/** Reads the JWT payload without verifying it — only to schedule refreshes. */
export function decodeJwt(token: string): JwtClaims | null {
  const part = token.split('.')[1];
  if (!part) return null;
  try {
    const b64 = part.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(part.length / 4) * 4, '=');
    return JSON.parse(atob(b64)) as JwtClaims;
  } catch {
    return null;
  }
}

function safeGet(key: string): string | null {
  try {
    return sessionStorage.getItem(key);
  } catch {
    return null;
  }
}
function safeSet(key: string, value: string | null): void {
  try {
    if (value === null) sessionStorage.removeItem(key);
    else sessionStorage.setItem(key, value);
  } catch {
    /* storage blocked — session lives in memory for this tab only */
  }
}

/**
 * A session from a token and the staff details shown in the shell. The role
 * always comes from the token's own claims (which the API signed), never from
 * the stored staff details: editing laboura_staff in sessionStorage must not
 * open another portal's shell. A token without a staff role gives no session.
 */
export function sessionFromToken(token: string, staff: StaffIdentity): Session | null {
  const claims = decodeJwt(token);
  if (!claims?.exp) return null;
  if (!isStaffRole(claims.role)) return null;
  return {
    token,
    staff: { ...staff, role: claims.role },
    expiresAt: claims.exp * 1000,
    totpSetupOnly: claims.scope === 'totp_setup',
  };
}

type Listener = (session: Session | null, reason?: SignOutReason, message?: string) => void;

class SessionStore {
  private session: Session | null = null;
  private listeners = new Set<Listener>();

  constructor() {
    this.session = this.load();
  }

  private load(): Session | null {
    const token = safeGet(TOKEN_KEY);
    const rawStaff = safeGet(STAFF_KEY);
    if (!token || !rawStaff) return null;
    try {
      // The stored staff details are only for display; the role is taken
      // from the token (sessionFromToken).
      const staff = JSON.parse(rawStaff) as StaffIdentity;
      const session = sessionFromToken(token, staff);
      if (!session || session.expiresAt <= Date.now()) return null;
      return session;
    } catch {
      return null;
    }
  }

  get(): Session | null {
    return this.session;
  }

  token(): string | null {
    return this.session?.token ?? null;
  }

  set(session: Session): void {
    this.session = session;
    safeSet(TOKEN_KEY, session.token);
    safeSet(STAFF_KEY, JSON.stringify(session.staff));
    this.emit(session);
  }

  /** Swap in a refreshed token for the same person. */
  replaceToken(token: string): void {
    if (!this.session) return;
    const next = sessionFromToken(token, this.session.staff);
    if (next) this.set(next);
  }

  clear(reason: SignOutReason, message?: string): void {
    const had = this.session !== null;
    this.session = null;
    safeSet(TOKEN_KEY, null);
    safeSet(STAFF_KEY, null);
    if (had || reason !== 'logout') this.emit(null, reason, message);
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(session: Session | null, reason?: SignOutReason, message?: string) {
    for (const l of this.listeners) l(session, reason, message);
  }

  /** Test helper: reload from storage. */
  reloadForTests(): void {
    this.session = this.load();
  }
}

export const sessionStore = new SessionStore();

/** Maps the API's 401 messages to a reason the sign-in screen can explain. */
export function reasonFromMessage(message: string | undefined): SignOutReason {
  const m = (message ?? '').toLowerCase();
  if (m.includes('idle')) return 'idle';
  if (m.includes('maximum length')) return 'max_length';
  if (m.includes('revoked') || m.includes('not active')) return 'revoked';
  if (m.includes('expired')) return 'expired';
  return 'unauthorized';
}
