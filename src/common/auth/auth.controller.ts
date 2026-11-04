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
import { LoginDto, LoginResult, VerifyLoginCodeDto } from './dto/login.dto';
import { AuthThrottlerGuard, LOGIN_CONNECTION_RATE_LIMIT, LOGIN_CONNECTION_TTL, LOGIN_RATE_LIMIT_PER_CONNECTION } from './auth-throttler.guard';
import { JwtAuthGuard } from './jwt-auth.guard';
import { AllowTotpSetupScope } from './totp-setup-scope.decorator';
import { JwtPayload } from './jwt-payload.interface';

export { LOGIN_CONNECTION_RATE_LIMIT, LOGIN_RATE_LIMIT_PER_CONNECTION, LOGIN_CONNECTION_TTL };

interface AuthenticatedRequest extends Request {
  user: JwtPayload;
}

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('login')
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
    return this.authService.verifyLoginCode(body.loginRequestId, body.code, {
      ip,
      userAgent,
    });
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  @AllowTotpSetupScope()
  refresh(@Req() req: AuthenticatedRequest) {
    return this.authService.refresh(req.user);
  }

  @Post('logout')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  @AllowTotpSetupScope()
  logout(@Req() req: AuthenticatedRequest) {
    return this.authService.logout(req.user);
  }
}
