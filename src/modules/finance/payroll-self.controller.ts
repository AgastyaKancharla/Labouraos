import { Controller, Get, Param, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { JwtAuthGuard } from '../../common/auth/jwt-auth.guard';
import { JwtPayload } from '../../common/auth/jwt-payload.interface';
import { RbacGuard } from '../../common/rbac/rbac.guard';
import { RequireRoles } from '../../common/rbac/roles.decorator';
import { OWN_PAY_ANSWER } from '../../common/rbac/money-visibility';
import { PayrollService } from './payroll.service';

type AuthedRequest = Request & { user: JwtPayload } & Record<string, unknown>;

/**
 * Payslip self-service (CA14g-Payslip; Phase 22 Part B). Each person reads
 * only their own payslips, and only once Finance has paid them — the staff id
 * always comes from the signed-in token, never from the request. A Manager
 * sees their own payslip too (owner decision 11 Nov): this answer is marked as
 * the caller's own pay, so the Manager money filter leaves it; every other
 * answer to a Manager is still stripped of money.
 */
@Controller('payroll')
@UseGuards(JwtAuthGuard, RbacGuard)
@RequireRoles('manager', 'team_lead', 'call_agent', 'field_agent', 'finance')
export class PayrollSelfController {
  constructor(private readonly payroll: PayrollService) {}

  @Get('my-payslips')
  @RequireRoles('manager', 'team_lead', 'call_agent', 'field_agent', 'finance')
  mine(@Req() req: AuthedRequest) {
    return this.payroll.myPayslips(req.user.sub);
  }

  @Get('my-payslips/:month')
  @RequireRoles('manager', 'team_lead', 'call_agent', 'field_agent', 'finance')
  async one(@Req() req: AuthedRequest, @Param('month') month: string) {
    const slip = await this.payroll.myPayslip(req.user.sub, month);
    req[OWN_PAY_ANSWER] = true;
    return slip;
  }
}
