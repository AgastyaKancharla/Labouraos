import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Optional,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Request } from 'express';
import { AuthService, StaffSessionView } from './auth.service';
import { JwtAuthGuard } from './jwt-auth.guard';
import { JwtPayload } from './jwt-payload.interface';
import { RbacGuard } from '../rbac/rbac.guard';
import { RequireRoles } from '../rbac/roles.decorator';
import { ALL_STAFF_ROLES } from '../rbac/rbac.types';
import { LiveEventsService } from '../live/live-events.service';
import { PrismaService } from '../prisma/prisma.service';
import { Throttle } from '@nestjs/throttler';
import { AuthThrottlerGuard } from './auth-throttler.guard';

interface AuthenticatedRequest extends Request {
  user: JwtPayload;
}

@Controller('staff')
@UseGuards(JwtAuthGuard, RbacGuard)
@RequireRoles(...ALL_STAFF_ROLES)
export class StaffSessionController {
  constructor(
    private readonly authService: AuthService,
    private readonly prisma: PrismaService,
    @Optional() private readonly live?: LiveEventsService,
  ) {}

  @Get('sessions')
  async listSessions(
    @Req() req: AuthenticatedRequest,
    @Query('staffId') queryStaffId?: string,
  ): Promise<StaffSessionView[]> {
    // The CEO sees anyone's sessions; a Manager only their own reporting tree (403 otherwise).
    return this.authService.listSessionsFor(req.user, queryStaffId);
  }

  @Post('sessions/:id/revoke')
  @HttpCode(HttpStatus.OK)
  // Each revoke makes that person's open live streams check their session, so
  // it is rate limited: 20 a minute per signed-in staff member (AuthThrottlerGuard).
  @UseGuards(AuthThrottlerGuard)
  @Throttle({ default: { limit: 20, ttl: 60000 } })
  async revokeSession(
    @Param('id') sessionId: string,
    @Req() req: AuthenticatedRequest,
  ): Promise<{ success: boolean; message: string }> {
    const result = await this.authService.revokeSession(sessionId, req.user);
    // Only the revoked session's owner: their open live streams check now (LiveController).
    const session = await this.prisma.staffSession.findUnique({ where: { id: sessionId }, select: { staffId: true } });
    if (session?.staffId) this.live?.recheckSessions(session.staffId);
    return result;
  }
}
