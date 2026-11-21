import { Controller, Get, Query, Req, UseGuards, UseInterceptors } from '@nestjs/common';
import { Request } from 'express';
import { JwtAuthGuard } from '../../common/auth/jwt-auth.guard';
import { JwtPayload } from '../../common/auth/jwt-payload.interface';
import { queryText } from '../../common/http/plain-query';
import { PiiMaskingInterceptor } from '../../common/rbac/pii-masking.interceptor';
import { RbacGuard } from '../../common/rbac/rbac.guard';
import { RequireRoles } from '../../common/rbac/roles.decorator';
import { ProfileStuckService } from './profile-stuck.service';

/**
 * "Where they're stuck" (Master Guide rev 204, 21 Nov): GET /profile-stuck?kind=&id=
 * for the job seeker, business and referral partner profiles of the call agent,
 * Team Lead, Manager and CEO views. Each role's normal record scope applies
 * (the service: 404 outside it). The buttons it lists call existing routes.
 */
@Controller('profile-stuck')
@UseGuards(JwtAuthGuard, RbacGuard)
@UseInterceptors(PiiMaskingInterceptor)
export class ProfileStuckController {
  constructor(private readonly service: ProfileStuckService) {}

  /** "Stuck registrations" (22 Nov): the viewer's own (call agent) or team's (Team Lead, Manager) stuck people. */
  @Get('list')
  @RequireRoles('call_agent', 'team_lead', 'manager')
  list(@Req() req: Request & { user: JwtPayload }) {
    return this.service.list({ id: req.user.sub, role: req.user.role });
  }

  @Get()
  @RequireRoles('call_agent', 'team_lead', 'manager', 'ceo')
  stuck(@Req() req: Request & { user: JwtPayload }, @Query('kind') kind: unknown, @Query('id') id: unknown) {
    return this.service.stuck({ id: req.user.sub, role: req.user.role }, queryText(kind, 'kind'), queryText(id, 'id'));
  }
}
