import { isStaffAccessToken } from './staff-token';
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  Optional,
  UnauthorizedException,
} from '@nestjs/common';
import { SignInBellsService } from '../../modules/login-code/sign-in-bells.service';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { Prisma, Staff } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { noteRequestDevice } from '../observability/request-context';
import { AuditService } from '../audit/audit.service';
import { TotpService, claimTotpStep } from './totp.service';
import {
  AwaitingCodeResponseDto,
  LoginDto,
  LoginResponseDto,
  LoginResult,
  PasswordResetNotice,
  SetupRequiredResponseDto,
} from './dto/login.dto';
import { AUTHENTICATOR_ROLES, LOGIN_CODE_ROLES } from './sign-in-roles';
import { normaliseTemporaryPassword, SETUP_TICKET_TTL_MS } from './temporary-password';
import { PASSWORD_RULES } from './password-rules';
import { staffPhotoNeeded } from '../../modules/staff/staff-photo.service';
import { JwtPayload } from './jwt-payload.interface';
import { LoginCodeService } from '../../modules/login-code/login-code.service';
import { isOddHourIst, loginCodesMatch, loginRequestProofFor } from '../../modules/login-code/login-code.crypto';
import { ReviewFlagService } from '../../modules/review-flag/review-flag.service';
import { PricingService } from '../../modules/pricing/pricing.service';
import { ReportingScopeService } from '../../modules/staff/reporting-scope.service';
import {
  minutesToMs,
  sessionEndMessage,
} from './session-lifetime';
import { SessionDayService } from './session-day.service';
import { istClockOn } from '../../modules/attendance/staff-shift';
import { appForRole, appLabel, FIELD_APP_ONLY_MESSAGE, isStaffApp, roleAllowedInApp, StaffApp, UNKNOWN_APP_MESSAGE, wrongAppMessage } from './staff-app';

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

/**
 * Only the CEO approves his own new device with his authenticator code. A
 * Manager's or Finance's new device waits for the CEO (decided 11 Nov).
 */
const SELF_APPROVING_DEVICE_ROLES = ['ceo'] as const;
const INVALID_CREDENTIALS = 'Invalid staff code or password';
export const TEMP_PASSWORD_EXPIRED = 'This temporary password has expired. Ask your senior for a new one.';
/**
 * An authenticator role (CEO, Manager, Finance, Team Lead) with a password but
 * no authenticator yet: a password alone never opens a session. They set the
 * authenticator up with a fresh temporary password from a senior.
 */
export const AUTHENTICATOR_NOT_SET_UP =
  'Your authenticator is not set up yet. Ask a senior for a temporary password: you set up the authenticator when you sign in with it.';

export function hashSetupTicket(ticket: string): string {
  return createHash('sha256').update(ticket).digest('hex');
}
export const DEVICE_NO_LONGER_APPROVED = 'This device is no longer approved. Ask your Team Lead to approve it again.';

/**
 * Laboura Field keeps the session on the phone, so closing the app does not
 * log the agent out (guide decision). Field sessions are field agents only.
 * Since 21 Nov every session on a device gets a single-use refresh token, so
 * the apps can renew a 15-minute token that ran out (a laptop asleep, a phone
 * in a pocket) instead of signing out; the office web app keeps it in the
 * tab's sessionStorage, so closing the browser still signs out there.
 */
export const FIELD_SESSION_ROLES: readonly string[] = ['field_agent'];
export const FIELD_SESSION_REFUSED = 'Session not found';

/** Ended reasons after which the next sign-in needs a login code again (decided 21 Nov). */
const CODE_AGAIN_REASONS = ['revoked', 'locked'];

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
  /**
   * The app the sign-in came from (see staff-app.ts): worked out by the
   * controller from the body's `app` and the Laboura Field address.
   */
  app?: { app: StaffApp | null; fieldHost: boolean; invalid: boolean };
}

/** An authenticator code that was already accepted once. */
export const TOTP_REUSED = 'This authenticator code was already used. Wait for the next code in the app and try again.';

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
    private readonly reviewFlagService: ReviewFlagService,
    private readonly pricingService: PricingService,
    private readonly clock: AuthClock,
    private readonly reportingScope: ReportingScopeService,
    private readonly sessionDay: SessionDayService,
    @Optional() private readonly signInBells?: SignInBellsService,
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
    if (metadata?.app?.invalid) {
      await this.auditAttempt('login', 'unknown', 'auth.login.refused', { reason: 'unknown_app' });
      // On the Laboura Field address only Laboura Field signs in.
      if (metadata.app.fieldHost) throw new UnauthorizedException(FIELD_APP_ONLY_MESSAGE);
      throw new BadRequestException(UNKNOWN_APP_MESSAGE);
    }
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
    // First sign-in (or a senior's new temporary password): the temporary
    // password is recognised automatically, in any case, with or without the dash.
    const tempOk = staff && !passwordOk ? await this.temporaryPasswordMatches(staff, password) : false;
    if (staff && tempOk) {
      return this.startSetup(staff, text(loginDto.deviceId).trim(), metadata);
    }
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
    const authenticator = AUTHENTICATOR_ROLES.includes(staff.role);
    // Authenticator roles have a second factor still to come: the wrong-try
    // count is cleared only once that is right too, so wrong codes lock the
    // account exactly like wrong passwords (5 tries, 15 minutes).
    if (!authenticator) await this.clearFailedLogins(staff.id);

    if (staff.status !== 'active') {
      await this.auditAttempt(staff.id, staff.code, 'auth.login.refused', {
        reason: 'account_not_active',
      });
      throw new UnauthorizedException('Account is not active');
    }

    // Each app accepts only its own roles (owner decision 14 Nov). Checked
    // before any device request, login code request or session is created, so
    // a wrong-app attempt never reaches a senior or ends a session elsewhere.
    const app = this.appFor(staff.role, metadata);
    if (!roleAllowedInApp(staff.role, app)) {
      await this.auditAttempt(staff.id, staff.code, 'auth.login.refused', { reason: 'wrong_app', app, role: staff.role });
      throw new UnauthorizedException(wrongAppMessage(app));
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

    // No office-network rule (owner decision 14 Nov): every login already needs a one-time
    // code from a senior or the authenticator code, so staff log in from any network.

    if (authenticator) {
      return this.completeAuthenticatorLogin(staff, deviceId, device?.status, text(loginDto.totpCode) || undefined, metadata, app);
    }

    if (!LOGIN_CODE_ROLES.includes(staff.role)) {
      await this.auditAttempt(staff.id, staff.code, 'auth.login.refused', { reason: 'role_not_allowed' });
      throw new UnauthorizedException('This account cannot log in');
    }

    if (!device || device.status !== 'approved') {
      await this.ensurePendingDevice(staff.id, deviceId, app);
      await this.auditAttempt(staff.id, staff.code, 'auth.login.refused', {
        reason: 'device_pending',
      });
      throw new UnauthorizedException(await this.devicePendingMessage(staff));
    }

    // A login code once a day (decided 21 Nov): signed in with a code today on
    // this approved device and app, and nothing since asked for a new code.
    if (await this.signedInWithCodeToday(staff, device, app)) {
      return this.issueSession(staff, deviceId, metadata, null, app, 'code_accepted_earlier_today');
    }

    const request = await this.loginCodeService.create(staff.id, device.id, metadata?.ip ?? '', app);
    await this.auditAttempt(staff.id, staff.code, 'auth.login.awaiting_code', {
      loginRequestId: request.id,
    });
    const awaiting: AwaitingCodeResponseDto = {
      status: 'awaiting_code',
      loginRequestId: request.id,
      loginRequestProof: loginRequestProofFor(request.id, deviceId),
      expiresAt: request.expiresAt,
      codeFrom: await this.agentSenior(staff),
    };
    return awaiting;
  }

  /**
   * True when a login code was accepted today (IST) for this person on this
   * device and app, after the device was (last) approved and after any
   * password change, reset, lock, deactivation or session a senior ended
   * (Staff.sessionsRevokedAt). Then the day's later sign-ins on that device
   * need only the password (Master Guide rev 202: the login code is needed
   * once, at the first sign-in of the day).
   */
  private async signedInWithCodeToday(
    staff: Staff,
    device: { deviceId: string; approvedAt: Date | null },
    app: StaffApp,
  ): Promise<boolean> {
    const now = this.clock.now();
    const since = Math.max(
      istClockOn(now, '00:00').getTime(),
      staff.sessionsRevokedAt?.getTime() ?? 0,
      device.approvedAt?.getTime() ?? 0,
    );
    const earlier = await this.prisma.staffSession.findFirst({
      where: {
        staffId: staff.id,
        deviceId: device.deviceId,
        app,
        loginCodeRequestId: { not: null },
        createdAt: { gte: new Date(since), lte: now },
      },
      select: { id: true },
    });
    return Boolean(earlier);
  }

  /**
   * Whose approval a new device waits for: an agent's Team Lead; an owner
   * agent account that reports straight to a CEO, the CEO (rev 174–175).
   */
  private async devicePendingMessage(staff: Staff): Promise<string> {
    if ((await this.agentSenior(staff)) === 'ceo') return 'This device is waiting for approval by the CEO';
    return 'This device is waiting for approval by your Team Lead';
  }

  /** Who an agent asks for device approval and login codes: their Team Lead, or a CEO for an owner account under a CEO. */
  private async agentSenior(staff: Staff): Promise<'team_lead' | 'ceo'> {
    if (staff.reportsToId && !staff.teamLeadId) {
      const boss = await this.prisma.staff.findUnique({ where: { id: staff.reportsToId }, select: { role: true } });
      if (boss?.role === 'ceo') return 'ceo';
    }
    return 'team_lead';
  }

  /** True when the password is this account's temporary password (expired or not). */
  private async temporaryPasswordMatches(staff: Staff, password: string): Promise<boolean> {
    if (!staff.tempPasswordHash) return false;
    const normalised = normaliseTemporaryPassword(password);
    if (!normalised) return false;
    return this.verifyPassword(normalised, staff.tempPasswordHash);
  }

  /**
   * Staff code + temporary password (rev 174–175, rule 3): no session. A
   * 10–15 minute set-up ticket bound to this device opens the set-up steps
   * (selfie, new password twice, authenticator for authenticator roles).
   * A lock a senior placed stays; an expired temporary password is refused;
   * each app still accepts only its own roles.
   */
  private async startSetup(staff: Staff, deviceId: string, metadata?: LoginMetadata): Promise<SetupRequiredResponseDto> {
    await this.rejectIfLocked(staff);
    const now = this.clock.now();
    if (!staff.tempPasswordExpiresAt || staff.tempPasswordExpiresAt.getTime() <= now.getTime()) {
      await this.auditAttempt(staff.id, staff.code, 'auth.login.refused', { reason: 'temp_password_expired' });
      throw new UnauthorizedException(TEMP_PASSWORD_EXPIRED);
    }
    if (staff.status !== 'active' && staff.status !== 'pending_invite') {
      await this.auditAttempt(staff.id, staff.code, 'auth.login.refused', { reason: 'account_not_active' });
      throw new UnauthorizedException('Account is not active');
    }
    const app = this.appFor(staff.role, metadata);
    if (!roleAllowedInApp(staff.role, app)) {
      await this.auditAttempt(staff.id, staff.code, 'auth.login.refused', { reason: 'wrong_app', app, role: staff.role });
      throw new UnauthorizedException(wrongAppMessage(app));
    }
    if (!deviceId) {
      await this.auditAttempt(staff.id, staff.code, 'auth.login.refused', { reason: 'device_required' });
      throw new UnauthorizedException('A device id is required');
    }
    noteRequestDevice({ staffId: staff.id, deviceId });
    const ticket = randomBytes(32).toString('hex');
    const expiresAt = new Date(now.getTime() + SETUP_TICKET_TTL_MS);
    // Conditional on the temporary password still being the one checked, so a
    // senior's newer temporary password in between wins.
    const updated = await this.prisma.staff.updateMany({
      where: { id: staff.id, tempPasswordHash: staff.tempPasswordHash },
      data: {
        setupTicketHash: hashSetupTicket(ticket),
        setupTicketDeviceId: deviceId,
        setupTicketExpiresAt: expiresAt,
        // A new ticket has all 5 authenticator tries; wrong passwords and
        // codes on the account are cleared only when set-up completes.
        setupTicketWrongCodes: 0,
      },
    });
    if (updated.count !== 1) {
      throw new UnauthorizedException(INVALID_CREDENTIALS);
    }
    await this.auditAttempt(staff.id, staff.code, 'auth.login.setup_started', { app, setupExpiresAt: expiresAt.toISOString() });
    const authenticatorRole = AUTHENTICATOR_ROLES.includes(staff.role);
    const enrolled = Boolean(staff.totpEnabled && staff.totpSecret);
    return {
      status: 'setup_required',
      setupTicket: ticket,
      expiresAt,
      staff: { code: staff.code, name: staff.name, role: staff.role },
      photoRequired: staffPhotoNeeded(staff) !== null,
      authenticatorSetupRequired: authenticatorRole && !enrolled,
      authenticatorCodeRequired: authenticatorRole && enrolled,
      passwordRules: { ...PASSWORD_RULES },
      signInAt: staff.role === 'field_agent' ? 'field_app' : 'web',
    };
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
    const app = await this.assertCodeAppAndDevice(loginRequestId, metadata);
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
    const device = await this.prisma.staffDevice.findUnique({
      where: { id: (await this.prisma.loginCodeRequest.findUniqueOrThrow({
        where: { id: used.id },
        select: { staffDeviceId: true },
      })).staffDeviceId },
    });
    noteRequestDevice({ staffId: staff.id, deviceId: device?.deviceId ?? null });
    // The device may have been revoked while the code was being read out.
    if (!device || device.status !== 'approved') {
      await this.auditAttempt(staff.id, staff.code, 'auth.login.refused', { reason: 'device_not_approved' });
      throw new UnauthorizedException(DEVICE_NO_LONGER_APPROVED);
    }
    const sessionApp = app ?? appForRole(staff.role);
    if (!roleAllowedInApp(staff.role, sessionApp)) {
      await this.auditAttempt(staff.id, staff.code, 'auth.login.refused', { reason: 'wrong_app', app: sessionApp, role: staff.role });
      throw new UnauthorizedException(wrongAppMessage(sessionApp));
    }
    return this.issueSession(staff, device.deviceId, metadata, used.id, sessionApp);
  }

  /** The app a sign-in is for: the one it named (or the Laboura Field address), else the role's own. */
  private appFor(role: string, metadata?: LoginMetadata): StaffApp {
    return metadata?.app?.app ?? appForRole(role);
  }

  /**
   * Before a login code is used: the verify call comes from the same app as
   * the sign-in that asked for the code (an unknown app or another app is
   * refused without using up a try), and the device is still approved
   * (a device revoked while the code was read out cannot sign in).
   * Returns the app the code request was made from (null on older requests).
   */
  private async assertCodeAppAndDevice(loginRequestId: string, metadata?: LoginMetadata): Promise<StaffApp | null> {
    const request = await this.prisma.loginCodeRequest.findUnique({
      where: { id: loginRequestId },
      select: { id: true, staffId: true, app: true, staff: { select: { role: true } }, staffDevice: { select: { status: true } } },
    });
    if (!request) return metadata?.app?.app ?? null; // the code check answers "not found" as before
    const asked = metadata?.app;
    const recorded = isStaffApp(request.app) ? request.app : null;
    if (asked?.invalid || (asked?.app && recorded && asked.app !== recorded)) {
      await this.auditService.log({
        actorId: request.staffId,
        action: 'auth.login.refused',
        entityType: 'login_code_request',
        entityCode: request.id,
        after: { reason: 'login_code_other_app' },
      });
      throw new UnauthorizedException('This login code can only be used in the app that asked for it');
    }
    // An older code request (no app recorded) used from a named app: the role must belong there,
    // checked before the code is used so a wrong-app attempt never spends it.
    const app = recorded ?? asked?.app ?? null;
    if (app && request.staff && !roleAllowedInApp(request.staff.role, app)) {
      await this.auditService.log({
        actorId: request.staffId,
        action: 'auth.login.refused',
        entityType: 'login_code_request',
        entityCode: request.id,
        after: { reason: 'wrong_app', app, role: request.staff.role },
      });
      throw new UnauthorizedException(wrongAppMessage(app));
    }
    if (request.staffDevice?.status !== 'approved') {
      await this.auditService.log({
        actorId: request.staffId,
        action: 'auth.login.refused',
        entityType: 'login_code_request',
        entityCode: request.id,
        after: { reason: 'device_not_approved' },
      });
      throw new UnauthorizedException(DEVICE_NO_LONGER_APPROVED);
    }
    return app;
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

  /** A staff access token only: any scoped, customer or otherwise foreign token is refused like a bad one. */
  async verifyToken(token: string): Promise<JwtPayload> {
    let payload: unknown;
    try {
      payload = await this.jwtService.verifyAsync<JwtPayload>(token);
    } catch {
      throw new UnauthorizedException('Invalid or expired token');
    }
    if (!isStaffAccessToken(payload)) throw new UnauthorizedException('Invalid or expired token');
    return payload as JwtPayload;
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
    const now = this.clock.now();
    const result = await this.prisma.staffSession.updateMany({
      where: { staffId, revokedAt: null },
      data: { revokedAt: now, endedReason },
    });
    // A password change or reset, a lock or a deactivation: the next sign-in needs a login code again.
    if (CODE_AGAIN_REASONS.includes(endedReason)) {
      await this.prisma.staff.update({ where: { id: staffId }, data: { sessionsRevokedAt: now } });
    }
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
   * session's own limits still decide: while the person's attendance day is
   * open on that approved device it lasts the working day (decided 21 Nov,
   * SessionDayService); otherwise 1 hour without activity and 2 hours after
   * login (PricingPolicy idleLogoutMinutes / maxSessionMinutes). A refresh is
   * not activity, so it never moves the idle clock. The refresh token is
   * single use: each refresh hands out the next one.
   */
  async refreshFieldSession(input: FieldRefreshInput): Promise<FieldRefreshResult> {
    return this.refreshSession(input, 'field');
  }

  /**
   * The same for the office web app (POST /auth/session/refresh, decided
   * 21 Nov): the tab renews a token that ran out (laptop asleep) before it
   * would sign the person out. Office sessions only.
   */
  async refreshOfficeSession(input: FieldRefreshInput): Promise<FieldRefreshResult> {
    return this.refreshSession(input, 'office');
  }

  private async refreshSession(input: FieldRefreshInput, app: StaffApp): Promise<FieldRefreshResult> {
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
    const sessionApp = session ? (isStaffApp(session.app) ? session.app : appForRole(session.staff.role)) : null;
    if (
      !session ||
      !session.tokenHash ||
      !sameHash(session.tokenHash, presented) ||
      session.deviceId !== deviceId ||
      sessionApp !== app ||
      !roleAllowedInApp(session.staff.role, app) ||
      (app === 'field' && !FIELD_SESSION_ROLES.includes(session.staff.role))
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
    const end = await this.sessionDay.endFor(session, now);
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
        app,
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
    // Ended by a senior: the next sign-in needs a login code again (decided 21 Nov).
    await this.prisma.staff.update({ where: { id: session.staffId }, data: { sessionsRevokedAt: revokedAt } });

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

  private async completeAuthenticatorLogin(
    staff: Staff,
    deviceId: string,
    deviceStatus: string | undefined,
    totpCode: string | undefined,
    metadata?: LoginMetadata,
    app: StaffApp = 'office',
  ): Promise<LoginResponseDto> {
    const enrolled = !!(staff.totpEnabled && staff.totpSecret);
    if (!enrolled) {
      // A password alone never opens a session: the authenticator is set up
      // inside the first-login set-up, with a temporary password (rev 174–175).
      await this.auditAttempt(staff.id, staff.code, 'auth.login.refused', { reason: 'authenticator_not_set_up' });
      throw new UnauthorizedException({ message: AUTHENTICATOR_NOT_SET_UP, reason: 'authenticator_not_set_up' });
    }
    if (!totpCode) {
      await this.auditAttempt(staff.id, staff.code, 'auth.login.refused', { reason: 'totp_required' });
      throw new UnauthorizedException('TOTP 2FA code is required');
    }
    const step = this.totpService.verifyStep(totpCode, staff.totpSecret!);
    if (step === null) {
      // Counted on the account like a wrong password: 5 wrong codes lock it.
      const lockedUntil = await this.recordFailedPassword(staff, 'totp_invalid');
      if (lockedUntil) {
        throw new UnauthorizedException(this.lockedMessage({ lockedUntil, lockedByStaffId: null }));
      }
      throw new UnauthorizedException('Invalid TOTP code');
    }
    // A code works once (security check L9): a replayed code inside its 30 seconds
    // is refused and counted like a wrong one.
    if (!(await claimTotpStep(this.prisma, staff.id, step))) {
      const lockedUntil = await this.recordFailedPassword(staff, 'totp_reused');
      if (lockedUntil) {
        throw new UnauthorizedException(this.lockedMessage({ lockedUntil, lockedByStaffId: null }));
      }
      throw new UnauthorizedException(TOTP_REUSED);
    }
    await this.clearFailedLogins(staff.id);
    if (deviceStatus !== 'approved') {
      if (!this.selfApprovesDevice(staff)) {
        await this.ensurePendingDevice(staff.id, deviceId, app);
        await this.auditAttempt(staff.id, staff.code, 'auth.login.refused', {
          reason: 'device_pending',
        });
        // A Team Lead's device is approved by a Manager or the CEO; a Manager's
        // or Finance's by the CEO (StaffDeviceService.assertCanDecide).
        throw new UnauthorizedException(
          staff.role === 'team_lead'
            ? 'This device is waiting for approval by a Manager or the CEO'
            : 'This device is waiting for approval by the CEO',
        );
      }
      await this.selfApproveDevice(staff, deviceId);
    }
    return this.issueSession(staff, deviceId, metadata, null, app);
  }

  /**
   * A wrong authenticator code outside the sign-in itself (first-login set-up,
   * password reset): counted on the account like a wrong password. Returns
   * the lock end when it locked the account.
   */
  async countWrongSecondFactor(staff: Staff, reason: 'totp_invalid' | 'totp_reused'): Promise<Date | null> {
    return this.recordFailedPassword(staff, reason);
  }

  /** Refuses (401) while the account is locked; an expired wrong-try lock is cleared first. */
  async assertNotLocked(staff: Staff): Promise<void> {
    await this.rejectIfLocked(staff);
  }

  private selfApprovesDevice(staff: Staff): boolean {
    return (SELF_APPROVING_DEVICE_ROLES as readonly string[]).includes(staff.role);
  }

  private async issueSession(
    staff: Staff,
    deviceId: string | null,
    metadata: LoginMetadata | undefined,
    loginCodeRequestId: string | null,
    app: StaffApp = appForRole(staff.role),
    /** Set when an agent signed in without a login code because one was accepted earlier today. */
    withoutCode: 'code_accepted_earlier_today' | null = null,
  ): Promise<LoginResponseDto> {
    const now = this.clock.now();
    const policy = await this.pricingService.current();
    const expiresAt = new Date(now.getTime() + ACCESS_SESSION_MS);
    const absoluteExpiresAt = new Date(now.getTime() + minutesToMs(policy.maxSessionMinutes));
    await this.endOpenSessions(staff.id, 'replaced');
    // Every session on a device can be renewed with a single-use refresh token (decided 21 Nov).
    const refreshToken = deviceId ? randomBytes(32).toString('hex') : null;
    const session = await this.prisma.staffSession.create({
      data: {
        staffId: staff.id,
        tokenHash: refreshToken ? hashRefreshToken(refreshToken) : null,
        app,
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
      app,
    };

    const accessToken = await this.jwtService.signAsync(payload, { expiresIn: '15m' });

    await this.raiseOddHourFlag(staff);
    await this.auditAttempt(staff.id, staff.code, 'auth.login.succeeded', {
      role: staff.role,
      ...(loginCodeRequestId ? { loginRequestId: loginCodeRequestId } : {}),
      ...(withoutCode ? { withoutCode } : {}),
    });
    const passwordResetNotice = await this.takePasswordResetNotice(staff);

    return {
      accessToken,
      sessionId: session.id,
      ...(refreshToken ? { refreshToken } : {}),
      ...(passwordResetNotice ? { passwordResetNotice } : {}),
      staff: {
        id: staff.id,
        code: staff.code,
        name: staff.name,
        email: staff.email,
        role: staff.role,
      },
    };
  }

  /**
   * The notice shown once at the first sign-in after a password reset
   * ("Your password was reset on … approved by …"), then cleared.
   */
  private async takePasswordResetNotice(staff: Staff): Promise<PasswordResetNotice | null> {
    const raw = staff.passwordResetNotice as unknown;
    if (!raw || typeof raw !== 'object') return null;
    const taken = await this.prisma.staff.updateMany({
      where: { id: staff.id, passwordResetNotice: { not: Prisma.AnyNull } },
      data: { passwordResetNotice: Prisma.DbNull },
    });
    if (taken.count !== 1) return null;
    const notice = raw as Partial<PasswordResetNotice>;
    return {
      at: typeof notice.at === 'string' ? notice.at : '',
      byName: typeof notice.byName === 'string' ? notice.byName : null,
      byRole: typeof notice.byRole === 'string' ? notice.byRole : null,
      how: typeof notice.how === 'string' ? notice.how : 'temp_password',
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

  /** Records (or reopens) the device approval request and rings the approvers' bell (decided 21 Nov). */
  private async ensurePendingDevice(staffId: string, deviceId: string, app: StaffApp) {
    const row = await this.pendingDeviceRow(staffId, deviceId, app);
    if (row.status === 'pending') await this.signInBells?.syncDevice(row.id, this.clock.now());
    return row;
  }

  private async pendingDeviceRow(staffId: string, deviceId: string, app: StaffApp) {
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
          app,
          label: appLabel(app),
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
        label: appLabel(app),
        app,
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
    const end = await this.sessionDay.endFor(session, now);
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
      ...(actor.app ? { app: actor.app } : {}),
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
    reason: 'invalid_credentials' | 'totp_invalid' | 'totp_reused' = 'invalid_credentials',
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
