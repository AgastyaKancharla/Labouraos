import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Req, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Request } from 'express';
import { AuthThrottlerGuard } from '../../common/auth/auth-throttler.guard';
import { JwtAuthGuard } from '../../common/auth/jwt-auth.guard';
import { JwtPayload } from '../../common/auth/jwt-payload.interface';
import { requestedApp } from '../../common/auth/staff-app';
import { Public } from '../../common/rbac/public.decorator';
import { RbacGuard } from '../../common/rbac/rbac.guard';
import { RequireRoles } from '../../common/rbac/roles.decorator';
import { PasswordResetService, ResetActor, ResetCompleteInput } from './password-reset.service';

type AuthenticatedRequest = Request & { user: JwtPayload };

/** Requests per IP per hour on "Forgot password", whatever the staff code. */
export const RESET_REQUESTS_PER_IP_PER_HOUR = 20;

function ipOf(req: Request): string | null {
  return req.ip || req.socket?.remoteAddress || null;
}

/**
 * "Forgot password" on the login pages (web and Laboura Field). Public: the
 * person cannot sign in. The request answers the same whether the staff code
 * exists or not; the reset code from a senior is the proof on completion.
 */
@Controller('auth/password-reset')
export class PasswordResetPublicController {
  constructor(private readonly resets: PasswordResetService) {}

  @Post('request')
  @Public('forgot password: always the same answer, never says whether the staff code exists')
  @HttpCode(HttpStatus.OK)
  @UseGuards(AuthThrottlerGuard)
  @Throttle({
    default: { limit: 5, ttl: 60000 },
    connection: { limit: RESET_REQUESTS_PER_IP_PER_HOUR, ttl: 60 * 60 * 1000 },
  })
  request(@Body() body: { staffCode?: unknown; deviceId?: unknown; app?: unknown }, @Req() req: Request) {
    const app = requestedApp(body?.app, req);
    return this.resets.request(body?.staffCode, body?.deviceId, app.invalid ? null : app.app, ipOf(req));
  }

  @Post('complete')
  @Public('forgot password: the reset code a senior revealed, on the device that asked, is the proof')
  @HttpCode(HttpStatus.OK)
  @UseGuards(AuthThrottlerGuard)
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  complete(@Body() body: ResetCompleteInput & { app?: unknown }, @Req() req: Request) {
    const app = requestedApp(body?.app, req);
    return this.resets.complete(body, app.invalid ? null : app.app, ipOf(req));
  }
}

/** The red PASSWORD RESET cards on the code screens (C-, MG-, T-LoginCodes). */
@Controller('password-resets')
@UseGuards(JwtAuthGuard, RbacGuard)
@RequireRoles('ceo', 'manager', 'team_lead')
export class PasswordResetApprovalController {
  constructor(private readonly resets: PasswordResetService) {}

  private actor(req: AuthenticatedRequest): ResetActor {
    return { id: req.user.sub, role: req.user.role };
  }

  @Get('pending')
  pending(@Req() req: AuthenticatedRequest) {
    return this.resets.listPending(this.actor(req));
  }

  @Post(':id/reveal')
  @HttpCode(HttpStatus.OK)
  reveal(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    return this.resets.reveal(id, this.actor(req));
  }

  @Post(':id/refuse')
  @HttpCode(HttpStatus.OK)
  refuse(@Param('id') id: string, @Body() body: { reason?: unknown }, @Req() req: AuthenticatedRequest) {
    return this.resets.refuse(id, this.actor(req), body?.reason);
  }
}
