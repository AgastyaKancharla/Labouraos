import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { JwtPayload } from './jwt-payload.interface';
import { PrismaService } from '../prisma/prisma.service';
import { getJwtSecret } from './jwt-secret';
import { sessionlessTokensAllowed } from './sessionless-tokens';
import { noteRequestDevice } from '../observability/request-context';
import { AuthClock } from './auth.service';
import { PricingService } from '../../modules/pricing/pricing.service';
import {
  sessionEndMessage,
  sessionLifetimeEnd,
  shouldTouchActivity,
} from './session-lifetime';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: AuthClock,
    private readonly pricingService: PricingService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: getJwtSecret(),
    });
  }

  async validate(payload: JwtPayload): Promise<JwtPayload> {
    if (!payload.sub || !payload.role) {
      throw new UnauthorizedException('Malformed token payload');
    }

    // Every real token carries its session; one without is refused (only a Jest
    // test run may use one, see sessionless-tokens.ts).
    if (!payload.sid && !sessionlessTokensAllowed()) {
      throw new UnauthorizedException('Session required: log in again');
    }

    // Check if session revocation applies
    if (payload.sid) {
      const session = await this.prisma.staffSession.findUnique({
        where: { id: payload.sid },
        include: { staff: { select: { status: true } } },
      });

      if (!session) {
        throw new UnauthorizedException('Session not found');
      }

      if (session.revokedAt) {
        throw new UnauthorizedException('Session has been revoked');
      }

      // Deactivation also revokes sessions; this closes the window where a
      // session was created just as the account was being deactivated.
      if (session.staff.status !== 'active') {
        throw new UnauthorizedException('Account is not active');
      }

      const now = this.clock.now();
      const policy = await this.pricingService.current();
      const end = sessionLifetimeEnd(session, now, policy.idleLogoutMinutes);
      if (end) {
        await this.prisma.staffSession.updateMany({
          where: { id: session.id, revokedAt: null },
          data: { revokedAt: now, endedReason: end },
        });
        throw new UnauthorizedException(sessionEndMessage(end));
      }

      noteRequestDevice({ staffId: payload.sub, sessionId: session.id, deviceId: session.deviceId });

      if (shouldTouchActivity(session.lastActivityAt, now)) {
        await this.prisma.staffSession.updateMany({
          where: { id: session.id, revokedAt: null },
          data: { lastActivityAt: now },
        });
      }
    }

    return payload;
  }
}
