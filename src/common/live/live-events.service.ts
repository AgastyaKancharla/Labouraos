import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { Observable, Subject, filter, map } from 'rxjs';

/**
 * The live channel from the server to a staff member's browser
 * (Server-Sent Events). Each event is addressed to one staff member and only
 * reaches that person's open screens.
 *
 * Events in use:
 * - `incoming_call`: a call is ringing for this agent (CA17 pop-up).
 * - `call_status`: the calling system reported progress on a call this agent
 *   placed (answered, no answer, ended), so the on-call screen moves on
 *   without waiting for its next poll.
 * - `registration_step`: kept for the registration screens (ticks turning
 *   green); publish with the same service.
 * - `notification`: one of this person's bell notifications opened or
 *   cleared, so the bell reloads now instead of at its next 30-second poll.
 * - `attendance_status`: this person's attendance status changed (picked,
 *   set by the phone system, by the idle detector, or the day ended), so the
 *   header status menu changes at once.
 *
 * Delivery is in-process: the web service runs as one instance on Render and
 * every webhook that feeds this channel arrives there. Screens also poll as a
 * fallback, so a missed event only costs a few seconds, never data.
 */
export type LiveEventType =
  | 'incoming_call'
  | 'call_status'
  | 'registration_step'
  | 'notification'
  | 'attendance_status';

export interface LiveEvent {
  type: LiveEventType;
  /** Recipient staff id. Never sent to anyone else. */
  staffId: string;
  data: Record<string, unknown>;
  at: string;
}

export interface LiveMessage {
  type: LiveEventType;
  data: Record<string, unknown>;
  id: string;
}

@Injectable()
export class LiveEventsService implements OnModuleDestroy {
  private readonly logger = new Logger(LiveEventsService.name);
  private readonly bus = new Subject<LiveEvent>();
  /** "Check this person's sessions again now": a session of theirs was ended. */
  private readonly sessionRechecks = new Subject<string>();
  private readonly listeners = new Map<string, number>();
  private sequence = 0;

  /** Sends an event to one staff member. Returns true when a screen of theirs is open. */
  publish(staffId: string, type: LiveEventType, data: Record<string, unknown>): boolean {
    if (!staffId) return false;
    this.bus.next({ type, staffId, data, at: new Date().toISOString() });
    return (this.listeners.get(staffId) ?? 0) > 0;
  }

  /** The events for one staff member, as SSE messages. */
  streamFor(staffId: string): Observable<LiveMessage> {
    return new Observable<LiveMessage>((subscriber) => {
      this.listeners.set(staffId, (this.listeners.get(staffId) ?? 0) + 1);
      const subscription = this.bus
        .pipe(
          filter((event) => event.staffId === staffId),
          map((event) => {
            this.sequence += 1;
            return {
              type: event.type,
              id: String(this.sequence),
              data: { ...event.data, at: event.at },
            };
          }),
        )
        .subscribe(subscriber);
      return () => {
        subscription.unsubscribe();
        const left = (this.listeners.get(staffId) ?? 1) - 1;
        if (left <= 0) this.listeners.delete(staffId);
        else this.listeners.set(staffId, left);
      };
    });
  }

  /**
   * Called wherever a staff member's sessions are ended (deactivated, locked,
   * device revoked, invite re-issued, password reset): each open stream of
   * theirs checks its own session at once and closes if it has ended, instead
   * of waiting for its next periodic check (LiveController).
   */
  recheckSessions(staffId: string): void {
    if (staffId) this.sessionRechecks.next(staffId);
  }

  /** Emits each time recheckSessions is called for this staff member. */
  sessionRechecksFor(staffId: string): Observable<void> {
    return this.sessionRechecks.pipe(
      filter((id) => id === staffId),
      map(() => undefined),
    );
  }

  /** How many screens a staff member has open on the channel. */
  openScreens(staffId: string): number {
    return this.listeners.get(staffId) ?? 0;
  }

  onModuleDestroy() {
    this.logger.log('Closing the live channel');
    this.bus.complete();
    this.sessionRechecks.complete();
  }
}
