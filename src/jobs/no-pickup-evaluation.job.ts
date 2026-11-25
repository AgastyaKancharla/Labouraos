import {
  Inject,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
  Optional,
} from '@nestjs/common';
import { Queue, Worker } from 'bullmq';
import { JobHandler, LABOURA_JOBS_QUEUE, jobQueue, startScheduledJob } from './job-queue';
import { redisConnectionOptions } from '../common/redis/redis-connections';
import { messagesBlocked } from '../modules/call/contact-block';
import { PrismaService } from '../common/prisma/prisma.service';
import { JobSeekerService } from '../modules/job-seeker/job-seeker.service';
import {
  WHATSAPP_PROVIDER,
  WhatsAppProvider,
} from '../common/whatsapp/whatsapp.interface';
import { AuditService } from '../common/audit/audit.service';
import { MessagingService } from '../modules/message/messaging.service';
import {
  getRequestId,
  runWithRequestId,
} from '../common/observability/request-context';
import { StructuredLogger } from '../common/observability/structured-logger.service';
import { primaryJobSeekerTrade } from '../modules/job-seeker/job-seeker-legacy-read';
import { cronInIndia, DAILY_JOB_PATTERNS } from './job-schedules';
import { runsJobs } from '../common/process/process-role';

/** Every job shares one queue (no-pickup-evaluation was its own queue before; see job-queue.ts). */
export const NO_PICKUP_EVALUATION_QUEUE = LABOURA_JOBS_QUEUE;
export const NO_PICKUP_EVALUATION_JOB = 'daily-no-pickup-evaluation';

export interface EvaluationResult {
  evaluated: number;
  hitsRecorded: number;
  hitJobSeekerIds: string[];
}

@Injectable()
export class NoPickupEvaluationJob implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(NoPickupEvaluationJob.name);
  private readonly structuredLogger = new StructuredLogger(NoPickupEvaluationJob.name);
  private queue: Queue | null = null;
  private worker: Worker | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly jobSeekerService: JobSeekerService,
    @Optional()
    @Inject(WHATSAPP_PROVIDER)
    private readonly whatsAppProvider?: WhatsAppProvider,
    @Optional()
    private readonly auditService?: AuditService,
    @Optional()
    private readonly messaging?: MessagingService,
  ) {}

  /**
   * Connection settings for test tools that need their own connection (for
   * example a QueueEvents listener). The app itself never uses these: its
   * queue and worker share one connection (src/common/redis/redis-connections.ts).
   */
  get redisConnection() {
    const { host, port, password, tls, connectTimeout } = redisConnectionOptions();
    return { host, port, password, tls, connectTimeout, maxRetriesPerRequest: null };
  }

  /** What the shared job worker runs for this job (src/jobs/job-queue.ts). Records its own JobRun rows. */
  readonly handle: JobHandler = async (job) => {
    const jobRequestId = (job.data?.requestId as string) || undefined;
    if (jobRequestId) {
      return await runWithRequestId(jobRequestId, async () => {
        this.structuredLogger.log(
          `BullMQ processing job ${job.name} (id=${job.id})`,
          NoPickupEvaluationJob.name,
        );
        return await this.evaluateNoPickups();
      });
    }
    return await this.evaluateNoPickups();
  };

  async onModuleInit() {
    // Only a process that runs jobs registers the scheduler and the handler (Phase 6.5 Task 1)
    if (!runsJobs()) return;
    await startScheduledJob({
      name: NO_PICKUP_EVALUATION_JOB,
      handler: this.handle,
      schedule: () => this.scheduleDailyJob(),
      startWorker: () => this.getWorker(),
      onError: (message) => this.logger.warn(`Could not connect BullMQ queue to Redis: ${message}`),
    });
  }

  getQueue(): Queue {
    this.queue = jobQueue.queue();
    return this.queue;
  }

  getWorker(): Worker {
    this.worker = jobQueue.worker(NO_PICKUP_EVALUATION_JOB, this.handle);
    return this.worker;
  }

  async scheduleDailyJob(
    pattern: string = DAILY_JOB_PATTERNS.noPickupEvaluation,
  ): Promise<void> {
    const queue = this.getQueue();
    await queue.upsertJobScheduler(
      'daily-no-pickup-evaluation-scheduler',
      cronInIndia(pattern),
      {
        name: NO_PICKUP_EVALUATION_JOB,
      },
    );
  }

  async getJobSchedulers() {
    const queue = this.getQueue();
    return queue.getJobSchedulers();
  }

  async removeJobScheduler(id = 'daily-no-pickup-evaluation-scheduler') {
    const queue = this.getQueue();
    return queue.removeJobScheduler(id);
  }

  async triggerJob(requestId?: string): Promise<string | undefined> {
    const queue = this.getQueue();
    const effectiveRequestId = requestId || getRequestId();
    const job = await queue.add(NO_PICKUP_EVALUATION_JOB, {
      requestId: effectiveRequestId,
    });
    return job.id;
  }

  /**
   * Scans all active job seekers.
   * If a job seeker has a qualifying AM+PM no-pickup pattern plus WhatsApp/SMS
   * logged for the same day that hasn't already been converted into a hit,
   * calls recordHit(..., 'no_pickup') automatically.
   *
   * Idempotent: running on the same day's data does not record duplicate hits
   * because qualifying contact attempts are linked to hitId upon recording.
   */
  async evaluateNoPickups(): Promise<EvaluationResult> {
    const startedAt = new Date();
    this.structuredLogger.log(
      'Executing evaluateNoPickups sweep',
      NoPickupEvaluationJob.name,
    );

    try {
      const activeJobSeekers = await this.prisma.jobSeeker.findMany({
      where: { status: 'active' },
      select: {
        id: true,
        code: true,
        name: true,
        phone: true,
        trades: { select: { trade: true, isPrimary: true } },
      },
      orderBy: { createdAt: 'asc' },
    });

    let hitsRecorded = 0;
    const hitJobSeekerIds: string[] = [];

    for (const js of activeJobSeekers) {
      // 21 Nov fixes: a wrong number or "do not call" stops every automatic message and no hit is
      // ever recorded from calls to a number that is not his (contact-block.ts).
      if (await messagesBlocked(this.prisma, { subjectType: 'job_seeker', subjectId: js.id })) continue;
      // If candidate has AM and PM no-pickup calls on a day but missing the WhatsApp leg,
      // dispatch automated WhatsApp message through WhatsAppProvider
      if (this.whatsAppProvider) {
        const attempts = await this.prisma.contactAttempt.findMany({
          where: { jobSeekerId: js.id, hitId: null },
          orderBy: { attemptedAt: 'asc' },
        });

        const byDay: Record<string, typeof attempts> = {};
        for (const att of attempts) {
          const dateKey = new Date(att.attemptedAt).toLocaleDateString('en-CA', {
            timeZone: 'Asia/Kolkata',
          });
          if (!byDay[dateKey]) {
            byDay[dateKey] = [];
          }
          byDay[dateKey].push(att);
        }

        for (const [, dayAttempts] of Object.entries(byDay)) {
          const amCall = dayAttempts.find(
            (a) =>
              a.channel === 'call' &&
              a.timeOfDay === 'am' &&
              a.outcome === 'no_pickup',
          );
          const pmCall = dayAttempts.find(
            (a) =>
              a.channel === 'call' &&
              a.timeOfDay === 'pm' &&
              a.outcome === 'no_pickup',
          );
          const msgAttempt = dayAttempts.find(
            (a) => a.channel === 'whatsapp' || a.channel === 'sms',
          );

          // The notice this job already sent for that day (it is dated the next day, so it is not
          // among the day's attempts): never sent again on later runs.
          const noticeSent =
            amCall && pmCall && !msgAttempt
              ? await this.prisma.messageLog.findFirst({
                  where: {
                    subjectType: 'job_seeker',
                    subjectId: js.id,
                    template: 'call_attempt_notice',
                    createdAt: { gte: pmCall.attemptedAt },
                    status: { not: 'failed' },
                  },
                  select: { id: true },
                })
              : null;
          if (amCall && pmCall && !msgAttempt && !noticeSent) {
            if (this.messaging) {
              // An exception to WhatsApp first (rev 211): "we tried to call you" goes on WhatsApp and SMS.
              await this.messaging.sendBoth({
                template: 'call_attempt_notice',
                subjectType: 'job_seeker',
                subjectId: js.id,
                variables: {
                  candidateName: js.name,
                  // Meta refuses an empty parameter.
                  trade: primaryJobSeekerTrade(js) || 'suitable',
                },
              });
            } else if (this.whatsAppProvider) {
              const sendRes = await this.whatsAppProvider.sendTemplateMessage(
                js.phone,
                'call_attempt_notice',
                {
                  candidateName: js.name,
                  trade: primaryJobSeekerTrade(js) ?? '',
                },
              );

              if (sendRes.status === 'sent') {
                await this.prisma.contactAttempt.create({
                  data: {
                    jobSeekerId: js.id,
                    channel: 'whatsapp',
                    outcome: 'no_pickup',
                    timeOfDay: 'pm',
                    attemptedAt: new Date(),
                  },
                });

                if (this.auditService) {
                  let actor = await this.prisma.staff.findFirst({
                    where: { role: 'ceo' },
                  });
                  if (!actor) {
                    actor = await this.prisma.staff.findFirst();
                  }
                  if (actor) {
                    await this.auditService.log({
                      actorId: actor.id,
                      action: 'whatsapp.automated_attempt_sent',
                      entityType: 'job_seeker',
                      entityCode: js.code,
                      after: {
                        phone: js.phone,
                        template: 'call_attempt_notice',
                        messageId: sendRes.messageId,
                      },
                      city: 'Bengaluru',
                    });
                  }
                }
              }
            }
            break;
          }
        }
      }

      try {
        const result = await this.jobSeekerService.recordHit(
          js.id,
          'no_pickup',
          'Automated daily no-pickup evaluation',
          'system',
        );
        hitsRecorded++;
        hitJobSeekerIds.push(result.jobSeekerId);
      } catch {
        // Expected when job seeker does not have qualifying unconsumed attempts
        // or is already deactivated
        continue;
      }
      }

      const finishedAt = new Date();
      try {
        if (this.prisma.jobRun) {
          await this.prisma.jobRun.create({
            data: {
              jobName: NO_PICKUP_EVALUATION_JOB,
              startedAt,
              finishedAt,
              outcome: 'success',
              evaluated: activeJobSeekers.length,
              hitsRecorded,
              details: {
                hitJobSeekerIds,
              },
            },
          });
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        this.logger.error(`Failed to record JobRun for sweep: ${msg}`);
      }

      return {
        evaluated: activeJobSeekers.length,
        hitsRecorded,
        hitJobSeekerIds,
      };
    } catch (err: unknown) {
      try {
        if (this.prisma.jobRun) {
          await this.prisma.jobRun.create({
            data: {
              jobName: NO_PICKUP_EVALUATION_JOB,
              startedAt,
              finishedAt: new Date(),
              outcome: 'failed',
              evaluated: 0,
              hitsRecorded: 0,
              details: {
                error: err instanceof Error ? err.message : String(err),
              },
            },
          });
        }
      } catch {
        // ignore logging failure
      }
      throw err;
    }
  }

  hasWorker(): boolean {
    return this.worker !== null;
  }

  hasQueue(): boolean {
    return this.queue !== null;
  }

  /**
   * Stops handling this job here. The shared queue and Worker stay up; they
   * stop at shutdown (JobQueueLifecycle), waiting for a running sweep first.
   * `force` is kept for callers; there is nothing of this job's own to force.
   */
  async close(force = false): Promise<void> {
    void force;
    jobQueue.release(NO_PICKUP_EVALUATION_JOB);
    this.worker = null;
    this.queue = null;
  }

  async onModuleDestroy() {
    await this.close(false);
  }
}

