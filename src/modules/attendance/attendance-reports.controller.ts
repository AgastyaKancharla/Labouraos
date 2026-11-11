import { Controller, Get, Query, Req, Res, UseGuards } from '@nestjs/common';
import { Request, Response } from 'express';
import { JwtAuthGuard } from '../../common/auth/jwt-auth.guard';
import { RequireRoles } from '../../common/rbac/roles.decorator';
import { RbacGuard } from '../../common/rbac/rbac.guard';
import { JwtPayload } from '../../common/auth/jwt-payload.interface';
import { AttendanceReportsService } from './attendance-reports.service';

type Authed = Request & { user: JwtPayload };

@Controller('attendance')
@UseGuards(JwtAuthGuard, RbacGuard)
export class AttendanceReportsController {
  constructor(private readonly reports: AttendanceReportsService) {}

  private actor(req: Authed) {
    return { id: req.user.sub, role: req.user.role };
  }

  /** Live board. Team Lead: their team. Manager: their tree. CEO: everyone. */
  @Get('live')
  @RequireRoles('ceo', 'manager', 'team_lead')
  live(@Req() req: Authed) {
    return this.reports.liveBoard(this.actor(req));
  }

  /** Report for one person. The person, their Team Lead, a Manager over them, Finance, the CEO. */
  @Get('report')
  @RequireRoles('ceo', 'manager', 'team_lead', 'call_agent', 'field_agent', 'finance')
  report(
    @Req() req: Authed,
    @Query('staffId') staffId?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.reports.personReport(this.actor(req), staffId || req.user.sub, from, to);
  }

  /** Team summary. Team Lead: their team. Manager: their tree. CEO and Finance: everyone. */
  @Get('team-summary')
  @RequireRoles('ceo', 'manager', 'team_lead', 'finance')
  teamSummary(@Req() req: Authed, @Query('from') from?: string, @Query('to') to?: string) {
    return this.reports.teamSummary(this.actor(req), from, to);
  }

  /** Month sheet for salaries. Finance and the CEO only. `format=csv` downloads it. */
  @Get('month-sheet')
  @RequireRoles('ceo', 'finance')
  async monthSheet(
    @Req() req: Authed,
    @Res({ passthrough: true }) res: Response,
    @Query('month') month?: string,
    @Query('format') format?: string,
  ) {
    const sheet = await this.reports.monthSheet(this.actor(req), month ?? '');
    if (format !== 'csv') return sheet;
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="attendance-month-sheet-${sheet.month}.csv"`,
    );
    return this.reports.monthSheetCsv(sheet.rows);
  }
}
