import {
  Controller,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Request } from 'express';
import { JwtAuthGuard } from '../common/auth/jwt-auth.guard';
import { RbacGuard } from '../common/rbac/rbac.guard';
import { AuthThrottlerGuard } from '../common/auth/auth-throttler.guard';
import { RequireRoles } from '../common/rbac/roles.decorator';
import { RequirePermission } from '../common/rbac/permissions.decorator';
import { JwtPayload } from '../common/auth/jwt-payload.interface';
import { AuditService } from '../common/audit/audit.service';
import { NoPickupEvaluationJob } from './no-pickup-evaluation.job';

@Controller('jobs')
export class JobsController {
  constructor(
    private readonly noPickupEvaluationJob: NoPickupEvaluationJob,
    private readonly auditService: AuditService,
  ) {}

  /**
   * Manually triggers the daily no-pickup sweep immediately.
   *
   * This endpoint exists for two reasons:
   * 1. Manual testing without waiting for midnight.
   * 2. Operational re-run after a failed sweep.
   */
  @Post('no-pickup-evaluation/run')
  @UseGuards(JwtAuthGuard, RbacGuard, AuthThrottlerGuard)
  @RequireRoles('ceo')
  @RequirePermission('job_seeker', 'write')
  async runNoPickupEvaluation(
    @Req() req: Request & { user: JwtPayload },
  ): Promise<{ jobId: string | undefined }> {
    const jobId = await this.noPickupEvaluationJob.triggerJob();

    await this.auditService.log({
      actorId: req.user.sub,
      action: 'job.manual_trigger',
      entityType: 'job',
      entityCode: 'no-pickup-evaluation',
      after: { jobId: jobId ?? null },
      city: 'Bengaluru',
    });

    return { jobId };
  }
}
