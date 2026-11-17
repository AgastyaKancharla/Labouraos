import { Body, Controller, Get, HttpCode, HttpStatus, Post, Put, Query, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { JwtAuthGuard } from '../../common/auth/jwt-auth.guard';
import { JwtPayload } from '../../common/auth/jwt-payload.interface';
import { RbacGuard } from '../../common/rbac/rbac.guard';
import { RequireRoles } from '../../common/rbac/roles.decorator';
import { parseMonth } from '../ceo-portal/ceo-team.service';
import { CompanyPlanService } from './company-plan.service';
import { TargetSplitService } from './target-split.service';

type AuthedRequest = Request & { user: JwtPayload };

/**
 * The CEO's monthly company plan (C-Team-Targets "Company plan"). CEO only:
 * Managers read the plan inside GET /manager/targets and split it into their
 * teams with PUT /manager/targets/split.
 */
@Controller('plans')
@UseGuards(JwtAuthGuard, RbacGuard)
export class CompanyPlanController {
  constructor(
    private readonly plans: CompanyPlanService,
    private readonly split: TargetSplitService,
  ) {}

  /** The month's plan, every team's split and whether the split adds up. */
  @Get('company')
  @RequireRoles('ceo')
  board(@Query('year') year?: string, @Query('month') month?: string) {
    const m = parseMonth(year, month, new Date());
    return this.plans.ceoBoard(m.year, m.month);
  }

  /**
   * Set or change the month's plan: { year, month, registered?, paid?, … }.
   * The plan is then split automatically to Managers, teams and agents (17 Nov);
   * `split.teams` is how many teams it went to.
   */
  @Put('company')
  @RequireRoles('ceo')
  async save(@Req() req: AuthedRequest, @Body() body: Record<string, unknown>) {
    const now = new Date();
    const m = parseMonth(body?.year, body?.month, now);
    await this.plans.setCompany({ id: req.user.sub, role: req.user.role }, m.year, m.month, body ?? {}, now);
    const run = await this.split.splitMonth(m.year, m.month, req.user.sub, 'company_plan_saved', now);
    return { ...(await this.plans.ceoBoard(m.year, m.month)), split: run ? { teams: run.teams, agents: run.agents } : null };
  }

  /** "Split again" (the documented admin action for the backfill): split the month's plan again, keeping numbers set by hand. */
  @Post('company/split')
  @HttpCode(HttpStatus.OK)
  @RequireRoles('ceo')
  async splitAgain(@Req() req: AuthedRequest, @Body() body: Record<string, unknown>) {
    const now = new Date();
    const m = parseMonth(body?.year, body?.month, now);
    this.split.assertNotPast(m.year, m.month, now);
    const run = await this.split.splitMonth(m.year, m.month, req.user.sub, 'ceo_split_again', now);
    return { ...(await this.plans.ceoBoard(m.year, m.month)), split: run ? { teams: run.teams, agents: run.agents } : null };
  }
}
