import { Body, Controller, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { JwtAuthGuard } from '../../common/auth/jwt-auth.guard';
import { JwtPayload } from '../../common/auth/jwt-payload.interface';
import { RbacGuard } from '../../common/rbac/rbac.guard';
import { RequireRoles } from '../../common/rbac/roles.decorator';
import { ConductService } from './conduct.service';

type AuthedRequest = Request & { user: JwtPayload };

/** D6 business suspension (CEO) and D11 permanent bans (Manager / CEO), Master Guide rev 176. */
@Controller()
@UseGuards(JwtAuthGuard, RbacGuard)
export class ConductController {
  constructor(private readonly conduct: ConductService) {}

  @Post('businesses/:id/suspension')
  @RequireRoles('ceo')
  suspend(@Param('id') id: string, @Body() body: { days?: number; permanent?: boolean; reason?: string }, @Req() req: AuthedRequest) {
    return this.conduct.suspendBusiness(id, req.user.sub, body ?? {});
  }

  @Post('businesses/:id/suspension/lift')
  @RequireRoles('ceo')
  lift(@Param('id') id: string, @Body() body: { reason?: string }, @Req() req: AuthedRequest) {
    return this.conduct.liftSuspension(id, req.user.sub, body ?? {});
  }

  @Post('permanent-bans')
  @RequireRoles('manager', 'ceo')
  ban(@Body() body: { subjectType?: string; subjectId?: string; category?: string; reason?: string }, @Req() req: AuthedRequest) {
    return this.conduct.ban(req.user.sub, body ?? {});
  }

  @Get('permanent-bans/:subjectType/:subjectId')
  @RequireRoles('call_agent', 'field_agent', 'team_lead', 'manager', 'ceo', 'finance')
  banOf(@Param('subjectType') subjectType: string, @Param('subjectId') subjectId: string) {
    return this.conduct.banOf(subjectType, subjectId);
  }
}
