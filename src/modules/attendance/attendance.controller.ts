import { Body, Controller, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { JwtAuthGuard } from '../../common/auth/jwt-auth.guard';
import { RequireRoles } from '../../common/rbac/roles.decorator';
import { RbacGuard } from '../../common/rbac/rbac.guard';
import { JwtPayload } from '../../common/auth/jwt-payload.interface';
import { AttendanceService } from './attendance.service';
import { AttendanceDaysService } from './attendance-days.service';

const STAFF_ROLES = ['ceo', 'manager', 'team_lead', 'call_agent', 'field_agent', 'finance'] as const;

type Authed = Request & { user: JwtPayload };

@Controller('attendance')
@UseGuards(JwtAuthGuard, RbacGuard)
export class AttendanceController {
  constructor(
    private readonly attendance: AttendanceService,
    private readonly days: AttendanceDaysService,
  ) {}

  @Post('login')
  @RequireRoles(...STAFF_ROLES)
  login(
    @Req() req: Authed,
    @Body() body: { latitude?: number; longitude?: number; loginAt?: string },
  ) {
    return this.attendance.login(req.user.sub, body ?? {});
  }

  @Post('logout')
  @RequireRoles(...STAFF_ROLES)
  logout(@Req() req: Authed) {
    return this.attendance.logout(req.user.sub);
  }

  @Post('status')
  @RequireRoles(...STAFF_ROLES)
  setStatus(@Req() req: Authed, @Body() body: { status?: string }) {
    return this.attendance.setStatus(req.user.sub, body?.status ?? '');
  }

  @Post('heartbeat')
  @RequireRoles(...STAFF_ROLES)
  heartbeat(@Req() req: Authed) {
    return this.attendance.heartbeat(req.user.sub);
  }

  @Get('today')
  @RequireRoles(...STAFF_ROLES)
  today(@Req() req: Authed) {
    // An owner account's day starts by itself here (owner decision 14 Nov).
    return this.attendance.todayForSelf(req.user.sub);
  }

  @Post('system-problem/:segmentId/approve')
  @RequireRoles('ceo', 'manager', 'team_lead')
  approve(@Param('segmentId') segmentId: string, @Req() req: Authed) {
    return this.attendance.approveSystemProblem(segmentId, req.user.sub);
  }

  @Post('business-check-in')
  @RequireRoles('field_agent')
  async businessCheckIn(@Req() req: Authed) {
    await this.attendance.noteBusinessCheckIn(req.user.sub);
    return this.attendance.today(req.user.sub);
  }

  @Post('business-check-out')
  @RequireRoles('field_agent')
  async businessCheckOut(@Req() req: Authed) {
    await this.attendance.noteBusinessCheckOut(req.user.sub);
    return this.attendance.today(req.user.sub);
  }

  /** Month summary for one person. Defaults to the caller. */
  @Get('month')
  @RequireRoles(...STAFF_ROLES)
  month(
    @Req() req: Authed,
    @Query('month') month?: string,
    @Query('staffId') staffId?: string,
  ) {
    return this.days.monthSummary(
      { id: req.user.sub, role: req.user.role },
      staffId || req.user.sub,
      month ?? '',
    );
  }

  /** Change day: a Team Lead (own team), a Manager (own tree) or the CEO. */
  @Post('days/:dayId/day-type')
  @RequireRoles('ceo', 'manager', 'team_lead')
  changeDay(
    @Req() req: Authed,
    @Param('dayId') dayId: string,
    @Body() body: { dayType?: string; reason?: string },
  ) {
    return this.days.changeDayType({ id: req.user.sub, role: req.user.role }, dayId, body ?? {});
  }

  @Get('days/:dayId/history')
  @RequireRoles(...STAFF_ROLES)
  dayHistory(@Req() req: Authed, @Param('dayId') dayId: string) {
    return this.days.dayHistory({ id: req.user.sub, role: req.user.role }, dayId);
  }
}
