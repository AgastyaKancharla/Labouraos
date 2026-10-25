import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  Optional,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { TotpService } from './totp.service';
import { LoginDto, LoginResponseDto } from './dto/login.dto';
import { JwtPayload } from './jwt-payload.interface';

export interface StaffSessionView {
  id: string;
  deviceId: string | null;
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: Date;
  expiresAt: Date;
  isCurrent: boolean;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly totpService: TotpService,
    @Optional()
    private readonly auditService?: AuditService,
  ) {}

  async hashPassword(password: string): Promise<string> {
    const saltRounds = 10;
    return bcrypt.hash(password, saltRounds);
  }

  async verifyPassword(password: string, hash: string): Promise<boolean> {
    return bcrypt.compare(password, hash);
  }

  async login(
    loginDto: LoginDto,
    metadata?: { ip?: string; userAgent?: string },
  ): Promise<LoginResponseDto> {
    const staff = await this.prisma.staff.findUnique({
      where: { email: loginDto.email },
    });

    if (!staff) {
      throw new UnauthorizedException('Invalid email or password');
    }

    const isMatch = await this.verifyPassword(
      loginDto.password,
      staff.passwordHash,
    );
    if (!isMatch) {
      throw new UnauthorizedException('Invalid email or password');
    }

    // Checked after the password so account state is never revealed to someone
    // who does not hold valid credentials. A pending invite cannot reach here:
    // its placeholder password hash is unguessable.
    if (staff.status !== 'active') {
      throw new UnauthorizedException('Account is not active');
    }

    // 1. Mandatory 2FA via TOTP (RFC 6238) for all staff roles. An enrolled
    // account must present a valid code. An account that has not enrolled yet
    // cannot be asked for one (it has no secret), so it gets a token limited to
    // the TOTP setup/enable endpoints until enrolment completes.
    const enrolledSecret = staff.totpEnabled ? staff.totpSecret : null;
    const totpEnrolled = !!enrolledSecret;
    if (enrolledSecret) {
      if (!loginDto.totpCode) {
        throw new UnauthorizedException('TOTP 2FA code is required');
      }
      const isTotpValid = this.totpService.verify(
        loginDto.totpCode,
        enrolledSecret,
      );
      if (!isTotpValid) {
        throw new UnauthorizedException('Invalid TOTP code');
      }
    }

    // 2. Device binding for Field Agent app specifically
    if (staff.role === 'field_agent') {
      const incomingDeviceId = loginDto.deviceId?.trim();
      if (!staff.registeredDeviceId) {
        // First login from this field agent registers the device identifier
        if (incomingDeviceId) {
          await this.prisma.staff.update({
            where: { id: staff.id },
            data: { registeredDeviceId: incomingDeviceId },
          });
          staff.registeredDeviceId = incomingDeviceId;
        }
      } else if (
        incomingDeviceId &&
        incomingDeviceId !== staff.registeredDeviceId
      ) {
        // Unrecognized device on an account that already has one: requires step-up TOTP code
        if (!loginDto.stepUpTotpCode) {
          throw new UnauthorizedException(
            'Unrecognized device requires step-up TOTP verification',
          );
        }
        if (
          !staff.totpSecret ||
          !this.totpService.verify(
            loginDto.stepUpTotpCode,
            staff.totpSecret,
          )
        ) {
          throw new UnauthorizedException('Invalid step-up TOTP code');
        }
      }
    }

    // 3. Short-lived access token with a recorded, revocable session
    const sessionDurationMs = 15 * 60 * 1000; // 15 minutes
    const expiresAt = new Date(Date.now() + sessionDurationMs);

    const session = await this.prisma.staffSession.create({
      data: {
        staffId: staff.id,
        deviceId: loginDto.deviceId?.trim() || null,
        ipAddress: metadata?.ip || null,
        userAgent: metadata?.userAgent || null,
        expiresAt,
      },
    });

    const payload: JwtPayload = {
      sub: staff.id,
      role: staff.role,
      email: staff.email,
      code: staff.code,
      area: staff.area,
      teamLeadId: staff.teamLeadId,
      sid: session.id,
      ...(totpEnrolled ? {} : { scope: 'totp_setup' as const }),
    };

    const accessToken = await this.jwtService.signAsync(payload, {
      expiresIn: '15m',
    });

    return {
      accessToken,
      sessionId: session.id,
      ...(totpEnrolled ? {} : { totpEnrollmentRequired: true }),
      staff: {
        id: staff.id,
        code: staff.code,
        name: staff.name,
        email: staff.email,
        role: staff.role,
        area: staff.area,
      },
    };
  }

  async verifyToken(token: string): Promise<JwtPayload> {
    try {
      return await this.jwtService.verifyAsync<JwtPayload>(token);
    } catch {
      throw new UnauthorizedException('Invalid or expired token');
    }
  }

  // --- TOTP 2FA Setup & Activation ---

  async setupTotp(
    staffId: string,
  ): Promise<{ secret: string; otpauthUrl: string }> {
    const staff = await this.prisma.staff.findUnique({
      where: { id: staffId },
    });
    if (!staff) {
      throw new NotFoundException('Staff account not found');
    }

    // Re-running setup on an enrolled account would switch 2FA off (the new
    // secret starts disabled), so a stolen session could silently downgrade it.
    if (staff.totpEnabled) {
      throw new ConflictException('TOTP is already enabled for this account');
    }

    const { secret, otpauthUrl } = this.totpService.generateSetup(staff.email);

    // Save pending secret (not yet enabled until verified)
    await this.prisma.staff.update({
      where: { id: staffId },
      data: {
        totpSecret: secret,
        totpEnabled: false,
      },
    });

    return { secret, otpauthUrl };
  }

  async enableTotp(
    staffId: string,
    totpCode: string,
  ): Promise<{ success: boolean; message: string }> {
    const staff = await this.prisma.staff.findUnique({
      where: { id: staffId },
    });
    if (!staff) {
      throw new NotFoundException('Staff account not found');
    }

    if (!staff.totpSecret) {
      throw new BadRequestException('TOTP setup has not been initiated');
    }

    const isValid = this.totpService.verify(totpCode, staff.totpSecret);
    if (!isValid) {
      throw new UnauthorizedException('Invalid TOTP verification code');
    }

    await this.prisma.staff.update({
      where: { id: staffId },
      data: { totpEnabled: true },
    });

    if (this.auditService) {
      await this.auditService.log({
        actorId: staff.id,
        action: 'staff.2fa_enabled',
        entityType: 'staff',
        entityCode: staff.code,
        before: { totpEnabled: false },
        after: { totpEnabled: true },
      });
    }

    return { success: true, message: 'TOTP 2FA enabled successfully' };
  }

  // --- Session Listing & Immediate Revocation ---

  async listSessions(
    targetStaffId: string,
    currentSessionId?: string,
  ): Promise<StaffSessionView[]> {
    const sessions = await this.prisma.staffSession.findMany({
      where: {
        staffId: targetStaffId,
        revokedAt: null,
      },
      orderBy: { createdAt: 'desc' },
    });

    return sessions.map((s) => ({
      id: s.id,
      deviceId: s.deviceId,
      ipAddress: s.ipAddress,
      userAgent: s.userAgent,
      createdAt: s.createdAt,
      expiresAt: s.expiresAt,
      isCurrent: s.id === currentSessionId,
    }));
  }

  /**
   * Immediately invalidates every live session of a staff member. Uses the same
   * `revokedAt` mechanism that JwtStrategy checks on every request, so staff
   * deactivation and manual session revocation share one "kick out" path.
   */
  async revokeAllSessionsForStaff(staffId: string): Promise<number> {
    const result = await this.prisma.staffSession.updateMany({
      where: { staffId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    return result.count;
  }

  async revokeSession(
    sessionId: string,
    actor: JwtPayload,
  ): Promise<{ success: boolean; message: string }> {
    const session = await this.prisma.staffSession.findUnique({
      where: { id: sessionId },
    });
    if (!session) {
      throw new NotFoundException('Session not found');
    }

    // A user can revoke their own session; CEO/Manager can revoke anyone's session
    const isSelf = session.staffId === actor.sub;
    const isPrivileged = actor.role === 'ceo' || actor.role === 'manager';
    if (!isSelf && !isPrivileged) {
      throw new ForbiddenException(
        'Cannot revoke sessions belonging to other staff members',
      );
    }

    if (session.revokedAt) {
      return { success: true, message: 'Session already revoked' };
    }

    await this.prisma.staffSession.update({
      where: { id: sessionId },
      data: { revokedAt: new Date() },
    });

    if (this.auditService) {
      await this.auditService.log({
        actorId: actor.sub,
        action: 'staff.session_revoked',
        entityType: 'staff_session',
        entityCode: sessionId,
        before: { revokedAt: null },
        after: { revokedAt: new Date().toISOString() },
      });
    }

    return { success: true, message: 'Session revoked successfully' };
  }
}
