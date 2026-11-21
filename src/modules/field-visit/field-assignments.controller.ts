import { BadRequestException, Body, Controller, Get, Param, Post, Req, UseGuards, UseInterceptors } from '@nestjs/common';
import { Request } from 'express';
import { JwtAuthGuard } from '../../common/auth/jwt-auth.guard';
import { JwtPayload } from '../../common/auth/jwt-payload.interface';
import { RbacGuard } from '../../common/rbac/rbac.guard';
import { RequireRoles } from '../../common/rbac/roles.decorator';
import { PiiMaskingInterceptor } from '../../common/rbac/pii-masking.interceptor';
import { FieldHandoverService } from './field-handover.service';

type Authed = Request & { user: JwtPayload };
const actorOf = (req: Authed) => ({ id: req.user.sub, role: req.user.role });

/**
 * Moving field work (Master Guide rev 202, 21 Nov): a Team Lead (own team),
 * Manager (own line) or the CEO sees the open assigned visits, reassigns one
 * (a warning when the new agent is on approved leave today) and hands a field
 * agent's open work to a teammate or spreads it across the team.
 */
@Controller('field-assignments')
@UseGuards(JwtAuthGuard, RbacGuard)
@UseInterceptors(PiiMaskingInterceptor)
export class FieldAssignmentsController {
  constructor(private readonly handover: FieldHandoverService) {}

  @Get('open')
  @RequireRoles('team_lead', 'manager', 'ceo')
  open(@Req() req: Authed) {
    return this.handover.openAssignments(actorOf(req));
  }

  /** Body: { assignedStaffId, reason, confirmLeave? }. 409 AGENT_ON_LEAVE asks to confirm. */
  @Post(':id/reassign')
  @RequireRoles('team_lead', 'manager', 'ceo')
  reassign(@Req() req: Authed, @Param('id') id: string, @Body() body: { assignedStaffId?: unknown; reason?: unknown; confirmLeave?: unknown }) {
    return this.handover.reassign(id, actorOf(req), body ?? {});
  }

  /** Body: { fromStaffId, toStaffId? (empty = spread across the team), until (last day away, YYYY-MM-DD), reason }. */
  @Post('hand-over')
  @RequireRoles('team_lead', 'manager', 'ceo')
  handOver(@Req() req: Authed, @Body() body: { fromStaffId?: unknown; toStaffId?: unknown; reason?: unknown; until?: unknown }) {
    return this.handover.handOverByHand(actorOf(req), body ?? {});
  }

  /** Body: { fromStaffId }. The agent is back: every live cover of his work ends (open visits go back to him). */
  @Post('hand-back')
  @RequireRoles('team_lead', 'manager', 'ceo')
  handBack(@Req() req: Authed, @Body() body: { fromStaffId?: unknown }) {
    const fromStaffId = typeof body?.fromStaffId === 'string' ? body.fromStaffId : '';
    if (!fromStaffId) throw new BadRequestException('fromStaffId is required');
    return this.handover.handBack(actorOf(req), fromStaffId);
  }
}
