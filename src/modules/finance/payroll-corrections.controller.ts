import { Body, Controller, Get, Post, Query, Req, UseGuards, UseInterceptors } from '@nestjs/common';
import { Request } from 'express';
import { JwtAuthGuard } from '../../common/auth/jwt-auth.guard';
import { JwtPayload } from '../../common/auth/jwt-payload.interface';
import { RbacGuard } from '../../common/rbac/rbac.guard';
import { RequireRoles } from '../../common/rbac/roles.decorator';
import { PiiMaskingInterceptor } from '../../common/rbac/pii-masking.interceptor';
import { PayrollService } from './payroll.service';

type AuthedRequest = Request & { user: JwtPayload };

/**
 * Manual pay corrections (Phase 22 Part B). The CEO adds one (only the CEO
 * sets pay) — for example for a month payroll no longer works out again —
 * and the next prepared sheet pays it; the CEO and Finance see the list.
 * Managers, Team Leads and agents get 403. Audit-logged in the service.
 */
@Controller('payroll/corrections')
@UseGuards(JwtAuthGuard, RbacGuard)
@RequireRoles('ceo', 'finance')
@UseInterceptors(PiiMaskingInterceptor)
export class PayrollCorrectionsController {
  constructor(private readonly payroll: PayrollService) {}

  @Get()
  @RequireRoles('ceo', 'finance')
  list(@Query('status') status?: string) {
    return this.payroll.corrections(status);
  }

  @Post()
  @RequireRoles('ceo')
  add(@Req() req: AuthedRequest, @Body() body: { staffId?: unknown; relatesToMonth?: unknown; amountPaise?: unknown; reason?: unknown }) {
    return this.payroll.addCorrection(body ?? {}, { id: req.user.sub, role: req.user.role }, new Date());
  }
}
