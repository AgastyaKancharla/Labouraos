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
import { CloudflareAccessVerifier } from './cloudflare-access.verifier';
import { AuthThrottlerGuard } from './auth-throttler.guard';
import { getJwtSecret } from './jwt-secret';

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
    TotpService,
    JwtStrategy,
    JwtAuthGuard,
    CloudflareAccessGuard,
    CloudflareAccessVerifier,
    AuthThrottlerGuard,
  ],
  exports: [
    AuthService,
    TotpService,
    JwtModule,
    JwtAuthGuard,
    CloudflareAccessGuard,
    CloudflareAccessVerifier,
    AuthThrottlerGuard,
  ],
})
export class AuthModule {}
