import {
  Inject,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
  Optional,
} from '@nestjs/common';
import { Queue, Worker } from 'bullmq';
import { PrismaService } from '../common/prisma/prisma.service';
import { JobSeekerService } from '../modules/job-seeker/job-seeker.service';
import {
  WHATSAPP_PROVIDER,
  WhatsAppProvider,
} from '../common/whatsapp/whatsapp.interface';
import { AuditService } from '../common/audit/audit.service';
import {
  getRequestId,
  runWithRequestId,
} from '../common/observability/request-context';
import { StructuredLogger } from '../common/observability/structured-logger.service';

export const NO_PICKUP_EVALUATION_QUEUE = 'no-pickup-evaluation';
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
  ) {}

  get redisConnection() {
    const connectTimeout = process.env.REDIS_CONNECT_TIMEOUT_MS
      ? Number(process.env.REDIS_CONNECT_TIMEOUT_MS)
      : 5000;

    return {
      host: process.env.REDIS_HOST || 'localhost',
      port: Number(process.env.REDIS_PORT) || 6379,
      password: process.env.REDIS_PASSWORD || undefined,
      maxRetriesPerRequest: null,
      connectTimeout,
      tls: process.env.REDIS_TLS === 'true' ? {} : undefined,
      retryStrategy: (times: number) => {
        if (
          process.env.REDIS_MAX_RETRIES !== undefined &&
          times > Number(process.env.REDIS_MAX_RETRIES)
        ) {
          return null;
        }
        return Math.min(times * 100, 2000);
      },
    };
  }

  async onModuleInit() {
    // Only worker process initializes worker and registers scheduler (Phase 6.5 Task 1)
    if (process.env.PROCESS_ROLE === 'worker') {
      let timer: NodeJS.Timeout | undefined;
      try {
        const timeoutMs = Number(process.env.REDIS_STARTUP_TIMEOUT_MS) || 2000;
        await Promise.race([
          this.scheduleDailyJob(),
          new Promise((_, reject) => {
            timer = setTimeout(
              () => reject(new Error('Redis connection timed out')),
              timeoutMs,
            );
          }),
        ]).finally(() => {
          if (timer) clearTimeout(timer);
        });
        this.getWorker();
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        this.logger.warn(`Could not connect BullMQ queue to Redis: ${msg}`);
        await this.close(true);
      }
    }
  }

  getQueue(): Queue {
    if (!this.queue) {
      this.queue = new Queue(NO_PICKUP_EVALUATION_QUEUE, {
        connection: this.redisConnection,
      });
      this.queue.on('error', (err) => {
        this.logger.warn(`BullMQ queue error: ${err.message}`);
      });
    }
    return this.queue;
  }

  getWorker(): Worker {
    if (process.env.PROCESS_ROLE !== 'worker') {
      throw new Error(
        'BullMQ Worker can only be constructed in a worker process (PROCESS_ROLE === "worker")',
      );
    }
    if (!this.worker) {
      this.worker = new Worker(
        NO_PICKUP_EVALUATION_QUEUE,
        async (job) => {
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
        },
        {
          connection: this.redisConnection,
        },
      );

      this.worker.on('error', (err) => {
        this.logger.error(`BullMQ worker error: ${err.message}`);
      });
    }
    return this.worker;
  }

  async scheduleDailyJob(pattern = '0 0 * * *'): Promise<void> {
    const queue = this.getQueue();
    await queue.upsertJobScheduler(
      'daily-no-pickup-evaluation-scheduler',
      { pattern },
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
        tradeSkill: true,
      },
      orderBy: { createdAt: 'asc' },
    });

    let hitsRecorded = 0;
    const hitJobSeekerIds: string[] = [];

    for (const js of activeJobSeekers) {
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

          if (amCall && pmCall && !msgAttempt) {
            const sendRes = await this.whatsAppProvider.sendTemplateMessage(
              js.phone,
              'call_attempt_notice',
              {
                candidateName: js.name,
                trade: js.tradeSkill,
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

  async close(force = false): Promise<void> {
    if (this.worker) {
      try {
        await this.worker.close(force);
      } catch {
        // ignore error on close
      } finally {
        this.worker = null;
      }
    }
    if (this.queue) {
      try {
        await this.queue.close();
      } catch {
        // ignore
      } finally {
        this.queue = null;
      }
    }
  }

  async onModuleDestroy() {
    await this.close(false);
  }
}

