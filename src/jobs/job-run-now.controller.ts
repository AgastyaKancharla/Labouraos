import { Controller, Get, HttpCode, NotFoundException, Param, Post, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { JwtAuthGuard } from '../common/auth/jwt-auth.guard';
import { RbacGuard } from '../common/rbac/rbac.guard';
import { AuthThrottlerGuard } from '../common/auth/auth-throttler.guard';
import { RequireRoles } from '../common/rbac/roles.decorator';
import { JwtPayload } from '../common/auth/jwt-payload.interface';
import { AuditService } from '../common/audit/audit.service';
import { numericSummary } from './job-run-recorder';
import { findJob } from './job-catalog';
import { JobScheduleKeeper } from './job-schedule-keeper.service';

/**
 * The CEO's "run now" for every scheduled job, and where the schedules stand.
 *
 * "Run now" really runs the job in this process and answers with its counts;
 * it does not just put a job on the queue (which nothing reads when the worker
 * or its schedules are gone — the reason this exists).
 */
@Controller('jobs')
@UseGuards(JwtAuthGuard, RbacGuard)
@RequireRoles('ceo')
export class JobRunNowController {
  constructor(
    private readonly keeper: JobScheduleKeeper,
    private readonly audit: AuditService,
  ) {}

  /** Every repeating job and whether its schedule is in Redis now. */
  @Get('schedules')
  async schedules() {
    const jobs = await this.keeper.status();
    return { allPresent: jobs.every((j) => j.present), jobs };
  }

  /** Writes every schedule again (after a Key Value restart, for example). */
  @Post('schedules/repair')
  @HttpCode(200)
  @UseGuards(AuthThrottlerGuard)
  async repair(@Req() req: Request & { user: JwtPayload }) {
    const result = await this.keeper.ensureAll('repaired by the CEO');
    await this.audit.log({
      actorId: req.user.sub,
      action: 'job.schedules_repaired',
      entityType: 'job',
      entityCode: 'schedules',
      after: { registered: result.registered.length, failed: result.failed.length },
      city: 'Bengaluru',
    });
    return result;
  }

  @Post(':job/run-now')
  @HttpCode(200)
  @UseGuards(AuthThrottlerGuard)
  async runNow(@Param('job') key: string, @Req() req: Request & { user: JwtPayload }) {
    const entry = findJob(key);
    if (!entry || !this.keeper.keys().includes(key)) {
      throw new NotFoundException(`Unknown job '${key}'`);
    }
    const startedAt = new Date();
    const { result } = await this.keeper.run(key);
    const counts = numericSummary(result);
    await this.audit.log({
      actorId: req.user.sub,
      action: 'job.manual_trigger',
      entityType: 'job',
      entityCode: entry.queue,
      after: { ranNow: true, ...counts },
      city: 'Bengaluru',
    });
    return {
      job: entry.key,
      label: entry.label,
      ranAt: startedAt.toISOString(),
      finishedAt: new Date().toISOString(),
      result: counts,
    };
  }
}
