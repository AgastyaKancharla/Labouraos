import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { JwtAuthGuard } from '../../common/auth/jwt-auth.guard';
import { JwtPayload } from '../../common/auth/jwt-payload.interface';
import { RbacGuard } from '../../common/rbac/rbac.guard';
import { RequireRoles } from '../../common/rbac/roles.decorator';
import { FlagEscalationService } from './flag-escalation.service';
import { RequestsService } from './requests.service';

type Authed = Request & { user: JwtPayload };
const DECIDERS = ['ceo', 'manager', 'team_lead'] as const;

/**
 * Requests and escalation for the Team Lead and Manager portals. Phone
 * numbers are masked and money stripped for Managers by the global
 * PiiMaskingInterceptor; every list is scoped by the reporting line.
 */
@Controller('requests')
@UseGuards(JwtAuthGuard, RbacGuard)
export class RequestsController {
  constructor(
    private readonly requests: RequestsService,
    private readonly flags: FlagEscalationService,
  ) {}

  private actor(req: Authed) {
    return { id: req.user.sub, role: req.user.role };
  }

  /** What is waiting for me to decide, each with why it is with me. */
  @Get('waiting')
  @RequireRoles(...DECIDERS)
  waiting(@Req() req: Authed) {
    return this.requests.waiting(this.actor(req));
  }

  /** Everything still pending in my team or tree (mine to decide or not), and my own. */
  @Get('open')
  @RequireRoles(...DECIDERS)
  open(@Req() req: Authed) {
    return this.requests.open(this.actor(req));
  }

  /** Decided since Monday (IST), or since ?since=yyyy-mm-dd, by anyone in my scope. */
  @Get('decided')
  @RequireRoles(...DECIDERS)
  decided(@Req() req: Authed, @Query('since') since?: string) {
    return this.requests.decided(this.actor(req), since);
  }

  /** Scoped review flags (T-Flags, MG-Flags). */
  @Get('flags')
  @RequireRoles(...DECIDERS)
  listFlags(@Req() req: Authed, @Query('status') status?: string, @Query('kind') kind?: string) {
    return this.flags.list(this.actor(req), { status, kind });
  }

  @Post('flags/:id/resolve')
  @HttpCode(HttpStatus.OK)
  @RequireRoles(...DECIDERS)
  resolveFlag(@Req() req: Authed, @Param('id') id: string, @Body() body: { status?: string; resolution?: string }) {
    return this.flags.resolve(this.actor(req), id, body ?? {});
  }

  /** "Send to Manager" (Team Lead) / "Send to CEO" (Manager). */
  @Post('flags/:id/escalate')
  @HttpCode(HttpStatus.OK)
  @RequireRoles('manager', 'team_lead')
  escalateFlag(@Req() req: Authed, @Param('id') id: string, @Body() body: { note?: string }) {
    return this.flags.escalate(this.actor(req), id, body ?? {});
  }

  /** Raise a hit removal, target change, day change or written warning. */
  @Post()
  @RequireRoles('ceo', 'manager', 'team_lead', 'call_agent', 'field_agent')
  create(@Req() req: Authed, @Body() body: Record<string, unknown>) {
    return this.requests.create(this.actor(req), body ?? {});
  }

  @Get(':ref')
  @RequireRoles(...DECIDERS)
  get(@Req() req: Authed, @Param('ref') ref: string) {
    return this.requests.get(this.actor(req), ref);
  }

  /** Approve or reject; a leave approval with fromDate/toDate approves only those days (the rest is rejected). */
  @Post(':ref/decide')
  @HttpCode(HttpStatus.OK)
  @RequireRoles(...DECIDERS)
  decide(
    @Req() req: Authed,
    @Param('ref') ref: string,
    @Body() body: { decision?: string; reason?: string; fromDate?: string; toDate?: string; followUps?: { mode?: string; staffId?: string } },
  ) {
    return this.requests.decide(this.actor(req), ref, body ?? {});
  }

  /** "Send back to the Team Lead" (MG-Req-Sneha, MG-Req-Vikram): stays pending, with the Team Lead again. */
  @Post(':ref/send-back')
  @HttpCode(HttpStatus.OK)
  @RequireRoles('manager')
  sendBack(@Req() req: Authed, @Param('ref') ref: string, @Body() body: { note?: string }) {
    return this.requests.sendBack(this.actor(req), ref, body ?? {});
  }

  @Post(':ref/forward')
  @HttpCode(HttpStatus.OK)
  @RequireRoles('team_lead')
  forward(@Req() req: Authed, @Param('ref') ref: string, @Body() body: { note?: string }) {
    return this.requests.forward(this.actor(req), ref, body ?? {});
  }

  @Post(':ref/overturn')
  @HttpCode(HttpStatus.OK)
  @RequireRoles('ceo', 'manager')
  overturn(@Req() req: Authed, @Param('ref') ref: string, @Body() body: { reason?: string }) {
    return this.requests.overturn(this.actor(req), ref, body ?? {});
  }
}
