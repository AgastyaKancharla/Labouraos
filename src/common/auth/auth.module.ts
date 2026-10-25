import { Global, Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { ThrottlerModule } from '@nestjs/throttler';
import { PrismaModule } from '../prisma/prisma.module';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { StaffSessionController } from './staff-session.controller';
import { JwtStrategy } from './jwt.strategy';
import { JwtAuthGuard } from './jwt-auth.guard';
import { TotpService } from './totp.service';
import { CloudflareAccessGuard } from './cloudflare-access.guard';
import { AuthThrottlerGuard } from './auth-throttler.guard';

@Global()
@Module({
  imports: [
    PrismaModule,
    ThrottlerModule.forRoot([
      {
        ttl: 60000,
        limit: 10,
      },
    ]),
    PassportModule.register({ defaultStrategy: 'jwt' }),
    JwtModule.register({
      secret:
        process.env.JWT_SECRET ||
        'dev_secret_key_change_in_production_min_32_chars',
      signOptions: {
        expiresIn: (process.env.JWT_EXPIRES_IN || '15m') as
          | `${number}h`
          | `${number}m`
          | `${number}s`,
      },
    }),
  ],
  controllers: [AuthController, StaffSessionController],
  providers: [
    AuthService,
    TotpService,
    JwtStrategy,
    JwtAuthGuard,
    CloudflareAccessGuard,
    AuthThrottlerGuard,
  ],
  exports: [
    AuthService,
    TotpService,
    JwtModule,
    JwtAuthGuard,
    CloudflareAccessGuard,
    AuthThrottlerGuard,
  ],
})
export class AuthModule {}
