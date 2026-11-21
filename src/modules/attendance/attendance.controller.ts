import { Body, Controller, Get, Param, Post, Put, Query, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { JwtAuthGuard } from '../../common/auth/jwt-auth.guard';
import { RequireRoles } from '../../common/rbac/roles.decorator';
import { RbacGuard } from '../../common/rbac/rbac.guard';
import { JwtPayload } from '../../common/auth/jwt-payload.interface';
import { AttendanceService } from './attendance.service';
import { AttendanceDaysService } from './attendance-days.service';
import { AttendanceShiftsService } from './attendance-shifts.service';

const STAFF_ROLES = ['ceo', 'manager', 'team_lead', 'call_agent', 'field_agent', 'finance'] as const;

type Authed = Request & { user: JwtPayload };

@Controller('attendance')
@UseGuards(JwtAuthGuard, RbacGuard)
export class AttendanceController {
  constructor(
    private readonly attendance: AttendanceService,
    private readonly days: AttendanceDaysService,
    private readonly shifts: AttendanceShiftsService,
  ) {}

  @Post('login')
  @RequireRoles('manager', 'team_lead', 'call_agent', 'field_agent', 'finance')
  login(
    @Req() req: Authed,
    @Body() body: { latitude?: number; longitude?: number; loginAt?: string },
  ) {
    return this.attendance.login(req.user.sub, body ?? {});
  }

  @Post('logout')
  @RequireRoles('manager', 'team_lead', 'call_agent', 'field_agent', 'finance')
  logout(@Req() req: Authed) {
    return this.attendance.logout(req.user.sub);
  }

  @Post('status')
  @RequireRoles('manager', 'team_lead', 'call_agent', 'field_agent', 'finance')
  setStatus(@Req() req: Authed, @Body() body: { status?: string }) {
    return this.attendance.setStatus(req.user.sub, body?.status ?? '');
  }

  /**
   * { kind: 'presence' } while the console / Laboura Field is open and visible
   * (about once a minute); { kind: 'activity' } (or no body) for a click, key or tap.
   */
  @Post('heartbeat')
  @RequireRoles('manager', 'team_lead', 'call_agent', 'field_agent', 'finance')
  heartbeat(@Req() req: Authed, @Body() body: { kind?: string }) {
    return this.attendance.heartbeat(req.user.sub, body?.kind === 'presence' ? 'presence' : 'activity');
  }

  /** "Resume my day": the person ended today with Log out by mistake (decided 21 Nov, recorded). */
  @Post('resume')
  @RequireRoles('manager', 'team_lead', 'call_agent', 'field_agent', 'finance')
  resume(@Req() req: Authed) {
    return this.attendance.resumeDay(req.user.sub);
  }

  /** Reopen today's closed day: the person's Team Lead, a Manager over them or the CEO, with a reason. */
  @Post('days/:dayId/reopen')
  @RequireRoles('ceo', 'manager', 'team_lead')
  reopen(@Req() req: Authed, @Param('dayId') dayId: string, @Body() body: { reason?: string }) {
    return this.days.reopenDay({ id: req.user.sub, role: req.user.role }, dayId, body ?? {});
  }

  /** Own shifts (decided 21 Nov): the people whose shift the caller sets. */
  @Get('shifts')
  @RequireRoles('ceo', 'manager', 'team_lead')
  listShifts(@Req() req: Authed) {
    return this.shifts.list({ id: req.user.sub, role: req.user.role });
  }

  /** Set (HH:MM, HH:MM) or clear (null, null) a person's own shift. */
  @Put('shifts/:staffId')
  @RequireRoles('ceo', 'manager', 'team_lead')
  setShift(
    @Req() req: Authed,
    @Param('staffId') staffId: string,
    @Body() body: { shiftStart?: unknown; shiftEnd?: unknown; reason?: unknown },
  ) {
    return this.shifts.set({ id: req.user.sub, role: req.user.role }, staffId, body ?? {});
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
