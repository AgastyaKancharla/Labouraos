import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
  Optional,
} from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';
import { AlertService } from '../common/observability/alert.service';
import { NO_PICKUP_EVALUATION_JOB } from './no-pickup-evaluation.job';

export const STALENESS_THRESHOLD_HOURS = 36;
export const STALENESS_THRESHOLD_MS = STALENESS_THRESHOLD_HOURS * 60 * 60 * 1000;
export const ALERT_THROTTLE_HOURS = 6;
export const ALERT_THROTTLE_MS = ALERT_THROTTLE_HOURS * 60 * 60 * 1000;

export interface SweepStalenessResult {
  status: 'healthy' | 'stale';
  hoursElapsed: number | null;
  lastCompletedAt: Date | null;
  alertSent: boolean;
}

@Injectable()
export class SweepMonitoringService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SweepMonitoringService.name);
  private checkInterval: NodeJS.Timeout | null = null;

  constructor(
    private readonly prisma: PrismaService,
    @Optional()
    private readonly alertService?: AlertService,
  ) {}

  async onModuleInit() {
    // Only web service (PROCESS_ROLE !== 'worker') runs the staleness monitor.
    // If the worker process dies or fails to start, the web service continues to monitor.
    if (process.env.PROCESS_ROLE !== 'worker') {
      try {
        await this.checkSweepStaleness();
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        this.logger.warn(`Initial sweep staleness check error: ${msg}`);
      }

      // Check every 30 minutes
      const intervalMs = Number(process.env.SWEEP_MONITOR_INTERVAL_MS) || 30 * 60 * 1000;
      this.checkInterval = setInterval(() => {
        this.checkSweepStaleness().catch((err: unknown) => {
          const msg = err instanceof Error ? err.message : String(err);
          this.logger.error(`Periodic sweep staleness check error: ${msg}`);
        });
      }, intervalMs);
    }
  }

  onModuleDestroy() {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }
  }

  /**
   * Evaluates whether the daily sweep has run within the 36-hour threshold.
   *
   * Rationale: Phase 6.5 exists because the daily evaluation job silently never ran.
   * A job that silently stops is the same failure mode; this monitor ensures gaps
   * are proactively alerted to operational staff via AlertService.
   *
   * @param currentTime Optional override for current time, allowing tests to fast-forward the clock.
   */
  async checkSweepStaleness(currentTime?: Date): Promise<SweepStalenessResult> {
    const now = currentTime ? new Date(currentTime) : new Date();

    // 1. Fetch most recent successful JobRun for the sweep
    const latestRun = await this.prisma.jobRun.findFirst({
      where: {
        jobName: NO_PICKUP_EVALUATION_JOB,
        outcome: 'success',
        finishedAt: { not: null },
      },
      orderBy: { finishedAt: 'desc' },
    });

    let isStale = false;
    let hoursElapsed: number | null = null;
    const lastCompletedAt = latestRun?.finishedAt || null;

    if (lastCompletedAt) {
      const gapMs = now.getTime() - lastCompletedAt.getTime();
      hoursElapsed = Math.floor(gapMs / (1000 * 60 * 60));
      if (gapMs > STALENESS_THRESHOLD_MS) {
        isStale = true;
      }
    } else {
      // No sweep has ever completed.
      // Check system age from earliest database record to avoid false alarms on a brand new database.
      const earliestStaff = await this.prisma.staff.findFirst({
        orderBy: { createdAt: 'asc' },
        select: { createdAt: true },
      });
      const systemCreatedAt = earliestStaff?.createdAt;

      if (systemCreatedAt) {
        const systemAgeMs = now.getTime() - systemCreatedAt.getTime();
        hoursElapsed = Math.floor(systemAgeMs / (1000 * 60 * 60));
        if (systemAgeMs > STALENESS_THRESHOLD_MS) {
          isStale = true;
        }
      }
    }

    // 2. Query persistent alert state from database
    const alertState = await this.prisma.jobAlertState.findUnique({
      where: { jobName: NO_PICKUP_EVALUATION_JOB },
    });

    let alertSent = false;

    if (isStale) {
      // Determine if we should send an alert (first transition into stale, or throttle window passed)
      const lastAlertedAt = alertState?.lastAlertedAt ? new Date(alertState.lastAlertedAt) : null;
      const shouldAlert =
        !alertState ||
        !alertState.isStale ||
        !lastAlertedAt ||
        now.getTime() - lastAlertedAt.getTime() >= ALERT_THROTTLE_MS;

      if (shouldAlert && this.alertService) {
        await this.alertService.sendAlert({
          title: 'Daily No-Pickup Sweep Stale (> 36h)',
          message:
            `The daily no-pickup sweep has not completed successfully for ${hoursElapsed ?? '36+'} hours ` +
            `(threshold: ${STALENESS_THRESHOLD_HOURS}h). ` +
            `The background worker process or Redis scheduler may be offline or failing.`,
          severity: 'critical',
          metadata: {
            jobName: NO_PICKUP_EVALUATION_JOB,
            hoursElapsed,
            lastCompletedAt: lastCompletedAt ? lastCompletedAt.toISOString() : null,
          },
        });
        alertSent = true;
      }

      // Persist stale state and lastAlertedAt in database
      await this.prisma.jobAlertState.upsert({
        where: { jobName: NO_PICKUP_EVALUATION_JOB },
        create: {
          jobName: NO_PICKUP_EVALUATION_JOB,
          isStale: true,
          lastAlertedAt: alertSent ? now : alertState?.lastAlertedAt ?? null,
        },
        update: {
          isStale: true,
          ...(alertSent ? { lastAlertedAt: now } : {}),
        },
      });

      return {
        status: 'stale',
        hoursElapsed,
        lastCompletedAt,
        alertSent,
      };
    } else {
      // Healthy state
      // If previously in a stale state, alert on recovery!
      if (alertState?.isStale && this.alertService) {
        await this.alertService.sendAlert({
          title: 'Daily No-Pickup Sweep Recovered',
          message:
            `The daily no-pickup sweep has completed successfully. ` +
            `The staleness alert condition has cleared.`,
          severity: 'info',
          metadata: {
            jobName: NO_PICKUP_EVALUATION_JOB,
            completedAt: lastCompletedAt ? lastCompletedAt.toISOString() : null,
          },
        });
        alertSent = true;
      }

      if (alertState?.isStale) {
        await this.prisma.jobAlertState.update({
          where: { jobName: NO_PICKUP_EVALUATION_JOB },
          data: {
            isStale: false,
            lastRecoveredAt: now,
          },
        });
      }

      return {
        status: 'healthy',
        hoursElapsed,
        lastCompletedAt,
        alertSent,
      };
    }
  }
}
