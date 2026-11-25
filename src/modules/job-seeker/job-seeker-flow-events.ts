import { Global, Injectable, Logger, Module } from '@nestjs/common';

/**
 * What happened on a job seeker's registration (Master Guide rev 211, 25 Nov), for work that
 * follows it without the step itself depending on it: the selfie, the payment, the Aadhaar QR check
 * and the other-ID decision raise these; the job seeker module listens (starts the 30 days, sends
 * "payment received, only your ID check is left", "your 30 days have started", "your ID check
 * did not pass"). A failing listener is logged and never undoes the payment or the check.
 *
 * A module with no imports, so the payment and ID-check modules can raise events without a
 * dependency cycle on the job seeker module.
 */
export interface JobSeekerPaidEvent {
  jobSeekerId: string;
  paymentId: string;
  /** True when his ID had already passed: the 30 days started at this payment. */
  guaranteeStarted: boolean;
  now: Date;
}

export interface JobSeekerIdPassedEvent {
  jobSeekerId: string;
  /** Who passed it: the field agent who scanned, or null when he scanned on his own link. */
  actor: { id: string; role: string } | null;
  now: Date;
}

export interface JobSeekerIdFailedEvent {
  jobSeekerId: string;
  verificationId: string;
  /** under_18, name_mismatch or rejected (another ID the Team Lead turned down). */
  result: 'under_18' | 'name_mismatch' | 'rejected';
  now: Date;
}

export interface JobSeekerSelfieSavedEvent {
  jobSeekerId: string;
  now: Date;
}

type Listener<T> = (event: T) => Promise<void>;

@Injectable()
export class JobSeekerFlowEvents {
  private readonly logger = new Logger(JobSeekerFlowEvents.name);
  private paidListener: Listener<JobSeekerPaidEvent> | null = null;
  private idPassedListener: Listener<JobSeekerIdPassedEvent> | null = null;
  private idFailedListener: Listener<JobSeekerIdFailedEvent> | null = null;
  private selfieListener: Listener<JobSeekerSelfieSavedEvent> | null = null;

  onSelfieSaved(run: Listener<JobSeekerSelfieSavedEvent>): void {
    this.selfieListener = run;
  }

  async selfieSaved(event: JobSeekerSelfieSavedEvent): Promise<void> {
    await this.run('selfieSaved', this.selfieListener, event);
  }

  onPaid(run: Listener<JobSeekerPaidEvent>): void {
    this.paidListener = run;
  }

  onIdPassed(run: Listener<JobSeekerIdPassedEvent>): void {
    this.idPassedListener = run;
  }

  onIdFailed(run: Listener<JobSeekerIdFailedEvent>): void {
    this.idFailedListener = run;
  }

  async paid(event: JobSeekerPaidEvent): Promise<void> {
    await this.run('paid', this.paidListener, event);
  }

  async idPassed(event: JobSeekerIdPassedEvent): Promise<void> {
    await this.run('idPassed', this.idPassedListener, event);
  }

  async idFailed(event: JobSeekerIdFailedEvent): Promise<void> {
    await this.run('idFailed', this.idFailedListener, event);
  }

  private async run<T>(name: string, listener: Listener<T> | null, event: T): Promise<void> {
    if (!listener) return;
    try {
      await listener(event);
    } catch (error) {
      this.logger.warn(`Job seeker ${name} follow-up failed: ${(error as Error).message}`);
    }
  }
}

/** Global so the payment and ID-check services can take it as an optional dependency anywhere. */
@Global()
@Module({
  providers: [JobSeekerFlowEvents],
  exports: [JobSeekerFlowEvents],
})
export class JobSeekerFlowEventsModule {}
