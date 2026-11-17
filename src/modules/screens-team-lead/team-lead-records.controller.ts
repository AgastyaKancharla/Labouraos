import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query, Req, UseGuards, UseInterceptors } from '@nestjs/common';
import { Request } from 'express';
import { JwtAuthGuard } from '../../common/auth/jwt-auth.guard';
import { JwtPayload } from '../../common/auth/jwt-payload.interface';
import { PiiMaskingInterceptor } from '../../common/rbac/pii-masking.interceptor';
import { RbacGuard } from '../../common/rbac/rbac.guard';
import { RequireRoles } from '../../common/rbac/roles.decorator';
import { cleanOption, cleanSearch, parseOptionalRange, parsePage, parseRange } from '../ceo-portal/ceo-common';
import { ManagerListQuery } from '../screens-manager/manager-records.service';
import { RecordSectionsService, parseSection } from '../screens-manager/record-sections.service';
import { TeamLeadRecordsService } from './team-lead-records.service';

type Authed = Request & { user: JwtPayload };
type Q = Record<string, string | undefined>;

/**
 * The Team Lead's pipeline lists and profiles (the CEO pages, reused as the
 * Manager does), the business numbers on T-Home and "Assign" (Master Guide
 * rev 194, 17 Nov). Team Leads only. Lists take `section=team|unassigned`
 * (default team). Answers hold counts and work details, never rupees, and
 * phone numbers pass through the PII interceptor (last 4 digits only).
 */
@Controller('team-lead')
@UseGuards(JwtAuthGuard, RbacGuard)
@RequireRoles('team_lead')
@UseInterceptors(PiiMaskingInterceptor)
export class TeamLeadRecordsController {
  constructor(
    private readonly records: TeamLeadRecordsService,
    private readonly sections: RecordSectionsService,
  ) {}

  private scope(req: Authed) {
    return this.records.scope(this.actor(req));
  }

  private actor(req: Authed) {
    return { id: req.user.sub, role: req.user.role };
  }

  private listQuery(q: Q): ManagerListQuery {
    return {
      range: parseOptionalRange(q.fromDate, q.toDate),
      page: parsePage(q.page, q.pageSize),
      search: cleanSearch(q.search),
      status: cleanOption(q.status),
      trade: cleanOption(q.trade),
      kyc: cleanOption(q.kyc),
      sort: cleanOption(q.sort),
      agent: cleanOption(q.agent),
      area: cleanOption(q.area),
      type: cleanOption(q.type),
      age: cleanOption(q.age),
      stage: cleanOption(q.stage),
      checks: cleanOption(q.checks),
    };
  }

  /** T-Home "How the business is doing": the team's numbers for the period (counts only). */
  @Get('pipeline')
  @RequireRoles('team_lead')
  pipeline(@Req() req: Authed, @Query() q: Q) {
    return this.records.pipeline(this.actor(req), parseRange(q.fromDate, q.toDate, new Date()));
  }

  /** T-Home "Close to a refund": the team's rows, names and counts only (no rupees). */
  @Get('close-to-refund')
  @RequireRoles('team_lead')
  closeToRefund(@Req() req: Authed) {
    return this.records.closeToRefund(this.actor(req));
  }

  /** The Assign picker: himself and the active agents of his team. */
  @Get('assignees')
  @RequireRoles('team_lead')
  async assignees(@Req() req: Authed) {
    return this.sections.assigneeList(await this.scope(req));
  }

  /** Give a job seeker, referral partner or business to himself or an agent of his team. */
  @Post('assign')
  @HttpCode(HttpStatus.OK)
  @RequireRoles('team_lead')
  async assign(@Req() req: Authed, @Body() body: { kind?: unknown; id?: unknown; toStaffId?: unknown }) {
    return this.sections.assign(await this.scope(req), body ?? {});
  }

  @Get('job-seekers')
  @RequireRoles('team_lead')
  async jobSeekers(@Req() req: Authed, @Query() q: Q) {
    return this.sections.jobSeekers(await this.scope(req), parseSection(q.section), this.listQuery(q));
  }

  @Get('job-seekers/:id')
  @RequireRoles('team_lead')
  async jobSeeker(@Req() req: Authed, @Param('id') id: string) {
    return this.sections.jobSeeker(await this.scope(req), id);
  }

  /** C-JobSeeker: the live selfie, through a short-lived private link (audited). */
  @Get('job-seekers/:id/selfie')
  @RequireRoles('team_lead')
  async jobSeekerSelfie(@Req() req: Authed, @Param('id') id: string) {
    return this.sections.seekerSelfie(await this.scope(req), id);
  }

  @Get('businesses')
  @RequireRoles('team_lead')
  async businessList(@Req() req: Authed, @Query() q: Q) {
    return this.sections.businessList(await this.scope(req), parseSection(q.section), this.listQuery(q));
  }

  @Get('businesses/:id')
  @RequireRoles('team_lead')
  async business(@Req() req: Authed, @Param('id') id: string) {
    return this.sections.business(await this.scope(req), id);
  }

  /** C-Business: one visit's name-board photo and the agent's selfie (short-lived private links, audited). */
  @Get('businesses/:id/visits/:visitId/photos')
  @RequireRoles('team_lead')
  async visitPhotos(@Req() req: Authed, @Param('id') id: string, @Param('visitId') visitId: string) {
    return this.sections.visitPhotos(await this.scope(req), id, visitId);
  }

  @Get('vacancies')
  @RequireRoles('team_lead')
  async vacancies(@Req() req: Authed, @Query() q: Q) {
    return this.sections.vacancies(await this.scope(req), parseSection(q.section), this.listQuery(q));
  }

  @Get('vacancies/:id')
  @RequireRoles('team_lead')
  async vacancy(@Req() req: Authed, @Param('id') id: string) {
    return this.sections.vacancy(await this.scope(req), id);
  }

  @Get('interviews')
  @RequireRoles('team_lead')
  async interviews(@Req() req: Authed, @Query() q: Q) {
    const now = new Date();
    return this.sections.interviews(await this.scope(req), parseSection(q.section), parseRange(q.fromDate, q.toDate, now), now);
  }

  @Get('placements')
  @RequireRoles('team_lead')
  async placementList(@Req() req: Authed, @Query() q: Q) {
    return this.sections.placementList(await this.scope(req), parseSection(q.section), this.listQuery(q));
  }

  @Get('placements/:id')
  @RequireRoles('team_lead')
  async placement(@Req() req: Authed, @Param('id') id: string) {
    return this.sections.placement(await this.scope(req), id);
  }

  @Get('referrals')
  @RequireRoles('team_lead')
  async referrals(@Req() req: Authed, @Query() q: Q) {
    return this.sections.referrals(await this.scope(req), parseSection(q.section), this.listQuery(q));
  }

  @Get('referrals/:id')
  @RequireRoles('team_lead')
  async partner(@Req() req: Authed, @Param('id') id: string) {
    return this.sections.partner(await this.scope(req), id);
  }
}
