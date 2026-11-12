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
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { Staff } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { noteRequestDevice } from '../observability/request-context';
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
import { isOddHourIst, loginCodesMatch, loginRequestProofFor } from '../../modules/login-code/login-code.crypto';
import { OfficeNetworkService } from '../../modules/office-network/office-network.service';
import { ReviewFlagService } from '../../modules/review-flag/review-flag.service';
import { PricingService } from '../../modules/pricing/pricing.service';
import { ReportingScopeService } from '../../modules/staff/reporting-scope.service';
import {
  minutesToMs,
  sessionEndMessage,
  sessionLifetimeEnd,
} from './session-lifetime';

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
/**
 * Only the CEO approves his own new device with his authenticator code. A
 * Manager's or Finance's new device waits for the CEO (decided 11 Nov).
 */
const SELF_APPROVING_DEVICE_ROLES = ['ceo'] as const;
const LOGIN_CODE_ROLES = ['team_lead', 'call_agent', 'field_agent'] as const;

const INVALID_CREDENTIALS = 'Invalid staff code or password';

/**
 * Laboura Field keeps the session on the phone, so closing the app does not
 * log the agent out (guide decision). Only field agents get a refresh token;
 * office sessions keep ending when the browser closes.
 */
export const FIELD_SESSION_ROLES: readonly string[] = ['field_agent'];
export const FIELD_SESSION_REFUSED = 'Session not found';

export function hashRefreshToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function sameHash(a: string, b: string): boolean {
  const left = Buffer.from(a, 'hex');
  const right = Buffer.from(b, 'hex');
  return left.length === right.length && timingSafeEqual(left, right);
}

export interface FieldRefreshInput {
  sessionId?: string;
  refreshToken?: string;
  deviceId?: string;
}

export interface FieldRefreshResult {
  accessToken: string;
  refreshToken: string;
  sessionId: string;
}

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
    private readonly pricingService: PricingService,
    private readonly clock: AuthClock,
    private readonly reportingScope: ReportingScopeService,
  ) {}

  /**
   * Whose sessions the actor may see and end: their own; the CEO anyone's;
   * a Manager only people in their own reporting tree (Master Guide: a
   * Manager acts only inside their own tree). Everyone else only their own.
   */
  private async assertMaySeeSessionsOf(actor: JwtPayload, staffId: string): Promise<void> {
    if (staffId === actor.sub || actor.role === 'ceo') return;
    if (actor.role === 'manager' && (await this.reportingScope.personIsUnder(actor.sub, staffId))) return;
    throw new ForbiddenException(
      actor.role === 'manager'
        ? 'A Manager can see and end sessions only for staff in their own reporting tree'
        : 'Cannot revoke sessions belonging to other staff members',
    );
  }

  /** GET /staff/sessions: the actor's own, or ?staffId= for the CEO and a Manager (own tree only). */
  async listSessionsFor(actor: JwtPayload, queryStaffId?: string): Promise<StaffSessionView[]> {
    const wanted = queryStaffId?.trim();
    let target = actor.sub;
    // Below Manager a staffId is ignored, as before: they only ever see their own.
    if (wanted && (actor.role === 'ceo' || actor.role === 'manager')) {
      await this.assertMaySeeSessionsOf(actor, wanted);
      target = wanted;
    }
    return this.listSessions(target, actor.sid);
  }

  async hashPassword(password: string): Promise<string> {
    const saltRounds = 10;
    return bcrypt.hash(password, saltRounds);
  }

  async verifyPassword(password: string, hash: string): Promise<boolean> {
    return bcrypt.compare(password, hash);
  }

  async login(loginDto: LoginDto, metadata?: LoginMetadata): Promise<LoginResult> {
    if (loginDto.email && !(typeof loginDto.staffCode === 'string' && loginDto.staffCode.trim())) {
      await this.auditAttempt('login', 'unknown', 'auth.login.refused', {
        reason: 'email_not_identifier',
      });
      throw new UnauthorizedException('Email is not a login identifier');
    }

    // L10: request bodies are not validated globally; a wrong type (for
    // example a number) is treated as missing, not answered with a 500.
    const text = (value: unknown): string => (typeof value === 'string' ? value : '');
    const staffCode = text(loginDto.staffCode).trim();
    const password = text(loginDto.password);
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
      if (staff) {
        await this.rejectIfLocked(staff);
        const lockedUntil = await this.recordFailedPassword(staff);
        if (lockedUntil) {
          throw new UnauthorizedException(
            this.lockedMessage({ lockedUntil, lockedByStaffId: null }),
          );
        }
        throw new UnauthorizedException(INVALID_CREDENTIALS);
      }
      await this.auditAttempt('login', 'unknown', 'auth.login.refused', {
        reason: 'invalid_credentials',
      });
      throw new UnauthorizedException(INVALID_CREDENTIALS);
    }

    await this.rejectIfLocked(staff);
    const management = (MANAGEMENT_ROLES as readonly string[]).includes(staff.role);
    // Management has a second factor still to come (authenticator code): the
    // wrong-try count is cleared only once that is right too, so wrong codes
    // lock the account exactly like wrong passwords (5 tries, 15 minutes).
    if (!management) await this.clearFailedLogins(staff.id);

    if (staff.status !== 'active') {
      await this.auditAttempt(staff.id, staff.code, 'auth.login.refused', {
        reason: 'account_not_active',
      });
      throw new UnauthorizedException('Account is not active');
    }

    const deviceId = text(loginDto.deviceId).trim();
    if (!deviceId) {
      await this.auditAttempt(staff.id, staff.code, 'auth.login.refused', {
        reason: 'device_required',
      });
      throw new UnauthorizedException('A device id is required');
    }
    noteRequestDevice({ staffId: staff.id, deviceId });

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
      return this.completeManagementLogin(staff, deviceId, device?.status, text(loginDto.totpCode) || undefined, metadata);
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
      loginRequestProof: loginRequestProofFor(request.id, deviceId),
      expiresAt: request.expiresAt,
    };
    return awaiting;
  }

  async verifyLoginCode(
    loginRequestId: string | undefined,
    code: string | undefined,
    metadata?: LoginMetadata,
    binding: { deviceId?: string; loginRequestProof?: string } = {},
  ): Promise<LoginResponseDto> {
    if (!loginRequestId || !code || typeof loginRequestId !== 'string' || typeof code !== 'string') {
      throw new UnauthorizedException('Login code is not valid');
    }
    await this.assertSameDeviceAndSignIn(loginRequestId, binding);
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
    await this.rejectIfLocked(staff);
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
    noteRequestDevice({ staffId: staff.id, deviceId: device?.deviceId ?? null });
    return this.issueSession(staff, device?.deviceId ?? null, metadata, used.id);
  }

  /**
   * A login code works only for the device and sign-in that asked for it: the
   * same device id, and the proof that was handed only to that sign-in. A
   * mismatch is refused without counting as a wrong code, so nobody else can
   * use up the person's five tries.
   */
  private async assertSameDeviceAndSignIn(
    loginRequestId: string,
    binding: { deviceId?: string; loginRequestProof?: string },
  ): Promise<void> {
    const request = await this.prisma.loginCodeRequest.findUnique({
      where: { id: loginRequestId },
      select: { id: true, staffId: true, staffDevice: { select: { deviceId: true } } },
    });
    if (!request) return; // the code check answers "not found" as before
    const deviceId = typeof binding.deviceId === 'string' ? binding.deviceId.trim() : '';
    const proof = typeof binding.loginRequestProof === 'string' ? binding.loginRequestProof : '';
    const expectedDevice = request.staffDevice?.deviceId ?? '';
    const sameDevice = Boolean(deviceId) && Boolean(expectedDevice) && deviceId === expectedDevice;
    const sameSignIn = sameDevice && loginCodesMatch(proof, loginRequestProofFor(request.id, expectedDevice));
    if (sameDevice && sameSignIn) return;
    await this.auditService.log({
      actorId: request.staffId,
      action: 'auth.login.refused',
      entityType: 'login_code_request',
      entityCode: request.id,
      after: { reason: sameDevice ? 'login_code_other_sign_in' : 'login_code_other_device' },
    });
    throw new UnauthorizedException('This login code can only be used on the device that asked for it');
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
        if (this.selfApprovesDevice(staff)) {
          await this.selfApproveDevice(staff, session.deviceId);
        } else {
          // Enrolling the authenticator does not approve the device: it is
          // put in front of the CEO, who approves it.
          await this.ensurePendingDevice(staff.id, session.deviceId);
        }
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
    return this.endOpenSessions(staffId, 'revoked');
  }

  async endOpenSessions(staffId: string, endedReason: string): Promise<number> {
    const result = await this.prisma.staffSession.updateMany({
      where: { staffId, revokedAt: null },
      data: { revokedAt: this.clock.now(), endedReason },
    });
    return result.count;
  }

  async refresh(actor: JwtPayload): Promise<{ accessToken: string; sessionId: string }> {
    const session = await this.requireOpenSession(actor);
    const accessToken = await this.signAccessToken(actor, session.id);
    const expiresAt = new Date(this.clock.now().getTime() + ACCESS_SESSION_MS);
    await this.prisma.staffSession.update({
      where: { id: session.id },
      data: { expiresAt },
    });
    return { accessToken, sessionId: session.id };
  }

  /**
   * Laboura Field: a new access token for a session kept on the phone, also
   * after the 15-minute token has run out while the app was closed. The
   * session's own limits still decide: 1 hour without activity and 2 hours
   * after login (PricingPolicy idleLogoutMinutes / maxSessionMinutes). A
   * refresh is not activity, so it never moves the idle clock. The refresh
   * token is single use: each refresh hands out the next one.
   */
  async refreshFieldSession(input: FieldRefreshInput): Promise<FieldRefreshResult> {
    const sessionId = typeof input?.sessionId === 'string' ? input.sessionId.trim() : '';
    const refreshToken = typeof input?.refreshToken === 'string' ? input.refreshToken.trim() : '';
    const deviceId = typeof input?.deviceId === 'string' ? input.deviceId.trim() : '';
    const refuse = (message: string, reason: string) =>
      new UnauthorizedException({ message, reason });
    if (!sessionId || !refreshToken || !deviceId) {
      throw refuse(FIELD_SESSION_REFUSED, 'unknown');
    }
    const session = await this.prisma.staffSession.findUnique({
      where: { id: sessionId },
      include: { staff: true },
    });
    const presented = hashRefreshToken(refreshToken);
    if (
      !session ||
      !session.tokenHash ||
      !sameHash(session.tokenHash, presented) ||
      session.deviceId !== deviceId ||
      !FIELD_SESSION_ROLES.includes(session.staff.role)
    ) {
      throw refuse(FIELD_SESSION_REFUSED, 'unknown');
    }
    noteRequestDevice({ staffId: session.staffId, sessionId: session.id, deviceId });
    if (session.revokedAt || session.endedReason) {
      throw refuse('Session has been revoked', 'revoked');
    }
    const staff = session.staff;
    if (staff.status !== 'active') {
      await this.endSession(session.id, 'revoked');
      throw refuse('Account is not active', 'revoked');
    }
    if (this.isAccountLocked(staff)) {
      await this.endSession(session.id, 'locked');
      throw refuse(this.lockedMessage(staff), 'locked');
    }
    const now = this.clock.now();
    const policy = await this.pricingService.current();
    const end = sessionLifetimeEnd(session, now, policy.idleLogoutMinutes);
    if (end) {
      await this.endSession(session.id, end);
      throw refuse(sessionEndMessage(end), end);
    }

    const next = randomBytes(32).toString('hex');
    // Conditional on the presented token so two refreshes with the same one
    // cannot both succeed.
    const rotated = await this.prisma.staffSession.updateMany({
      where: { id: session.id, tokenHash: session.tokenHash, revokedAt: null },
      data: {
        tokenHash: hashRefreshToken(next),
        expiresAt: new Date(now.getTime() + ACCESS_SESSION_MS),
      },
    });
    if (rotated.count !== 1) {
      throw refuse(FIELD_SESSION_REFUSED, 'unknown');
    }
    const accessToken = await this.signAccessToken(
      {
        sub: staff.id,
        role: staff.role,
        email: staff.email,
        code: staff.code,
        teamLeadId: staff.teamLeadId,
      },
      session.id,
    );
    return { accessToken, refreshToken: next, sessionId: session.id };
  }

  async logout(actor: JwtPayload): Promise<{ success: boolean }> {
    if (actor.sid) {
      await this.endSession(actor.sid, 'logout');
    }
    return { success: true };
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

    await this.assertMaySeeSessionsOf(actor, session.staffId);

    if (session.revokedAt) {
      return { success: true, message: 'Session already revoked' };
    }

    const revokedAt = this.clock.now();
    await this.prisma.staffSession.update({
      where: { id: sessionId },
      data: { revokedAt, endedReason: 'revoked' },
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
      await this.clearFailedLogins(staff.id);
      return this.issueSession(staff, deviceId, metadata, null, true);
    }
    if (!totpCode) {
      await this.auditAttempt(staff.id, staff.code, 'auth.login.refused', { reason: 'totp_required' });
      throw new UnauthorizedException('TOTP 2FA code is required');
    }
    if (!this.totpService.verify(totpCode, staff.totpSecret!)) {
      // Counted on the account like a wrong password: 5 wrong codes lock it.
      const lockedUntil = await this.recordFailedPassword(staff, 'totp_invalid');
      if (lockedUntil) {
        throw new UnauthorizedException(this.lockedMessage({ lockedUntil, lockedByStaffId: null }));
      }
      throw new UnauthorizedException('Invalid TOTP code');
    }
    await this.clearFailedLogins(staff.id);
    if (deviceStatus !== 'approved') {
      if (!this.selfApprovesDevice(staff)) {
        await this.ensurePendingDevice(staff.id, deviceId);
        await this.auditAttempt(staff.id, staff.code, 'auth.login.refused', {
          reason: 'device_pending',
        });
        throw new UnauthorizedException('This device is waiting for approval by the CEO');
      }
      await this.selfApproveDevice(staff, deviceId);
    }
    return this.issueSession(staff, deviceId, metadata, null, false);
  }

  private selfApprovesDevice(staff: Staff): boolean {
    return (SELF_APPROVING_DEVICE_ROLES as readonly string[]).includes(staff.role);
  }

  private async issueSession(
    staff: Staff,
    deviceId: string | null,
    metadata: LoginMetadata | undefined,
    loginCodeRequestId: string | null,
    totpSetup = false,
  ): Promise<LoginResponseDto> {
    const now = this.clock.now();
    const policy = await this.pricingService.current();
    const expiresAt = new Date(now.getTime() + ACCESS_SESSION_MS);
    const absoluteExpiresAt = new Date(now.getTime() + minutesToMs(policy.maxSessionMinutes));
    await this.endOpenSessions(staff.id, 'replaced');
    const refreshToken =
      !totpSetup && deviceId && FIELD_SESSION_ROLES.includes(staff.role)
        ? randomBytes(32).toString('hex')
        : null;
    const session = await this.prisma.staffSession.create({
      data: {
        staffId: staff.id,
        tokenHash: refreshToken ? hashRefreshToken(refreshToken) : null,
        deviceId,
        ipAddress: metadata?.ip || null,
        userAgent: metadata?.userAgent || null,
        expiresAt,
        lastActivityAt: now,
        absoluteExpiresAt,
        loginCodeRequestId,
      },
    });

    const payload: JwtPayload = {
      sub: staff.id,
      role: staff.role,
      email: staff.email,
      code: staff.code,
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
      ...(refreshToken ? { refreshToken } : {}),
      ...(totpSetup ? { totpEnrollmentRequired: true } : {}),
      staff: {
        id: staff.id,
        code: staff.code,
        name: staff.name,
        email: staff.email,
        role: staff.role,
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

  private async requireOpenSession(actor: JwtPayload) {
    if (!actor.sid) {
      throw new UnauthorizedException('Session not found');
    }
    const session = await this.prisma.staffSession.findUnique({
      where: { id: actor.sid },
    });
    if (!session || session.staffId !== actor.sub) {
      throw new UnauthorizedException('Session not found');
    }
    if (session.revokedAt || session.endedReason) {
      throw new UnauthorizedException('Session has been revoked');
    }
    const now = this.clock.now();
    const policy = await this.pricingService.current();
    const end = sessionLifetimeEnd(session, now, policy.idleLogoutMinutes);
    if (end) {
      await this.endSession(session.id, end);
      throw new UnauthorizedException(sessionEndMessage(end));
    }
    return session;
  }

  private async signAccessToken(actor: JwtPayload, sessionId: string): Promise<string> {
    const payload: JwtPayload = {
      sub: actor.sub,
      role: actor.role,
      email: actor.email,
      code: actor.code,
      teamLeadId: actor.teamLeadId,
      sid: sessionId,
      ...(actor.scope ? { scope: actor.scope } : {}),
    };
    return this.jwtService.signAsync(payload, { expiresIn: '15m' });
  }

  private async endSession(sessionId: string, endedReason: string): Promise<void> {
    await this.prisma.staffSession.updateMany({
      where: { id: sessionId, revokedAt: null },
      data: { revokedAt: this.clock.now(), endedReason },
    });
  }

  private async rejectIfLocked(staff: Staff): Promise<void> {
    const current = await this.accountAfterExpiredLock(staff);
    if (!this.isAccountLocked(current)) {
      return;
    }
    await this.auditAttempt(current.id, current.code, 'auth.login.refused', {
      reason: 'account_locked',
      lockedUntil: current.lockedUntil ? current.lockedUntil.toISOString() : null,
    });
    throw new UnauthorizedException(this.lockedMessage(current));
  }

  private async accountAfterExpiredLock(staff: Staff): Promise<Staff> {
    if (staff.lockedByStaffId) {
      return staff;
    }
    if (staff.lockedUntil && staff.lockedUntil.getTime() <= this.clock.now().getTime()) {
      return this.prisma.staff.update({
        where: { id: staff.id },
        data: { lockedUntil: null, failedLoginCount: 0 },
      });
    }
    return staff;
  }

  private isAccountLocked(staff: {
    lockedByStaffId: string | null;
    lockedUntil: Date | null;
  }): boolean {
    if (staff.lockedByStaffId) {
      return true;
    }
    return !!staff.lockedUntil && staff.lockedUntil.getTime() > this.clock.now().getTime();
  }

  private lockedMessage(staff: {
    lockedUntil: Date | null;
    lockedByStaffId: string | null;
  }): string {
    if (staff.lockedByStaffId || !staff.lockedUntil) {
      return 'Account is locked until a Team Lead, Manager or the CEO unlocks it';
    }
    return `Account is locked until ${staff.lockedUntil.toISOString()}`;
  }

  private async clearFailedLogins(staffId: string): Promise<void> {
    await this.prisma.staff.update({
      where: { id: staffId },
      data: { failedLoginCount: 0, lockedUntil: null },
    });
  }

  /** Counts one wrong password (or wrong authenticator code) and locks at the limit. */
  private async recordFailedPassword(
    staff: Staff,
    reason: 'invalid_credentials' | 'totp_invalid' = 'invalid_credentials',
  ): Promise<Date | null> {
    const policy = await this.pricingService.current();
    const updated = await this.prisma.staff.update({
      where: { id: staff.id },
      data: { failedLoginCount: { increment: 1 } },
      select: { failedLoginCount: true },
    });
    const count = updated.failedLoginCount;
    if (count < policy.failedLoginLimit) {
      await this.auditService.log({
        actorId: staff.id,
        action: 'auth.login.refused',
        entityType: 'staff',
        entityCode: staff.code,
        before: { failedLoginCount: count - 1 },
        after: { reason, failedLoginCount: count },
      });
      return null;
    }
    const lockedUntil = new Date(
      this.clock.now().getTime() + minutesToMs(policy.lockoutMinutes),
    );
    await this.prisma.staff.update({
      where: { id: staff.id },
      data: { lockedUntil },
    });
    await this.auditService.log({
      actorId: staff.id,
      action: 'auth.login.refused',
      entityType: 'staff',
      entityCode: staff.code,
      before: { failedLoginCount: count - 1, lockedUntil: null },
      after: {
        reason: 'account_locked',
        lastFailure: reason,
        failedLoginCount: count,
        lockedUntil: lockedUntil.toISOString(),
      },
    });
    return lockedUntil;
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
