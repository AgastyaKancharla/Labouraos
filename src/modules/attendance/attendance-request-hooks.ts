import { Injectable, Logger, Optional } from '@nestjs/common';
import { NotificationSourcesService } from '../notification/notification-sources.service';
import { AttendanceClock } from './attendance-clock';

export type AttendanceRequestKind = 'leave' | 'correction';

/**
 * The notification bells for leave and correction requests (Phase 21 Task 6).
 * Called when a request is routed, forwarded, decided or overturned. Each call
 * makes the bells match where the request is now (request-routing.ts): the
 * approver it is with gets it, the ones it has left have it cleared with who
 * moved it, and the requester hears the decision. Escalation after 24 and 48
 * hours needs no event: the notification sweep and bell reads re-check every
 * pending request against the clock.
 */
@Injectable()
export class AttendanceRequestHooks {
  private readonly logger = new Logger(AttendanceRequestHooks.name);

  constructor(
    private readonly clock: AttendanceClock,
    @Optional() private readonly bells?: NotificationSourcesService,
  ) {}

  private async sync(kind: AttendanceRequestKind, requestId: string, what: string): Promise<void> {
    this.logger.debug(`${kind} request ${requestId} ${what}`);
    if (!this.bells) return;
    try {
      await this.bells.syncRequest(kind, requestId, this.clock.now());
    } catch (error) {
      // A bell never blocks the request itself.
      this.logger.warn(`Bell for ${kind} request ${requestId} failed: ${(error as Error).message}`);
    }
  }

  async requestRouted(kind: AttendanceRequestKind, requestId: string): Promise<void> {
    await this.sync(kind, requestId, 'routed');
  }

  async requestForwarded(kind: AttendanceRequestKind, requestId: string): Promise<void> {
    await this.sync(kind, requestId, 'forwarded to the Manager');
  }

  async requestDecided(kind: AttendanceRequestKind, requestId: string): Promise<void> {
    await this.sync(kind, requestId, 'decided');
  }

  async requestOverturned(kind: AttendanceRequestKind, requestId: string): Promise<void> {
    await this.sync(kind, requestId, 'overturned');
  }
}
