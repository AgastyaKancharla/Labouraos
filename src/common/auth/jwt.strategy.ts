import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { JwtPayload } from './jwt-payload.interface';
import { PrismaService } from '../prisma/prisma.service';
import { getJwtSecret } from './jwt-secret';
import { AuthClock } from './auth.service';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: AuthClock,
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

      if (session.expiresAt && session.expiresAt < this.clock.now()) {
        throw new UnauthorizedException('Session has expired');
      }
    }

    return payload;
  }
}
