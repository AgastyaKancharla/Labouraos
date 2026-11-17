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

  /** "Reset to automatic": { year, month, kind: 'team' | 'agent', id, key? } for a team or agent in the tree. */
  @Post('targets/reset')
  @HttpCode(HttpStatus.OK)
  @RequireRoles('manager')
  resetTargets(@Req() req: AuthedRequest, @Body() body: { year?: unknown; month?: unknown; kind?: unknown; id?: unknown; key?: unknown }) {
    return this.targets.reset(req.user, body ?? {}, new Date());
  }

  /** "Transfer target": { year, month, fromStaffId, toStaffId }, both in the tree (the one giving may have left). */
  @Post('targets/transfer')
  @HttpCode(HttpStatus.OK)
  @RequireRoles('manager')
  transferTargets(@Req() req: AuthedRequest, @Body() body: { year?: unknown; month?: unknown; fromStaffId?: unknown; toStaffId?: unknown }) {
    return this.targets.transfer(req.user, body ?? {}, new Date());
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

  @Get('job-seekers')
  @RequireRoles('manager')
  jobSeekers(@Req() req: AuthedRequest, @Query() q: Q) {
    return this.records.jobSeekers(req.user.sub, this.listQuery(q));
  }

  @Get('job-seekers/:id')
  @RequireRoles('manager')
  jobSeeker(@Req() req: AuthedRequest, @Param('id') id: string) {
    return this.records.jobSeeker(req.user.sub, id);
  }

  @Get('businesses')
  @RequireRoles('manager')
  businessList(@Req() req: AuthedRequest, @Query() q: Q) {
    return this.records.businessList(req.user.sub, this.listQuery(q));
  }

  @Get('businesses/:id')
  @RequireRoles('manager')
  business(@Req() req: AuthedRequest, @Param('id') id: string) {
    return this.records.business(req.user.sub, id);
  }

  @Get('vacancies')
  @RequireRoles('manager')
  vacancies(@Req() req: AuthedRequest, @Query() q: Q) {
    return this.records.vacancies(req.user.sub, this.listQuery(q));
  }

  @Get('vacancies/:id')
  @RequireRoles('manager')
  vacancy(@Req() req: AuthedRequest, @Param('id') id: string) {
    return this.records.vacancy(req.user.sub, id);
  }

  @Get('interviews')
  @RequireRoles('manager')
  interviews(@Req() req: AuthedRequest, @Query() q: Q) {
    const now = new Date();
    return this.records.interviews(req.user.sub, parseRange(q.fromDate, q.toDate, now), now);
  }

  @Get('placements')
  @RequireRoles('manager')
  placementList(@Req() req: AuthedRequest, @Query() q: Q) {
    return this.records.placementList(req.user.sub, this.listQuery(q));
  }

  @Get('placements/:id')
  @RequireRoles('manager')
  placement(@Req() req: AuthedRequest, @Param('id') id: string) {
    return this.records.placement(req.user.sub, id);
  }

  @Get('referrals')
  @RequireRoles('manager')
  referrals(@Req() req: AuthedRequest, @Query() q: Q) {
    return this.records.referrals(req.user.sub, this.listQuery(q));
  }

  @Get('referrals/:id')
  @RequireRoles('manager')
  partner(@Req() req: AuthedRequest, @Param('id') id: string) {
    return this.records.partner(req.user.sub, id);
  }
}
