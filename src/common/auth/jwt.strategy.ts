import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import type { Request } from 'express';
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
import { appForRole, isStaffApp, roleAllowedInApp } from './staff-app';
import { isFieldHost } from '../../modules/web-app/site-hosts';

/** A token used in the other app (or on the other app's address). */
export const WRONG_APP_TOKEN = 'This sign-in belongs to the other Laboura app: sign in again here';

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
      passReqToCallback: true,
    });
  }

  async validate(req: Request, payload: JwtPayload): Promise<JwtPayload> {
    if (!payload.sub || !payload.role) {
      throw new UnauthorizedException('Malformed token payload');
    }
    const fieldHost = isFieldHost(req);
    // A token without a session (Jest only) still answers to its app on the Laboura Field address.
    if (!payload.sid && fieldHost && (payload.app ?? appForRole(payload.role)) !== 'field') {
      throw new UnauthorizedException(WRONG_APP_TOKEN);
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

      // A token works only in its own app (owner decision 14 Nov): the session's
      // app (older sessions: the role's own app) must match the token's, must
      // allow the role, and on the Laboura Field address it must be Laboura Field.
      const sessionApp = isStaffApp(session.app) ? session.app : appForRole(payload.role);
      if (
        (payload.app && payload.app !== sessionApp) ||
        !roleAllowedInApp(payload.role, sessionApp) ||
        (fieldHost && sessionApp !== 'field')
      ) {
        throw new UnauthorizedException(WRONG_APP_TOKEN);
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
