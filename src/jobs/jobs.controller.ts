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
import { PlacementCompletionJob } from './placement-completion.job';
import { ClaimOverdueJob } from './claim-overdue.job';
import { FollowUpJob } from './follow-up.job';

@Controller('jobs')
export class JobsController {
  constructor(
    private readonly noPickupEvaluationJob: NoPickupEvaluationJob,
    private readonly placementCompletionJob: PlacementCompletionJob,
    private readonly claimOverdueJob: ClaimOverdueJob,
    private readonly followUpJob: FollowUpJob,
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

  @Post('placement-completion/run')
  @UseGuards(JwtAuthGuard, RbacGuard, AuthThrottlerGuard)
  @RequireRoles('ceo')
  @RequirePermission('placement', 'write')
  async runPlacementCompletion(
    @Req() req: Request & { user: JwtPayload },
  ): Promise<{ completed: number }> {
    const result = await this.placementCompletionJob.process();

    await this.auditService.log({
      actorId: req.user.sub,
      action: 'job.manual_trigger',
      entityType: 'job',
      entityCode: 'placement-completion',
      after: { completed: result.completed },
      city: 'Bengaluru',
    });

    return result;
  }

  @Post('claim-overdue/run')
  @UseGuards(JwtAuthGuard, RbacGuard, AuthThrottlerGuard)
  @RequireRoles('ceo')
  @RequirePermission('placement', 'write')
  async runClaimOverdue(
    @Req() req: Request & { user: JwtPayload },
  ): Promise<{ raised: number }> {
    const result = await this.claimOverdueJob.process();

    await this.auditService.log({
      actorId: req.user.sub,
      action: 'job.manual_trigger',
      entityType: 'job',
      entityCode: 'claim-overdue',
      after: { raised: result.raised },
      city: 'Bengaluru',
    });

    return result;
  }

  @Post('follow-up/run')
  @UseGuards(JwtAuthGuard, RbacGuard, AuthThrottlerGuard)
  @RequireRoles('ceo')
  @RequirePermission('job_seeker', 'write')
  async runFollowUp(
    @Req() req: Request & { user: JwtPayload },
  ): Promise<{ created: number; missed: number }> {
    const result = await this.followUpJob.process();

    await this.auditService.log({
      actorId: req.user.sub,
      action: 'job.manual_trigger',
      entityType: 'job',
      entityCode: 'follow-up',
      after: result,
      city: 'Bengaluru',
    });

    return result;
  }
}
