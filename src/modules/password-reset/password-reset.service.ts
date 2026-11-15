import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  Optional,
  UnauthorizedException,
} from '@nestjs/common';
import { Prisma, Staff } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import { AuthClock, AuthService, TOTP_REUSED } from '../../common/auth/auth.service';
import { TotpService, claimTotpStep } from '../../common/auth/totp.service';
import { LiveEventsService } from '../../common/live/live-events.service';
import { noteRequestDevice } from '../../common/observability/request-context';
import { OwnTeam, TEAM_AGENT_ROLES } from '../../common/rbac/own-team';
import { AUTHENTICATOR_ROLES } from '../../common/auth/sign-in-roles';
import { passwordRuleProblem } from '../../common/auth/password-rules';
import { roleAllowedInApp, StaffApp, wrongAppMessage } from '../../common/auth/staff-app';
import { loginCodesMatch } from '../login-code/login-code.crypto';
import { ReportingScopeService } from '../staff/reporting-scope.service';
import { StaffPhotoService } from '../staff/staff-photo.service';
import { ResetAftermathService } from '../staff/reset-aftermath.service';
import { ownOwnerAccount } from '../../common/rbac/own-owner-account';
import { resetCodeFor, resetRequestProofFor, standInResetRequestId } from './password-reset.crypto';

/** A request (and, once revealed, its code) lives this long: the code works for 15 minutes after the reveal. */
export const RESET_REQUEST_TTL_MS = 15 * 60 * 1000;
/** Wrong codes before the request dies. */
export const RESET_WRONG_TRIES = 5;
/** Requests per staff code per hour; more are answered the same way and do nothing. */
export const RESET_REQUESTS_PER_HOUR = 3;

/** Longest staff code and device id taken; longer gets the usual answer and nothing else. */
const MAX_STAFF_CODE_LENGTH = 32;
const MAX_DEVICE_ID_LENGTH = 128;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The one answer for a wrong reset code, one not given yet, or a request that does not exist. */
export const RESET_CODE_INVALID = 'The reset code is not right, or your senior has not given it yet.';

/** The one answer to "Forgot password", whether or not the staff code exists. */
export const RESET_REQUESTED_MESSAGE =
  'If that staff code belongs to an active account, your request is now with your seniors. Ask your senior to call you back with the reset code.';

const BELOW_MANAGER = ['team_lead', 'call_agent', 'field_agent'];
const OPEN = ['pending', 'revealed'];

export interface ResetActor {
  id: string;
  role: string;
}

export interface ResetRequestAnswer {
  status: 'requested';
  message: string;
  resetRequestId: string;
  /** Send back with the code and the same device id: only this sign-in page has it. */
  resetRequestProof: string;
  expiresAt: Date;
}

export interface ResetCompleteInput {
  resetRequestId?: unknown;
  resetRequestProof?: unknown;
  deviceId?: unknown;
  code?: unknown;
  newPassword?: unknown;
  confirmPassword?: unknown;
  /** CEO, Manager, Finance, Team Lead: a code from their own authenticator (kept). */
  totpCode?: unknown;
}

const text = (value: unknown): string => (typeof value === 'string' ? value : '');

const staffCard = {
  id: true,
  code: true,
  name: true,
  role: true,
  teamLeadId: true,
  reportsToId: true,
  isOwnerAccount: true,
} as const;


/**
 * "Forgot password" (Master Guide rev 174–175, rules 7, 8 and 10).
 *
 * The person types their staff code on the login page (web or Laboura Field).
 * A PASSWORD RESET request appears as a red card on the code screens of the
 * seniors allowed to approve it: a Team Lead for their own agents; a Manager
 * for people below Manager in their teams; a CEO for anyone — a CEO's reset
 * only by the other CEO, Finance by a CEO; never one's own. The senior calls
 * them back from their own contacts and reveals a 6-digit reset code: single
 * use, 15 minutes, only on the device and sign-in page that asked, with its
 * own HMAC label (never a login code); 5 wrong tries end the request. The
 * person types the code and a new password; authenticator roles also a code
 * from the authenticator they keep. The old password works until then; a
 * lock a senior placed stays. After it: every session ends, approved devices
 * stay, a bell to their boss and the CEO, a notice at their next sign-in, and
 * a full audit trail.
 */
@Injectable()
export class PasswordResetService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly auth: AuthService,
    private readonly totp: TotpService,
    private readonly reportingScope: ReportingScopeService,
    private readonly aftermath: ResetAftermathService,
    private readonly clock: AuthClock,
    @Optional() private readonly photos?: StaffPhotoService,
    @Optional() private readonly live?: LiveEventsService,
  ) {}

  // ---------------------------------------------------------------- the person (public)

  /**
   * Always the same answer, whether the staff code exists or not: a request
   * id, its proof and when it ends. Nothing is made for an unknown, inactive
   * or limited account: the id is a stand-in worked out from the staff code,
   * device and time, so asking again gives the same id and end time, as a
   * real open request does, and about the same work is done. One open request
   * per account (asking again from the same device gives the same one); a
   * request from an approved device of that person replaces one from an
   * unknown device (a stranger cannot block the real person); at most 3 an
   * hour per staff code (from an approved device only its own requests
   * count); the IP limit is on the route.
   */
  async request(rawStaffCode: unknown, rawDeviceId: unknown, app: StaffApp | null, ip: string | null): Promise<ResetRequestAnswer> {
    const staffCode = text(rawStaffCode).trim();
    const deviceId = text(rawDeviceId).trim();
    if (!staffCode || !deviceId) {
      throw new BadRequestException('Type your staff code');
    }
    const now = this.clock.now();
    const answer = (id: string, expiresAt: Date): ResetRequestAnswer => ({
      status: 'requested',
      message: RESET_REQUESTED_MESSAGE,
      resetRequestId: id,
      resetRequestProof: resetRequestProofFor(id, deviceId),
      expiresAt,
    });
    const nothing = () => {
      const standIn = this.standIn(staffCode, deviceId, now);
      return answer(standIn.id, standIn.expiresAt);
    };
    const ignored = async (staff: { id: string; code: string } | null, reason: string, extra: Record<string, unknown> = {}) => {
      await this.audit.log({
        actorId: staff?.id ?? 'login',
        action: 'password_reset.request_ignored',
        entityType: 'staff',
        entityCode: staff?.code ?? 'unknown',
        after: { reason, ...extra, deviceId, ip },
      });
      return nothing();
    };

    if (staffCode.length > MAX_STAFF_CODE_LENGTH || deviceId.length > MAX_DEVICE_ID_LENGTH) {
      // No staff code is that long: the usual answer, and nothing is looked up or kept.
      await this.comparableWork(deviceId.slice(0, MAX_DEVICE_ID_LENGTH));
      return nothing();
    }
    const staff = await this.prisma.staff.findFirst({
      where: { code: { equals: staffCode, mode: 'insensitive' } },
      select: { id: true, code: true, role: true, status: true },
    });
    if (!staff || staff.status !== 'active') {
      await this.comparableWork(deviceId);
      return ignored(staff, staff ? 'account_not_active' : 'unknown_staff_code');
    }
    noteRequestDevice({ staffId: staff.id, deviceId });
    // Each app takes only its own roles: nothing reaches a senior from the wrong app.
    if (app && !roleAllowedInApp(staff.role, app)) {
      await this.comparableWork(deviceId);
      return ignored(staff, 'wrong_app', { app });
    }
    await this.expireOld({ staffId: staff.id });
    const known = await this.prisma.staffDevice.findUnique({
      where: { staffId_deviceId: { staffId: staff.id, deviceId } },
      select: { status: true },
    });
    const approvedDevice = known?.status === 'approved';
    const open = await this.prisma.passwordResetRequest.findFirst({
      where: { staffId: staff.id, status: { in: OPEN } },
      orderBy: { createdAt: 'desc' },
    });
    if (open && open.deviceId === deviceId) return answer(open.id, open.expiresAt);
    if (open && !(approvedDevice && !open.knownDevice)) {
      return ignored(staff, 'open_request', { openRequestId: open.id });
    }
    const lastHour = await this.prisma.passwordResetRequest.count({
      where: {
        staffId: staff.id,
        createdAt: { gt: new Date(now.getTime() - 60 * 60 * 1000) },
        // From an approved device, requests from unknown devices never use up the person's own tries.
        ...(approvedDevice ? { knownDevice: true } : {}),
      },
    });
    if (lastHour >= RESET_REQUESTS_PER_HOUR) {
      return ignored(staff, 'hourly_limit', { lastHour });
    }
    if (open) {
      // The person's own approved device replaces a request from an unknown device.
      const replaced = await this.prisma.passwordResetRequest.updateMany({
        where: { id: open.id, status: { in: OPEN }, knownDevice: false },
        data: { status: 'cancelled' },
      });
      if (replaced.count === 1) {
        await this.audit.log({
          actorId: staff.id,
          action: 'password_reset.replaced',
          entityType: 'password_reset_request',
          entityCode: open.id,
          after: { status: 'cancelled', reason: 'replaced_by_approved_device', openDeviceId: open.deviceId, deviceId, ip },
        });
      }
    }
    let row;
    try {
      row = await this.prisma.passwordResetRequest.create({
        data: {
          staffId: staff.id,
          deviceId,
          knownDevice: approvedDevice,
          app,
          ipAddress: ip,
          status: 'pending',
          createdAt: now,
          expiresAt: new Date(now.getTime() + RESET_REQUEST_TTL_MS),
        },
      });
    } catch (error) {
      // Two requests at once: the database keeps one open request per account.
      if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') throw error;
      const winner = await this.prisma.passwordResetRequest.findFirst({
        where: { staffId: staff.id, status: { in: OPEN } },
        orderBy: { createdAt: 'desc' },
      });
      if (winner && winner.deviceId === deviceId) return answer(winner.id, winner.expiresAt);
      return ignored(staff, 'open_request', { openRequestId: winner?.id ?? null });
    }
    await this.audit.log({
      actorId: staff.id,
      action: 'password_reset.requested',
      entityType: 'password_reset_request',
      entityCode: row.id,
      after: { staffCode: staff.code, deviceId, knownDevice: row.knownDevice, app, ip },
    });
    return answer(row.id, row.expiresAt);
  }

  /**
   * The stand-in answer: its id and end time both come from the staff code,
   * the device and the 15-minute window, so asking again (even after a
   * restart) gives the same id and the same end time, with nothing kept.
   */
  private standIn(staffCode: string, deviceId: string, now: Date): { id: string; expiresAt: Date } {
    const windowStart = Math.floor(now.getTime() / RESET_REQUEST_TTL_MS) * RESET_REQUEST_TTL_MS;
    return { id: standInResetRequestId(staffCode, deviceId, windowStart), expiresAt: new Date(windowStart + RESET_REQUEST_TTL_MS) };
  }

  /** About the same database work as a real request, so the answer time says nothing either. */
  private async comparableWork(deviceId: string): Promise<void> {
    const nobody = '00000000-0000-4000-8000-000000000000';
    await this.prisma.passwordResetRequest.updateMany({
      where: { staffId: nobody, status: { in: OPEN }, expiresAt: { lte: this.clock.now() } },
      data: { status: 'expired' },
    });
    await this.prisma.staffDevice.findFirst({ where: { staffId: nobody, deviceId }, select: { status: true } });
    await this.prisma.passwordResetRequest.findFirst({ where: { staffId: nobody, status: { in: OPEN } } });
    await this.prisma.passwordResetRequest.count({ where: { staffId: nobody, createdAt: { gt: new Date(this.clock.now().getTime() - 60 * 60 * 1000) } } });
  }

  /** The reset code + a new password (+ an authenticator code for authenticator roles). */
  async complete(input: ResetCompleteInput, app: StaffApp | null, ip: string | null): Promise<{ success: true; code: string; signInAt: 'field_app' | 'web' }> {
    const id = text(input?.resetRequestId).trim();
    const deviceId = text(input?.deviceId).trim();
    const proof = text(input?.resetRequestProof);
    const code = text(input?.code).trim();
    const password = text(input?.newPassword);
    // One answer for an unknown request, a code not given yet and a wrong code.
    const invalid = () => new UnauthorizedException({ message: RESET_CODE_INVALID, reason: 'code_invalid' });
    const otherDevice = () => new UnauthorizedException({ message: 'This reset code can only be used on the device that asked for it', reason: 'other_device' });
    const problem = passwordRuleProblem(password);
    if (problem) throw new BadRequestException({ message: problem, reason: 'password_rules' });
    if (input?.confirmPassword !== undefined && text(input.confirmPassword) !== password) {
      throw new BadRequestException({ message: 'The two passwords are not the same.', reason: 'password_mismatch' });
    }
    if (!id || !code || deviceId.length > MAX_DEVICE_ID_LENGTH) throw invalid();
    const request = UUID.test(id) ? await this.prisma.passwordResetRequest.findUnique({ where: { id }, include: { staff: true } }) : null;
    if (!request) {
      // A stand-in id answers like a real one that is not given yet: the same checks, the same work.
      const proofRight = Boolean(deviceId) && loginCodesMatch(proof, resetRequestProofFor(id, deviceId));
      loginCodesMatch(code, resetCodeFor(id));
      if (!proofRight) throw otherDevice();
      throw invalid();
    }
    noteRequestDevice({ staffId: request.staffId, deviceId: deviceId || null });

    // Only the device and sign-in page that asked; a mismatch never uses up a try.
    const sameDevice = Boolean(deviceId) && deviceId === request.deviceId;
    if (!sameDevice || !loginCodesMatch(proof, resetRequestProofFor(request.id, request.deviceId))) {
      await this.audit.log({ actorId: request.staffId, action: 'password_reset.refused', entityType: 'password_reset_request', entityCode: request.id, after: { reason: sameDevice ? 'other_sign_in' : 'other_device', deviceId, ip } });
      throw otherDevice();
    }
    // From here on, everything a stand-in can never be (another app, ended
    // by time, refused, not given yet, a wrong code) gets the stand-in's
    // answer, so none of it says the staff code exists. The page shows
    // "This code has run out, ask again" from the end time it was given.
    const now = this.clock.now();
    const sameAnswer = () => {
      loginCodesMatch(code, resetCodeFor(request.id));
      return invalid();
    };
    if (app && request.app && app !== request.app) {
      await this.audit.log({ actorId: request.staffId, action: 'password_reset.refused', entityType: 'password_reset_request', entityCode: request.id, after: { reason: 'other_app', app, deviceId, ip } });
      throw sameAnswer();
    }
    if (OPEN.includes(request.status) && request.expiresAt.getTime() <= now.getTime()) {
      await this.prisma.passwordResetRequest.updateMany({ where: { id: request.id, status: { in: OPEN } }, data: { status: 'expired' } });
      throw sameAnswer();
    }
    if (request.status === 'used') {
      // Only someone who finished the reset with the right code can see this.
      throw new UnauthorizedException({ message: 'This reset code was already used', reason: 'used' });
    }
    if (request.status !== 'revealed') {
      // Not given yet (no try used), refused, or ended.
      throw sameAnswer();
    }
    // Take a try BEFORE comparing (never more than 5, however many arrive at once); a right code gives it back.
    if (!(await this.takeTry(request.id, now))) throw invalid();
    if (!loginCodesMatch(code, resetCodeFor(request.id))) {
      const after = await this.prisma.passwordResetRequest.findUnique({ where: { id: request.id }, select: { failedAttempts: true } });
      const attempt = after?.failedAttempts ?? RESET_WRONG_TRIES;
      const dead = attempt >= RESET_WRONG_TRIES;
      if (dead) await this.endRequest(request.id, 'too_many_wrong_codes', now);
      await this.audit.log({ actorId: request.staffId, action: 'password_reset.wrong_code', entityType: 'password_reset_request', entityCode: request.id, after: { attempt, ended: dead, deviceId, ip } });
      throw invalid();
    }
    await this.giveTryBack(request.id);

    const staff = request.staff;
    if (staff.status !== 'active') {
      throw new UnauthorizedException({ message: 'Account is not active', reason: 'account_not_active' });
    }
    // Only a lock a senior placed stops a reset (and ends the request). A
    // wrong-password lock from the login page (anyone who knows a staff code
    // can cause one) does not; the new password clears it.
    if (staff.lockedByStaffId) {
      await this.endRequest(request.id, 'account_locked', now);
      throw new UnauthorizedException({ message: 'Account is locked until a Team Lead, Manager or the CEO unlocks it', reason: 'locked' });
    }
    const signInApp = (request.app as StaffApp | null) ?? app;
    if (signInApp && !roleAllowedInApp(staff.role, signInApp)) {
      throw new UnauthorizedException({ message: wrongAppMessage(signInApp), reason: 'wrong_app' });
    }
    // Authenticator roles keep their authenticator and type a code from it too.
    if (AUTHENTICATOR_ROLES.includes(staff.role)) {
      if (!staff.totpEnabled || !staff.totpSecret) {
        throw new UnauthorizedException({
          message: 'You have no authenticator yet. Ask a senior for a temporary password instead.',
          reason: 'authenticator_not_set_up',
        });
      }
      const totpCode = text(input?.totpCode).trim();
      if (!totpCode) {
        throw new BadRequestException({ message: 'Type the 6-digit code from your authenticator app too.', reason: 'totp_required' });
      }
      // Wrong authenticator codes use up the request's tries (5 in all, with
      // wrong reset codes), taken before the check; a right code gives it back.
      if (!(await this.takeTry(request.id, now))) throw invalid();
      const step = this.totp.verifyStep(totpCode, staff.totpSecret);
      if (step === null) {
        await this.wrongAuthenticatorCode(staff, request.id, 'totp_invalid', 'The authenticator code is not right', deviceId, ip, now);
      }
      if (!(await claimTotpStep(this.prisma, staff.id, step!))) {
        await this.wrongAuthenticatorCode(staff, request.id, 'totp_reused', TOTP_REUSED, deviceId, ip, now);
      }
      await this.giveTryBack(request.id);
    }

    const passwordHash = await this.auth.hashPassword(password);
    const approver = request.revealedByStaffId
      ? await this.prisma.staff.findUnique({ where: { id: request.revealedByStaffId }, select: { id: true, name: true, role: true } })
      : null;
    const done = await this.prisma.$transaction(async (tx) => {
      const used = await tx.passwordResetRequest.updateMany({
        where: { id: request.id, status: 'revealed', expiresAt: { gt: now } },
        data: { status: 'used', usedAt: now },
      });
      if (used.count !== 1) return false;
      const updated = await tx.staff.updateMany({
        where: { id: staff.id, status: 'active', lockedByStaffId: null },
        data: {
          passwordHash,
          failedLoginCount: 0,
          lockedUntil: null,
          // A temporary password still waiting is no longer needed.
          tempPasswordHash: null,
          tempPasswordExpiresAt: null,
          tempPasswordIssuedByStaffId: null,
          setupTicketHash: null,
          setupTicketDeviceId: null,
          setupTicketExpiresAt: null,
          passwordResetNotice: this.aftermath.notice(approver, 'senior_code', now),
        },
      });
      if (updated.count !== 1) throw new UnauthorizedException({ message: 'Account is not active', reason: 'account_not_active' });
      await tx.staffPasswordReset.updateMany({
        where: { staffId: staff.id, usedAt: null, cancelledAt: null },
        data: { cancelledAt: now },
      });
      return true;
    });
    if (!done) throw new UnauthorizedException({ message: 'This reset code was already used', reason: 'used' });

    const sessionsEnded = await this.auth.revokeAllSessionsForStaff(staff.id);
    this.live?.recheckSessions(staff.id);
    await this.audit.log({
      actorId: staff.id,
      action: 'staff.password_reset_completed',
      entityType: 'staff',
      entityCode: staff.code,
      after: {
        passwordResetRequestId: request.id,
        how: 'senior_code',
        revealedByStaffId: request.revealedByStaffId,
        deviceId,
        ip,
        sessionsEnded,
      },
    });
    await this.aftermath.ringBells(staff, approver, 'senior_code', request.id, now);
    return { success: true, code: staff.code, signInAt: staff.role === 'field_agent' ? 'field_app' : 'web' };
  }

  /** One of the request's 5 tries, taken before a code is checked; false (and the request ends) when none is left. */
  private async takeTry(requestId: string, now: Date): Promise<boolean> {
    const taken = await this.prisma.passwordResetRequest.updateMany({
      where: { id: requestId, status: 'revealed', failedAttempts: { lt: RESET_WRONG_TRIES } },
      data: { failedAttempts: { increment: 1 } },
    });
    if (taken.count === 1) return true;
    await this.endRequest(requestId, 'too_many_wrong_codes', now);
    return false;
  }

  private async giveTryBack(requestId: string): Promise<void> {
    await this.prisma.passwordResetRequest.updateMany({
      where: { id: requestId, failedAttempts: { gt: 0 } },
      data: { failedAttempts: { decrement: 1 } },
    });
  }

  /**
   * A wrong authenticator code: counted on the request (the try stays used;
   * the 5th wrong try of any kind ends it), not on the account, so it never
   * locks the person out of the login page.
   */
  private async wrongAuthenticatorCode(
    staff: Staff,
    requestId: string,
    reason: 'totp_invalid' | 'totp_reused',
    message: string,
    deviceId: string,
    ip: string | null,
    now: Date,
  ): Promise<never> {
    const after = await this.prisma.passwordResetRequest.findUnique({ where: { id: requestId }, select: { failedAttempts: true } });
    const attempt = after?.failedAttempts ?? RESET_WRONG_TRIES;
    const ended = attempt >= RESET_WRONG_TRIES;
    if (ended) await this.endRequest(requestId, 'too_many_wrong_codes', now);
    await this.audit.log({ actorId: staff.id, action: 'password_reset.wrong_authenticator_code', entityType: 'password_reset_request', entityCode: requestId, after: { reason, attempt, ended, deviceId, ip } });
    if (ended) throw new UnauthorizedException({ message: RESET_CODE_INVALID, reason: 'code_invalid' });
    throw new UnauthorizedException({ message, reason });
  }

  /** Ends an open request for good (too many wrong reset codes, or the account locked). */
  private async endRequest(requestId: string, why: 'too_many_wrong_codes' | 'account_locked', now: Date): Promise<void> {
    const ended = await this.prisma.passwordResetRequest.updateMany({
      where: { id: requestId, status: { in: OPEN } },
      data: { status: 'refused', refusedReason: why, refusedAt: now },
    });
    if (ended.count === 1 && why === 'account_locked') {
      await this.audit.log({ actorId: 'login', action: 'password_reset.ended', entityType: 'password_reset_request', entityCode: requestId, after: { reason: why } });
    }
  }

  // ---------------------------------------------------------------- the seniors (code screens)

  /** The red PASSWORD RESET cards waiting for this senior. */
  async listPending(actor: ResetActor) {
    this.assertApproverRole(actor);
    const scope = await this.scopeWhere(actor);
    await this.expireOld(scope);
    const rows = await this.prisma.passwordResetRequest.findMany({
      where: { ...scope, status: { in: OPEN } },
      orderBy: { createdAt: 'asc' },
      include: { staff: { select: staffCard } },
    });
    await this.audit.log({ actorId: actor.id, action: 'password_reset.pending_listed', entityType: 'password_reset_request', entityCode: 'pending', after: { count: rows.length } });
    const photos = this.photos ? await this.photos.photosFor(rows.map((r) => r.staff.id)) : new Map<string, { photoUrl: string | null }>();
    return rows.map((r) => ({
      id: r.id,
      kind: 'password_reset' as const,
      status: r.status,
      createdAt: r.createdAt,
      expiresAt: r.expiresAt,
      knownDevice: r.knownDevice,
      app: r.app,
      revealedAt: r.revealedAt,
      staff: { id: r.staff.id, code: r.staff.code, name: r.staff.name, role: r.staff.role, photoUrl: photos.get(r.staff.id)?.photoUrl ?? null },
    }));
  }

  /** Reveal the reset code (call them back from your own contacts first). Recorded every time. */
  async reveal(requestId: string, actor: ResetActor) {
    this.assertApproverRole(actor);
    const request = await this.requireRequest(requestId);
    await this.assertMayApprove(actor, request.staff);
    const now = this.clock.now();
    if (OPEN.includes(request.status) && request.expiresAt.getTime() <= now.getTime()) {
      await this.prisma.passwordResetRequest.update({ where: { id: request.id }, data: { status: 'expired' } });
      throw new BadRequestException('This reset request has expired');
    }
    if (!OPEN.includes(request.status)) {
      throw new BadRequestException(`This reset request is ${request.status}`);
    }
    let row = request;
    if (!request.revealedAt) {
      // The code works for 15 minutes from now.
      const claimed = await this.prisma.passwordResetRequest.updateMany({
        where: { id: request.id, status: 'pending' },
        data: { status: 'revealed', revealedAt: now, revealedByStaffId: actor.id, expiresAt: new Date(now.getTime() + RESET_REQUEST_TTL_MS) },
      });
      if (claimed.count === 1) row = await this.requireRequest(request.id);
    }
    await this.audit.log({
      actorId: actor.id,
      action: 'password_reset.revealed',
      entityType: 'password_reset_request',
      entityCode: request.id,
      after: {
        status: 'revealed',
        staffCode: request.staff.code,
        revealedByStaffId: row.revealedByStaffId,
        knownDevice: request.knownDevice,
        ...(ownOwnerAccount(actor.id, request.staff) ? { ownOwnerAccount: true } : {}),
      },
    });
    return { id: row.id, status: row.status, expiresAt: row.expiresAt, revealedAt: row.revealedAt, code: resetCodeFor(row.id) };
  }

  /** Refuse with a reason (for example: could not reach them, or it was not them). */
  async refuse(requestId: string, actor: ResetActor, reason: unknown) {
    this.assertApproverRole(actor);
    const why = text(reason).trim().slice(0, 500);
    if (!why) throw new BadRequestException('A reason is required to refuse a reset');
    const request = await this.requireRequest(requestId);
    await this.assertMayApprove(actor, request.staff);
    if (request.status === 'refused') return { id: request.id, status: request.status };
    if (!OPEN.includes(request.status)) throw new BadRequestException(`This reset request is ${request.status}`);
    const now = this.clock.now();
    await this.prisma.passwordResetRequest.update({
      where: { id: request.id },
      data: { status: 'refused', refusedByStaffId: actor.id, refusedReason: why, refusedAt: now },
    });
    await this.audit.log({
      actorId: actor.id,
      action: 'password_reset.refused',
      entityType: 'password_reset_request',
      entityCode: request.id,
      reason: why,
      after: { status: 'refused', staffCode: request.staff.code },
    });
    return { id: request.id, status: 'refused' };
  }

  /**
   * Who approves whose reset (rule 8): a Team Lead for the agents of their
   * own team; a Manager for people below Manager in their teams; a CEO for
   * anyone else — so a CEO's reset only by the other CEO, Finance and
   * Managers only by a CEO; nobody their own.
   */
  async assertMayApprove(actor: ResetActor, target: { id: string; role: string }): Promise<void> {
    if (actor.id === target.id) throw new ForbiddenException('Nobody approves their own password reset');
    if (actor.role === 'ceo') return;
    if (actor.role === 'manager') {
      if (BELOW_MANAGER.includes(target.role) && (await this.reportingScope.personIsUnder(actor.id, target.id))) return;
      throw new ForbiddenException('A Manager approves resets only for people below Manager in their own teams');
    }
    if (actor.role === 'team_lead') {
      if (TEAM_AGENT_ROLES.includes(target.role) && (await new OwnTeam(this.prisma).includes(actor.id, target.id))) return;
      throw new ForbiddenException('A Team Lead approves resets only for the agents of their own team');
    }
    throw new ForbiddenException('Only a Team Lead, Manager or the CEO approves password resets');
  }

  private async scopeWhere(actor: ResetActor): Promise<Prisma.PasswordResetRequestWhereInput> {
    if (actor.role === 'ceo') return { staffId: { not: actor.id } };
    if (actor.role === 'manager') {
      const under = await this.reportingScope.peopleUnder(actor.id);
      return { staffId: { in: under }, staff: { role: { in: BELOW_MANAGER } } };
    }
    const team = (await new OwnTeam(this.prisma).memberIds(actor.id)).filter((id) => id !== actor.id);
    return { staffId: { in: team }, staff: { role: { in: [...TEAM_AGENT_ROLES] } } };
  }

  private async expireOld(where: Prisma.PasswordResetRequestWhereInput) {
    await this.prisma.passwordResetRequest.updateMany({
      where: { ...where, status: { in: OPEN }, expiresAt: { lte: this.clock.now() } },
      data: { status: 'expired' },
    });
  }

  private assertApproverRole(actor: ResetActor) {
    if (!['ceo', 'manager', 'team_lead'].includes(actor.role)) {
      throw new ForbiddenException('Only a Team Lead, Manager or the CEO approves password resets');
    }
  }

  private async requireRequest(id: string) {
    const request = await this.prisma.passwordResetRequest.findUnique({
      where: { id },
      include: { staff: { select: staffCard } },
    });
    if (!request) throw new NotFoundException('Password reset request not found');
    return request;
  }
}
