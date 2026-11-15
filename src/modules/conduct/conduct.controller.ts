import { Body, Controller, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { JwtAuthGuard } from '../../common/auth/jwt-auth.guard';
import { JwtPayload } from '../../common/auth/jwt-payload.interface';
import { RbacGuard } from '../../common/rbac/rbac.guard';
import { RequireRoles } from '../../common/rbac/roles.decorator';
import { ConductService } from './conduct.service';

type AuthedRequest = Request & { user: JwtPayload };

/** D6 business suspension (CEO) and D11 permanent bans (Manager / CEO; lifted by the CEO only), Master Guide rev 176 / 178. */
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

  /** M7 (rev 178): only the CEO lifts a ban, with a reason; the profiles go back to what they were. */
  @Post('permanent-bans/:subjectType/:subjectId/lift')
  @RequireRoles('ceo')
  liftBan(@Param('subjectType') subjectType: string, @Param('subjectId') subjectId: string, @Body() body: { reason?: string }, @Req() req: AuthedRequest) {
    return this.conduct.liftBan(subjectType, subjectId, req.user.sub, body ?? {});
  }

  /** H2 (rev 181): "possibly the same person as a banned person" — Manager or CEO decides, with a reason. */
  @Post('permanent-bans/possible-matches/:flagId/confirm')
  @RequireRoles('manager', 'ceo')
  confirmPossibleMatch(@Param('flagId') flagId: string, @Body() body: { reason?: string }, @Req() req: AuthedRequest) {
    return this.conduct.confirmPossibleMatch(flagId, req.user.sub, body ?? {});
  }

  @Post('permanent-bans/possible-matches/:flagId/not-same')
  @RequireRoles('manager', 'ceo')
  rejectPossibleMatch(@Param('flagId') flagId: string, @Body() body: { reason?: string }, @Req() req: AuthedRequest) {
    return this.conduct.rejectPossibleMatch(flagId, req.user.sub, body ?? {});
  }

  @Get('permanent-bans/:subjectType/:subjectId')
  @RequireRoles('manager', 'ceo', 'finance')
  banOf(@Param('subjectType') subjectType: string, @Param('subjectId') subjectId: string) {
    return this.conduct.banOf(subjectType, subjectId);
  }
}
