import { Body, Controller, Get, Param, Post, Query, Req, UseGuards, UseInterceptors } from '@nestjs/common';
import { Request } from 'express';
import { JwtAuthGuard } from '../../common/auth/jwt-auth.guard';
import { JwtPayload } from '../../common/auth/jwt-payload.interface';
import { RbacGuard } from '../../common/rbac/rbac.guard';
import { RequireRoles } from '../../common/rbac/roles.decorator';
import { PiiMaskingInterceptor } from '../../common/rbac/pii-masking.interceptor';
import { CeoCommandCenterService } from './ceo-command-center.service';
import { CeoJobSeekersService } from './ceo-job-seekers.service';
import { CeoBusinessesService } from './ceo-businesses.service';
import { CeoPlacementsService } from './ceo-placements.service';
import { CeoMoneyService } from './ceo-money.service';
import { CeoTeamService, parseMonth } from './ceo-team.service';
import { CeoOpsService } from './ceo-ops.service';
import { CeoAdminService } from './ceo-admin.service';
import { cleanOption, cleanSearch, parseOptionalRange, parsePage, parseRange } from './ceo-common';

type AuthedRequest = Request & { user: JwtPayload };
type Q = Record<string, string | undefined>;

/**
 * Read endpoints behind the CEO portal screens (Command Center, lists and
 * detail pages). CEO only: the CEO, founders and co-founders see every single
 * thing (guide, "CEO and founders vs. Manager"); Managers, Finance and agents
 * are refused here and use their own portals. Full phone numbers in these
 * answers are logged by the PII interceptor, as for every CEO answer.
 */
@Controller('ceo')
@UseGuards(JwtAuthGuard, RbacGuard)
@RequireRoles('ceo')
@UseInterceptors(PiiMaskingInterceptor)
export class CeoPortalController {
  constructor(
    private readonly commandCenter: CeoCommandCenterService,
    private readonly seekers: CeoJobSeekersService,
    private readonly businesses: CeoBusinessesService,
    private readonly placements: CeoPlacementsService,
    private readonly money: CeoMoneyService,
    private readonly team: CeoTeamService,
    private readonly ops: CeoOpsService,
    private readonly admin: CeoAdminService,
  ) {}

  // Command Center and reports ------------------------------------------

  @Get('command-center/money')
  @RequireRoles('ceo')
  ccMoney(@Req() req: AuthedRequest, @Query() q: Q) {
    const now = new Date();
    return this.commandCenter.moneyRow(req.user.sub, parseRange(q.fromDate, q.toDate, now), now);
  }

  @Get('command-center/pipeline')
  @RequireRoles('ceo')
  ccPipeline(@Query() q: Q) {
    const now = new Date();
    return this.commandCenter.pipeline(parseRange(q.fromDate, q.toDate, now), now);
  }

  @Get('command-center/verticals')
  @RequireRoles('ceo')
  ccVerticals(@Query() q: Q) {
    const now = new Date();
    return this.commandCenter.verticals(parseRange(q.fromDate, q.toDate, now), now);
  }

  @Get('command-center/insights')
  @RequireRoles('ceo')
  ccInsights(@Query() q: Q) {
    const now = new Date();
    return this.commandCenter.insights(parseRange(q.fromDate, q.toDate, now), now);
  }

  @Get('reports')
  @RequireRoles('ceo')
  reports(@Query() q: Q) {
    const now = new Date();
    return this.commandCenter.reports(parseRange(q.fromDate, q.toDate, now), now);
  }

  // Job seekers ----------------------------------------------------------

  @Get('job-seekers')
  @RequireRoles('ceo')
  jobSeekers(@Query() q: Q) {
    return this.seekers.list({
      range: parseOptionalRange(q.fromDate, q.toDate),
      page: parsePage(q.page, q.pageSize),
      search: cleanSearch(q.search),
      status: cleanOption(q.status),
      trade: cleanOption(q.trade),
      kyc: cleanOption(q.kyc),
      sort: cleanOption(q.sort),
    });
  }

  @Get('near-refund')
  @RequireRoles('ceo')
  nearRefund() {
    return this.seekers.nearRefund();
  }

  @Post('near-refund/remind')
  @RequireRoles('ceo')
  remind(@Req() req: AuthedRequest, @Body() body: { kind?: string; id?: string }) {
    return this.seekers.remindAgent(req.user.sub, body);
  }

  @Get('job-seekers/:id')
  @RequireRoles('ceo')
  jobSeeker(@Param('id') id: string) {
    return this.seekers.detail(id);
  }

  // Businesses, vacancies, interviews, introductions ---------------------

  @Get('businesses')
  @RequireRoles('ceo')
  businessList(@Query() q: Q) {
    return this.businesses.listBusinesses({
      range: parseOptionalRange(q.fromDate, q.toDate),
      page: parsePage(q.page, q.pageSize),
      search: cleanSearch(q.search),
      status: cleanOption(q.status),
      agent: cleanOption(q.agent),
      area: cleanOption(q.area),
      type: cleanOption(q.type),
    });
  }

  @Get('businesses/waiting')
  @RequireRoles('ceo')
  businessesWaiting() {
    return this.businesses.waiting();
  }

  @Get('introductions')
  @RequireRoles('ceo')
  introductions(@Query() q: Q) {
    return this.businesses.introductions({
      range: parseOptionalRange(q.fromDate, q.toDate),
      page: parsePage(q.page, q.pageSize),
      search: cleanSearch(q.search),
      outcome: cleanOption(q.outcome),
    });
  }

  @Get('businesses/:id')
  @RequireRoles('ceo')
  business(@Param('id') id: string) {
    return this.businesses.businessDetail(id);
  }

  @Get('vacancies')
  @RequireRoles('ceo')
  vacancies(@Query() q: Q) {
    return this.businesses.listVacancies({
      range: parseOptionalRange(q.fromDate, q.toDate),
      page: parsePage(q.page, q.pageSize),
      search: cleanSearch(q.search),
      status: typeof q.status === 'string' && q.status ? q.status : undefined,
      trade: cleanOption(q.trade),
      area: cleanOption(q.area),
      age: cleanOption(q.age),
    });
  }

  @Get('vacancies/:id')
  @RequireRoles('ceo')
  vacancy(@Param('id') id: string) {
    return this.businesses.vacancyDetail(id);
  }

  @Get('interviews')
  @RequireRoles('ceo')
  interviews(@Query() q: Q) {
    const now = new Date();
    return this.businesses.interviews(parseRange(q.fromDate, q.toDate, now), now);
  }

  // Placements and claims ------------------------------------------------

  @Get('placements')
  @RequireRoles('ceo')
  placementList(@Query() q: Q) {
    return this.placements.list({
      range: parseOptionalRange(q.fromDate, q.toDate),
      page: parsePage(q.page, q.pageSize),
      search: cleanSearch(q.search),
      stage: cleanOption(q.stage),
      trade: cleanOption(q.trade),
    });
  }

  @Get('claims')
  @RequireRoles('ceo')
  claims(@Query() q: Q) {
    return this.placements.claims(parseOptionalRange(q.fromDate, q.toDate), parsePage(q.page, q.pageSize));
  }

  @Get('placements/:id')
  @RequireRoles('ceo')
  placement(@Param('id') id: string) {
    return this.placements.detail(id);
  }

  // Referral partners ----------------------------------------------------

  @Get('referrals')
  @RequireRoles('ceo')
  referrals(@Query() q: Q) {
    return this.money.referrals(parseOptionalRange(q.fromDate, q.toDate), parsePage(q.page, q.pageSize), {
      search: cleanSearch(q.search),
      type: cleanOption(q.type),
      payout: cleanOption(q.payout),
      checks: cleanOption(q.checks),
    });
  }

  @Get('referrals/:id')
  @RequireRoles('ceo')
  partner(@Param('id') id: string) {
    return this.money.partner(id);
  }

  // Money ----------------------------------------------------------------

  @Get('payments/in')
  @RequireRoles('ceo')
  moneyIn(@Query() q: Q) {
    const now = new Date();
    return this.money.moneyIn(parseRange(q.fromDate, q.toDate, now), parsePage(q.page, q.pageSize), cleanSearch(q.search), cleanOption(q.type));
  }

  @Get('payments/out')
  @RequireRoles('ceo')
  moneyOut(@Query() q: Q) {
    const now = new Date();
    return this.money.moneyOut(parseRange(q.fromDate, q.toDate, now), parsePage(q.page, q.pageSize), cleanOption(q.type), cleanOption(q.status));
  }

  @Get('payments/gst')
  @RequireRoles('ceo')
  gst(@Query() q: Q) {
    const now = new Date();
    return this.money.gst(parseRange(q.fromDate, q.toDate, now), parsePage(q.page, q.pageSize), cleanSearch(q.search));
  }

  @Get('refunds')
  @RequireRoles('ceo')
  refunds() {
    return this.money.refundsWithCeo();
  }

  // Team & access (part 2) ------------------------------------------------

  @Get('team')
  @RequireRoles('ceo')
  teamList() {
    return this.team.team(new Date());
  }

  @Get('teams')
  @RequireRoles('ceo')
  teamsList() {
    return this.team.teams(new Date());
  }

  @Post('teams/:id')
  @RequireRoles('ceo')
  nameTeam(@Req() req: AuthedRequest, @Param('id') id: string, @Body() body: { name?: unknown }) {
    return this.team.setTeamName(req.user, id, body ?? {});
  }

  @Get('devices')
  @RequireRoles('ceo')
  devices() {
    return this.team.devices(new Date());
  }

  @Get('access')
  @RequireRoles('ceo')
  access(@Query() q: Q) {
    const range = parseOptionalRange(q.fromDate, q.toDate);
    return this.team.access(new Date(), range.from, range.to);
  }

  @Get('targets')
  @RequireRoles('ceo')
  targetsBoard(@Query() q: Q) {
    const now = new Date();
    return this.team.targetsBoard(parseMonth(q.year, q.month, now), now);
  }

  @Post('targets/copy')
  @RequireRoles('ceo')
  copyTargets(@Req() req: AuthedRequest, @Body() body: { fromYear?: unknown; fromMonth?: unknown; toYear?: unknown; toMonth?: unknown }) {
    return this.team.copyTargets(req.user, body ?? {}, new Date());
  }

  // Operations -----------------------------------------------------------

  @Get('attendance')
  @RequireRoles('ceo')
  attendance(@Query() q: Q) {
    const now = new Date();
    return this.ops.attendance(parseRange(q.fromDate, q.toDate, now), now);
  }

  @Get('call-center')
  @RequireRoles('ceo')
  callCenter(@Req() req: AuthedRequest, @Query() q: Q) {
    const now = new Date();
    return this.ops.callCenter(req.user.sub, parseRange(q.fromDate, q.toDate, now), now);
  }

  @Get('field-ops')
  @RequireRoles('ceo')
  fieldOps(@Req() req: AuthedRequest, @Query() q: Q) {
    const now = new Date();
    return this.ops.fieldOps(req.user.sub, parseRange(q.fromDate, q.toDate, now), now);
  }

  @Get('check-ins')
  @RequireRoles('ceo')
  checkins(@Query() q: Q) {
    const now = new Date();
    return this.ops.checkins(parseRange(q.fromDate, q.toDate, now), now);
  }

  // Admin ----------------------------------------------------------------

  @Get('audit')
  @RequireRoles('ceo')
  audit(@Query() q: Q) {
    return this.admin.audit(parseOptionalRange(q.fromDate, q.toDate), parsePage(q.page, q.pageSize), {
      search: cleanSearch(q.search),
      who: cleanOption(q.who),
      type: cleanOption(q.type),
    });
  }

  @Get('flags')
  @RequireRoles('ceo')
  flags(@Query() q: Q) {
    return this.admin.flags(
      parsePage(q.page, q.pageSize),
      { search: cleanSearch(q.search), status: cleanOption(q.status), severity: cleanOption(q.severity), kind: cleanOption(q.kind) },
      new Date(),
    );
  }

  @Get('privacy')
  @RequireRoles('ceo')
  privacy() {
    return this.admin.privacy(new Date());
  }

  @Get('privacy/consents')
  @RequireRoles('ceo')
  consentRecords(@Query() q: Q) {
    return this.admin.consentRecords(parseOptionalRange(q.fromDate, q.toDate), parsePage(q.page, q.pageSize), {
      subjectType: cleanOption(q.subjectType),
      purpose: cleanOption(q.purpose),
      status: cleanOption(q.status),
      search: cleanSearch(q.search),
    });
  }

  @Get('system')
  @RequireRoles('ceo')
  system() {
    return this.admin.system(new Date());
  }

  @Get('pricing/history')
  @RequireRoles('ceo')
  pricingHistory() {
    return this.admin.pricingHistory(new Date());
  }

  @Get('pricing/minimum-wage')
  @RequireRoles('ceo')
  minimumWage() {
    return this.admin.minimumWage();
  }

  @Get('pricing/trades')
  @RequireRoles('ceo')
  tradeCounts() {
    return this.admin.tradeCounts();
  }
}
