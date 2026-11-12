import { Controller, Get, HttpException, HttpStatus } from '@nestjs/common';
import { HealthService, ScheduleCheckStatus, WorkerHeartbeatStatus } from './health.service';
import { Public } from '../common/rbac/public.decorator';

@Controller('health')
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  @Get()
  @Public('liveness and readiness probes for the host and monitors')
  getHealth(): { status: string; upiCollection: string } {
    // Cheap liveness probe with NO external dependency checks.
    // Pointed to by Render's healthCheckPath so container boot and deploys never gate on dependency reachability.
    const configured = Boolean(process.env.COMPANY_UPI_VPA?.trim() && process.env.COMPANY_UPI_PAYEE_NAME?.trim());
    return {
      status: 'ok',
      upiCollection: configured ? 'configured' : 'UPI collection not configured',
    };
  }

  @Get('ready')
  @Public('liveness and readiness probes for the host and monitors')
  async getReadiness(): Promise<{
    status: string;
    postgres: string;
    redis: string;
    sweep?: {
      status: 'healthy' | 'stale';
      hoursElapsed: number | null;
      lastCompletedAt: string | null;
    };
    worker?: WorkerHeartbeatStatus;
    schedules?: ScheduleCheckStatus;
  }> {
    // Quick readiness probe checking PostgreSQL and Redis with a 2-second timeout.
    // Pointed to by monitoring and alert systems; returns 503 naming which dependency failed.
    // Note: Sweep staleness is reported in body as informational and never forces a 503.
    // With WORKER_HEARTBEAT_CHECK=true (set on Render's web service) a missing
    // background-worker heartbeat also answers 503, naming `worker`, and so
    // does a job schedule missing from Redis, naming `schedules`.
    const result = await this.healthService.checkReadiness();
    if (!result.ready) {
      throw new HttpException(
        {
          status: 'unavailable',
          failed: result.failed,
          errors: result.errors,
          ...(result.schedules ? { schedules: result.schedules } : {}),
          message: `Readiness check failed for: ${result.failed.join(', ')}`,
        },
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }

    return {
      status: 'ready',
      postgres: 'ok',
      redis: 'ok',
      ...(result.sweep ? { sweep: result.sweep } : {}),
      ...(result.worker ? { worker: result.worker } : {}),
      ...(result.schedules ? { schedules: result.schedules } : {}),
    };
  }
}
