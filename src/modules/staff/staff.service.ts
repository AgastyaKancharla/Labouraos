import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  GoneException,
  HttpException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, Staff } from '@prisma/client';
import {
  createHash,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from 'node:crypto';
import { PrismaService } from '../../common/prisma/prisma.service';
import { IdService } from '../../common/id/id.service';
import { AuditService } from '../../common/audit/audit.service';
import { AuthService } from '../../common/auth/auth.service';
import { TotpService, claimTotpStep } from '../../common/auth/totp.service';
import { JwtPayload } from '../../common/auth/jwt-payload.interface';
import { Role } from '../../common/rbac/rbac.types';
import { CreateStaffDto } from './dto/create-staff.dto';
import { AcceptInviteDto, InviteTokenDto } from './dto/accept-invite.dto';
import { STAFF_PHOTO_ON_FILE, staffPhotoNeeded } from './staff-photo.service';
import { QueryStaffDto } from './dto/query-staff.dto';
import { BootstrapStaffDto } from './dto/bootstrap-staff.dto';
import { recordStatusChange } from '../../common/status-history/status-history.helper';
import { getCalendarPartsInTimezone } from '../../common/time/period-boundary';
import { encryptCallRoutingPhone, getCallRoutingKey } from './call-routing-key';
import { requireIndianMobile } from '../../common/phone/indian-mobile';
import { ReportingScopeService } from './reporting-scope.service';
import { publicLink } from '../../common/public-link';
import { assertPayrollCanCorrect, frozenMonthsWithoutLine, monthOfDay, monthsBetween } from '../finance/payroll-window';
import { monthLabel } from '../finance/payroll-rules';

/** How long a one-time invite token stays redeemable. */
export const INVITE_TTL_MS = 72 * 60 * 60 * 1000;
export const MIN_PASSWORD_LENGTH = 12;
/** bcrypt silently ignores bytes beyond 72, so longer passwords are rejected. */
export const MAX_PASSWORD_BYTES = 72;

/** Roles that sign in with an authenticator app instead of a login code. */
export const AUTHENTICATOR_ROLES: readonly string[] = ['ceo', 'manager', 'finance'];

/** Why an invite link cannot be used. The invite page shows each one plainly. */
export type InviteProblem = 'invalid' | 'expired' | 'used';

export const INVITE_PROBLEM_MESSAGE: Record<InviteProblem, string> = {
  invalid: 'This invite link is not valid. Ask the person who added you to send a new one.',
  expired: 'This invite has expired. Ask the person who added you to send a new one.',
  used: 'This invite has already been used. Sign in with the password you set.',
};

/** Kept for accept-invite so old clients keep matching on it; `reason` says which. */
const ACCEPT_INVITE_REFUSED = 'Invalid or expired invite token';

/**
 * Where the invite page lives in the web app. It sits under /p (public,
 * outside Cloudflare Access) because field agents accept their invite from
 * their phone, outside the office network.
 */
export function staffInvitePath(token: string): string {
  return `/p/invite/${encodeURIComponent(token)}`;
}

/** The link the person who added a hire sends them (shown once, with the token). */
export function staffInviteLink(token: string): string {
  return publicLink(staffInvitePath(token));
}

export interface InvitePreview {
  /** 'reset' when the link is a password reset for an existing account. */
  purpose: 'invite' | 'reset';
  name: string;
  code: string;
  role: string;
  expiresAt: Date;
  /** CEO, Manager and Finance set up an authenticator app before finishing. */
  authenticatorRequired: boolean;
  passwordRules: { minLength: number; maxBytes: number };
  /** Field agents sign in on Laboura Field; everyone else on the web sign-in. */
  signInAt: 'field_app' | 'web';
  /** True when the person has no staff photo yet, or the CEO asked for a new one. */
  photoRequired: boolean;
}

type ResolvedInvite =
  | { ok: true; purpose: 'invite'; staff: Staff; tokenHash: string; expiresAt: Date }
  | { ok: true; purpose: 'reset'; staff: Staff; tokenHash: string; expiresAt: Date; resetId: string }
  | { ok: false; reason: InviteProblem };

export interface PasswordResetResult {
  staff: StaffView;
  /** Shown exactly once; only its SHA-256 hash is stored. */
  resetToken: string;
  /** The invite page link carrying the token, to send to the person. */
  resetUrl: string;
  expiresAt: Date;
}

export type PasswordResetState = 'waiting' | 'used' | 'expired' | 'replaced';

export interface PasswordResetView {
  id: string;
  staff: { id: string; code: string; name: string; role: string };
  issuedBy: { id: string; code: string; name: string; role: string };
  createdAt: Date;
  expiresAt: Date;
  usedAt: Date | null;
  cancelledAt: Date | null;
  state: PasswordResetState;
}

/** Waiting, used, expired, or replaced by a newer reset / a deactivation. */
export function passwordResetState(
  row: { usedAt: Date | null; cancelledAt: Date | null; expiresAt: Date },
  now: Date,
): PasswordResetState {
  if (row.usedAt) return 'used';
  if (row.cancelledAt) return 'replaced';
  if (row.expiresAt.getTime() <= now.getTime()) return 'expired';
  return 'waiting';
}

export const STAFF_STATUS = {
  PENDING_INVITE: 'pending_invite',
  ACTIVE: 'active',
  DEACTIVATED: 'deactivated',
} as const;

const ROLES: readonly Role[] = [
  'ceo',
  'manager',
  'team_lead',
  'call_agent',
  'field_agent',
  'finance',
];

/** Human-readable code prefix per role; matches the codes used by the seed. */
export const STAFF_CODE_PREFIX: Record<Role, string> = {
  ceo: 'CEO',
  manager: 'MGR',
  team_lead: 'TL',
  call_agent: 'CA',
  field_agent: 'FA',
  finance: 'FIN',
};

/** Roles whose accounts only a CEO may create or deactivate. */
const CEO_ONLY_ROLES: readonly string[] = ['ceo', 'manager'];
/**
 * Roles a Manager can never create: CEO and Manager (Master Guide), and
 * Finance, who reports to the CEO and sits outside every Manager's tree.
 */
const NOT_CREATED_BY_MANAGER: readonly string[] = ['ceo', 'manager', 'finance'];
/** Roles that sit in a team and can therefore have a team lead. */
const TEAM_MEMBER_ROLES: readonly string[] = ['call_agent', 'field_agent'];

const MAX_CODE_ATTEMPTS = 5;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Explicit allow-list of columns returned to callers. passwordHash, totpSecret,
 * inviteTokenHash and callRoutingPhone must never leave the service.
 */
const STAFF_VIEW_SELECT = {
  id: true,
  code: true,
  name: true,
  email: true,
  role: true,
  teamLeadId: true,
  reportsToId: true,
  status: true,
  isIntern: true,
  joinedOn: true,
  createdAt: true,
  deactivatedAt: true,
} satisfies Prisma.StaffSelect;

export type StaffView = Prisma.StaffGetPayload<{
  select: typeof STAFF_VIEW_SELECT;
}>;

export interface CreateStaffResult {
  staff: StaffView;
  /** Shown exactly once; only its SHA-256 hash is stored. */
  inviteToken: string;
  /** The invite page link carrying the token, to send to the hire. */
  inviteUrl: string;
  inviteExpiresAt: Date;
}

export interface ReissueInviteResult {
  staff: StaffView;
  /** Shown exactly once; only its SHA-256 hash is stored. */
  inviteToken: string;
  /** The invite page link carrying the token, to send to the person. */
  inviteUrl: string;
  inviteExpiresAt: Date;
}

export interface ReactivateStaffResult {
  staff: StaffView;
}

export interface BootstrapResult {
  staff: StaffView;
}

export function constantTimeEquals(a: string, b: string): boolean {
  const hashA = createHash('sha256').update(a).digest();
  const hashB = createHash('sha256').update(b).digest();
  return timingSafeEqual(hashA, hashB);
}

export function hashInviteToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function errorTargets(error: Prisma.PrismaClientKnownRequestError): string {
  const target = error.meta?.target;
  return Array.isArray(target) ? target.join(',') : String(target ?? '');
}

@Injectable()
export class StaffService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly idService: IdService,
    private readonly auditService: AuditService,
    private readonly authService: AuthService,
    private readonly totpService: TotpService,
    private readonly reportingScope: ReportingScopeService,
  ) {
    getCallRoutingKey();
  }

  async bootstrapStaff(
    dto: BootstrapStaffDto,
    suppliedSecretOrNow?: string | Date,
    maybeNow?: Date,
  ): Promise<BootstrapResult> {
    let suppliedSecret: string | undefined;
    let now: Date;
    if (suppliedSecretOrNow instanceof Date) {
      suppliedSecret = undefined;
      now = suppliedSecretOrNow;
    } else {
      suppliedSecret = suppliedSecretOrNow;
      now = maybeNow ?? new Date();
    }

    const configuredSecret = process.env.STAFF_BOOTSTRAP_SECRET;
    if (!configuredSecret || !configuredSecret.trim()) {
      throw new ForbiddenException('Server not configured for bootstrap');
    }

    const candidateSecret = (
      suppliedSecret ??
      (dto?.secret || dto?.bootstrapSecret || '')
    ).trim();

    if (
      !candidateSecret ||
      !constantTimeEquals(candidateSecret, configuredSecret.trim())
    ) {
      throw new ForbiddenException(
        'Staff bootstrap is only allowed when no staff accounts exist',
      );
    }

    const name = typeof dto?.name === 'string' ? dto.name.trim() : '';
    const email =
      typeof dto?.email === 'string' ? dto.email.trim().toLowerCase() : '';
    const password = typeof dto?.password === 'string' ? dto.password : '';

    if (!name) {
      throw new BadRequestException('name is required');
    }
    if (!EMAIL_PATTERN.test(email)) {
      throw new BadRequestException('A valid email is required');
    }
    if (password.length < MIN_PASSWORD_LENGTH) {
      throw new BadRequestException(
        `password must be at least ${MIN_PASSWORD_LENGTH} characters`,
      );
    }
    if (Buffer.byteLength(password, 'utf8') > MAX_PASSWORD_BYTES) {
      throw new BadRequestException(
        `password must be at most ${MAX_PASSWORD_BYTES} bytes`,
      );
    }

    const preCount = await this.prisma.staff.count();
    if (preCount !== 0) {
      throw new ForbiddenException(
        'Staff bootstrap is only allowed when no staff accounts exist',
      );
    }

    const passwordHash = await this.authService.hashPassword(password);
    const code = await this.idService.generateCode(STAFF_CODE_PREFIX.ceo);
    const id = randomUUID();

    const createdStaff = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`LOCK TABLE "Staff" IN EXCLUSIVE MODE`;

      const inTxCount = await tx.staff.count();
      if (inTxCount !== 0) {
        throw new ForbiddenException(
          'Staff bootstrap is only allowed when no staff accounts exist',
        );
      }

      const rowsAffected = await tx.$executeRaw`
        INSERT INTO "Staff" (
          "id", "code", "city", "name", "email", "passwordHash", "role",
          "totpSecret", "totpEnabled", "status", "createdAt", "updatedAt"
        )
        SELECT
          ${id}, ${code}, 'Bengaluru', ${name}, ${email}, ${passwordHash}, 'ceo',
          NULL, false, 'active', ${now}, ${now}
        WHERE (SELECT COUNT(*) FROM "Staff") = 0
      `;

      if (rowsAffected !== 1) {
        throw new ForbiddenException(
          'Staff bootstrap is only allowed when no staff accounts exist',
        );
      }

      await recordStatusChange(tx, {
        subjectType: 'staff',
        subjectId: id,
        fromStatus: null,
        toStatus: 'active',
        changedByStaffId: null,
        reason: 'ceo_bootstrap',
      });

      return tx.staff.findUniqueOrThrow({
        where: { id },
        select: STAFF_VIEW_SELECT,
      });
    });

    await this.auditService.log({
      actorId: 'bootstrap',
      action: 'staff.created',
      entityType: 'staff',
      entityCode: createdStaff.code,
      before: null,
      after: {
        code: createdStaff.code,
        name: createdStaff.name,
        email: createdStaff.email,
        role: createdStaff.role,
        teamLeadId: createdStaff.teamLeadId,
        status: createdStaff.status,
      },
    });

    return {
      staff: createdStaff,
    };
  }

  async createStaff(
    dto: CreateStaffDto,
    actor: JwtPayload,
    now: Date = new Date(),
  ): Promise<CreateStaffResult> {
    const name = typeof dto?.name === 'string' ? dto.name.trim() : '';
    const rawEmail =
      typeof dto?.email === 'string' ? dto.email.trim().toLowerCase() : '';
    const email = rawEmail === '' ? null : rawEmail;
    const role = dto?.role;

    if (!name) {
      throw new BadRequestException('name is required');
    }
    const emailRequired = role === 'ceo' || role === 'manager' || role === 'finance';
    if (emailRequired && !email) {
      throw new BadRequestException('A valid email is required');
    }
    if (email && !EMAIL_PATTERN.test(email)) {
      throw new BadRequestException('A valid email is required');
    }
    if (!ROLES.includes(role as Role)) {
      throw new BadRequestException(`role must be one of: ${ROLES.join(', ')}`);
    }
    if (CEO_ONLY_ROLES.includes(role) && actor.role !== 'ceo') {
      throw new ForbiddenException(
        `Only a CEO can create '${role}' accounts`,
      );
    }
    if (actor.role === 'manager' && NOT_CREATED_BY_MANAGER.includes(role)) {
      throw new ForbiddenException(
        `A Manager cannot create '${role}' accounts; only the CEO can`,
      );
    }
    if (dto.intern !== undefined && typeof dto.intern !== 'boolean') {
      throw new BadRequestException('intern must be true or false');
    }
    const isIntern = dto.intern === true;
    if (isIntern && !TEAM_MEMBER_ROLES.includes(role)) {
      throw new BadRequestException('Only call agents and field agents can be interns');
    }
    let joinedOn: Date | null = null;
    if (dto.joinedOn !== undefined && dto.joinedOn !== null && dto.joinedOn !== '') {
      if (typeof dto.joinedOn !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(dto.joinedOn)) {
        throw new BadRequestException('joinedOn must be a date like 2026-11-16');
      }
      joinedOn = new Date(`${dto.joinedOn}T00:00:00.000Z`);
      if (Number.isNaN(joinedOn.getTime())) {
        throw new BadRequestException('joinedOn must be a valid date');
      }
    }
    const requestedTeamLeadId = dto.teamLeadId || undefined;
    const requestedReportsToId = dto.reportsToId || undefined;
    if (requestedTeamLeadId && !TEAM_MEMBER_ROLES.includes(role)) {
      throw new BadRequestException(
        'teamLeadId applies to call agents and field agents only',
      );
    }
    if (
      requestedTeamLeadId &&
      requestedReportsToId &&
      requestedTeamLeadId !== requestedReportsToId
    ) {
      throw new BadRequestException(
        'teamLeadId and reportsToId must be the same person',
      );
    }
    const lineId = await this.reportingScope.assertReportingLine(
      role,
      requestedReportsToId ?? requestedTeamLeadId ?? null,
    );
    const teamLeadId = TEAM_MEMBER_ROLES.includes(role) ? lineId : null;
    if (actor.role === 'manager') {
      // A Manager adds people only inside their own tree: a Team Lead under
      // themself, an agent under one of their own Team Leads.
      const under = await this.reportingScope.peopleUnder(actor.sub);
      if (!lineId || (lineId !== actor.sub && !under.includes(lineId))) {
        throw new ForbiddenException(
          'A Manager can add staff only inside their own teams',
        );
      }
    }

    if (email) {
      const existing = await this.prisma.staff.findUnique({
        where: { email },
        select: { id: true },
      });
      if (existing) {
        throw new ConflictException(
          'A staff account with this email already exists',
        );
      }
    }

    // The hire sets their own password through the invite. Until they do, the
    // stored hash is of random bytes nobody knows, so password login is impossible.
    const placeholderHash = await this.authService.hashPassword(
      randomBytes(32).toString('hex'),
    );
    const inviteToken = randomBytes(32).toString('hex');
    const inviteExpiresAt = new Date(now.getTime() + INVITE_TTL_MS);

    const staff = await this.insertWithFreshCode(
      role as Role,
      (code) => ({
        code,
        name,
        email,
        role,
        teamLeadId: teamLeadId ?? null,
        reportsToId: lineId,
        passwordHash: placeholderHash,
        status: STAFF_STATUS.PENDING_INVITE,
        inviteTokenHash: hashInviteToken(inviteToken),
        inviteExpiresAt,
        isIntern,
        joinedOn,
      }),
      actor.sub,
    );

    await this.auditService.log({
      actorId: actor.sub,
      action: 'staff.created',
      entityType: 'staff',
      entityCode: staff.code,
      before: null,
      after: {
        code: staff.code,
        name: staff.name,
        email: staff.email,
        role: staff.role,
        teamLeadId: staff.teamLeadId,
        reportsToId: staff.reportsToId,
        status: staff.status,
        isIntern: staff.isIntern,
        joinedOn: staff.joinedOn ? staff.joinedOn.toISOString().slice(0, 10) : null,
        inviteExpiresAt: inviteExpiresAt.toISOString(),
      },
    });

    return { staff, inviteToken, inviteUrl: staffInviteLink(inviteToken), inviteExpiresAt };
  }

  async listStaff(
    query: QueryStaffDto,
    actor?: JwtPayload,
  ): Promise<StaffView[]> {
    if (query.role && !ROLES.includes(query.role as Role)) {
      throw new BadRequestException(`role must be one of: ${ROLES.join(', ')}`);
    }
    const statuses: string[] = Object.values(STAFF_STATUS);
    if (query.status && !statuses.includes(query.status)) {
      throw new BadRequestException(
        `status must be one of: ${statuses.join(', ')}`,
      );
    }

    if (actor?.role === 'team_lead') {
      if (query.teamLeadId && query.teamLeadId !== actor.sub) {
        throw new ForbiddenException(
          `Access denied: cannot view staff of another team lead`,
        );
      }
    }

    const effectiveTeamLeadId =
      actor?.role === 'team_lead' ? actor.sub : query.teamLeadId;
    // A Manager lists only their own reporting tree (security check L6); a Team Lead
    // only their team (above). The CEO lists everyone.
    const tree = actor?.role === 'manager' ? await this.reportingScope.peopleUnder(actor.sub) : null;

    return this.prisma.staff.findMany({
      where: {
        ...(query.role ? { role: query.role } : {}),
        ...(effectiveTeamLeadId ? { teamLeadId: effectiveTeamLeadId } : {}),
        ...(query.status ? { status: query.status } : {}),
        ...(tree ? { id: { in: [actor!.sub, ...tree] } } : {}),
      },
      select: STAFF_VIEW_SELECT,
      orderBy: { createdAt: 'asc' },
    });
  }

  async getStaffById(id: string, actor?: JwtPayload) {
    const staff = await this.prisma.staff.findUnique({
      where: { id },
      select: STAFF_VIEW_SELECT,
    });
    if (!staff) {
      throw new NotFoundException(`Staff '${id}' not found`);
    }
    // A Manager opens only people in their own tree, a Team Lead only their team.
    if (actor && (actor.role === 'manager' || actor.role === 'team_lead') && staff.id !== actor.sub) {
      const inTeam = actor.role === 'team_lead' && staff.teamLeadId === actor.sub;
      if (!inTeam && !(await this.reportingScope.personIsUnder(actor.sub, staff.id))) {
        throw new ForbiddenException(
          actor.role === 'manager'
            ? `Access denied: staff '${id}' is not in your reporting tree`
            : `Access denied: staff '${id}' is not part of your team`,
        );
      }
    }
    return staff;
  }

  /**
   * Finds the account an invite token belongs to, or says plainly why it
   * cannot be used. Tokens are 256-bit random values, so telling "used" from
   * "not valid" gives nothing away to someone guessing.
   */
  private async resolveInvite(rawToken: unknown, now: Date): Promise<ResolvedInvite> {
    const token = typeof rawToken === 'string' ? rawToken.trim() : '';
    if (!token) {
      return { ok: false, reason: 'invalid' };
    }
    const tokenHash = hashInviteToken(token);
    const staff = await this.prisma.staff.findUnique({
      where: { inviteTokenHash: tokenHash },
    });
    if (staff) {
      if (staff.status !== STAFF_STATUS.PENDING_INVITE) {
        return { ok: false, reason: 'invalid' };
      }
      if (!staff.inviteExpiresAt || staff.inviteExpiresAt <= now) {
        return { ok: false, reason: 'expired' };
      }
      return { ok: true, purpose: 'invite', staff, tokenHash, expiresAt: staff.inviteExpiresAt };
    }
    const reset = await this.prisma.staffPasswordReset.findUnique({
      where: { tokenHash },
      include: { staff: true },
    });
    if (reset) {
      if (reset.usedAt) return { ok: false, reason: 'used' };
      if (reset.cancelledAt || reset.staff.status !== STAFF_STATUS.ACTIVE) {
        return { ok: false, reason: 'invalid' };
      }
      if (reset.expiresAt <= now) return { ok: false, reason: 'expired' };
      return {
        ok: true,
        purpose: 'reset',
        staff: reset.staff,
        tokenHash,
        expiresAt: reset.expiresAt,
        resetId: reset.id,
      };
    }
    const used = await this.prisma.staff.findUnique({
      where: { inviteUsedTokenHash: tokenHash },
      select: { id: true },
    });
    return { ok: false, reason: used ? 'used' : 'invalid' };
  }

  private inviteProblem(reason: InviteProblem): HttpException {
    const body = { message: INVITE_PROBLEM_MESSAGE[reason], reason };
    return reason === 'invalid' ? new NotFoundException(body) : new GoneException(body);
  }

  /** What the invite page shows before the hire sets a password. */
  async previewInvite(dto: InviteTokenDto, now: Date = new Date()): Promise<InvitePreview> {
    const invite = await this.resolveInvite(dto?.token, now);
    if (!invite.ok) {
      throw this.inviteProblem(invite.reason);
    }
    const { staff } = invite;
    return {
      purpose: invite.purpose,
      name: staff.name,
      code: staff.code,
      role: staff.role,
      expiresAt: invite.expiresAt,
      // A password reset keeps the authenticator already set up.
      authenticatorRequired: invite.purpose === 'invite' && AUTHENTICATOR_ROLES.includes(staff.role),
      passwordRules: { minLength: MIN_PASSWORD_LENGTH, maxBytes: MAX_PASSWORD_BYTES },
      signInAt: staff.role === 'field_agent' ? 'field_app' : 'web',
      // Guide (14 Nov): a live camera selfie is taken while setting up the account.
      photoRequired: staffPhotoNeeded(staff) !== null,
    };
  }

  /**
   * The staff member an invite (or password reset) link belongs to, for the
   * live camera selfie on the invite page. Refused like the preview when the
   * link is not valid, has expired or was used.
   */
  async staffForInvitePhoto(rawToken: unknown, now: Date = new Date()): Promise<{ id: string }> {
    const invite = await this.resolveInvite(rawToken, now);
    if (!invite.ok) throw this.inviteProblem(invite.reason);
    // Only while a photo is needed (none on file, or the CEO asked for a new one):
    // a password reset link, or an invite reissued after the photo was taken, can
    // never replace the face on someone's account.
    if (!staffPhotoNeeded(invite.staff)) throw new ForbiddenException(STAFF_PHOTO_ON_FILE);
    return { id: invite.staff.id };
  }

  /**
   * CEO, Managers and Finance: starts the authenticator set-up on the invite
   * page. The secret is kept on the pending account and turned on only when
   * accept-invite brings a matching code. Calling it again replaces it.
   */
  async setupInviteAuthenticator(
    dto: InviteTokenDto,
    now: Date = new Date(),
  ): Promise<{ secret: string; otpauthUrl: string }> {
    const invite = await this.resolveInvite(dto?.token, now);
    if (!invite.ok) {
      throw this.inviteProblem(invite.reason);
    }
    const { staff, tokenHash } = invite;
    if (invite.purpose === 'reset') {
      throw new BadRequestException(
        'A password reset keeps the authenticator you already use',
      );
    }
    if (!AUTHENTICATOR_ROLES.includes(staff.role)) {
      throw new BadRequestException(
        'Only the CEO, Managers and Finance use an authenticator app',
      );
    }
    const { secret, otpauthUrl } = this.totpService.generateSetup(staff.email ?? staff.code);
    const updated = await this.prisma.staff.updateMany({
      where: {
        id: staff.id,
        inviteTokenHash: tokenHash,
        status: STAFF_STATUS.PENDING_INVITE,
      },
      data: { totpSecret: secret, totpEnabled: false },
    });
    if (updated.count !== 1) {
      throw this.inviteProblem('invalid');
    }
    return { secret, otpauthUrl };
  }

  async acceptInvite(
    dto: AcceptInviteDto,
    now: Date = new Date(),
  ): Promise<{ success: true; code: string; email: string | null }> {
    const token = typeof dto?.token === 'string' ? dto.token.trim() : '';
    const password = typeof dto?.password === 'string' ? dto.password : '';
    const totpCode = typeof dto?.totpCode === 'string' ? dto.totpCode.trim() : '';

    if (!token) {
      throw new BadRequestException({ message: ACCEPT_INVITE_REFUSED, reason: 'invalid' });
    }
    if (password.length < MIN_PASSWORD_LENGTH) {
      throw new BadRequestException(
        `password must be at least ${MIN_PASSWORD_LENGTH} characters`,
      );
    }
    if (Buffer.byteLength(password, 'utf8') > MAX_PASSWORD_BYTES) {
      throw new BadRequestException(
        `password must be at most ${MAX_PASSWORD_BYTES} bytes`,
      );
    }

    const invite = await this.resolveInvite(token, now);
    if (!invite.ok) {
      throw new BadRequestException({ message: ACCEPT_INVITE_REFUSED, reason: invite.reason });
    }
    if (invite.purpose === 'reset') {
      return this.completePasswordReset(invite.staff, invite.resetId, password, now);
    }
    const { staff, tokenHash } = invite;

    // The authenticator set up on the invite page is turned on with the
    // password, in the same update, only when its first code is right.
    let enableTotp = false;
    if (totpCode) {
      if (!AUTHENTICATOR_ROLES.includes(staff.role)) {
        throw new BadRequestException(
          'Only the CEO, Managers and Finance use an authenticator app',
        );
      }
      const step = staff.totpSecret ? this.totpService.verifyStep(totpCode, staff.totpSecret) : null;
      if (step === null) {
        throw new BadRequestException({
          message: 'The authenticator code is not right. Check the app and try again.',
          reason: 'totp_invalid',
        });
      }
      // A code works once: the same code can't also be used to log in.
      if (!(await claimTotpStep(this.prisma, staff.id, step))) {
        throw new BadRequestException({
          message: 'This authenticator code was already used. Wait for the next code in the app and try again.',
          reason: 'totp_reused',
        });
      }
      enableTotp = true;
    }

    const passwordHash = await this.authService.hashPassword(password);

    // Conditional update so two concurrent redemptions (or a deactivation that
    // lands in between) cannot both win: only one request flips the row.
    const claimed = await this.prisma.$transaction(async (tx) => {
      const c = await tx.staff.updateMany({
        where: {
          id: staff.id,
          inviteTokenHash: tokenHash,
          status: STAFF_STATUS.PENDING_INVITE,
          inviteExpiresAt: { gt: now },
          ...(enableTotp ? { totpSecret: staff.totpSecret } : {}),
        },
        data: {
          passwordHash,
          status: STAFF_STATUS.ACTIVE,
          inviteTokenHash: null,
          inviteExpiresAt: null,
          inviteUsedTokenHash: tokenHash,
          ...(enableTotp ? { totpEnabled: true } : {}),
        },
      });
      if (c.count === 1) {
        await recordStatusChange(tx, {
          subjectType: 'staff',
          subjectId: staff.id,
          fromStatus: STAFF_STATUS.PENDING_INVITE,
          toStatus: STAFF_STATUS.ACTIVE,
          changedByStaffId: staff.id,
          reason: 'invite_accepted',
        });
      }
      return c;
    });
    if (claimed.count !== 1) {
      throw new BadRequestException({ message: ACCEPT_INVITE_REFUSED, reason: 'used' });
    }

    await this.auditService.log({
      actorId: staff.id,
      action: 'staff.invite_accepted',
      entityType: 'staff',
      entityCode: staff.code,
      before: enableTotp
        ? { status: STAFF_STATUS.PENDING_INVITE, totpEnabled: false }
        : { status: STAFF_STATUS.PENDING_INVITE },
      after: enableTotp
        ? { status: STAFF_STATUS.ACTIVE, totpEnabled: true }
        : { status: STAFF_STATUS.ACTIVE },
    });

    return { success: true, code: staff.code, email: staff.email };
  }

  async deactivateStaff(
    staffId: string,
    actor: JwtPayload,
    now: Date = new Date(),
  ): Promise<{ staff: StaffView; sessionsRevoked: number }> {
    const target = await this.prisma.staff.findUnique({
      where: { id: staffId },
      select: STAFF_VIEW_SELECT,
    });
    if (!target) {
      throw new NotFoundException('Staff account not found');
    }
    if (target.id === actor.sub) {
      throw new BadRequestException('You cannot deactivate your own account');
    }
    if (CEO_ONLY_ROLES.includes(target.role) && actor.role !== 'ceo') {
      throw new ForbiddenException(
        `Only a CEO can deactivate '${target.role}' accounts`,
      );
    }
    await this.assertInManagerTree(actor, target.id);
    if (target.status === STAFF_STATUS.DEACTIVATED) {
      return { staff: target, sessionsRevoked: 0 };
    }

    // The record is kept (data retention): only access is removed. Any unused
    // invite is voided so it cannot bring the account back.
    const staff = await this.prisma.$transaction(async (tx) => {
      const s = await tx.staff.update({
        where: { id: staffId },
        data: {
          status: STAFF_STATUS.DEACTIVATED,
          deactivatedAt: now,
          inviteTokenHash: null,
          inviteExpiresAt: null,
        },
        select: STAFF_VIEW_SELECT,
      });
      // An unused password reset must not bring the account back either.
      await tx.staffPasswordReset.updateMany({
        where: { staffId, usedAt: null, cancelledAt: null },
        data: { cancelledAt: now },
      });
      // Payroll: the days away are not paid (the leaving day itself is).
      await tx.staffAwayPeriod?.create({ data: { staffId, leftAt: now } });
      await recordStatusChange(tx, {
        subjectType: 'staff',
        subjectId: staffId,
        fromStatus: target.status,
        toStatus: STAFF_STATUS.DEACTIVATED,
        changedByStaffId: actor.sub,
        reason: 'staff_deactivated',
      });
      return s;
    });
    const sessionsRevoked =
      await this.authService.revokeAllSessionsForStaff(staffId);

    await this.auditService.log({
      actorId: actor.sub,
      action: 'staff.deactivated',
      entityType: 'staff',
      entityCode: staff.code,
      before: { status: target.status },
      after: {
        status: STAFF_STATUS.DEACTIVATED,
        deactivatedAt: now.toISOString(),
        sessionsRevoked,
      },
    });

    return { staff, sessionsRevoked };
  }

  async reissueInvite(
    staffId: string,
    actor: JwtPayload,
    now: Date = new Date(),
  ): Promise<ReissueInviteResult> {
    const target = await this.prisma.staff.findUnique({
      where: { id: staffId },
    });
    if (!target) {
      throw new NotFoundException('Staff account not found');
    }
    if (CEO_ONLY_ROLES.includes(target.role) && actor.role !== 'ceo') {
      throw new ForbiddenException(
        `Only a CEO can re-issue invites for '${target.role}' accounts`,
      );
    }
    await this.assertInManagerTree(actor, target.id);
    if (actor.role === 'team_lead') {
      // A Team Lead resets passwords for their own agents only (Master Guide,
      // Passwords and email). The re-issued invite is how a password is reset.
      const ownAgent =
        TEAM_MEMBER_ROLES.includes(target.role) &&
        (target.teamLeadId === actor.sub || target.reportsToId === actor.sub);
      if (!ownAgent) {
        throw new ForbiddenException(
          'A Team Lead can reset passwords only for agents in their own team',
        );
      }
    } else if (actor.role !== 'ceo' && actor.role !== 'manager') {
      throw new ForbiddenException('Only a Team Lead, Manager or the CEO can reset a password');
    }
    if (target.status === STAFF_STATUS.DEACTIVATED) {
      throw new BadRequestException(
        'Cannot re-issue invite for a deactivated account. Reactivate the account first.',
      );
    }

    const placeholderHash = await this.authService.hashPassword(
      randomBytes(32).toString('hex'),
    );
    const inviteToken = randomBytes(32).toString('hex');
    const inviteExpiresAt = new Date(now.getTime() + INVITE_TTL_MS);

    const updatedStaff = await this.prisma.$transaction(async (tx) => {
      const s = await tx.staff.update({
        where: { id: staffId },
        data: {
          passwordHash: placeholderHash,
          status: STAFF_STATUS.PENDING_INVITE,
          inviteTokenHash: hashInviteToken(inviteToken),
          inviteExpiresAt,
          totpSecret: null,
          totpEnabled: false,
        },
        select: STAFF_VIEW_SELECT,
      });

      if (target.status !== STAFF_STATUS.PENDING_INVITE) {
        await recordStatusChange(tx, {
          subjectType: 'staff',
          subjectId: staffId,
          fromStatus: target.status,
          toStatus: STAFF_STATUS.PENDING_INVITE,
          changedByStaffId: actor.sub,
          reason: 'invite_reissued',
        });
      }

      return s;
    });

    await this.authService.revokeAllSessionsForStaff(staffId);

    await this.auditService.log({
      actorId: actor.sub,
      action: 'staff.invite_reissued',
      entityType: 'staff',
      entityCode: updatedStaff.code,
      before: {
        status: target.status,
        totpEnabled: target.totpEnabled,
        inviteExpiresAt: target.inviteExpiresAt
          ? target.inviteExpiresAt.toISOString()
          : null,
      },
      after: {
        status: updatedStaff.status,
        totpEnabled: false,
        inviteExpiresAt: inviteExpiresAt.toISOString(),
      },
    });

    return {
      staff: updatedStaff,
      inviteToken,
      inviteUrl: staffInviteLink(inviteToken),
      inviteExpiresAt,
    };
  }

  /**
   * Reset password (Master Guide, Passwords and email): a Team Lead for their
   * own agents, a Manager inside their own tree, the CEO for anyone. Works
   * like a new invite link — the person opens it on the invite page and sets
   * a new password. Until the link is used the old password keeps working;
   * once it is used the old password stops working and every open session
   * ends. A newer reset replaces an older unused one. The authenticator
   * (CEO, Managers, Finance) is kept. Each reset is stored with who issued it.
   */
  async issuePasswordReset(
    staffId: string,
    actor: JwtPayload,
    now: Date = new Date(),
  ): Promise<PasswordResetResult> {
    const target = await this.prisma.staff.findUnique({
      where: { id: staffId },
      select: { ...STAFF_VIEW_SELECT, teamLeadId: true, reportsToId: true },
    });
    if (!target) {
      throw new NotFoundException('Staff account not found');
    }
    if (target.id === actor.sub) {
      throw new BadRequestException('You cannot reset your own password here');
    }
    if (actor.role === 'team_lead') {
      const ownAgent =
        TEAM_MEMBER_ROLES.includes(target.role) &&
        (target.teamLeadId === actor.sub || target.reportsToId === actor.sub);
      if (!ownAgent) {
        throw new ForbiddenException(
          'A Team Lead can reset passwords only for agents in their own team',
        );
      }
    } else if (actor.role === 'manager') {
      if (NOT_CREATED_BY_MANAGER.includes(target.role)) {
        throw new ForbiddenException(
          `A Manager cannot reset the password of a '${target.role}' account; only the CEO can`,
        );
      }
      await this.assertInManagerTree(actor, target.id);
    } else if (actor.role !== 'ceo') {
      throw new ForbiddenException('Only a Team Lead, Manager or the CEO can reset a password');
    }
    if (target.status === STAFF_STATUS.DEACTIVATED) {
      throw new BadRequestException('This account is deactivated. Reactivate it first.');
    }
    if (target.status === STAFF_STATUS.PENDING_INVITE) {
      throw new BadRequestException(
        'This person has not set a password yet. Send them a new invite instead.',
      );
    }

    const resetToken = randomBytes(32).toString('hex');
    const expiresAt = new Date(now.getTime() + INVITE_TTL_MS);
    const reset = await this.prisma.$transaction(async (tx) => {
      const replaced = await tx.staffPasswordReset.updateMany({
        where: { staffId, usedAt: null, cancelledAt: null },
        data: { cancelledAt: now },
      });
      const created = await tx.staffPasswordReset.create({
        data: {
          staffId,
          issuedByStaffId: actor.sub,
          tokenHash: hashInviteToken(resetToken),
          expiresAt,
          createdAt: now,
        },
        select: { id: true },
      });
      return { id: created.id, replaced: replaced.count };
    });

    await this.auditService.log({
      actorId: actor.sub,
      action: 'staff.password_reset_issued',
      entityType: 'staff',
      entityCode: target.code,
      before: null,
      after: {
        passwordResetId: reset.id,
        issuedByStaffId: actor.sub,
        expiresAt: expiresAt.toISOString(),
        replacedEarlierResets: reset.replaced,
      },
    });

    const staff: StaffView = {
      id: target.id,
      code: target.code,
      name: target.name,
      email: target.email,
      role: target.role,
      teamLeadId: target.teamLeadId,
      reportsToId: target.reportsToId,
      status: target.status,
      isIntern: target.isIntern,
      joinedOn: target.joinedOn,
      createdAt: target.createdAt,
      deactivatedAt: target.deactivatedAt,
    };
    return { staff, resetToken, resetUrl: staffInviteLink(resetToken), expiresAt };
  }

  /** The reset link was used: the new password replaces the old one, sessions end. */
  private async completePasswordReset(
    staff: Staff,
    resetId: string,
    password: string,
    now: Date,
  ): Promise<{ success: true; code: string; email: string | null }> {
    const passwordHash = await this.authService.hashPassword(password);
    const claimed = await this.prisma.$transaction(async (tx) => {
      const used = await tx.staffPasswordReset.updateMany({
        where: { id: resetId, usedAt: null, cancelledAt: null, expiresAt: { gt: now } },
        data: { usedAt: now },
      });
      if (used.count !== 1) return false;
      const updated = await tx.staff.updateMany({
        where: { id: staff.id, status: STAFF_STATUS.ACTIVE },
        // A lock from wrong passwords ends with the new password; a lock a
        // Manager or the CEO put on the account (lockedByStaffId) stays.
        data: { passwordHash, failedLoginCount: 0, lockedUntil: null },
      });
      if (updated.count !== 1) {
        throw new BadRequestException({ message: ACCEPT_INVITE_REFUSED, reason: 'invalid' });
      }
      return true;
    });
    if (!claimed) {
      throw new BadRequestException({ message: ACCEPT_INVITE_REFUSED, reason: 'used' });
    }
    const sessionsEnded = await this.authService.revokeAllSessionsForStaff(staff.id);
    await this.auditService.log({
      actorId: staff.id,
      action: 'staff.password_reset_completed',
      entityType: 'staff',
      entityCode: staff.code,
      before: { passwordResetId: resetId, usedAt: null },
      after: { passwordResetId: resetId, usedAt: now.toISOString(), sessionsEnded },
    });
    return { success: true, code: staff.code, email: staff.email };
  }

  /**
   * Who reset whose password, newest first. The CEO sees every reset; a
   * Manager sees resets of people in their own tree.
   */
  async listPasswordResets(
    actor: JwtPayload,
    now: Date = new Date(),
  ): Promise<PasswordResetView[]> {
    let where: Prisma.StaffPasswordResetWhereInput = {};
    if (actor.role === 'manager') {
      const under = await this.reportingScope.peopleUnder(actor.sub);
      where = { staffId: { in: under } };
    } else if (actor.role !== 'ceo') {
      throw new ForbiddenException('Only a Manager or the CEO can see password resets');
    }
    const person = { select: { id: true, code: true, name: true, role: true } };
    const rows = await this.prisma.staffPasswordReset.findMany({
      where,
      include: { staff: person, issuedBy: person },
      orderBy: { createdAt: 'desc' },
      take: 500,
    });
    return rows.map((r) => ({
      id: r.id,
      staff: r.staff,
      issuedBy: r.issuedBy,
      createdAt: r.createdAt,
      expiresAt: r.expiresAt,
      usedAt: r.usedAt,
      cancelledAt: r.cancelledAt,
      state: passwordResetState(r, now),
    }));
  }

  async reactivateStaff(
    staffId: string,
    actor: JwtPayload,
  ): Promise<ReactivateStaffResult> {
    const target = await this.prisma.staff.findUnique({
      where: { id: staffId },
    });
    if (!target) {
      throw new NotFoundException('Staff account not found');
    }
    if (CEO_ONLY_ROLES.includes(target.role) && actor.role !== 'ceo') {
      throw new ForbiddenException(
        `Only a CEO can reactivate '${target.role}' accounts`,
      );
    }
    await this.assertInManagerTree(actor, target.id);
    if (target.status !== STAFF_STATUS.DEACTIVATED) {
      throw new BadRequestException(
        `Staff account is not deactivated (current status: '${target.status}')`,
      );
    }

    const placeholderHash = await this.authService.hashPassword(
      randomBytes(32).toString('hex'),
    );

    const staff = await this.prisma.$transaction(async (tx) => {
      const s = await tx.staff.update({
        where: { id: staffId },
        data: {
          status: STAFF_STATUS.ACTIVE,
          deactivatedAt: null,
          passwordHash: placeholderHash,
          totpSecret: null,
          totpEnabled: false,
          inviteTokenHash: null,
          inviteExpiresAt: null,
        },
        select: STAFF_VIEW_SELECT,
      });

      // Payroll: close the period away; the day they come back is paid.
      const returnedAt = new Date();
      const open = await tx.staffAwayPeriod?.findFirst({ where: { staffId, returnedAt: null }, orderBy: { leftAt: 'desc' } });
      if (open) {
        await tx.staffAwayPeriod.update({ where: { id: open.id }, data: { returnedAt } });
      } else if (target.deactivatedAt) {
        await tx.staffAwayPeriod?.create({ data: { staffId, leftAt: target.deactivatedAt, returnedAt } });
      }
      await recordStatusChange(tx, {
        subjectType: 'staff',
        subjectId: staffId,
        fromStatus: target.status,
        toStatus: STAFF_STATUS.ACTIVE,
        changedByStaffId: actor.sub,
        reason: 'staff_reactivated',
      });

      return s;
    });

    await this.auditService.log({
      actorId: actor.sub,
      action: 'staff.reactivated',
      entityType: 'staff',
      entityCode: staff.code,
      before: {
        status: target.status,
        deactivatedAt: target.deactivatedAt
          ? target.deactivatedAt.toISOString()
          : null,
      },
      after: {
        status: STAFF_STATUS.ACTIVE,
        deactivatedAt: null,
      },
    });

    return { staff };
  }

  async lockStaff(
    staffId: string,
    actor: JwtPayload,
    reason: string | undefined,
  ): Promise<{ success: boolean; sessionsEnded: number }> {
    const trimmed = typeof reason === 'string' ? reason.trim() : '';
    if (!trimmed) {
      throw new BadRequestException('A reason is required to lock an account');
    }
    if (actor.role !== 'ceo' && actor.role !== 'manager') {
      throw new ForbiddenException('Only a Manager or the CEO can lock an account');
    }
    const target = await this.prisma.staff.findUnique({ where: { id: staffId } });
    if (!target) {
      throw new NotFoundException('Staff account not found');
    }
    await this.assertInManagerTree(actor, target.id);

    const before = {
      failedLoginCount: target.failedLoginCount,
      lockedUntil: target.lockedUntil ? target.lockedUntil.toISOString() : null,
      lockedByStaffId: target.lockedByStaffId,
      lockedReason: target.lockedReason,
    };
    await this.prisma.staff.update({
      where: { id: staffId },
      data: {
        lockedByStaffId: actor.sub,
        lockedReason: trimmed,
        lockedUntil: null,
      },
    });
    const sessionsEnded = await this.authService.endOpenSessions(staffId, 'locked');
    await this.auditService.log({
      actorId: actor.sub,
      action: 'staff.locked',
      entityType: 'staff',
      entityCode: target.code,
      reason: trimmed,
      before,
      after: {
        lockedByStaffId: actor.sub,
        lockedReason: trimmed,
        lockedUntil: null,
        sessionsEnded,
      },
    });
    return { success: true, sessionsEnded };
  }

  async unlockStaff(
    staffId: string,
    actor: JwtPayload,
    reason?: string,
  ): Promise<{ success: boolean }> {
    const why = typeof reason === 'string' && reason.trim() ? reason.trim().slice(0, 500) : undefined;
    if (
      actor.role !== 'ceo' &&
      actor.role !== 'manager' &&
      actor.role !== 'team_lead'
    ) {
      throw new ForbiddenException(
        'Only a Team Lead, Manager or the CEO can unlock an account',
      );
    }
    const target = await this.prisma.staff.findUnique({ where: { id: staffId } });
    if (!target) {
      throw new NotFoundException('Staff account not found');
    }
    if (actor.role === 'team_lead' && target.teamLeadId !== actor.sub) {
      throw new ForbiddenException(
        `Access denied: staff '${staffId}' is not part of your team`,
      );
    }
    await this.assertInManagerTree(actor, target.id);

    await this.prisma.staff.update({
      where: { id: staffId },
      data: {
        failedLoginCount: 0,
        lockedUntil: null,
        lockedByStaffId: null,
        lockedReason: null,
      },
    });
    await this.auditService.log({
      actorId: actor.sub,
      action: 'staff.unlocked',
      entityType: 'staff',
      entityCode: target.code,
      ...(why ? { reason: why } : {}),
      before: {
        failedLoginCount: target.failedLoginCount,
        lockedUntil: target.lockedUntil ? target.lockedUntil.toISOString() : null,
        lockedByStaffId: target.lockedByStaffId,
        lockedReason: target.lockedReason,
      },
      after: {
        failedLoginCount: 0,
        lockedUntil: null,
        lockedByStaffId: null,
        lockedReason: null,
      },
    });
    return { success: true };
  }

  /**
   * A Manager acts only on people in their own reporting tree (Master Guide,
   * "Several Managers can each be given their own teams"). The CEO acts on
   * anyone; other roles are limited elsewhere.
   */
  private async assertInManagerTree(actor: JwtPayload, targetId: string): Promise<void> {
    if (actor.role !== 'manager') {
      return;
    }
    if (!(await this.reportingScope.personIsUnder(actor.sub, targetId))) {
      throw new ForbiddenException(
        'A Manager can act only on staff in their own teams',
      );
    }
  }

  /** Team Leads, Managers, Finance and agents who have no reporting line. CEO only. */
  async listWithoutReportingLine(): Promise<StaffView[]> {
    return this.prisma.staff.findMany({
      where: {
        reportsToId: null,
        role: { in: ['call_agent', 'field_agent', 'team_lead', 'manager', 'finance'] },
        status: { not: STAFF_STATUS.DEACTIVATED },
      },
      select: STAFF_VIEW_SELECT,
      orderBy: [{ role: 'asc' }, { code: 'asc' }],
    });
  }

  /**
   * The reporting tree. The CEO sees everyone. A Manager sees their own part.
   */
  async reportingTree(actor: JwtPayload): Promise<{
    viewerId: string;
    people: StaffView[];
  }> {
    if (actor.role === 'ceo') {
      const people = await this.prisma.staff.findMany({
        where: { status: { not: STAFF_STATUS.DEACTIVATED } },
        select: STAFF_VIEW_SELECT,
        orderBy: [{ role: 'asc' }, { code: 'asc' }],
      });
      return { viewerId: actor.sub, people };
    }
    const under = await this.reportingScope.peopleUnder(actor.sub);
    const people = await this.prisma.staff.findMany({
      where: {
        id: { in: [actor.sub, ...under] },
        status: { not: STAFF_STATUS.DEACTIVATED },
      },
      select: STAFF_VIEW_SELECT,
      orderBy: [{ role: 'asc' }, { code: 'asc' }],
    });
    return { viewerId: actor.sub, people };
  }

  /**
   * Move someone onto a new reporting line.
   * The CEO can move anyone. A Manager can move agents between Team Leads
   * in their own teams. Open work moves with the person when the Team Lead
   * changes, unless the caller sets moveOpenWork to false.
   */
  async moveReportingLine(
    staffId: string,
    body: { reportsToId?: string; reason?: string; moveOpenWork?: boolean },
    actor: JwtPayload,
  ): Promise<StaffView> {
    const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
    if (!reason) {
      throw new BadRequestException('A reason is required');
    }
    const target = await this.prisma.staff.findUnique({
      where: { id: staffId },
      select: {
        id: true,
        code: true,
        role: true,
        status: true,
        teamLeadId: true,
        reportsToId: true,
      },
    });
    if (!target) {
      throw new NotFoundException('Staff account not found');
    }
    if (target.status === STAFF_STATUS.DEACTIVATED) {
      throw new BadRequestException('A deactivated account cannot be moved');
    }
    const reportsToId = await this.reportingScope.assertReportingLine(
      target.role,
      body.reportsToId ?? null,
    );
    if (actor.role === 'manager') {
      await this.assertManagerMayMove(actor.sub, target, reportsToId);
    } else if (actor.role !== 'ceo') {
      throw new ForbiddenException('Only the CEO or a Manager can move a reporting line');
    }
    const newTeamLeadId = TEAM_MEMBER_ROLES.includes(target.role) ? reportsToId : null;
    const teamLeadChanged = (target.teamLeadId ?? null) !== (newTeamLeadId ?? null);
    const moveOpenWork = body.moveOpenWork !== false;
    const previousTeamLeadId = target.teamLeadId;

    const moved = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.staff.update({
        where: { id: target.id },
        data: { reportsToId, teamLeadId: newTeamLeadId },
        select: STAFF_VIEW_SELECT,
      });
      let openWork: {
        followedThePerson: boolean;
        targetCount: number;
        followUpCount: number;
        visitCount: number;
        accountCount: number;
      } = {
        followedThePerson: true,
        targetCount: 0,
        followUpCount: 0,
        visitCount: 0,
        accountCount: 0,
      };
      if (teamLeadChanged && TEAM_MEMBER_ROLES.includes(target.role)) {
        openWork = await this.transferOpenWork(tx, {
          personId: target.id,
          previousTeamLeadId,
          moveWithPerson: moveOpenWork,
          actorId: actor.sub,
        });
      }
      await recordStatusChange(tx, {
        subjectType: 'staff',
        subjectId: target.id,
        fromStatus: target.reportsToId ?? 'none',
        toStatus: reportsToId ?? 'none',
        changedByStaffId: actor.sub,
        reason,
      });
      return { updated, openWork };
    });
    await this.auditService.log({
      actorId: actor.sub,
      action: 'staff.reporting_line_moved',
      entityType: 'staff',
      entityCode: target.code,
      reason,
      before: {
        reportsToId: target.reportsToId,
        teamLeadId: target.teamLeadId,
      },
      after: {
        reportsToId,
        teamLeadId: newTeamLeadId,
        moveOpenWork,
        openWork: moved.openWork,
      },
    });
    return moved.updated;
  }

  private async assertManagerMayMove(
    managerId: string,
    target: { id: string; role: string; teamLeadId: string | null },
    newReportsToId: string | null,
  ): Promise<void> {
    if (!TEAM_MEMBER_ROLES.includes(target.role) || !newReportsToId) {
      throw new ForbiddenException(
        'A Manager can move agents only between Team Leads in their own teams',
      );
    }
    const under = await this.reportingScope.peopleUnder(managerId);
    const agentInTree = under.includes(target.id);
    const newLeadInTree = under.includes(newReportsToId);
    const oldLeadInTree = target.teamLeadId ? under.includes(target.teamLeadId) : false;
    if (!agentInTree || !newLeadInTree || !oldLeadInTree) {
      throw new ForbiddenException(
        'A Manager can move agents only between Team Leads in their own teams',
      );
    }
  }

  private async transferOpenWork(
    tx: Prisma.TransactionClient,
    input: {
      personId: string;
      previousTeamLeadId: string | null;
      moveWithPerson: boolean;
      actorId: string;
    },
  ): Promise<{
    followedThePerson: boolean;
    targetCount: number;
    followUpCount: number;
    visitCount: number;
    accountCount: number;
  }> {
    const { year, month } = getCalendarPartsInTimezone(new Date());
    const [targetCount, followUpCount, visitCount, accountCount] = await Promise.all([
      tx.target.count({
        where: { staffId: input.personId, year, month },
      }),
      tx.followUpTask.count({
        where: { assignedStaffId: input.personId, status: 'pending' },
      }),
      tx.visitAssignment.count({
        where: {
          assignedStaffId: input.personId,
          status: { notIn: ['done', 'cancelled', 'completed'] },
        },
      }),
      tx.business.count({ where: { accountAgentId: input.personId } }),
    ]);
    if (input.moveWithPerson || !input.previousTeamLeadId) {
      return {
        followedThePerson: true,
        targetCount,
        followUpCount,
        visitCount,
        accountCount,
      };
    }
    const leadId = input.previousTeamLeadId;
    await tx.followUpTask.updateMany({
      where: { assignedStaffId: input.personId, status: 'pending' },
      data: { assignedStaffId: leadId },
    });
    await tx.visitAssignment.updateMany({
      where: {
        assignedStaffId: input.personId,
        status: { notIn: ['done', 'cancelled', 'completed'] },
      },
      data: { assignedStaffId: leadId },
    });
    await tx.business.updateMany({
      where: { accountAgentId: input.personId },
      data: { accountAgentId: leadId },
    });
    const ownTarget = await tx.target.findUnique({
      where: {
        staffId_year_month: { staffId: input.personId, year, month },
      },
    });
    if (ownTarget) {
      const leadTarget = await tx.target.findUnique({
        where: { staffId_year_month: { staffId: leadId, year, month } },
      });
      if (!leadTarget) {
        await tx.target.update({
          where: { id: ownTarget.id },
          data: { staffId: leadId, updatedById: input.actorId },
        });
      }
    }
    return {
      followedThePerson: false,
      targetCount,
      followUpCount,
      visitCount,
      accountCount,
    };
  }

  /**
   * Codes come from a sequence, but other writers (seed, hand-keyed rows) can
   * occupy the next value. A `code` collision therefore retries with a fresh
   * code, while an `email` collision is a genuine duplicate. Anything else is
   * rethrown untouched.
   */
  private async insertWithFreshCode(
    role: Role,
    build: (code: string) => Prisma.StaffUncheckedCreateInput,
    actorId?: string | null,
  ): Promise<StaffView> {
    for (let attempt = 1; attempt <= MAX_CODE_ATTEMPTS; attempt++) {
      const code = await this.idService.generateCode(STAFF_CODE_PREFIX[role]);
      try {
        return await this.prisma.$transaction(async (tx) => {
          const created = await tx.staff.create({
            data: build(code),
            select: STAFF_VIEW_SELECT,
          });
          await recordStatusChange(tx, {
            subjectType: 'staff',
            subjectId: created.id,
            fromStatus: null,
            toStatus: created.status,
            changedByStaffId: actorId ?? null,
            reason: 'staff_created',
          });
          return created;
        });
      } catch (error) {
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === 'P2002'
        ) {
          const targets = errorTargets(error);
          if (targets.includes('email')) {
            throw new ConflictException(
              'A staff account with this email already exists',
            );
          }
          if (targets.includes('code') && attempt < MAX_CODE_ATTEMPTS) {
            continue;
          }
        }
        throw error;
      }
    }
    throw new ConflictException('Could not allocate a unique staff code');
  }

  /**
   * Sets the number the calling system rings. The ciphertext is stored;
   * the response never contains the number.
   */
  /** The CEO enters or corrects a joining date (Phase 22 Part B). Pay starts on it. */
  async setJoinedOn(staffId: string, value: unknown, actor: JwtPayload, now: Date = new Date()) {
    if (actor.role !== 'ceo') throw new ForbiddenException('Only the CEO enters the joining date');
    const joinedOn = parseJoinedOn(value, now);
    if (!joinedOn) throw new BadRequestException('joinedOn must be a date like 2026-10-28');
    const target = await this.prisma.staff.findUnique({ where: { id: staffId }, select: { id: true, code: true, joinedOn: true } });
    if (!target) throw new NotFoundException('Staff account not found');
    // Pay starts on the joining day: every month between the old and the new one changes.
    const was = target.joinedOn ?? (await this.firstWorkedDay(staffId));
    if (!was || was.getTime() !== joinedOn.getTime()) {
      const touched = monthsBetween(monthOfDay(was ?? joinedOn), monthOfDay(joinedOn));
      await assertPayrollCanCorrect(this.prisma, touched, 'This joining date');
      // A month whose sheet was prepared without this person: the recompute never adds them to it.
      const missed = await frozenMonthsWithoutLine(this.prisma, staffId, touched);
      if (missed.length) {
        throw new BadRequestException(
          `This joining date changes pay in ${missed.map(monthLabel).join(', ')}, whose salary sheet was prepared without this person, so payroll can't add the change to it. Keep the joining date as it is and add a manual correction on Salaries (Team & access → Salaries → Add a correction) for the pay owed.`,
        );
      }
    }
    const staff = await this.prisma.staff.update({ where: { id: staffId }, data: { joinedOn }, select: STAFF_VIEW_SELECT });
    await this.auditService.log({
      actorId: actor.sub,
      action: 'staff.joined_on_set',
      entityType: 'staff',
      entityCode: target.code,
      before: { joinedOn: target.joinedOn ? target.joinedOn.toISOString().slice(0, 10) : null },
      after: { joinedOn: joinedOn.toISOString().slice(0, 10) },
      changedFields: ['joinedOn'],
    });
    return staff;
  }

  /** The day payroll counts from when no joining date is entered: the first login (as an IST day at UTC midnight). */
  private async firstWorkedDay(staffId: string): Promise<Date | null> {
    const [day, session] = await Promise.all([
      this.prisma.attendanceDay.aggregate({ where: { staffId, loginAt: { not: null } }, _min: { loginAt: true } }),
      this.prisma.staffSession.aggregate({ where: { staffId }, _min: { createdAt: true } }),
    ]);
    const times = [day._min.loginAt, session._min.createdAt].filter((d): d is Date => Boolean(d)).map((d) => d.getTime());
    if (!times.length) return null;
    return new Date(`${new Date(Math.min(...times) + 5.5 * 3600_000).toISOString().slice(0, 10)}T00:00:00.000Z`);
  }

  async setCallRoutingPhone(staffId: string, phone: string, actor: JwtPayload) {
    // The calling system rings an Indian mobile, saved as +91 and 10 digits.
    const trimmed = requireIndianMobile(phone, 'phone');

    const target = await this.prisma.staff.findUnique({
      where: { id: staffId },
      select: { id: true, code: true, role: true, teamLeadId: true, callRoutingPhone: true },
    });
    if (!target) {
      throw new NotFoundException('Staff account not found');
    }

    const isSelf = actor.sub === target.id;
    const isManagement = actor.role === 'ceo' || actor.role === 'manager';
    const isTheirLead = actor.role === 'team_lead' && target.teamLeadId === actor.sub;
    if (!isSelf && !isManagement && !isTheirLead) {
      throw new ForbiddenException(
        'Only the staff member, their team lead, a manager or the CEO can set this number',
      );
    }

    const encrypted = encryptCallRoutingPhone(trimmed);
    await this.prisma.staff.update({
      where: { id: target.id },
      data: { callRoutingPhone: encrypted },
    });

    await this.auditService.log({
      actorId: actor.sub,
      action: 'staff.call_routing_phone_set',
      entityType: 'staff',
      entityCode: target.code,
      before: { callRoutingPhoneSet: Boolean(target.callRoutingPhone) },
      after: { callRoutingPhoneSet: true },
    });

    return { set: true };
  }
}

/** A joining date: an IST calendar date (yyyy-mm-dd), stored at UTC midnight; never more than a year ahead. */
function parseJoinedOn(value: unknown, now: Date): Date | null {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new BadRequestException('joinedOn must be a date like 2026-10-28');
  }
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    throw new BadRequestException('joinedOn must be a real date');
  }
  if (date.getTime() > now.getTime() + 366 * 24 * 3600 * 1000) {
    throw new BadRequestException('joinedOn is too far ahead');
  }
  return date;
}
