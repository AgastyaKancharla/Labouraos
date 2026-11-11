import { Injectable, Logger } from '@nestjs/common';

export type AttendanceRequestKind = 'leave' | 'correction';

/**
 * Hook for the notification bells (Phase 21 Task 6). Leave and correction
 * requests call it when a request is routed, forwarded or decided. Until the
 * bells exist it only logs; escalation after 24 and 48 hours is worked out
 * when the request lists are read (see request-routing.ts).
 */
@Injectable()
export class AttendanceRequestHooks {
  private readonly logger = new Logger(AttendanceRequestHooks.name);

  async requestRouted(kind: AttendanceRequestKind, requestId: string): Promise<void> {
    this.logger.debug(`${kind} request ${requestId} routed`);
  }

  async requestForwarded(kind: AttendanceRequestKind, requestId: string): Promise<void> {
    this.logger.debug(`${kind} request ${requestId} forwarded to the Manager`);
  }

  async requestDecided(kind: AttendanceRequestKind, requestId: string): Promise<void> {
    this.logger.debug(`${kind} request ${requestId} decided`);
  }
}
