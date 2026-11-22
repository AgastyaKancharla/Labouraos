import { Injectable, Logger } from '@nestjs/common';

/** What a sign-in hook is told about a successful staff sign-in. */
export interface StaffSignedIn {
  staffId: string;
  role: string;
  sessionId: string;
  /** The device's location when the app sent one with the sign-in (Laboura Field). */
  location: { latitude?: number; longitude?: number };
}

type SignInListener = (event: StaffSignedIn) => Promise<unknown>;

/**
 * Work that follows a successful staff sign-in without the auth module
 * depending on it (22 Nov: the attendance day opens at sign-in, in Start of
 * day). Listeners register at start-up; each runs after the session is made.
 * A failing listener is logged and never fails the sign-in.
 */
@Injectable()
export class StaffSignInHooks {
  private readonly logger = new Logger(StaffSignInHooks.name);
  private readonly listeners: { label: string; run: SignInListener }[] = [];

  register(label: string, run: SignInListener): void {
    if (!this.listeners.some((listener) => listener.label === label)) this.listeners.push({ label, run });
  }

  async signedIn(event: StaffSignedIn): Promise<void> {
    for (const listener of this.listeners) {
      try {
        await listener.run(event);
      } catch (error) {
        this.logger.warn(`Sign-in hook "${listener.label}" failed: ${(error as Error).message}`);
      }
    }
  }
}
