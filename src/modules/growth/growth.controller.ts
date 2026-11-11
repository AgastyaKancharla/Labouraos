import { Body, Controller, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { JwtAuthGuard } from '../../common/auth/jwt-auth.guard';
import { AuthThrottlerGuard } from '../../common/auth/auth-throttler.guard';
import { RbacGuard } from '../../common/rbac/rbac.guard';
import { RequireRoles } from '../../common/rbac/roles.decorator';
import { RequirePermission } from '../../common/rbac/permissions.decorator';
import { JwtPayload } from '../../common/auth/jwt-payload.interface';
import { AuditService } from '../../common/audit/audit.service';
import { decisionTime } from '../../common/time/decision-time';
import { MoneyUnderGuaranteeService } from './money-under-guarantee.service';
import { DaysToFirstInterviewService } from './days-to-first-interview.service';
import { ShortageTaskService } from './shortage-task.service';
import { WinBackService } from './win-back.service';

type AuthedRequest = Request & { user: JwtPayload };

/**
 * Proposals N1–N5 (confirmed 11 Nov). Data and actions only; the screens read these.
 * `asOf` is honoured only in tests (decisionTime); production always uses the clock.
 */
@Controller('growth')
@UseGuards(JwtAuthGuard, RbacGuard)
export class GrowthController {
  constructor(
    private readonly moneyUnderGuarantee: MoneyUnderGuaranteeService,
    private readonly daysToFirstInterview: DaysToFirstInterviewService,
    private readonly shortageTasks: ShortageTaskService,
    private readonly winBack: WinBackService,
    private readonly auditService: AuditService,
  ) {}

  private actor(req: AuthedRequest) {
    return { id: req.user.sub, role: req.user.role };
  }

  /** N1: CEO and Finance only. Managers and Team Leads see no money. */
  @Get('money-under-guarantee')
  @RequireRoles('ceo', 'finance')
  @RequirePermission('payment', 'read')
  async getMoneyUnderGuarantee(
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('details') details?: string,
    @Query('asOf') asOf?: string,
  ) {
    return this.moneyUnderGuarantee.report(
      { from, to, includeRows: details === 'true' || details === '1' },
      decisionTime(asOf),
    );
  }

  /** N2: Team Leads (own team), Managers (own tree), CEO. Counts only. */
  @Get('days-to-first-interview')
  @RequireRoles('ceo', 'manager', 'team_lead')
  @RequirePermission('job_seeker', 'read')
  async getDaysToFirstInterview(
    @Req() req: AuthedRequest,
    @Query('minDays') minDays?: string,
    @Query('asOf') asOf?: string,
  ) {
    return this.daysToFirstInterview.list(
      this.actor(req),
      this.daysToFirstInterview.parseMinDays(minDays),
      decisionTime(asOf),
    );
  }

  /** N2: the one number for the Command Center (scoped the same way for Managers and Team Leads). */
  @Get('days-to-first-interview/summary')
  @RequireRoles('ceo', 'manager', 'team_lead')
  @RequirePermission('job_seeker', 'read')
  async getDaysToFirstInterviewSummary(
    @Req() req: AuthedRequest,
    @Query('minDays') minDays?: string,
    @Query('asOf') asOf?: string,
  ) {
    return this.daysToFirstInterview.summary(
      this.actor(req),
      this.daysToFirstInterview.parseMinDays(minDays),
      decisionTime(asOf),
    );
  }

  /** N3: open shortage tasks for the Team Lead (own), Manager (tree) and CEO (all). */
  @Get('shortage-tasks')
  @RequireRoles('ceo', 'manager', 'team_lead')
  @RequirePermission('vacancy', 'read')
  async getShortageTasks(@Req() req: AuthedRequest) {
    return this.shortageTasks.listOpen(this.actor(req));
  }

  /** N3: run the daily shortage sweep now. */
  @Post('shortage-tasks/run')
  @UseGuards(AuthThrottlerGuard)
  @RequireRoles('ceo')
  async runShortageTasks(@Req() req: AuthedRequest) {
    const result = await this.shortageTasks.sweep(decisionTime(undefined));
    await this.auditService.log({
      actorId: req.user.sub,
      action: 'job.manual_trigger',
      entityType: 'job',
      entityCode: 'shortage-tasks',
      after: { ...result },
      city: 'Bengaluru',
    });
    return result;
  }

  /** N5: the win-back call list. */
  @Get('win-back')
  @RequireRoles('ceo', 'manager', 'team_lead', 'call_agent')
  @RequirePermission('job_seeker', 'read')
  async getWinBack(
    @Req() req: AuthedRequest,
    @Query('callableNow') callableNow?: string,
    @Query('asOf') asOf?: string,
  ) {
    return this.winBack.list(
      this.actor(req),
      { callableNow: callableNow === 'true' || callableNow === '1' },
      decisionTime(asOf),
    );
  }

  /** N5: he said no on an answered call. */
  @Post('win-back/:id/decline')
  @RequireRoles('ceo', 'manager', 'team_lead', 'call_agent')
  async declineWinBack(
    @Req() req: AuthedRequest,
    @Param('id') id: string,
    @Body() body: { callRecordId?: string; reason?: string },
  ) {
    return this.winBack.decline(this.actor(req), id, body ?? {});
  }

  /** N5: run the daily win-back sweep now. */
  @Post('win-back/run')
  @UseGuards(AuthThrottlerGuard)
  @RequireRoles('ceo')
  async runWinBack(@Req() req: AuthedRequest) {
    const result = await this.winBack.sweep(decisionTime(undefined));
    await this.auditService.log({
      actorId: req.user.sub,
      action: 'job.manual_trigger',
      entityType: 'job',
      entityCode: 'win-back',
      after: { ...result },
      city: 'Bengaluru',
    });
    return result;
  }
}
