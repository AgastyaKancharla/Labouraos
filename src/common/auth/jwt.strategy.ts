import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { JwtPayload } from './jwt-payload.interface';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(private readonly prisma: PrismaService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey:
        process.env.JWT_SECRET || 'dev_secret_key_change_in_production_min_32_chars',
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
      });

      if (!session) {
        throw new UnauthorizedException('Session not found');
      }

      if (session.revokedAt) {
        throw new UnauthorizedException('Session has been revoked');
      }

      if (session.expiresAt && session.expiresAt < new Date()) {
        throw new UnauthorizedException('Session has expired');
      }
    }

    return payload;
  }
}
