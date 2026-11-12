import { Body, Controller, Get, Put, Query, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { JwtAuthGuard } from '../../common/auth/jwt-auth.guard';
import { JwtPayload } from '../../common/auth/jwt-payload.interface';
import { RbacGuard } from '../../common/rbac/rbac.guard';
import { RequireRoles } from '../../common/rbac/roles.decorator';
import { parseMonth } from '../ceo-portal/ceo-team.service';
import { CompanyPlanService } from './company-plan.service';

type AuthedRequest = Request & { user: JwtPayload };

/**
 * The CEO's monthly company plan (C-Team-Targets "Company plan"). CEO only:
 * Managers read the plan inside GET /manager/targets and split it into their
 * teams with PUT /manager/targets/split.
 */
@Controller('plans')
@UseGuards(JwtAuthGuard, RbacGuard)
export class CompanyPlanController {
  constructor(private readonly plans: CompanyPlanService) {}

  /** The month's plan, every team's split and whether the split adds up. */
  @Get('company')
  @RequireRoles('ceo')
  board(@Query('year') year?: string, @Query('month') month?: string) {
    const m = parseMonth(year, month, new Date());
    return this.plans.ceoBoard(m.year, m.month);
  }

  /** Set or change the month's plan: { year, month, registered?, paid?, … }. */
  @Put('company')
  @RequireRoles('ceo')
  async save(@Req() req: AuthedRequest, @Body() body: Record<string, unknown>) {
    const now = new Date();
    const m = parseMonth(body?.year, body?.month, now);
    await this.plans.setCompany({ id: req.user.sub, role: req.user.role }, m.year, m.month, body ?? {}, now);
    return this.plans.ceoBoard(m.year, m.month);
  }
}
