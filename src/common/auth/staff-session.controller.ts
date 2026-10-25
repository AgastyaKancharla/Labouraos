import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
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

interface AuthenticatedRequest extends Request {
  user: JwtPayload;
}

@Controller('staff')
@UseGuards(JwtAuthGuard)
export class StaffSessionController {
  constructor(private readonly authService: AuthService) {}

  @Get('sessions')
  async listSessions(
    @Req() req: AuthenticatedRequest,
    @Query('staffId') queryStaffId?: string,
  ): Promise<StaffSessionView[]> {
    const actor = req.user;
    let targetStaffId = actor.sub;

    // Privileged roles can view any staff member's active sessions
    if (queryStaffId && (actor.role === 'ceo' || actor.role === 'manager')) {
      targetStaffId = queryStaffId;
    }

    return this.authService.listSessions(targetStaffId, actor.sid);
  }

  @Post('sessions/:id/revoke')
  @HttpCode(HttpStatus.OK)
  async revokeSession(
    @Param('id') sessionId: string,
    @Req() req: AuthenticatedRequest,
  ): Promise<{ success: boolean; message: string }> {
    return this.authService.revokeSession(sessionId, req.user);
  }

  @Post('2fa/setup')
  @HttpCode(HttpStatus.OK)
  async setup2fa(
    @Req() req: AuthenticatedRequest,
  ): Promise<{ secret: string; otpauthUrl: string }> {
    return this.authService.setupTotp(req.user.sub);
  }

  @Post('2fa/enable')
  @HttpCode(HttpStatus.OK)
  async enable2fa(
    @Req() req: AuthenticatedRequest,
    @Body('totpCode') totpCode: string,
  ): Promise<{ success: boolean; message: string }> {
    if (!totpCode || typeof totpCode !== 'string') {
      throw new BadRequestException('totpCode is required');
    }
    return this.authService.enableTotp(req.user.sub, totpCode);
  }
}
