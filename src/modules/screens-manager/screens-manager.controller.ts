import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Put, Query, Req, UseGuards, UseInterceptors } from '@nestjs/common';
import { Request } from 'express';
import { StaffPhotoService } from '../staff/staff-photo.service';
import { JwtAuthGuard } from '../../common/auth/jwt-auth.guard';
import { JwtPayload } from '../../common/auth/jwt-payload.interface';
import { RbacGuard } from '../../common/rbac/rbac.guard';
import { RequireRoles } from '../../common/rbac/roles.decorator';
import { PiiMaskingInterceptor } from '../../common/rbac/pii-masking.interceptor';
import { cleanOption, cleanSearch, parseOptionalRange, parsePage, parseRange } from '../ceo-portal/ceo-common';
import { ManagerListQuery, ManagerRecordsService } from './manager-records.service';
import { ManagerPlanService } from './manager-plan.service';
import { ManagerPeopleService } from './manager-people.service';
import { ManagerOpsService } from './manager-ops.service';
import { ManagerTargetsService } from './manager-targets.service';
import { RecordSectionsService, parseSection } from './record-sections.service';
import { PHOTO_LINK_ANSWER } from '../../common/rbac/money-visibility';

type AuthedRequest = Request & { user: JwtPayload };
type Q = Record<string, string | undefined>;

/**
 * Read endpoints (and a few actions) behind the Manager portal screens. A
 * Manager only: every answer covers the Manager's own reporting tree
 * (ReportingScopeService), passes through the PII interceptor (phone numbers
 * masked, every money field stripped) and holds counts — never rupees
 * (guide, "CEO and founders vs. Manager", reconfirmed 11 Nov). The CEO uses
 * the CEO portal endpoints instead.
 */
@Controller('manager')
@UseGuards(JwtAuthGuard, RbacGuard)
@RequireRoles('manager')
@UseInterceptors(PiiMaskingInterceptor)
export class ScreensManagerController {
  constructor(
    private readonly plan: ManagerPlanService,
    private readonly people: ManagerPeopleService,
    private readonly ops: ManagerOpsService,
    private readonly targets: ManagerTargetsService,
    private readonly photos: StaffPhotoService,
    private readonly records: ManagerRecordsService,
    private readonly sections: RecordSectionsService,
  ) {}

  private actor(req: AuthedRequest) {
    return { id: req.user.sub, role: req.user.role };
  }

  // Overview -------------------------------------------------------------

  /** MG-Home and MG-Plan: plan vs actual for the tree, each team and each week. */
  @Get('overview')
  @RequireRoles('manager')
  overview(@Req() req: AuthedRequest, @Query() q: Q) {
    const now = new Date();
    return this.plan.overview(this.actor(req), parseRange(q.fromDate, q.toDate, now), now);
  }

  /** MG-Reports: weekly team report (counts only). */
  @Get('reports/weekly')
  @RequireRoles('manager')
  weekly(@Req() req: AuthedRequest, @Query() q: Q) {
    const now = new Date();
    return this.plan.weekly(this.actor(req), parseRange(q.fromDate, q.toDate, now), now);
  }

  // People ---------------------------------------------------------------

  @Get('teams')
  @RequireRoles('manager')
  teams(@Req() req: AuthedRequest) {
    return this.people.teams(this.actor(req), new Date());
  }

  @Get('teams/:id')
  @RequireRoles('manager')
  team(@Req() req: AuthedRequest, @Param('id') id: string) {
    return this.people.team(this.actor(req), id, new Date());
  }

  @Get('agents')
  @RequireRoles('manager')
  async agents(@Req() req: AuthedRequest) {
    const res = await this.people.agents(this.actor(req), new Date());
    return { ...res, rows: await this.photos.withStaffPhotos(res.rows) };
  }

  @Get('agents/:id')
  @RequireRoles('manager')
  async agent(@Req() req: AuthedRequest, @Param('id') id: string) {
    const res = await this.people.agent(this.actor(req), id, new Date());
    const [withPhoto] = await this.photos.withStaffPhotos([res]);
    return withPhoto;
  }

  /** A coaching note or written warning about someone in the tree. */
  @Post('people/:id/notes')
  @RequireRoles('manager')
  addNote(@Req() req: AuthedRequest, @Param('id') id: string, @Body() body: { kind?: unknown; text?: unknown }) {
    return this.people.addNote(this.actor(req), id, body ?? {}, new Date());
  }

  @Get('staff')
  @RequireRoles('manager')
  async staff(@Req() req: AuthedRequest) {
    const res = await this.people.staff(this.actor(req), new Date());
    return { ...res, rows: await this.photos.withPhotos(res.rows, (r) => r.id) };
  }

  @Get('attendance')
  @RequireRoles('manager')
  attendance(@Req() req: AuthedRequest, @Query() q: Q) {
    const now = new Date();
    return this.people.attendance(this.actor(req), parseRange(q.fromDate, q.toDate, now), now);
  }

  @Get('login-codes')
  @RequireRoles('manager')
  loginCodes(@Req() req: AuthedRequest, @Query() q: Q) {
    const now = new Date();
    return this.people.loginCodes(this.actor(req), parseRange(q.fromDate, q.toDate, now), now);
  }

  @Get('leave')
  @RequireRoles('manager')
  leave(@Req() req: AuthedRequest) {
    return this.ops.leaveBoard(this.actor(req), new Date());
  }

  // Targets --------------------------------------------------------------

  @Get('targets')
  @RequireRoles('manager')
  targetsBoard(@Req() req: AuthedRequest, @Query() q: Q) {
    return this.targets.board(this.actor(req), q.year, q.month, new Date());
  }

  @Put('targets')
  @RequireRoles('manager')
  saveTargets(@Req() req: AuthedRequest, @Body() body: { year?: unknown; month?: unknown; rows?: unknown }) {
    return this.targets.save(req.user, body ?? {}, new Date());
  }

  /** "Split the CEO's plan into teams": { year, month, rows: [{ teamLeadId, registered?, paid?, … }] } for teams in the tree. */
  @Put('targets/split')
  @RequireRoles('manager')
  saveSplit(@Req() req: AuthedRequest, @Body() body: { year?: unknown; month?: unknown; rows?: unknown }) {
    return this.targets.saveSplit(req.user, body ?? {}, new Date());
  }

  /** Copy from last month, for the Manager's own agents only. */
  @Post('targets/copy')
  @RequireRoles('manager')
  copyTargets(@Req() req: AuthedRequest, @Body() body: { fromYear?: unknown; fromMonth?: unknown; toYear?: unknown; toMonth?: unknown }) {
    return this.targets.copy(req.user, body ?? {}, new Date());
  }

  // Work -----------------------------------------------------------------

  @Get('pipeline')
  @RequireRoles('manager')
  pipeline(@Req() req: AuthedRequest, @Query() q: Q) {
    const now = new Date();
    return this.ops.pipeline(this.actor(req), parseRange(q.fromDate, q.toDate, now), now);
  }

  /** "Remind the agent" on a close-to-refund row. */
  @Post('pipeline/remind')
  @HttpCode(HttpStatus.OK)
  @RequireRoles('manager')
  remind(@Req() req: AuthedRequest, @Body() body: { kind?: string; id?: string }) {
    return this.ops.remindRefund(this.actor(req), body ?? {}, new Date());
  }

  /** "Remind the agents" on a stuck-work row. */
  @Post('pipeline/stuck/:kind/remind')
  @HttpCode(HttpStatus.OK)
  @RequireRoles('manager')
  remindStuck(@Req() req: AuthedRequest, @Param('kind') kind: string) {
    return this.ops.remindStuck(this.actor(req), kind, new Date());
  }

  /** Sidebar badge count: missed calls waiting in the Manager's tree. */
  @Get('nav-counts')
  @RequireRoles('manager')
  navCounts(@Req() req: AuthedRequest) {
    return this.ops.navCounts(this.actor(req));
  }

  @Get('call-center')
  @RequireRoles('manager')
  callCenter(@Req() req: AuthedRequest, @Query() q: Q) {
    const now = new Date();
    return this.ops.callCenter(this.actor(req), parseRange(q.fromDate, q.toDate, now), now);
  }

  @Get('field-ops')
  @RequireRoles('manager')
  fieldOps(@Req() req: AuthedRequest, @Query() q: Q) {
    const now = new Date();
    return this.ops.fieldOps(this.actor(req), parseRange(q.fromDate, q.toDate, now), now);
  }

  @Get('flags')
  @RequireRoles('manager')
  flags(@Req() req: AuthedRequest) {
    return this.ops.flagList(this.actor(req), new Date());
  }

  /** Resolve a quality or login flag about someone in the tree (money and bypass flags go to the CEO). */
  @Post('flags/:id/resolve')
  @HttpCode(HttpStatus.OK)
  @RequireRoles('manager')
  resolveFlag(@Req() req: AuthedRequest, @Param('id') id: string, @Body() body: { resolution?: string; status?: string }) {
    return this.ops.resolveFlag(this.actor(req), id, body ?? {});
  }

  /** "Send to CEO" on MG-Flags: the flag goes up to the CEO with the Manager's note. */
  @Post('flags/:id/escalate')
  @HttpCode(HttpStatus.OK)
  @RequireRoles('manager')
  escalateFlag(@Req() req: AuthedRequest, @Param('id') id: string, @Body() body: { note?: string }) {
    return this.ops.escalateFlag(this.actor(req), id, body ?? {});
  }

  // Pipeline lists and profiles (the CEO pages, scoped to the tree, no money) -----

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

  /** The Manager's sections (rev 196): his tree's records, or unowned ones in his teams' cities. */
  private scope(req: AuthedRequest) {
    return this.records.sectionScope(this.actor(req));
  }

  /** The Assign picker: anyone active in his reporting tree, himself first. */
  @Get('assignees')
  @RequireRoles('manager')
  async assignees(@Req() req: AuthedRequest) {
    return this.sections.assigneeList(await this.scope(req));
  }

  /** Give a job seeker, referral partner or business to someone active in his tree (rev 196). */
  @Post('assign')
  @HttpCode(HttpStatus.OK)
  @RequireRoles('manager')
  async assign(@Req() req: AuthedRequest, @Body() body: { kind?: unknown; id?: unknown; toStaffId?: unknown }) {
    return this.sections.assign(await this.scope(req), body ?? {});
  }

  @Get('job-seekers')
  @RequireRoles('manager')
  async jobSeekers(@Req() req: AuthedRequest, @Query() q: Q) {
    return this.sections.jobSeekers(await this.scope(req), parseSection(q.section), this.listQuery(q));
  }

  @Get('job-seekers/:id')
  @RequireRoles('manager')
  async jobSeeker(@Req() req: AuthedRequest, @Param('id') id: string) {
    return this.sections.jobSeeker(await this.scope(req), id);
  }

  /** C-JobSeeker: the live selfie of a job seeker he may open, through a short-lived private link. */
  @Get('job-seekers/:id/selfie')
  @RequireRoles('manager')
  async jobSeekerSelfie(@Req() req: AuthedRequest, @Param('id') id: string) {
    (req as unknown as Record<string, unknown>)[PHOTO_LINK_ANSWER] = true;
    return this.sections.seekerSelfie(await this.scope(req), id);
  }

  @Get('businesses')
  @RequireRoles('manager')
  async businessList(@Req() req: AuthedRequest, @Query() q: Q) {
    return this.sections.businessList(await this.scope(req), parseSection(q.section), this.listQuery(q));
  }

  @Get('businesses/:id')
  @RequireRoles('manager')
  async business(@Req() req: AuthedRequest, @Param('id') id: string) {
    return this.sections.business(await this.scope(req), id);
  }

  /** C-Business: a visit's name-board photo and selfie, for a business he may open; signed links only. */
  @Get('businesses/:id/visits/:visitId/photos')
  @RequireRoles('manager')
  async visitPhotos(@Req() req: AuthedRequest, @Param('id') id: string, @Param('visitId') visitId: string) {
    (req as unknown as Record<string, unknown>)[PHOTO_LINK_ANSWER] = true;
    return this.sections.visitPhotos(await this.scope(req), id, visitId);
  }

  @Get('vacancies')
  @RequireRoles('manager')
  async vacancies(@Req() req: AuthedRequest, @Query() q: Q) {
    return this.sections.vacancies(await this.scope(req), parseSection(q.section), this.listQuery(q));
  }

  @Get('vacancies/:id')
  @RequireRoles('manager')
  async vacancy(@Req() req: AuthedRequest, @Param('id') id: string) {
    return this.sections.vacancy(await this.scope(req), id);
  }

  @Get('interviews')
  @RequireRoles('manager')
  async interviews(@Req() req: AuthedRequest, @Query() q: Q) {
    const now = new Date();
    return this.sections.interviews(await this.scope(req), parseSection(q.section), parseRange(q.fromDate, q.toDate, now), now);
  }

  @Get('placements')
  @RequireRoles('manager')
  async placementList(@Req() req: AuthedRequest, @Query() q: Q) {
    return this.sections.placementList(await this.scope(req), parseSection(q.section), this.listQuery(q));
  }

  @Get('placements/:id')
  @RequireRoles('manager')
  async placement(@Req() req: AuthedRequest, @Param('id') id: string) {
    return this.sections.placement(await this.scope(req), id);
  }

  @Get('referrals')
  @RequireRoles('manager')
  async referrals(@Req() req: AuthedRequest, @Query() q: Q) {
    return this.sections.referrals(await this.scope(req), parseSection(q.section), this.listQuery(q));
  }

  @Get('referrals/:id')
  @RequireRoles('manager')
  async partner(@Req() req: AuthedRequest, @Param('id') id: string) {
    return this.sections.partner(await this.scope(req), id);
  }
}
