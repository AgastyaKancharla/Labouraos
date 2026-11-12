import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Request } from 'express';
import { Throttle } from '@nestjs/throttler';
import { AuthService } from './auth.service';
import { FieldRefreshDto, LoginDto, LoginResult, VerifyLoginCodeDto } from './dto/login.dto';
import { AuthThrottlerGuard, LOGIN_CONNECTION_RATE_LIMIT, LOGIN_CONNECTION_TTL, LOGIN_RATE_LIMIT_PER_CONNECTION } from './auth-throttler.guard';
import { JwtAuthGuard } from './jwt-auth.guard';
import { AllowTotpSetupScope } from './totp-setup-scope.decorator';
import { JwtPayload } from './jwt-payload.interface';
import { Public } from '../rbac/public.decorator';
import { RbacGuard } from '../rbac/rbac.guard';
import { RequireRoles } from '../rbac/roles.decorator';
import { ALL_STAFF_ROLES } from '../rbac/rbac.types';

export { LOGIN_CONNECTION_RATE_LIMIT, LOGIN_RATE_LIMIT_PER_CONNECTION, LOGIN_CONNECTION_TTL };

interface AuthenticatedRequest extends Request {
  user: JwtPayload;
}

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('login')
  @Public('staff login: proves identity itself with code, password, device and second factor')
  @HttpCode(HttpStatus.OK)
  @UseGuards(AuthThrottlerGuard)
  @Throttle({
    default: { limit: 5, ttl: 60000 },
    connection: { limit: LOGIN_CONNECTION_RATE_LIMIT, ttl: LOGIN_CONNECTION_TTL },
  })
  async login(
    @Body() loginDto: LoginDto,
    @Req() req: Request,
  ): Promise<LoginResult> {
    const ip = req.ip || req.socket.remoteAddress;
    const userAgent = req.headers['user-agent'];
    return this.authService.login(loginDto, { ip, userAgent });
  }

  @Post('login/verify-code')
  @Public('second login step: the one-time login code is the proof')
  @HttpCode(HttpStatus.OK)
  @UseGuards(AuthThrottlerGuard)
  @Throttle({
    default: { limit: 5, ttl: 60000 },
    connection: { limit: LOGIN_CONNECTION_RATE_LIMIT, ttl: LOGIN_CONNECTION_TTL },
  })
  async verifyCode(
    @Body() body: VerifyLoginCodeDto,
    @Req() req: Request,
  ) {
    const ip = req.ip || req.socket.remoteAddress;
    const userAgent = req.headers['user-agent'];
    return this.authService.verifyLoginCode(
      body.loginRequestId,
      body.code,
      { ip, userAgent },
      { deviceId: body.deviceId, loginRequestProof: body.loginRequestProof },
    );
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard, RbacGuard)
  @RequireRoles(...ALL_STAFF_ROLES)
  @AllowTotpSetupScope()
  refresh(@Req() req: AuthenticatedRequest) {
    return this.authService.refresh(req.user);
  }

  /**
   * Laboura Field: reopening the app restores the session kept on the phone.
   * No bearer token (it may have run out while the app was closed): the
   * single-use refresh token, the session id and the approved phone's id are
   * the proof, and the 1-hour idle and 2-hour limits still apply.
   */
  @Post('field/refresh')
  @Public('Laboura Field restores a session with its single-use refresh token; idle and 2-hour limits still apply')
  @HttpCode(HttpStatus.OK)
  @UseGuards(AuthThrottlerGuard)
  @Throttle({ default: { limit: 20, ttl: 60000 } })
  refreshField(@Body() body: FieldRefreshDto) {
    return this.authService.refreshFieldSession(body);
  }

  @Post('logout')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard, RbacGuard)
  @RequireRoles(...ALL_STAFF_ROLES)
  @AllowTotpSetupScope()
  logout(@Req() req: AuthenticatedRequest) {
    return this.authService.logout(req.user);
  }
}
