import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { JwtAuthGuard } from '../../common/auth/jwt-auth.guard';
import { JwtPayload } from '../../common/auth/jwt-payload.interface';
import { RbacGuard } from '../../common/rbac/rbac.guard';
import { RequireRoles } from '../../common/rbac/roles.decorator';
import { TeamLeadChecksService } from './team-lead-checks.service';
import { TeamLeadScreensService } from './team-lead-screens.service';
import { StaffPhotoService } from '../staff/staff-photo.service';

type Authed = Request & { user: JwtPayload };

/** The Team Lead portal's own read endpoints and checks (designs T-*). Team Leads only, own team only. */
@Controller('team-lead')
@UseGuards(JwtAuthGuard, RbacGuard)
@RequireRoles('team_lead')
export class TeamLeadController {
  constructor(
    private readonly screens: TeamLeadScreensService,
    private readonly checks: TeamLeadChecksService,
    private readonly photos: StaffPhotoService,
  ) {}

  private actor(req: Authed) {
    return { id: req.user.sub, role: req.user.role };
  }

  @Get('team')
  @RequireRoles('team_lead')
  team(@Req() req: Authed) {
    return this.screens.team(this.actor(req));
  }

  @Get('today')
  @RequireRoles('team_lead')
  today(@Req() req: Authed) {
    return this.screens.today(this.actor(req));
  }

  @Get('targets')
  @RequireRoles('team_lead')
  targets(@Req() req: Authed) {
    return this.screens.targets(this.actor(req));
  }

  @Get('agents')
  @RequireRoles('team_lead')
  async agents(@Req() req: Authed) {
    const res = await this.screens.agents(this.actor(req));
    return { ...res, rows: await this.photos.withStaffPhotos(res.rows) };
  }

  @Get('agents/:id')
  @RequireRoles('team_lead')
  async agent(@Req() req: Authed, @Param('id') id: string) {
    const [withPhoto] = await this.photos.withStaffPhotos([await this.screens.agent(this.actor(req), id)]);
    return withPhoto;
  }

  @Post('agents/:id/notes')
  @RequireRoles('team_lead')
  addNote(@Req() req: Authed, @Param('id') id: string, @Body() body: { text?: string; kind?: string }) {
    return this.checks.addNote(this.actor(req), id, body ?? {});
  }

  @Get('attendance')
  @RequireRoles('team_lead')
  attendance(@Req() req: Authed, @Query('date') date?: string) {
    return this.screens.attendance(this.actor(req), date);
  }

  @Get('leave')
  @RequireRoles('team_lead')
  leave(@Req() req: Authed) {
    return this.screens.leaveBoard(this.actor(req));
  }

  @Get('reports')
  @RequireRoles('team_lead')
  reports(@Req() req: Authed, @Query('from') from?: string, @Query('to') to?: string) {
    return this.screens.reportDays(this.actor(req), from, to);
  }

  @Get('access')
  @RequireRoles('team_lead')
  access(@Req() req: Authed) {
    return this.screens.access(this.actor(req));
  }

  @Get('work')
  @RequireRoles('team_lead')
  work(@Req() req: Authed) {
    return this.checks.work(this.actor(req));
  }

  @Post('remind')
  @HttpCode(HttpStatus.OK)
  @RequireRoles('team_lead')
  remind(@Req() req: Authed, @Body() body: { staffId?: string; jobSeekerId?: string; text?: string }) {
    return this.checks.remind(this.actor(req), body ?? {});
  }

  @Post('businesses/:id/move')
  @HttpCode(HttpStatus.OK)
  @RequireRoles('team_lead')
  moveBusiness(@Req() req: Authed, @Param('id') id: string, @Body() body: { toStaffId?: string }) {
    return this.checks.moveBusiness(this.actor(req), id, body ?? {});
  }

  @Get('registrations')
  @RequireRoles('team_lead')
  registrations(@Req() req: Authed) {
    return this.checks.registrations(this.actor(req));
  }

  @Get('registrations/:id/selfie')
  @RequireRoles('team_lead')
  selfie(@Req() req: Authed, @Param('id') id: string, @Query('subjectType') subjectType?: string) {
    return this.checks.selfie(this.actor(req), id, subjectType);
  }

  @Post('registrations/:id/check')
  @HttpCode(HttpStatus.OK)
  @RequireRoles('team_lead')
  checkRegistration(@Req() req: Authed, @Param('id') id: string, @Body() body: { verdict?: string; note?: string; subjectType?: string }) {
    return this.checks.checkRegistration(this.actor(req), id, body ?? {});
  }

  @Get('visits')
  @RequireRoles('team_lead')
  visits(@Req() req: Authed, @Query('date') date?: string) {
    return this.checks.visits(this.actor(req), date);
  }

  /** The visit's name-board photo and selfie as short-lived private links (never public). */
  @Get('visits/:id/photos')
  @RequireRoles('team_lead')
  visitPhotos(@Req() req: Authed, @Param('id') id: string) {
    return this.checks.visitPhotos(this.actor(req), id);
  }

  @Post('visits/:id/check')
  @HttpCode(HttpStatus.OK)
  @RequireRoles('team_lead')
  checkVisit(@Req() req: Authed, @Param('id') id: string, @Body() body: { verdict?: string; note?: string }) {
    return this.checks.checkVisit(this.actor(req), id, body ?? {});
  }

  @Get('quality')
  @RequireRoles('team_lead')
  quality(@Req() req: Authed) {
    return this.checks.quality(this.actor(req));
  }

  @Post('quality/:callId/score')
  @HttpCode(HttpStatus.OK)
  @RequireRoles('team_lead')
  score(@Req() req: Authed, @Param('callId') callId: string, @Body() body: { checks?: unknown; note?: string; flag?: boolean }) {
    return this.checks.scoreCall(this.actor(req), callId, body ?? {});
  }
}
