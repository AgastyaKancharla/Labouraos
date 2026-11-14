import type { KeyValueStore } from '@/lib/storage';

/**
 * The customer's sign-in, kept on the phone (Keychain / Keystore via
 * expo-secure-store). Only the tokens are stored, never profile data.
 *
 * Customers stay signed in on their own phone for 90 days, renewed on use
 * (proposal 3.5, C16); the server enforces it and answers 401 when it ends.
 * The app also forgets a session older than 90 days without use. Sensitive
 * actions (deleting the account, confirming a vacancy) always ask for a
 * fresh OTP on top.
 */
export const SESSION_KEY = 'laboura_customer_session';
export const SESSION_MAX_IDLE_MS = 90 * 24 * 60 * 60 * 1000;

export type SignedOutReason = 'signed_out' | 'expired' | 'deleted';

export interface StoredSession {
  accessToken: string;
  refreshToken: string | null;
  lastUsedAt: number;
}

type Listener = (session: StoredSession | null, reason?: SignedOutReason) => void;

export class SessionStore {
  private current: StoredSession | null = null;
  private listeners = new Set<Listener>();

  constructor(private readonly storage: KeyValueStore, private readonly now: () => number = Date.now) {}

  token(): string | null {
    return this.current?.accessToken ?? null;
  }

  session(): StoredSession | null {
    return this.current;
  }

  /** Reads the saved session once at start. Drops a corrupt or too-old one. */
  async load(): Promise<StoredSession | null> {
    const raw = await this.storage.getItem(SESSION_KEY);
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw) as Partial<StoredSession>;
      if (typeof parsed.accessToken !== 'string' || !parsed.accessToken) throw new Error('bad');
      const lastUsedAt = typeof parsed.lastUsedAt === 'number' ? parsed.lastUsedAt : 0;
      if (this.now() - lastUsedAt > SESSION_MAX_IDLE_MS) {
        await this.storage.removeItem(SESSION_KEY);
        return null;
      }
      this.current = { accessToken: parsed.accessToken, refreshToken: parsed.refreshToken ?? null, lastUsedAt: this.now() };
      await this.save();
      return this.current;
    } catch {
      await this.storage.removeItem(SESSION_KEY);
      return null;
    }
  }

  async start(accessToken: string, refreshToken: string | null = null): Promise<void> {
    this.current = { accessToken, refreshToken, lastUsedAt: this.now() };
    await this.save();
    this.emit(this.current);
  }

  async clear(reason: SignedOutReason = 'signed_out'): Promise<void> {
    const had = this.current !== null;
    this.current = null;
    await this.storage.removeItem(SESSION_KEY);
    if (had) this.emit(null, reason);
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private async save(): Promise<void> {
    if (this.current) await this.storage.setItem(SESSION_KEY, JSON.stringify(this.current));
  }

  private emit(session: StoredSession | null, reason?: SignedOutReason) {
    for (const l of this.listeners) l(session, reason);
  }
}
