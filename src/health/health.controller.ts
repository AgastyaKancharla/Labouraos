import { Controller, Get, Header, HttpException, HttpStatus, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { HealthService, ReadinessCheckResult, ScheduleCheckStatus, WorkerHeartbeatStatus } from './health.service';
import { Public } from '../common/rbac/public.decorator';
import { JwtAuthGuard } from '../common/auth/jwt-auth.guard';
import { RbacGuard } from '../common/rbac/rbac.guard';
import { RequireRoles } from '../common/rbac/roles.decorator';
import { ProxyCheck, proxyCheckFor } from '../common/http/proxy-check';

type Check = 'ok' | 'fail';

/** What anyone may see: component names and ok / fail only. */
export interface PublicReadiness {
  status: 'ready' | 'unavailable';
  /** Only when not ready: the names of the failed components. */
  failed?: string[];
  postgres: Check;
  redis: Check;
  worker?: Check;
  schedules?: Check;
  sweep?: Check;
}

export function publicReadiness(result: ReadinessCheckResult): PublicReadiness {
  const state = (name: string): Check => (result.failed.includes(name) ? 'fail' : 'ok');
  return {
    status: result.ready ? 'ready' : 'unavailable',
    ...(result.ready ? {} : { failed: [...result.failed] }),
    postgres: state('postgres'),
    redis: state('redis'),
    ...(result.worker ? { worker: result.worker.status === 'alive' ? 'ok' : 'fail' } : {}),
    ...(result.schedules ? { schedules: result.schedules.status === 'ok' ? 'ok' : 'fail' } : {}),
    ...(result.sweep ? { sweep: result.sweep.status === 'healthy' ? 'ok' : 'fail' } : {}),
  };
}

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

  /**
   * Readiness for monitors and the host (INF-8): public, so it answers only
   * each component's name and `ok` / `fail`, never an error text, a time or a
   * count. 503 when postgres, redis or (with WORKER_HEARTBEAT_CHECK=true) the
   * worker or the job schedules fail; the sweep is informational (`fail` when
   * stale, still 200). Details: GET /health/ready/details (CEO only).
   */
  @Get('ready')
  @Public('liveness and readiness probes for the host and monitors')
  @Header('Cache-Control', 'no-store')
  async getReadiness(): Promise<PublicReadiness> {
    const result = await this.healthService.checkReadiness();
    const body = publicReadiness(result);
    if (!result.ready) {
      throw new HttpException(
        { ...body, message: `Readiness check failed for: ${result.failed.join(', ')}` },
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
    return body;
  }

  /**
   * CEO only: the full readiness answer — error texts, the worker's last
   * heartbeat, missing job schedules and the sweep's age. Always 200 (`ready`
   * says whether the public check passes).
   */
  @Get('ready/details')
  @UseGuards(JwtAuthGuard, RbacGuard)
  @RequireRoles('ceo')
  @Header('Cache-Control', 'no-store')
  async getReadinessDetails(): Promise<{
    ready: boolean;
    status: 'ready' | 'unavailable';
    failed: string[];
    errors: Record<string, string>;
    postgres: 'ok' | 'fail';
    redis: 'ok' | 'fail';
    sweep?: { status: 'healthy' | 'stale'; hoursElapsed: number | null; lastCompletedAt: string | null };
    worker?: WorkerHeartbeatStatus;
    schedules?: ScheduleCheckStatus;
  }> {
    const result = await this.healthService.checkReadiness();
    return {
      ready: result.ready,
      status: result.ready ? 'ready' : 'unavailable',
      failed: result.failed,
      errors: result.errors,
      postgres: result.failed.includes('postgres') ? 'fail' : 'ok',
      redis: result.failed.includes('redis') ? 'fail' : 'ok',
      ...(result.sweep ? { sweep: result.sweep } : {}),
      ...(result.worker ? { worker: result.worker } : {}),
      ...(result.schedules ? { schedules: result.schedules } : {}),
    };
  }

  /**
   * CEO only: is TRUST_PROXY_HOPS right? (DEPLOY.md step F11, a gate before
   * going live.) Answers only how many X-Forwarded-For entries this request
   * carried, the TRUST_PROXY_HOPS value, and whether the address the server
   * took as the visitor's is public (right) or a private/proxy address (the
   * value is too low). Never an address itself.
   */
  @Get('proxy-check')
  @UseGuards(JwtAuthGuard, RbacGuard)
  @RequireRoles('ceo')
  @Header('Cache-Control', 'no-store')
  proxyCheck(@Req() req: Request): ProxyCheck {
    return proxyCheckFor(req.headers['x-forwarded-for'], req.ip, req.app?.get('trust proxy'));
  }
}
