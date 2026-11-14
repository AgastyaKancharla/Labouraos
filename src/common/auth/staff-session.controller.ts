import {
  BadRequestException,
  Body,
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
import { AllowTotpSetupScope } from './totp-setup-scope.decorator';
import { RbacGuard } from '../rbac/rbac.guard';
import { RequireRoles } from '../rbac/roles.decorator';
import { ALL_STAFF_ROLES } from '../rbac/rbac.types';
import { LiveEventsService } from '../live/live-events.service';

interface AuthenticatedRequest extends Request {
  user: JwtPayload;
}

@Controller('staff')
@UseGuards(JwtAuthGuard, RbacGuard)
@RequireRoles(...ALL_STAFF_ROLES)
export class StaffSessionController {
  constructor(
    private readonly authService: AuthService,
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
  async revokeSession(
    @Param('id') sessionId: string,
    @Req() req: AuthenticatedRequest,
  ): Promise<{ success: boolean; message: string }> {
    const result = await this.authService.revokeSession(sessionId, req.user);
    // Whoever's session it was, its live stream closes now (LiveController).
    this.live?.recheckAllSessions();
    return result;
  }

  @Post('2fa/setup')
  @AllowTotpSetupScope()
  @HttpCode(HttpStatus.OK)
  async setup2fa(
    @Req() req: AuthenticatedRequest,
  ): Promise<{ secret: string; otpauthUrl: string }> {
    return this.authService.setupTotp(req.user.sub);
  }

  @Post('2fa/enable')
  @AllowTotpSetupScope()
  @HttpCode(HttpStatus.OK)
  async enable2fa(
    @Req() req: AuthenticatedRequest,
    @Body('totpCode') totpCode: string,
  ): Promise<{ success: boolean; message: string }> {
    if (!totpCode || typeof totpCode !== 'string') {
      throw new BadRequestException('totpCode is required');
    }
    return this.authService.enableTotp(req.user.sub, totpCode, req.user.sid);
  }
}
