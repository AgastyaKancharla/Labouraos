import { Body, Controller, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { JwtAuthGuard } from '../../common/auth/jwt-auth.guard';
import { RequireRoles } from '../../common/rbac/roles.decorator';
import { RbacGuard } from '../../common/rbac/rbac.guard';
import { JwtPayload } from '../../common/auth/jwt-payload.interface';
import { AttendanceRequestsService } from './attendance-requests.service';

type Authed = Request & { user: JwtPayload };

/** Roles that mark attendance and so ask for leave and corrections. */
const ATTENDANCE_STAFF = ['manager', 'team_lead', 'call_agent', 'field_agent', 'finance'] as const;
const ALL_STAFF = ['ceo', ...ATTENDANCE_STAFF] as const;
const DECIDERS = ['ceo', 'manager', 'team_lead'] as const;

@Controller('attendance')
@UseGuards(JwtAuthGuard, RbacGuard)
export class AttendanceRequestsController {
  constructor(private readonly requests: AttendanceRequestsService) {}

  private actor(req: Authed) {
    return { id: req.user.sub, role: req.user.role };
  }

  @Post('leave')
  @RequireRoles(...ATTENDANCE_STAFF)
  requestLeave(
    @Req() req: Authed,
    @Body() body: { kind?: string; fromDate?: string; toDate?: string; reason?: string },
  ) {
    return this.requests.requestLeave(this.actor(req), body ?? {});
  }

  @Get('leave/balance')
  @RequireRoles(...ALL_STAFF)
  balance(@Req() req: Authed, @Query('staffId') staffId?: string) {
    return this.requests.balanceFor(this.actor(req), staffId || req.user.sub);
  }

  @Post('corrections')
  @RequireRoles(...ATTENDANCE_STAFF)
  requestCorrection(
    @Req() req: Authed,
    @Body() body: { date?: string; from?: string; to?: string; status?: string; reason?: string },
  ) {
    return this.requests.requestCorrection(this.actor(req), body ?? {});
  }

  @Get('requests/mine')
  @RequireRoles(...ATTENDANCE_STAFF)
  mine(@Req() req: Authed) {
    return this.requests.mine(this.actor(req));
  }

  @Get('requests/team')
  @RequireRoles(...DECIDERS)
  team(@Req() req: Authed) {
    return this.requests.team(this.actor(req));
  }

  @Get('requests/waiting')
  @RequireRoles(...DECIDERS)
  waiting(@Req() req: Authed) {
    return this.requests.waiting(this.actor(req));
  }

  @Get('requests/decided')
  @RequireRoles(...DECIDERS)
  decided(@Req() req: Authed) {
    return this.requests.decidedThisWeek(this.actor(req));
  }

  @Post('requests/:kind/:id/approve')
  @RequireRoles(...DECIDERS)
  approve(
    @Req() req: Authed,
    @Param('kind') kind: string,
    @Param('id') id: string,
    @Body() body: { reason?: string },
  ) {
    return this.requests.decide(this.actor(req), kind, id, 'approved', body ?? {});
  }

  @Post('requests/:kind/:id/reject')
  @RequireRoles(...DECIDERS)
  reject(
    @Req() req: Authed,
    @Param('kind') kind: string,
    @Param('id') id: string,
    @Body() body: { reason?: string },
  ) {
    return this.requests.decide(this.actor(req), kind, id, 'rejected', body ?? {});
  }

  @Post('requests/:kind/:id/forward')
  @RequireRoles('team_lead')
  forward(
    @Req() req: Authed,
    @Param('kind') kind: string,
    @Param('id') id: string,
    @Body() body: { note?: string },
  ) {
    return this.requests.forward(this.actor(req), kind, id, body ?? {});
  }

  @Post('requests/:kind/:id/overturn')
  @RequireRoles('ceo', 'manager')
  overturn(
    @Req() req: Authed,
    @Param('kind') kind: string,
    @Param('id') id: string,
    @Body() body: { reason?: string },
  ) {
    return this.requests.overturn(this.actor(req), kind, id, body ?? {});
  }
}
