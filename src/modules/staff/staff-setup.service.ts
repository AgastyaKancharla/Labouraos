import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Optional,
  UnauthorizedException,
} from '@nestjs/common';
import { Staff } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import { AuthClock, AuthService, hashSetupTicket, TOTP_REUSED } from '../../common/auth/auth.service';
import { TotpService, claimTotpStep } from '../../common/auth/totp.service';
import { LiveEventsService } from '../../common/live/live-events.service';
import { noteRequestDevice } from '../../common/observability/request-context';
import { recordStatusChange } from '../../common/status-history/status-history.helper';
import { AUTHENTICATOR_ROLES } from '../../common/auth/sign-in-roles';
import { normaliseTemporaryPassword } from '../../common/auth/temporary-password';
import { passwordRuleProblem } from '../../common/auth/password-rules';
import { STAFF_PHOTO_ON_FILE, StaffPhotoService, staffPhotoNeeded } from './staff-photo.service';
import { ResetAftermathService } from './reset-aftermath.service';
import type { SelfieImageType } from '../../common/image-type';

/** Every refusal of a ticket says the same thing: start again from the sign-in page. */
export const SETUP_EXPIRED = 'This set-up has ended. Sign in again with your staff code and temporary password.';

export interface SetupCompleteInput {
  setupTicket?: unknown;
  deviceId?: unknown;
  newPassword?: unknown;
  /** The new password typed a second time (checked when sent). */
  confirmPassword?: unknown;
  /** Authenticator roles: the first code (new authenticator) or a code from the one they keep. */
  totpCode?: unknown;
}

const text = (value: unknown): string => (typeof value === 'string' ? value : '');

/**
 * First-login set-up (Master Guide rev 174–175, rule 3). Signing in with the
 * staff code and temporary password gives no session, only a set-up ticket
 * (AuthService.startSetup): 15 minutes, on that device. With it, and nothing
 * else, the person takes the live selfie, sets up the authenticator (CEO,
 * Manager, Finance, Team Lead) and sets a new password typed twice. The
 * password and the authenticator are switched on in ONE conditional update
 * that also clears the temporary password and the ticket, so a temporary
 * password works once. Then they sign in normally with the new password.
 */
@Injectable()
export class StaffSetupService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auth: AuthService,
    private readonly totp: TotpService,
    private readonly photos: StaffPhotoService,
    private readonly audit: AuditService,
    private readonly aftermath: ResetAftermathService,
    private readonly clock: AuthClock,
    @Optional() private readonly live?: LiveEventsService,
  ) {}

  /**
   * The account a set-up ticket belongs to, checked against the device it was
   * given to. Anything wrong (unknown, other device, ended, temporary password
   * ended or replaced, account deactivated or locked by a senior) is the same
   * 401: start again from the sign-in page.
   */
  async holderOf(rawTicket: unknown, rawDeviceId: unknown): Promise<Staff> {
    const ticket = text(rawTicket).trim();
    const deviceId = text(rawDeviceId).trim();
    const refuse = (reason: string) => new UnauthorizedException({ message: SETUP_EXPIRED, reason });
    if (!ticket || !deviceId) throw refuse('setup_missing');
    const staff = await this.prisma.staff.findUnique({ where: { setupTicketHash: hashSetupTicket(ticket) } });
    if (!staff) throw refuse('setup_unknown');
    noteRequestDevice({ staffId: staff.id, deviceId });
    const now = this.clock.now().getTime();
    if (staff.setupTicketDeviceId !== deviceId) {
      await this.audit.log({ actorId: staff.id, action: 'auth.setup.refused', entityType: 'staff', entityCode: staff.code, after: { reason: 'other_device' } });
      throw refuse('other_device');
    }
    if (!staff.setupTicketExpiresAt || staff.setupTicketExpiresAt.getTime() <= now) throw refuse('setup_expired');
    if (!staff.tempPasswordHash || !staff.tempPasswordExpiresAt || staff.tempPasswordExpiresAt.getTime() <= now) {
      throw refuse('temp_password_ended');
    }
    if (staff.status !== 'active' && staff.status !== 'pending_invite') throw refuse('account_not_active');
    if (staff.lockedByStaffId) throw refuse('account_locked');
    return staff;
  }

  /** The live camera selfie, taken before the password (moved here from the old invite page). */
  async takePhoto(staff: Staff, photo: { buffer: Buffer; contentType: SelfieImageType }) {
    // Only while a photo is needed: a set-up can never replace the face on someone's account.
    if (!staffPhotoNeeded(staff)) throw new ForbiddenException(STAFF_PHOTO_ON_FILE);
    const saved = await this.photos.save(staff.id, photo, staff.id, 'setup', this.clock.now());
    return { photoTakenAt: saved.photoTakenAt };
  }

  /**
   * CEO, Manager, Finance and Team Lead without an authenticator: the QR code
   * for their authenticator app. The secret waits on the account (off) and is
   * switched on with the password only when the first code is right. Calling
   * it again gives a new secret.
   */
  async startAuthenticator(rawTicket: unknown, rawDeviceId: unknown): Promise<{ secret: string; otpauthUrl: string }> {
    const staff = await this.holderOf(rawTicket, rawDeviceId);
    if (!AUTHENTICATOR_ROLES.includes(staff.role)) {
      throw new BadRequestException('Only the CEO, Managers, Finance and Team Leads use an authenticator app');
    }
    if (staff.totpEnabled && staff.totpSecret) {
      throw new BadRequestException('You keep the authenticator you already use: type a code from it to finish');
    }
    const { secret, otpauthUrl } = this.totp.generateSetup(staff.email ?? staff.code);
    const updated = await this.prisma.staff.updateMany({
      where: { id: staff.id, setupTicketHash: staff.setupTicketHash, totpEnabled: false },
      data: { totpSecret: secret },
    });
    if (updated.count !== 1) throw new UnauthorizedException({ message: SETUP_EXPIRED, reason: 'setup_replaced' });
    return { secret, otpauthUrl };
  }

  async complete(input: SetupCompleteInput): Promise<{ success: true; code: string; signInAt: 'field_app' | 'web' }> {
    const staff = await this.holderOf(input?.setupTicket, input?.deviceId);
    const password = text(input?.newPassword);
    const problem = passwordRuleProblem(password);
    if (problem) throw new BadRequestException({ message: problem, reason: 'password_rules' });
    if (input?.confirmPassword !== undefined && text(input.confirmPassword) !== password) {
      throw new BadRequestException({ message: 'The two passwords are not the same.', reason: 'password_mismatch' });
    }
    // The new password must differ from the temporary one (in any case, with or without the dash).
    const asTemp = normaliseTemporaryPassword(password);
    if (asTemp && (await this.auth.verifyPassword(asTemp, staff.tempPasswordHash!))) {
      throw new BadRequestException({ message: 'Choose a password that is different from the temporary password.', reason: 'same_as_temporary' });
    }

    // Authenticator roles: the first code of the new authenticator, or a code
    // from the one they keep (a reset that kept it). Wrong codes count like
    // wrong passwords (5 lock the account).
    const totpCode = text(input?.totpCode).trim();
    const authenticatorRole = AUTHENTICATOR_ROLES.includes(staff.role);
    const enrolled = Boolean(staff.totpEnabled && staff.totpSecret);
    let enableTotp = false;
    if (authenticatorRole) {
      if (!staff.totpSecret) {
        throw new BadRequestException({ message: 'Set up your authenticator first: scan the QR code, then type the code it shows.', reason: 'authenticator_not_started' });
      }
      if (!totpCode) {
        throw new BadRequestException({ message: 'Type the 6-digit code from your authenticator app.', reason: 'totp_required' });
      }
      const step = this.totp.verifyStep(totpCode, staff.totpSecret);
      if (step === null) {
        await this.auth.countWrongSecondFactor(staff, 'totp_invalid');
        throw new BadRequestException({ message: 'The authenticator code is not right. Check the app and try again.', reason: 'totp_invalid' });
      }
      if (!(await claimTotpStep(this.prisma, staff.id, step))) {
        await this.auth.countWrongSecondFactor(staff, 'totp_reused');
        throw new BadRequestException({ message: TOTP_REUSED, reason: 'totp_reused' });
      }
      enableTotp = !enrolled;
    }

    const now = this.clock.now();
    const passwordHash = await this.auth.hashPassword(password);
    const issuer = staff.tempPasswordIssuedByStaffId
      ? await this.prisma.staff.findUnique({ where: { id: staff.tempPasswordIssuedByStaffId }, select: { id: true, name: true, role: true } })
      : null;

    const result = await this.prisma.$transaction(async (tx) => {
      // The temporary password given to an existing account is a reset (the
      // history row says what kind); a first sign-in is not.
      const reset = await tx.staffPasswordReset.findFirst({
        where: { staffId: staff.id, usedAt: null, cancelledAt: null, kind: { not: 'link' } },
        orderBy: { createdAt: 'desc' },
        select: { id: true, kind: true },
      });
      // ONE conditional update: still this ticket, this temporary password, in
      // time, and (when switching it on) the very secret whose code was right.
      const claimed = await tx.staff.updateMany({
        where: {
          id: staff.id,
          setupTicketHash: staff.setupTicketHash,
          setupTicketExpiresAt: { gt: now },
          tempPasswordHash: staff.tempPasswordHash,
          tempPasswordExpiresAt: { gt: now },
          status: { in: ['active', 'pending_invite'] },
          lockedByStaffId: null,
          ...(enableTotp ? { totpSecret: staff.totpSecret, totpEnabled: false } : {}),
        },
        data: {
          passwordHash,
          status: 'active',
          tempPasswordHash: null,
          tempPasswordExpiresAt: null,
          tempPasswordIssuedByStaffId: null,
          setupTicketHash: null,
          setupTicketDeviceId: null,
          setupTicketExpiresAt: null,
          inviteTokenHash: null,
          inviteExpiresAt: null,
          failedLoginCount: 0,
          lockedUntil: null,
          ...(enableTotp ? { totpEnabled: true } : {}),
          ...(reset ? { passwordResetNotice: this.aftermath.notice(issuer, reset.kind, now) } : {}),
        },
      });
      if (claimed.count !== 1) return null;
      if (reset) await tx.staffPasswordReset.update({ where: { id: reset.id }, data: { usedAt: now } });
      if (staff.status !== 'active') {
        await recordStatusChange(tx, {
          subjectType: 'staff',
          subjectId: staff.id,
          fromStatus: staff.status,
          toStatus: 'active',
          changedByStaffId: staff.id,
          reason: 'first_login_setup',
        });
      }
      return { reset };
    });
    if (!result) throw new UnauthorizedException({ message: SETUP_EXPIRED, reason: 'setup_replaced' });

    // A new password ends every session (a reset of an active account); approved devices stay.
    const sessionsEnded = await this.auth.revokeAllSessionsForStaff(staff.id);
    this.live?.recheckSessions(staff.id);
    await this.audit.log({
      actorId: staff.id,
      action: 'staff.setup_completed',
      entityType: 'staff',
      entityCode: staff.code,
      before: { status: staff.status, totpEnabled: staff.totpEnabled },
      after: {
        status: 'active',
        totpEnabled: enrolled || enableTotp,
        passwordResetId: result.reset?.id ?? null,
        resetKind: result.reset?.kind ?? null,
        approvedByStaffId: issuer?.id ?? null,
        deviceId: staff.setupTicketDeviceId,
        sessionsEnded,
      },
    });
    if (result.reset) {
      await this.aftermath.ringBells(staff, issuer, result.reset.kind, result.reset.id, now);
    }
    return { success: true, code: staff.code, signInAt: staff.role === 'field_agent' ? 'field_app' : 'web' };
  }
}
