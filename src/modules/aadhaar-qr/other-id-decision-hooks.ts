import { Injectable, Logger } from '@nestjs/common';
import type { OtherIdSubjectType } from './other-id-approval.service';

/** What follows an approved other ID (PAN, driving licence, voter ID), as the decider's answer shows it. */
export interface OtherIdFollowUp {
  /** sent: the next-step link went out; skipped: it did not (the reason says why); none: nothing to send. */
  status: 'sent' | 'skipped' | 'none';
  reason: string | null;
}

export interface OtherIdApproved {
  subjectType: OtherIdSubjectType;
  subjectId: string;
  actor: { id: string; role: string };
  now: Date;
}

type ApprovedListener = (event: OtherIdApproved) => Promise<OtherIdFollowUp>;

/**
 * Work that follows an approved other ID without the ID check depending on it
 * (22 Nov: the ₹499 payment link goes to a job seeker who hasn't paid). One
 * listener per subject type; a failing listener is logged and never undoes
 * the decision.
 */
@Injectable()
export class OtherIdDecisionHooks {
  private readonly logger = new Logger(OtherIdDecisionHooks.name);
  private readonly listeners = new Map<OtherIdSubjectType, ApprovedListener>();

  onApproved(subjectType: OtherIdSubjectType, run: ApprovedListener): void {
    this.listeners.set(subjectType, run);
  }

  async approved(event: OtherIdApproved): Promise<OtherIdFollowUp> {
    const run = this.listeners.get(event.subjectType);
    if (!run) return { status: 'none', reason: null };
    try {
      return await run(event);
    } catch (error) {
      this.logger.warn(`Follow-up after an approved ID failed: ${(error as Error).message}`);
      return { status: 'skipped', reason: 'failed' };
    }
  }
}
