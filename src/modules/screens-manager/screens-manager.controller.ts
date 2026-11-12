import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Put, Query, Req, UseGuards, UseInterceptors } from '@nestjs/common';
import { Request } from 'express';
import { JwtAuthGuard } from '../../common/auth/jwt-auth.guard';
import { JwtPayload } from '../../common/auth/jwt-payload.interface';
import { RbacGuard } from '../../common/rbac/rbac.guard';
import { RequireRoles } from '../../common/rbac/roles.decorator';
import { PiiMaskingInterceptor } from '../../common/rbac/pii-masking.interceptor';
import { parseRange } from '../ceo-portal/ceo-common';
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
  agents(@Req() req: AuthedRequest) {
    return this.people.agents(this.actor(req), new Date());
  }

  @Get('agents/:id')
  @RequireRoles('manager')
  agent(@Req() req: AuthedRequest, @Param('id') id: string) {
    return this.people.agent(this.actor(req), id, new Date());
  }

  /** A coaching note or written warning about someone in the tree. */
  @Post('people/:id/notes')
  @RequireRoles('manager')
  addNote(@Req() req: AuthedRequest, @Param('id') id: string, @Body() body: { kind?: unknown; text?: unknown }) {
    return this.people.addNote(this.actor(req), id, body ?? {}, new Date());
  }

  @Get('staff')
  @RequireRoles('manager')
  staff(@Req() req: AuthedRequest) {
    return this.people.staff(this.actor(req), new Date());
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
}
