import { ownOwnerAccount } from '../../common/rbac/own-owner-account';
import { OwnTeam } from '../../common/rbac/own-team';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { LiveEventsService } from '../../common/live/live-events.service';
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
import { JwtPayload } from '../../common/auth/jwt-payload.interface';
import { Role } from '../../common/rbac/rbac.types';
import { CreateStaffDto } from './dto/create-staff.dto';
import { QueryStaffDto } from './dto/query-staff.dto';
import { BootstrapStaffDto } from './dto/bootstrap-staff.dto';
import { recordStatusChange } from '../../common/status-history/status-history.helper';
import { getCalendarPartsInTimezone } from '../../common/time/period-boundary';
import { encryptCallRoutingPhone, getCallRoutingKey } from './call-routing-key';
import { requireIndianMobile } from '../../common/phone/indian-mobile';
import { ReportingScopeService } from './reporting-scope.service';
import { TargetSplitHooks } from '../company-plan/target-split.hooks';
import { assertPayrollCanCorrect, frozenMonthsWithoutLine, monthOfDay, monthsBetween } from '../finance/payroll-window';
import { monthLabel } from '../finance/payroll-rules';
import { OWNER_ACCOUNT_HAS_PAY, OWNER_ACCOUNT_ROLES } from './owner-account';
import { AUTHENTICATOR_ROLES } from '../../common/auth/sign-in-roles';
import {
  generateTemporaryPassword,
  normaliseTemporaryPassword,
  TEMP_PASSWORD_TTL_MS,
} from '../../common/auth/temporary-password';

export { MIN_PASSWORD_LENGTH, MAX_PASSWORD_BYTES, passwordRuleProblem } from '../../common/auth/password-rules';

/** Roles that sign in with an authenticator app instead of a login code (the shared list). */
export { AUTHENTICATOR_ROLES };

/**
 * A temporary password a senior gave an existing account, as kept in the
 * password reset history (StaffPasswordReset.kind).
 */
export type TempPasswordKind = 'temp_password' | 'full_reset' | 'reactivation' | 'break_glass';

/**
 * The answer that carries a temporary password: shown exactly once to the
 * person who asked for it (next to the staff code), never logged, never
 * cached (Cache-Control: no-store). Only its bcrypt hash is stored.
 */
export interface TempPasswordResult {
  staff: StaffView;
  tempPassword: string;
  tempPasswordExpiresAt: Date;
}

/** One line of the password reset history (S7). */
export type PasswordResetState =
  | 'waiting'
  | 'used'
  | 'expired'
  | 'replaced'
  | 'asked'
  | 'code_given'
  | 'refused';

export interface PasswordResetView {
  id: string;
  /** temp_password, full_reset, reactivation, break_glass, link (older), or senior_code (Forgot password). */
  kind: string;
  staff: { id: string; code: string; name: string; role: string };
  /** Who gave the temporary password, or who revealed the reset code. */
  issuedBy: { id: string; code: string; name: string; role: string } | null;
  refusedBy: { id: string; code: string; name: string; role: string } | null;
  refusedReason: string | null;
  /** Forgot password only: the asking phone was one of their approved devices. */
  knownDevice: boolean | null;
  createdAt: Date;
  expiresAt: Date;
  usedAt: Date | null;
  cancelledAt: Date | null;
  state: PasswordResetState;
}

/** Waiting, used, expired, or replaced by a newer one / a deactivation. */
export function passwordResetState(
  row: { usedAt: Date | null; cancelledAt: Date | null; expiresAt: Date },
  now: Date,
): PasswordResetState {
  if (row.usedAt) return 'used';
  if (row.cancelledAt) return 'replaced';
  if (row.expiresAt.getTime() <= now.getTime()) return 'expired';
  return 'waiting';
}

/** A Forgot password request, as a history state. */
export function resetRequestState(
  row: { status: string; expiresAt: Date },
  now: Date,
): PasswordResetState {
  if (row.status === 'used') return 'used';
  if (row.status === 'refused') return 'refused';
  if (row.status === 'cancelled') return 'replaced';
  if (row.status === 'expired' || row.expiresAt.getTime() <= now.getTime()) return 'expired';
  return row.status === 'revealed' ? 'code_given' : 'asked';
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
  isOwnerAccount: true,
  joinedOn: true,
  createdAt: true,
  deactivatedAt: true,
} satisfies Prisma.StaffSelect;

export type StaffView = Prisma.StaffGetPayload<{
  select: typeof STAFF_VIEW_SELECT;
}>;

export type CreateStaffResult = TempPasswordResult;
export type ReactivateStaffResult = TempPasswordResult;

export type BootstrapResult = TempPasswordResult;

/** Only the CEO marks owner accounts, and only call and field agent accounts can be one. */
function assertMayBeOwnerAccount(role: string, actor: JwtPayload): void {
  if (actor.role !== 'ceo') throw new ForbiddenException('Only the CEO can mark or clear an owner account');
  if (!OWNER_ACCOUNT_ROLES.includes(role)) {
    throw new BadRequestException('Only call agent and field agent accounts can be owner accounts');
  }
}

export function constantTimeEquals(a: string, b: string): boolean {
  const hashA = createHash('sha256').update(a).digest();
  const hashB = createHash('sha256').update(b).digest();
  return timingSafeEqual(hashA, hashB);
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
    private readonly reportingScope: ReportingScopeService,
    @Optional() private readonly live?: LiveEventsService,
    /** The automatic target split: told when agents join, leave or move (17 Nov). */
    @Optional() private readonly splitHooks?: TargetSplitHooks,
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
    const rawEmail =
      typeof dto?.email === 'string' ? dto.email.trim().toLowerCase() : '';
    // Email is optional for every role (rev 174–175).
    const email = rawEmail === '' ? null : rawEmail;

    if (!name) {
      throw new BadRequestException('name is required');
    }
    if (email && !EMAIL_PATTERN.test(email)) {
      throw new BadRequestException('A valid email is required');
    }

    const preCount = await this.prisma.staff.count();
    if (preCount !== 0) {
      throw new ForbiddenException(
        'Staff bootstrap is only allowed when no staff accounts exist',
      );
    }

    // Like every new account, the first CEO gets a temporary password (shown
    // once) and sets their own password, selfie and authenticator at the first
    // login. Until then the password hash is of random bytes nobody knows.
    const placeholderHash = await this.authService.hashPassword(
      randomBytes(32).toString('hex'),
    );
    const temp = await this.newTempPassword(now);
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
          "totpSecret", "totpEnabled", "status", "tempPasswordHash",
          "tempPasswordExpiresAt", "createdAt", "updatedAt"
        )
        SELECT
          ${id}, ${code}, 'Bengaluru', ${name}, ${email}, ${placeholderHash}, 'ceo',
          NULL, false, ${STAFF_STATUS.PENDING_INVITE}, ${temp.hash},
          ${temp.expiresAt}, ${now}, ${now}
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
        toStatus: STAFF_STATUS.PENDING_INVITE,
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
        // Never the temporary password itself.
        tempPasswordExpiresAt: temp.expiresAt.toISOString(),
      },
    });

    return {
      staff: createdStaff,
      tempPassword: temp.tempPassword,
      tempPasswordExpiresAt: temp.expiresAt,
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
    // Email is optional for every role (rev 174–175); when given it must look
    // like one and be unique.
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
    if (dto.ownerAccount !== undefined && typeof dto.ownerAccount !== 'boolean') {
      throw new BadRequestException('ownerAccount must be true or false');
    }
    const ownerAccount = dto.ownerAccount === true;
    if (ownerAccount) assertMayBeOwnerAccount(role, actor);
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
    const line = await this.reportingScope.reportingLine(
      role,
      requestedReportsToId ?? requestedTeamLeadId ?? null,
      { ownerAccount },
    );
    const lineId = line.id;
    // An owner agent account may report straight to a CEO: it then has no Team Lead.
    const teamLeadId = TEAM_MEMBER_ROLES.includes(role) && line.bossRole === 'team_lead' ? lineId : null;
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

    // The new person signs in once with the temporary password and sets their
    // own (rev 174–175). Until then the stored password hash is of random bytes
    // nobody knows, and the account stays pending ("Not signed in yet").
    const placeholderHash = await this.authService.hashPassword(
      randomBytes(32).toString('hex'),
    );
    const temp = await this.newTempPassword(now);

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
        tempPasswordHash: temp.hash,
        tempPasswordExpiresAt: temp.expiresAt,
        tempPasswordIssuedByStaffId: actor.sub,
        isIntern,
        isOwnerAccount: ownerAccount,
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
        isOwnerAccount: staff.isOwnerAccount,
        joinedOn: staff.joinedOn ? staff.joinedOn.toISOString().slice(0, 10) : null,
        // Never the temporary password itself.
        tempPasswordExpiresAt: temp.expiresAt.toISOString(),
      },
    });
    if (TEAM_MEMBER_ROLES.includes(role as string) && !ownerAccount) {
      await this.splitHooks?.staffChanged({ kind: 'joined', staffId: staff.id, actorId: actor.sub, fromToday: false });
    }

    return { staff, tempPassword: temp.tempPassword, tempPasswordExpiresAt: temp.expiresAt };
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
      actor?.role === 'team_lead' ? undefined : query.teamLeadId;
    // ?teamLeadId= (Managers, the CEO): that Team Lead's team, as OwnTeam defines it.
    const ofLead = effectiveTeamLeadId
      ? (await new OwnTeam(this.prisma).memberIds(effectiveTeamLeadId)).filter((id) => id !== effectiveTeamLeadId)
      : null;
    // A Team Lead's own team (OwnTeam: teamLeadId links and reporting line).
    const team = actor?.role === 'team_lead'
      ? (await new OwnTeam(this.prisma).memberIds(actor.sub)).filter((id) => id !== actor.sub)
      : null;
    // A Manager lists only their own reporting tree (security check L6); a Team Lead
    // only their team (above). The CEO lists everyone.
    const tree = actor?.role === 'manager' ? await this.reportingScope.peopleUnder(actor.sub) : null;

    return this.prisma.staff.findMany({
      where: {
        ...(query.role ? { role: query.role } : {}),
        ...(query.status ? { status: query.status } : {}),
        AND: [
          ...(ofLead ? [{ id: { in: ofLead } }] : []),
          ...(tree ? [{ id: { in: [actor!.sub, ...tree] } }] : []),
          ...(team ? [{ id: { in: team } }] : []),
        ],
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
      const inTeam = actor.role === 'team_lead' && (await new OwnTeam(this.prisma).includes(actor.sub, staff.id));
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

  /** A fresh temporary password: the text shown once, its bcrypt hash and when it ends. */
  private async newTempPassword(now: Date): Promise<{ tempPassword: string; hash: string; expiresAt: Date }> {
    const tempPassword = generateTemporaryPassword();
    const hash = await this.authService.hashPassword(normaliseTemporaryPassword(tempPassword)!);
    return { tempPassword, hash, expiresAt: new Date(now.getTime() + TEMP_PASSWORD_TTL_MS) };
  }

  /**
   * Who may give someone a temporary password or reset their sign-in
   * (rev 174–175, rules 2, 8 and 9): never oneself; a Team Lead for the call
   * and field agents of their own team; a Manager for people below Manager in
   * their own teams; the CEO for anyone else — so a CEO's sign-in only by the
   * other CEO, and Finance and Managers only by a CEO. Owner agent accounts
   * that report straight to a CEO sit in nobody's team, so only a CEO.
   */
  private async assertMayResetSignIn(
    actor: JwtPayload,
    target: { id: string; role: string },
  ): Promise<void> {
    if (target.id === actor.sub) {
      throw new ForbiddenException('You cannot reset your own sign-in; ask a senior');
    }
    if (actor.role === 'team_lead') {
      const ownAgent =
        TEAM_MEMBER_ROLES.includes(target.role) &&
        (await new OwnTeam(this.prisma).includes(actor.sub, target.id));
      if (!ownAgent) {
        throw new ForbiddenException(
          'A Team Lead can do this only for agents in their own team',
        );
      }
      return;
    }
    if (actor.role === 'manager') {
      if (NOT_CREATED_BY_MANAGER.includes(target.role)) {
        throw new ForbiddenException(
          `A Manager cannot do this for a '${target.role}' account; only the CEO can`,
        );
      }
      await this.assertInManagerTree(actor, target.id);
      return;
    }
    if (actor.role !== 'ceo') {
      throw new ForbiddenException('Only a Team Lead, Manager or the CEO can do this');
    }
  }

  /** People who still report to this account (reporting line or Team Lead link), not deactivated. */
  private async activeReportsOf(staffId: string): Promise<number> {
    return this.prisma.staff.count({
      where: {
        id: { not: staffId },
        status: { not: STAFF_STATUS.DEACTIVATED },
        OR: [{ reportsToId: staffId }, { teamLeadId: staffId }],
      },
    });
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
    // Nobody is left reporting to a deactivated boss (rev 174–175, rule 15).
    const reports = await this.activeReportsOf(staffId);
    if (reports > 0) {
      throw new BadRequestException({
        message: `${reports} ${reports === 1 ? 'person still reports' : 'people still report'} to this account. Move them to another boss first.`,
        reason: 'has_reports',
        reports,
      });
    }

    // The record is kept (data retention): only access is removed. A
    // temporary password or set-up in progress is voided so it cannot bring
    // the account back.
    const staff = await this.prisma.$transaction(async (tx) => {
      const s = await tx.staff.update({
        where: { id: staffId },
        data: {
          status: STAFF_STATUS.DEACTIVATED,
          deactivatedAt: now,
          inviteTokenHash: null,
          inviteExpiresAt: null,
          tempPasswordHash: null,
          tempPasswordExpiresAt: null,
          setupTicketHash: null,
          setupTicketDeviceId: null,
          setupTicketExpiresAt: null,
        },
        select: STAFF_VIEW_SELECT,
      });
      await tx.staffPasswordReset.updateMany({
        where: { staffId, usedAt: null, cancelledAt: null },
        data: { cancelledAt: now },
      });
      await tx.passwordResetRequest.updateMany({
        where: { staffId, status: { in: ['pending', 'revealed'] } },
        data: { status: 'cancelled' },
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
    this.live?.recheckSessions(staffId);

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
    if (TEAM_MEMBER_ROLES.includes(target.role)) {
      await this.splitHooks?.staffChanged({ kind: 'left', staffId, actorId: actor.sub });
    } else if (target.role === 'team_lead') {
      await this.splitHooks?.staffChanged({ kind: 'team_closed', staffId, actorId: actor.sub });
    }

    return { staff, sessionsRevoked };
  }

  /**
   * "New temporary password" (rev 174–175, rule 2): replaces "Resend invite"
   * and the reset link. Same people as "Reset sign-in completely". The new
   * temporary password ends any earlier one at once. For someone who has not
   * signed in yet it is simply their new first-login password. For an active
   * account it works like a reset: the old password and the authenticator
   * keep working until the person finishes setting a new password with it
   * (an authenticator user also types a code from their authenticator then);
   * then every session ends and their boss and the CEO get a bell.
   */
  async issueTempPassword(
    staffId: string,
    actor: JwtPayload,
    now: Date = new Date(),
  ): Promise<TempPasswordResult> {
    const target = await this.prisma.staff.findUnique({
      where: { id: staffId },
      select: { ...STAFF_VIEW_SELECT, tempPasswordExpiresAt: true },
    });
    if (!target) {
      throw new NotFoundException('Staff account not found');
    }
    await this.assertMayResetSignIn(actor, target);
    if (target.status === STAFF_STATUS.DEACTIVATED) {
      throw new BadRequestException('This account is deactivated. Reactivate it first.');
    }
    const temp = await this.newTempPassword(now);
    const resetId = await this.prisma.$transaction(async (tx) => {
      const open = await tx.staffPasswordReset.findFirst({
        where: { staffId, usedAt: null, cancelledAt: null, kind: { not: 'link' } },
        orderBy: { createdAt: 'desc' },
        select: { kind: true },
      });
      await tx.staffPasswordReset.updateMany({
        where: { staffId, usedAt: null, cancelledAt: null },
        data: { cancelledAt: now },
      });
      await tx.staff.update({
        where: { id: staffId },
        data: {
          tempPasswordHash: temp.hash,
          tempPasswordExpiresAt: temp.expiresAt,
          tempPasswordIssuedByStaffId: actor.sub,
          setupTicketHash: null,
          setupTicketDeviceId: null,
          setupTicketExpiresAt: null,
        },
      });
      // A first sign-in that has not happened yet is not a reset; an active
      // account (or a reset still waiting to be finished) is.
      const kind: TempPasswordKind | null =
        target.status === STAFF_STATUS.ACTIVE
          ? 'temp_password'
          : ((open?.kind as TempPasswordKind | undefined) ?? null);
      if (!kind) return null;
      const row = await tx.staffPasswordReset.create({
        data: { staffId, issuedByStaffId: actor.sub, kind, expiresAt: temp.expiresAt, createdAt: now },
        select: { id: true },
      });
      return row.id;
    });

    await this.auditService.log({
      actorId: actor.sub,
      action: 'staff.temp_password_issued',
      entityType: 'staff',
      entityCode: target.code,
      before: { status: target.status },
      after: {
        status: target.status,
        passwordResetId: resetId,
        tempPasswordExpiresAt: temp.expiresAt.toISOString(),
        replacedEarlierTempPassword: Boolean(target.tempPasswordExpiresAt),
        ...(ownOwnerAccount(actor.sub, target) ? { ownOwnerAccount: true } : {}),
      },
    });

    const { tempPasswordExpiresAt: _earlier, ...staff } = target;
    void _earlier;
    return { staff, tempPassword: temp.tempPassword, tempPasswordExpiresAt: temp.expiresAt };
  }

  /**
   * "Reset sign-in completely" (rev 174–175, rule 9): for a lost phone or a
   * lost authenticator — never from the login page. Removes the authenticator,
   * ends every session, puts the account back to "Not signed in yet" and
   * gives a temporary password; the person sets up again (selfie only if
   * needed, new password, authenticator for authenticator roles). Approved
   * devices stay. The CEO for a Manager, Finance or the other CEO; a Manager
   * or the CEO for a Team Lead; the Team Lead, a Manager or the CEO (in
   * scope) for agents.
   */
  async resetSignIn(
    staffId: string,
    actor: JwtPayload,
    now: Date = new Date(),
  ): Promise<TempPasswordResult> {
    const target = await this.prisma.staff.findUnique({
      where: { id: staffId },
    });
    if (!target) {
      throw new NotFoundException('Staff account not found');
    }
    await this.assertMayResetSignIn(actor, target);
    if (target.status === STAFF_STATUS.DEACTIVATED) {
      throw new BadRequestException(
        'This account is deactivated. Reactivate it first.',
      );
    }

    const placeholderHash = await this.authService.hashPassword(
      randomBytes(32).toString('hex'),
    );
    const temp = await this.newTempPassword(now);

    const { staff: updatedStaff, resetId } = await this.prisma.$transaction(async (tx) => {
      await tx.staffPasswordReset.updateMany({
        where: { staffId, usedAt: null, cancelledAt: null },
        data: { cancelledAt: now },
      });
      await tx.passwordResetRequest.updateMany({
        where: { staffId, status: { in: ['pending', 'revealed'] } },
        data: { status: 'cancelled' },
      });
      const s = await tx.staff.update({
        where: { id: staffId },
        data: {
          passwordHash: placeholderHash,
          status: STAFF_STATUS.PENDING_INVITE,
          inviteTokenHash: null,
          inviteExpiresAt: null,
          totpSecret: null,
          totpEnabled: false,
          totpLastStep: null,
          tempPasswordHash: temp.hash,
          tempPasswordExpiresAt: temp.expiresAt,
          tempPasswordIssuedByStaffId: actor.sub,
          setupTicketHash: null,
          setupTicketDeviceId: null,
          setupTicketExpiresAt: null,
        },
        select: STAFF_VIEW_SELECT,
      });
      const row = await tx.staffPasswordReset.create({
        data: { staffId, issuedByStaffId: actor.sub, kind: 'full_reset', expiresAt: temp.expiresAt, createdAt: now },
        select: { id: true },
      });
      if (target.status !== STAFF_STATUS.PENDING_INVITE) {
        await recordStatusChange(tx, {
          subjectType: 'staff',
          subjectId: staffId,
          fromStatus: target.status,
          toStatus: STAFF_STATUS.PENDING_INVITE,
          changedByStaffId: actor.sub,
          reason: 'sign_in_reset',
        });
      }
      return { staff: s, resetId: row.id };
    });

    const sessionsEnded = await this.authService.revokeAllSessionsForStaff(staffId);
    this.live?.recheckSessions(staffId);

    await this.auditService.log({
      actorId: actor.sub,
      action: 'staff.sign_in_reset',
      entityType: 'staff',
      entityCode: updatedStaff.code,
      before: {
        status: target.status,
        totpEnabled: target.totpEnabled,
      },
      after: {
        status: updatedStaff.status,
        totpEnabled: false,
        passwordResetId: resetId,
        sessionsEnded,
        tempPasswordExpiresAt: temp.expiresAt.toISOString(),
        ...(ownOwnerAccount(actor.sub, target) ? { ownOwnerAccount: true } : {}),
      },
    });

    return { staff: updatedStaff, tempPassword: temp.tempPassword, tempPasswordExpiresAt: temp.expiresAt };
  }

  /**
   * The password reset history (S7), newest first: temporary passwords given
   * by a senior, and "Forgot password" requests with who revealed or refused
   * the reset code. The CEO sees everyone; a Manager people in their own tree.
   */
  async listPasswordResets(
    actor: JwtPayload,
    now: Date = new Date(),
  ): Promise<PasswordResetView[]> {
    let staffFilter: { staffId?: { in: string[] } } = {};
    if (actor.role === 'manager') {
      const under = await this.reportingScope.peopleUnder(actor.sub);
      staffFilter = { staffId: { in: under } };
    } else if (actor.role !== 'ceo') {
      throw new ForbiddenException('Only a Manager or the CEO can see password resets');
    }
    const person = { select: { id: true, code: true, name: true, role: true } };
    const [issued, requests] = await Promise.all([
      this.prisma.staffPasswordReset.findMany({
        where: staffFilter,
        include: { staff: person, issuedBy: person },
        orderBy: { createdAt: 'desc' },
        take: 500,
      }),
      this.prisma.passwordResetRequest.findMany({
        where: staffFilter,
        include: { staff: person, revealedBy: person, refusedBy: person },
        orderBy: { createdAt: 'desc' },
        take: 500,
      }),
    ]);
    const rows: PasswordResetView[] = [
      ...issued.map((r) => ({
        id: r.id,
        kind: r.kind,
        staff: r.staff,
        issuedBy: r.issuedBy,
        refusedBy: null,
        refusedReason: null,
        knownDevice: null,
        createdAt: r.createdAt,
        expiresAt: r.expiresAt,
        usedAt: r.usedAt,
        cancelledAt: r.cancelledAt,
        state: passwordResetState(r, now),
      })),
      ...requests.map((r) => ({
        id: r.id,
        kind: 'senior_code',
        staff: r.staff,
        issuedBy: r.revealedBy,
        refusedBy: r.refusedBy,
        refusedReason: r.refusedReason,
        knownDevice: r.knownDevice,
        createdAt: r.createdAt,
        expiresAt: r.expiresAt,
        usedAt: r.usedAt,
        cancelledAt: null,
        state: resetRequestState(r, now),
      })),
    ];
    return rows.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()).slice(0, 500);
  }

  /**
   * Reactivation gives a temporary password (rev 174–175, rule 2): the old
   * password and authenticator were wiped, so without one the person could
   * never sign in again. The account is "Not signed in yet" until they set up.
   */
  async reactivateStaff(
    staffId: string,
    actor: JwtPayload,
    now: Date = new Date(),
  ): Promise<ReactivateStaffResult> {
    const target = await this.prisma.staff.findUnique({
      where: { id: staffId },
    });
    if (!target) {
      throw new NotFoundException('Staff account not found');
    }
    if (target.id === actor.sub) {
      throw new BadRequestException('You cannot reactivate your own account');
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
    const temp = await this.newTempPassword(now);

    const staff = await this.prisma.$transaction(async (tx) => {
      const s = await tx.staff.update({
        where: { id: staffId },
        data: {
          status: STAFF_STATUS.PENDING_INVITE,
          deactivatedAt: null,
          passwordHash: placeholderHash,
          totpSecret: null,
          totpEnabled: false,
          totpLastStep: null,
          inviteTokenHash: null,
          inviteExpiresAt: null,
          tempPasswordHash: temp.hash,
          tempPasswordExpiresAt: temp.expiresAt,
          tempPasswordIssuedByStaffId: actor.sub,
          setupTicketHash: null,
          setupTicketDeviceId: null,
          setupTicketExpiresAt: null,
        },
        select: STAFF_VIEW_SELECT,
      });
      await tx.staffPasswordReset.create({
        data: { staffId, issuedByStaffId: actor.sub, kind: 'reactivation', expiresAt: temp.expiresAt, createdAt: now },
      });

      // Payroll: close the period away; the day they come back is paid.
      const returnedAt = now;
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
        toStatus: STAFF_STATUS.PENDING_INVITE,
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
        status: STAFF_STATUS.PENDING_INVITE,
        deactivatedAt: null,
        tempPasswordExpiresAt: temp.expiresAt.toISOString(),
      },
    });
    if (TEAM_MEMBER_ROLES.includes(target.role) && !target.isOwnerAccount) {
      await this.splitHooks?.staffChanged({ kind: 'joined', staffId, actorId: actor.sub, fromToday: true });
    }

    return { staff, tempPassword: temp.tempPassword, tempPasswordExpiresAt: temp.expiresAt };
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
    this.live?.recheckSessions(staffId);
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
    // Nobody unlocks their own account; a Team Lead unlocks only the call and
    // field agents of their own team (never themselves or another Team Lead).
    if (target.id === actor.sub) {
      throw new ForbiddenException('You cannot unlock your own account');
    }
    if (
      actor.role === 'team_lead' &&
      (!TEAM_MEMBER_ROLES.includes(target.role) ||
        !(await new OwnTeam(this.prisma).includes(actor.sub, target.id)))
    ) {
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
        isOwnerAccount: true,
        reportsTo: { select: { role: true } },
      },
    });
    if (!target) {
      throw new NotFoundException('Staff account not found');
    }
    if (target.status === STAFF_STATUS.DEACTIVATED) {
      throw new BadRequestException('A deactivated account cannot be moved');
    }
    // An owner agent account may report to a CEO (rev 174–175, rule 14); only
    // the CEO moves it on or off that line (it sits in no Manager's tree).
    if (actor.role !== 'ceo' && target.reportsTo?.role === 'ceo' && TEAM_MEMBER_ROLES.includes(target.role)) {
      throw new ForbiddenException('This owner account reports to a CEO; only the CEO can move it');
    }
    const line = await this.reportingScope.reportingLine(
      target.role,
      body.reportsToId ?? null,
      { ownerAccount: target.isOwnerAccount },
    );
    const reportsToId = line.id;
    if (actor.role === 'manager') {
      await this.assertManagerMayMove(actor.sub, target, reportsToId);
    } else if (actor.role !== 'ceo') {
      throw new ForbiddenException('Only the CEO or a Manager can move a reporting line');
    }
    // Reporting to a CEO (owner accounts only) means no Team Lead.
    const newTeamLeadId = TEAM_MEMBER_ROLES.includes(target.role) && line.bossRole === 'team_lead' ? reportsToId : null;
    const teamLeadChanged = (target.teamLeadId ?? null) !== (newTeamLeadId ?? null);
    const moveOpenWork = body.moveOpenWork !== false;
    const previousTeamLeadId = target.teamLeadId;
    // The agent's target this month as it was before the move (the automatic split credits the old team with what was reached).
    const splitBefore =
      this.splitHooks && teamLeadChanged && TEAM_MEMBER_ROLES.includes(target.role)
        ? await this.currentTargetValues(target.id)
        : null;

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
    if (TEAM_MEMBER_ROLES.includes(target.role) && teamLeadChanged && !target.isOwnerAccount) {
      await this.splitHooks?.staffChanged({
        kind: 'moved',
        staffId: target.id,
        actorId: actor.sub,
        fromTeamLeadId: previousTeamLeadId ?? (target.reportsTo?.role === 'team_lead' ? target.reportsToId : null),
        before: splitBefore,
      });
    } else if (target.role === 'team_lead' && (target.reportsToId ?? null) !== (reportsToId ?? null)) {
      await this.splitHooks?.staffChanged({ kind: 'team_moved', staffId: target.id, actorId: actor.sub });
    }
    return moved.updated;
  }

  /** An agent's target numbers this month (IST), for the automatic split. */
  private async currentTargetValues(staffId: string) {
    const { year, month } = getCalendarPartsInTimezone(new Date());
    return this.prisma.target.findUnique({
      where: { staffId_year_month: { staffId, year, month } },
      select: { candidatesActivated: true, vacanciesCaptured: true, placementsClosed: true, repeatBusinesses: true },
    });
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
  /**
   * The CEO marks or unmarks an owner account (owner decision 14 Nov): an
   * owner's own call or field agent account whose work counts in the lists but
   * not in targets, leaderboards, attendance, salary or incentives. Audited.
   */
  async setOwnerAccount(staffId: string, value: unknown, actor: JwtPayload) {
    if (typeof value !== 'boolean') throw new BadRequestException('ownerAccount must be true or false');
    const target = await this.prisma.staff.findUnique({
      where: { id: staffId },
      select: { id: true, code: true, role: true, isOwnerAccount: true, reportsTo: { select: { role: true } } },
    });
    if (!target) throw new NotFoundException('Staff account not found');
    if (value) assertMayBeOwnerAccount(target.role, actor);
    else if (actor.role !== 'ceo') throw new ForbiddenException('Only the CEO can mark or clear an owner account');
    // Only an owner account may report straight to a CEO (rev 174–175, rule 14).
    if (!value && target.isOwnerAccount && target.reportsTo?.role === 'ceo') {
      throw new BadRequestException('This owner account reports to a CEO. Move it to a Team Lead first, then clear "Owner account".');
    }
    if (target.isOwnerAccount === value) {
      return this.prisma.staff.findUniqueOrThrow({ where: { id: staffId }, select: STAFF_VIEW_SELECT });
    }
    await this.assertNoPayRecordsToSplit(staffId);
    const staff = await this.prisma.staff.update({
      where: { id: staffId },
      data: { isOwnerAccount: value },
      select: STAFF_VIEW_SELECT,
    });
    await this.auditService.log({
      actorId: actor.sub,
      action: value ? 'staff.owner_account_set' : 'staff.owner_account_cleared',
      entityType: 'staff',
      entityCode: target.code,
      before: { isOwnerAccount: target.isOwnerAccount },
      after: { isOwnerAccount: value },
      changedFields: ['isOwnerAccount'],
    });
    // An owner account carries no targets: marking one is like leaving, clearing it like joining.
    if (TEAM_MEMBER_ROLES.includes(target.role)) {
      await this.splitHooks?.staffChanged(value ? { kind: 'left', staffId, actorId: actor.sub } : { kind: 'joined', staffId, actorId: actor.sub, fromToday: true });
    }
    return staff;
  }

  /**
   * Owner accounts are meant to be made as owner accounts from the start.
   * Marking or clearing one later would split a month between "paid agent"
   * and "owner account", so it is refused while the account has a salary, a
   * salary sheet line, or a finished attendance day in a month whose salaries
   * are not yet approved. After that month is approved (or for an account
   * that has not worked yet) the change is allowed.
   */
  private async assertNoPayRecordsToSplit(staffId: string): Promise<void> {
    const [salaries, lines, days] = await Promise.all([
      this.prisma.staffSalary.count({ where: { staffId } }),
      this.prisma.payrollLine.count({ where: { staffId } }),
      this.prisma.attendanceDay.findMany({
        where: { staffId, OR: [{ logoutAt: { not: null } }, { dayType: { not: 'open' } }] },
        select: { date: true },
      }),
    ]);
    if (salaries > 0 || lines > 0) throw new BadRequestException(OWNER_ACCOUNT_HAS_PAY);
    const months = [...new Set(days.map((d) => monthOfDay(d.date)))];
    if (!months.length) return;
    const frozen = await this.prisma.payrollRun.findMany({
      where: { month: { in: months }, status: { in: ['approved', 'paid'] } },
      select: { month: true },
    });
    const done = new Set(frozen.map((r) => r.month));
    if (months.some((m) => !done.has(m))) throw new BadRequestException(OWNER_ACCOUNT_HAS_PAY);
  }

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
    // A Manager acts only inside their own reporting tree (AGENTS.md §7); the CEO for anyone.
    const isManagement =
      actor.role === 'ceo' || (actor.role === 'manager' && !isSelf && (await this.reportingScope.personIsUnder(actor.sub, target.id)));
    const isTheirLead = actor.role === 'team_lead' && (await new OwnTeam(this.prisma).includes(actor.sub, target.id));
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
