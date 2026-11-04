import { Global, Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { ThrottlerModule } from '@nestjs/throttler';
import { PrismaModule } from '../prisma/prisma.module';
import { AuthClock, AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { StaffSessionController } from './staff-session.controller';
import { JwtStrategy } from './jwt.strategy';
import { JwtAuthGuard } from './jwt-auth.guard';
import { TotpService } from './totp.service';
import { CloudflareAccessGuard } from './cloudflare-access.guard';
import { CloudflareAccessVerifier } from './cloudflare-access.verifier';
import {
  AuthThrottlerGuard,
  LOGIN_CONNECTION_RATE_LIMIT,
  LOGIN_CONNECTION_TTL,
} from './auth-throttler.guard';
import { getJwtSecret } from './jwt-secret';
import { LoginCodeModule } from '../../modules/login-code/login-code.module';
import { OfficeNetworkModule } from '../../modules/office-network/office-network.module';
import { ReviewFlagModule } from '../../modules/review-flag/review-flag.module';
import { PricingModule } from '../../modules/pricing/pricing.module';

@Global()
@Module({
  imports: [
    PrismaModule,
    ThrottlerModule.forRoot([
      {
        name: 'default',
        ttl: 60000,
        limit: 10,
      },
      {
        name: 'connection',
        ttl: LOGIN_CONNECTION_TTL,
        limit: LOGIN_CONNECTION_RATE_LIMIT,
      },
    ]),
    LoginCodeModule,
    OfficeNetworkModule,
    ReviewFlagModule,
    PricingModule,
    PassportModule.register({ defaultStrategy: 'jwt' }),
    JwtModule.registerAsync({
      useFactory: () => ({
        secret: getJwtSecret(),
        signOptions: {
          expiresIn: (process.env.JWT_EXPIRES_IN || '15m') as
            | `${number}h`
            | `${number}m`
            | `${number}s`,
        },
      }),
    }),
  ],
  controllers: [AuthController, StaffSessionController],
  providers: [
    AuthService,
    AuthClock,
    TotpService,
    JwtStrategy,
    JwtAuthGuard,
    CloudflareAccessGuard,
    CloudflareAccessVerifier,
    AuthThrottlerGuard,
  ],
  exports: [
    AuthService,
    AuthClock,
    TotpService,
    JwtModule,
    JwtAuthGuard,
    CloudflareAccessGuard,
    CloudflareAccessVerifier,
    AuthThrottlerGuard,
  ],
})
export class AuthModule {}
