import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Optional,
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
import { JwtPayload } from './jwt-payload.interface';
import { Public } from '../rbac/public.decorator';
import { RbacGuard } from '../rbac/rbac.guard';
import { RequireRoles } from '../rbac/roles.decorator';
import { ALL_STAFF_ROLES } from '../rbac/rbac.types';
import { LiveEventsService } from '../live/live-events.service';
import { requestedApp } from './staff-app';
import { fieldAppAddress } from '../../modules/web-app/site-hosts';

export { LOGIN_CONNECTION_RATE_LIMIT, LOGIN_RATE_LIMIT_PER_CONNECTION, LOGIN_CONNECTION_TTL };

interface AuthenticatedRequest extends Request {
  user: JwtPayload;
}

@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    // Optional so specs that build the controller by hand need not supply it.
    @Optional() private readonly live?: LiveEventsService,
  ) {}

  /** A new sign-in can end this person's other sessions: their open live streams check at once. */
  private afterLogin<T>(result: T): T {
    const staffId = (result as { staff?: { id?: unknown } } | null)?.staff?.id;
    if (typeof staffId === 'string') this.live?.recheckSessions(staffId);
    return result;
  }

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
    return this.afterLogin(
      await this.authService.login(loginDto, { ip, userAgent, app: requestedApp(loginDto?.app, req), location: signInLocation(loginDto) }),
    );
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
    return this.afterLogin(
      await this.authService.verifyLoginCode(
        body.loginRequestId,
        body.code,
        { ip, userAgent, app: requestedApp(body?.app, req), location: signInLocation(body) },
        { deviceId: body.deviceId, loginRequestProof: body.loginRequestProof },
      ),
    );
  }

  /**
   * Where each app lives, for links such as "Open Laboura Field" on the office
   * app (Laboura Field's real address: FIELD_HOST, else /field on this address).
   */
  @Get('apps')
  @Public('addresses of the two apps; holds no data')
  apps() {
    return { fieldAppUrl: fieldAppAddress() };
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard, RbacGuard)
  @RequireRoles(...ALL_STAFF_ROLES)
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
  refreshField(@Body() body: FieldRefreshDto, @Req() req: Request) {
    return this.authService.refreshFieldSession(body, { userAgent: req.headers['user-agent'] });
  }

  /**
   * The office web app renews its token with its single-use refresh token
   * (decided 21 Nov) — also after the 15-minute token ran out while the
   * laptop slept. Office sessions only; the day-long and idle / 2-hour rules
   * still decide. The token lives in the tab's sessionStorage, so closing the
   * browser still signs out.
   */
  @Post('session/refresh')
  @Public('the office web app renews a session with its single-use refresh token; the session rules still apply')
  @HttpCode(HttpStatus.OK)
  @UseGuards(AuthThrottlerGuard)
  @Throttle({ default: { limit: 20, ttl: 60000 } })
  refreshOffice(@Body() body: FieldRefreshDto, @Req() req: Request) {
    return this.authService.refreshOfficeSession(body, { userAgent: req.headers['user-agent'] });
  }

  @Post('logout')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard, RbacGuard)
  @RequireRoles(...ALL_STAFF_ROLES)
  async logout(@Req() req: AuthenticatedRequest) {
    const result = await this.authService.logout(req.user);
    // The signed-out session's live stream closes now (LiveController).
    this.live?.recheckSessions(req.user.sub);
    return result;
  }
}

/**
 * The location Laboura Field may send with a sign-in (22 Nov: the attendance
 * day opens at sign-in and keeps a field agent's location). Only finite numbers
 * are passed on; anything else is ignored, never an error.
 */
function signInLocation(body: { latitude?: unknown; longitude?: unknown } | null | undefined): { latitude?: number; longitude?: number } {
  const latitude = body?.latitude;
  const longitude = body?.longitude;
  if (typeof latitude !== 'number' || typeof longitude !== 'number' || !Number.isFinite(latitude) || !Number.isFinite(longitude)) return {};
  return { latitude, longitude };
}
