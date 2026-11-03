import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { Staff } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { TotpService } from './totp.service';
import {
  AwaitingCodeResponseDto,
  LoginDto,
  LoginResponseDto,
  LoginResult,
} from './dto/login.dto';
import { JwtPayload } from './jwt-payload.interface';
import { LoginCodeService } from '../../modules/login-code/login-code.service';
import { isOddHourIst } from '../../modules/login-code/login-code.crypto';
import { OfficeNetworkService } from '../../modules/office-network/office-network.service';
import { ReviewFlagService } from '../../modules/review-flag/review-flag.service';

export interface StaffSessionView {
  id: string;
  deviceId: string | null;
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: Date;
  expiresAt: Date;
  isCurrent: boolean;
}

/** Matches the access-token lifetime on JwtModule until Task 5 owns session length. */
const ACCESS_SESSION_MS = 15 * 60 * 1000;

const MANAGEMENT_ROLES = ['ceo', 'manager', 'finance'] as const;
const LOGIN_CODE_ROLES = ['team_lead', 'call_agent', 'field_agent'] as const;

const INVALID_CREDENTIALS = 'Invalid staff code or password';

export interface LoginMetadata {
  ip?: string;
  userAgent?: string;
}

@Injectable()
export class AuthClock {
  now(): Date {
    return new Date();
  }
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly totpService: TotpService,
    private readonly auditService: AuditService,
    private readonly loginCodeService: LoginCodeService,
    private readonly officeNetworkService: OfficeNetworkService,
    private readonly reviewFlagService: ReviewFlagService,
    private readonly clock: AuthClock,
  ) {}

  async hashPassword(password: string): Promise<string> {
    const saltRounds = 10;
    return bcrypt.hash(password, saltRounds);
  }

  async verifyPassword(password: string, hash: string): Promise<boolean> {
    return bcrypt.compare(password, hash);
  }

  async login(loginDto: LoginDto, metadata?: LoginMetadata): Promise<LoginResult> {
    if (loginDto.email && !loginDto.staffCode?.trim()) {
      await this.auditAttempt('login', 'unknown', 'auth.login.refused', {
        reason: 'email_not_identifier',
      });
      throw new UnauthorizedException('Email is not a login identifier');
    }

    const staffCode = loginDto.staffCode?.trim() ?? '';
    const password = loginDto.password ?? '';
    if (!staffCode || !password) {
      await this.auditAttempt('login', 'unknown', 'auth.login.refused', {
        reason: 'invalid_credentials',
      });
      throw new UnauthorizedException(INVALID_CREDENTIALS);
    }

    const staff = await this.prisma.staff.findFirst({
      where: { code: { equals: staffCode, mode: 'insensitive' } },
    });
    const passwordOk = staff
      ? await this.verifyPassword(password, staff.passwordHash)
      : false;
    if (!staff || !passwordOk) {
      await this.auditAttempt(staff?.id ?? 'login', staff?.code ?? 'unknown', 'auth.login.refused', {
        reason: 'invalid_credentials',
      });
      throw new UnauthorizedException(INVALID_CREDENTIALS);
    }

    if (staff.status !== 'active') {
      await this.auditAttempt(staff.id, staff.code, 'auth.login.refused', {
        reason: 'account_not_active',
      });
      throw new UnauthorizedException('Account is not active');
    }

    const deviceId = loginDto.deviceId?.trim() ?? '';
    if (!deviceId) {
      await this.auditAttempt(staff.id, staff.code, 'auth.login.refused', {
        reason: 'device_required',
      });
      throw new UnauthorizedException('A device id is required');
    }

    const management = (MANAGEMENT_ROLES as readonly string[]).includes(staff.role);
    const device = await this.prisma.staffDevice.findUnique({
      where: { staffId_deviceId: { staffId: staff.id, deviceId } },
    });

    if (!management) {
      if (!device || device.status !== 'approved') {
        await this.ensurePendingDevice(staff.id, deviceId);
        await this.auditAttempt(staff.id, staff.code, 'auth.login.refused', {
          reason: 'device_pending',
        });
        throw new UnauthorizedException(
          'This device is waiting for approval by your Team Lead',
        );
      }
    }

    if (staff.worksFromOffice) {
      const onOffice = await this.officeNetworkService.isOnOfficeNetwork(metadata?.ip ?? '');
      if (!onOffice) {
        await this.auditAttempt(staff.id, staff.code, 'auth.login.refused', {
          reason: 'off_office_network',
        });
        throw new UnauthorizedException('Login is only allowed from the office network');
      }
    }

    if (management) {
      return this.completeManagementLogin(staff, deviceId, device?.status, loginDto.totpCode, metadata);
    }

    if (!(LOGIN_CODE_ROLES as readonly string[]).includes(staff.role)) {
      await this.auditAttempt(staff.id, staff.code, 'auth.login.refused', { reason: 'role_not_allowed' });
      throw new UnauthorizedException('This account cannot log in');
    }

    const onOfficeNetwork = await this.officeNetworkService.isOnOfficeNetwork(metadata?.ip ?? '');
    const request = await this.loginCodeService.create(
      staff.id,
      device!.id,
      metadata?.ip ?? '',
      onOfficeNetwork,
    );
    await this.auditAttempt(staff.id, staff.code, 'auth.login.awaiting_code', {
      loginRequestId: request.id,
    });
    const awaiting: AwaitingCodeResponseDto = {
      status: 'awaiting_code',
      loginRequestId: request.id,
      expiresAt: request.expiresAt,
    };
    return awaiting;
  }

  async verifyLoginCode(
    loginRequestId: string | undefined,
    code: string | undefined,
    metadata?: LoginMetadata,
  ): Promise<LoginResponseDto> {
    if (!loginRequestId || !code) {
      throw new UnauthorizedException('Login code is not valid');
    }
    let used: { staffId: string; id: string };
    try {
      used = await this.loginCodeService.verify(loginRequestId, code);
    } catch (error) {
      await this.auditAttempt('login', loginRequestId, 'auth.login.refused', {
        reason: 'login_code_rejected',
      });
      throw error;
    }
    const staff = await this.prisma.staff.findUnique({ where: { id: used.staffId } });
    if (!staff || staff.status !== 'active') {
      await this.auditAttempt(staff?.id ?? 'login', staff?.code ?? 'unknown', 'auth.login.refused', {
        reason: 'account_not_active',
      });
      throw new UnauthorizedException('Account is not active');
    }
    if (
      staff.worksFromOffice &&
      !(await this.officeNetworkService.isOnOfficeNetwork(metadata?.ip ?? ''))
    ) {
      await this.auditAttempt(staff.id, staff.code, 'auth.login.refused', {
        reason: 'off_office_network',
      });
      throw new UnauthorizedException('Login is only allowed from the office network');
    }
    const device = await this.prisma.staffDevice.findUnique({
      where: { id: (await this.prisma.loginCodeRequest.findUniqueOrThrow({
        where: { id: used.id },
        select: { staffDeviceId: true },
      })).staffDeviceId },
    });
    return this.issueSession(staff, device?.deviceId ?? null, metadata, used.id);
  }

  async verifyToken(token: string): Promise<JwtPayload> {
    try {
      return await this.jwtService.verifyAsync<JwtPayload>(token);
    } catch {
      throw new UnauthorizedException('Invalid or expired token');
    }
  }

  async setupTotp(staffId: string): Promise<{ secret: string; otpauthUrl: string }> {
    const staff = await this.prisma.staff.findUnique({
      where: { id: staffId },
    });
    if (!staff) {
      throw new NotFoundException('Staff account not found');
    }
    if (!(MANAGEMENT_ROLES as readonly string[]).includes(staff.role)) {
      throw new ForbiddenException(
        'TOTP enrolment is only for the CEO, Managers and Finance',
      );
    }
    if (staff.totpEnabled) {
      throw new ConflictException('TOTP is already enabled for this account');
    }

    const { secret, otpauthUrl } = this.totpService.generateSetup(staff.email ?? staff.code);

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
    sessionId?: string,
  ): Promise<{ success: boolean; message: string }> {
    const staff = await this.prisma.staff.findUnique({
      where: { id: staffId },
    });
    if (!staff) {
      throw new NotFoundException('Staff account not found');
    }
    if (!(MANAGEMENT_ROLES as readonly string[]).includes(staff.role)) {
      throw new ForbiddenException(
        'TOTP enrolment is only for the CEO, Managers and Finance',
      );
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

    if (sessionId) {
      const session = await this.prisma.staffSession.findUnique({ where: { id: sessionId } });
      if (session && session.staffId === staffId && session.deviceId) {
        await this.selfApproveDevice(staff, session.deviceId);
      }
    }

    await this.auditService.log({
      actorId: staff.id,
      action: 'staff.2fa_enabled',
      entityType: 'staff',
      entityCode: staff.code,
      before: { totpEnabled: false },
      after: { totpEnabled: true },
    });

    return { success: true, message: 'TOTP 2FA enabled successfully' };
  }

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

  async revokeAllSessionsForStaff(staffId: string): Promise<number> {
    const result = await this.prisma.staffSession.updateMany({
      where: { staffId, revokedAt: null },
      data: { revokedAt: this.clock.now() },
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

    const revokedAt = this.clock.now();
    await this.prisma.staffSession.update({
      where: { id: sessionId },
      data: { revokedAt },
    });

    await this.auditService.log({
      actorId: actor.sub,
      action: 'staff.session_revoked',
      entityType: 'staff_session',
      entityCode: sessionId,
      before: { revokedAt: null },
      after: { revokedAt: revokedAt.toISOString() },
    });

    return { success: true, message: 'Session revoked successfully' };
  }

  private async completeManagementLogin(
    staff: Staff,
    deviceId: string,
    deviceStatus: string | undefined,
    totpCode: string | undefined,
    metadata?: LoginMetadata,
  ): Promise<LoginResponseDto> {
    const enrolled = !!(staff.totpEnabled && staff.totpSecret);
    if (!enrolled) {
      return this.issueSession(staff, deviceId, metadata, null, true);
    }
    if (!totpCode) {
      await this.auditAttempt(staff.id, staff.code, 'auth.login.refused', { reason: 'totp_required' });
      throw new UnauthorizedException('TOTP 2FA code is required');
    }
    if (!this.totpService.verify(totpCode, staff.totpSecret!)) {
      await this.auditAttempt(staff.id, staff.code, 'auth.login.refused', { reason: 'totp_invalid' });
      throw new UnauthorizedException('Invalid TOTP code');
    }
    if (deviceStatus !== 'approved') {
      await this.selfApproveDevice(staff, deviceId);
    }
    return this.issueSession(staff, deviceId, metadata, null, false);
  }

  private async issueSession(
    staff: Staff,
    deviceId: string | null,
    metadata: LoginMetadata | undefined,
    loginCodeRequestId: string | null,
    totpSetup = false,
  ): Promise<LoginResponseDto> {
    const expiresAt = new Date(this.clock.now().getTime() + ACCESS_SESSION_MS);
    const session = await this.prisma.staffSession.create({
      data: {
        staffId: staff.id,
        deviceId,
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
      ...(totpSetup ? { scope: 'totp_setup' as const } : {}),
    };

    const accessToken = await this.jwtService.signAsync(payload, { expiresIn: '15m' });

    if (!totpSetup) {
      await this.raiseOddHourFlag(staff);
      await this.auditAttempt(staff.id, staff.code, 'auth.login.succeeded', {
        role: staff.role,
        ...(loginCodeRequestId ? { loginRequestId: loginCodeRequestId } : {}),
      });
    } else {
      await this.auditAttempt(staff.id, staff.code, 'auth.login.totp_setup', { role: staff.role });
    }

    return {
      accessToken,
      sessionId: session.id,
      ...(totpSetup ? { totpEnrollmentRequired: true } : {}),
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

  private async raiseOddHourFlag(staff: Staff): Promise<void> {
    if (!isOddHourIst(this.clock.now())) {
      return;
    }
    await this.reviewFlagService.raise({
      kind: 'odd_hour_login',
      subjectType: 'staff',
      subjectId: staff.id,
      raisedForStaffId: staff.id,
      details: { window: 'odd_hours' },
    });
  }

  private async selfApproveDevice(staff: Staff, deviceId: string) {
    const now = this.clock.now();
    const existing = await this.prisma.staffDevice.findUnique({
      where: { staffId_deviceId: { staffId: staff.id, deviceId } },
    });
    const row = existing
      ? await this.prisma.staffDevice.update({
          where: { id: existing.id },
          data: {
            status: 'approved',
            approvedAt: now,
            approvedByStaffId: staff.id,
            revokedAt: null,
            revokedByStaffId: null,
          },
        })
      : await this.prisma.staffDevice.create({
          data: {
            staffId: staff.id,
            deviceId,
            label: 'Login device',
            platform: 'unknown',
            status: 'approved',
            requestedAt: now,
            approvedAt: now,
            approvedByStaffId: staff.id,
          },
        });
    await this.auditService.log({
      actorId: staff.id,
      action: 'staff_device.self_approved_totp',
      entityType: 'staff_device',
      entityCode: row.id,
      after: { status: 'approved', deviceId, method: 'totp' },
    });
    return row;
  }

  private async ensurePendingDevice(staffId: string, deviceId: string) {
    const existing = await this.prisma.staffDevice.findUnique({
      where: { staffId_deviceId: { staffId, deviceId } },
    });
    if (existing && (existing.status === 'pending' || existing.status === 'approved')) {
      return existing;
    }
    const now = this.clock.now();
    if (existing && existing.status === 'revoked') {
      return this.prisma.staffDevice.update({
        where: { id: existing.id },
        data: {
          status: 'pending',
          requestedAt: now,
          approvedAt: null,
          approvedByStaffId: null,
          revokedAt: null,
          revokedByStaffId: null,
        },
      });
    }
    return this.prisma.staffDevice.create({
      data: {
        staffId,
        deviceId,
        label: 'Login device',
        platform: 'unknown',
        status: 'pending',
        requestedAt: now,
      },
    });
  }

  private async auditAttempt(
    actorId: string,
    entityCode: string,
    action: string,
    after: Record<string, unknown>,
  ) {
    await this.auditService.log({
      actorId,
      action,
      entityType: 'staff',
      entityCode,
      after,
    });
  }
}
