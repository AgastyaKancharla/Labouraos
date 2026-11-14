import { Body, Controller, Get, Param, Post, Put, Query, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { JwtAuthGuard } from '../../common/auth/jwt-auth.guard';
import { JwtPayload } from '../../common/auth/jwt-payload.interface';
import { RbacGuard } from '../../common/rbac/rbac.guard';
import { RequireRoles } from '../../common/rbac/roles.decorator';
import { SignupTrackerService } from './signup-tracker.service';
import { SignupViewsService } from './signup-views.service';

type Authed = Request & { user: JwtPayload };

/**
 * App sign-ups for the office (customer app proposal 4.4): the Team Lead's
 * page (own team, move a sign-up), the Manager's counts (no money, no names),
 * the CEO's funnels and list, the "Registered in the app" labels, and the
 * CEO's edit of the languages each staff member speaks.
 */
@Controller('signup-tracker')
@UseGuards(JwtAuthGuard, RbacGuard)
export class SignupTrackerController {
  constructor(
    private readonly tracker: SignupTrackerService,
    private readonly views: SignupViewsService,
  ) {}

  private actor(req: Authed) {
    return { id: req.user.sub, role: req.user.role };
  }

  @Get('team-lead')
  @RequireRoles('team_lead')
  teamLead(@Req() req: Authed, @Query('days') days?: string) {
    return this.views.teamLead(this.actor(req), days);
  }

  @Get('manager')
  @RequireRoles('manager')
  manager(@Req() req: Authed, @Query('days') days?: string) {
    return this.views.manager(this.actor(req), days);
  }

  @Get('ceo')
  @RequireRoles('ceo')
  ceo(
    @Req() req: Authed,
    @Query('days') days?: string,
    @Query('kind') kind?: string,
    @Query('stage') stage?: string,
    @Query('outcome') outcome?: string,
  ) {
    return this.views.ceo(this.actor(req), { days, kind, stage, outcome });
  }

  @Post(':id/reassign')
  @RequireRoles('team_lead', 'manager', 'ceo')
  reassign(@Req() req: Authed, @Param('id') id: string, @Body() body: { staffId?: string; reason?: string }) {
    return this.tracker.reassign(this.actor(req), id, body?.staffId ?? '', body?.reason ?? null);
  }

  /** "Registered in the app" labels for a list of records (ids comma-separated). */
  @Get('app-labels')
  @RequireRoles('ceo', 'manager', 'team_lead', 'call_agent', 'field_agent', 'finance')
  appLabels(@Query('type') type: string, @Query('ids') ids?: string) {
    return this.views.appLabels(type, ids);
  }

  @Get('staff-languages')
  @RequireRoles('ceo')
  staffLanguages() {
    return this.views.staffLanguages();
  }

  @Put('staff-languages/:staffId')
  @RequireRoles('ceo')
  setStaffLanguages(@Req() req: Authed, @Param('staffId') staffId: string, @Body() body: { languages?: unknown }) {
    return this.views.setStaffLanguages(this.actor(req), staffId, body);
  }
}
