import { Controller, Get, Param, Req, UseGuards, UseInterceptors } from '@nestjs/common';
import { Request } from 'express';
import { JwtAuthGuard } from '../../common/auth/jwt-auth.guard';
import { JwtPayload } from '../../common/auth/jwt-payload.interface';
import { RbacGuard } from '../../common/rbac/rbac.guard';
import { RequireRoles } from '../../common/rbac/roles.decorator';
import { PiiMaskingInterceptor } from '../../common/rbac/pii-masking.interceptor';
import { WeeklyReportService } from './weekly-report.service';

type AuthedRequest = Request & { user: JwtPayload };

/**
 * The kept Monday reports (MG-Reports, C-Reports with ?week=). A Manager reads
 * only their own tree's reports (counts only; the interceptor strips money
 * anyway), the CEO the company's.
 */
@Controller('weekly-reports')
@UseGuards(JwtAuthGuard, RbacGuard)
@UseInterceptors(PiiMaskingInterceptor)
export class WeeklyReportController {
  constructor(private readonly reports: WeeklyReportService) {}

  @Get()
  @RequireRoles('manager', 'ceo')
  list(@Req() req: AuthedRequest) {
    return this.reports.list({ id: req.user.sub, role: req.user.role });
  }

  /** One week's report, by its Monday: /weekly-reports/2026-11-09. */
  @Get(':week')
  @RequireRoles('manager', 'ceo')
  get(@Req() req: AuthedRequest, @Param('week') week: string) {
    return this.reports.get({ id: req.user.sub, role: req.user.role }, week);
  }
}
