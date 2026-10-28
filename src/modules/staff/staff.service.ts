import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { PrismaService } from '../../common/prisma/prisma.service';
import { IdService } from '../../common/id/id.service';
import { AuditService } from '../../common/audit/audit.service';
import { AuthService } from '../../common/auth/auth.service';
import { TotpService } from '../../common/auth/totp.service';
import { JwtPayload } from '../../common/auth/jwt-payload.interface';
import { Role } from '../../common/rbac/rbac.types';
import { CreateStaffDto } from './dto/create-staff.dto';
import { AcceptInviteDto } from './dto/accept-invite.dto';
import { QueryStaffDto } from './dto/query-staff.dto';
import { BootstrapStaffDto } from './dto/bootstrap-staff.dto';

/** How long a one-time invite token stays redeemable. */
export const INVITE_TTL_MS = 72 * 60 * 60 * 1000;
export const MIN_PASSWORD_LENGTH = 12;
/** bcrypt silently ignores bytes beyond 72, so longer passwords are rejected. */
export const MAX_PASSWORD_BYTES = 72;

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
/** Roles that sit in a team and can therefore have a team lead. */
const TEAM_MEMBER_ROLES: readonly string[] = ['call_agent', 'field_agent'];

const MAX_CODE_ATTEMPTS = 5;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Explicit allow-list of columns returned to callers. passwordHash, totpSecret,
 * registeredDeviceId and inviteTokenHash must never leave the service.
 */
const STAFF_VIEW_SELECT = {
  id: true,
  code: true,
  name: true,
  email: true,
  role: true,
  area: true,
  teamLeadId: true,
  status: true,
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
  inviteExpiresAt: Date;
}

export interface BootstrapResult {
  staff: StaffView;
  totpSecret: string;
  secret: string;
  otpauthUrl: string;
  otpauthUri: string;
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
  ) {}

  async bootstrapStaff(
    dto: BootstrapStaffDto,
    now: Date = new Date(),
  ): Promise<BootstrapResult> {
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

    const { secret, otpauthUrl } = this.totpService.generateSetup(email);
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
          ${secret}, true, 'active', ${now}, ${now}
        WHERE (SELECT COUNT(*) FROM "Staff") = 0
      `;

      if (rowsAffected !== 1) {
        throw new ForbiddenException(
          'Staff bootstrap is only allowed when no staff accounts exist',
        );
      }

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
        area: createdStaff.area,
        teamLeadId: createdStaff.teamLeadId,
        status: createdStaff.status,
      },
    });

    return {
      staff: createdStaff,
      totpSecret: secret,
      secret,
      otpauthUrl,
      otpauthUri: otpauthUrl,
    };
  }

  async createStaff(
    dto: CreateStaffDto,
    actor: JwtPayload,
    now: Date = new Date(),
  ): Promise<CreateStaffResult> {
    const name = typeof dto?.name === 'string' ? dto.name.trim() : '';
    const email =
      typeof dto?.email === 'string' ? dto.email.trim().toLowerCase() : '';
    const role = dto?.role;
    const area = typeof dto?.area === 'string' ? dto.area.trim() : undefined;

    if (!name) {
      throw new BadRequestException('name is required');
    }
    if (!EMAIL_PATTERN.test(email)) {
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
    if (role === 'field_agent' && !area) {
      throw new BadRequestException('area is required for field agents');
    }
    if (role !== 'field_agent' && area) {
      throw new BadRequestException('area applies to field agents only');
    }

    const teamLeadId = dto.teamLeadId || undefined;
    if (teamLeadId) {
      if (!TEAM_MEMBER_ROLES.includes(role)) {
        throw new BadRequestException(
          'teamLeadId applies to call agents and field agents only',
        );
      }
      const teamLead = await this.prisma.staff.findUnique({
        where: { id: teamLeadId },
        select: { role: true, status: true },
      });
      if (
        !teamLead ||
        teamLead.role !== 'team_lead' ||
        teamLead.status !== STAFF_STATUS.ACTIVE
      ) {
        throw new BadRequestException(
          'teamLeadId must reference an active team lead',
        );
      }
    }

    const existing = await this.prisma.staff.findUnique({
      where: { email },
      select: { id: true },
    });
    if (existing) {
      throw new ConflictException(
        'A staff account with this email already exists',
      );
    }

    // The hire sets their own password through the invite. Until they do, the
    // stored hash is of random bytes nobody knows, so password login is impossible.
    const placeholderHash = await this.authService.hashPassword(
      randomBytes(32).toString('hex'),
    );
    const inviteToken = randomBytes(32).toString('hex');
    const inviteExpiresAt = new Date(now.getTime() + INVITE_TTL_MS);

    const staff = await this.insertWithFreshCode(role as Role, (code) => ({
      code,
      name,
      email,
      role,
      area: area ?? null,
      teamLeadId: teamLeadId ?? null,
      passwordHash: placeholderHash,
      status: STAFF_STATUS.PENDING_INVITE,
      inviteTokenHash: hashInviteToken(inviteToken),
      inviteExpiresAt,
    }));

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
        area: staff.area,
        teamLeadId: staff.teamLeadId,
        status: staff.status,
        inviteExpiresAt: inviteExpiresAt.toISOString(),
      },
    });

    return { staff, inviteToken, inviteExpiresAt };
  }

  async listStaff(query: QueryStaffDto): Promise<StaffView[]> {
    if (query.role && !ROLES.includes(query.role as Role)) {
      throw new BadRequestException(`role must be one of: ${ROLES.join(', ')}`);
    }
    const statuses: string[] = Object.values(STAFF_STATUS);
    if (query.status && !statuses.includes(query.status)) {
      throw new BadRequestException(
        `status must be one of: ${statuses.join(', ')}`,
      );
    }

    return this.prisma.staff.findMany({
      where: {
        ...(query.role ? { role: query.role } : {}),
        ...(query.area ? { area: query.area } : {}),
        ...(query.teamLeadId ? { teamLeadId: query.teamLeadId } : {}),
        ...(query.status ? { status: query.status } : {}),
      },
      select: STAFF_VIEW_SELECT,
      orderBy: { createdAt: 'asc' },
    });
  }

  async acceptInvite(
    dto: AcceptInviteDto,
    now: Date = new Date(),
  ): Promise<{ success: true; code: string; email: string }> {
    const token = typeof dto?.token === 'string' ? dto.token.trim() : '';
    const password = typeof dto?.password === 'string' ? dto.password : '';

    if (!token) {
      throw new BadRequestException('Invalid or expired invite token');
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

    const tokenHash = hashInviteToken(token);
    const staff = await this.prisma.staff.findUnique({
      where: { inviteTokenHash: tokenHash },
    });
    // Unknown, already-used, expired and deactivated all look the same.
    if (
      !staff ||
      staff.status !== STAFF_STATUS.PENDING_INVITE ||
      !staff.inviteExpiresAt ||
      staff.inviteExpiresAt <= now
    ) {
      throw new BadRequestException('Invalid or expired invite token');
    }

    const passwordHash = await this.authService.hashPassword(password);

    // Conditional update so two concurrent redemptions (or a deactivation that
    // lands in between) cannot both win: only one request flips the row.
    const claimed = await this.prisma.staff.updateMany({
      where: {
        id: staff.id,
        inviteTokenHash: tokenHash,
        status: STAFF_STATUS.PENDING_INVITE,
        inviteExpiresAt: { gt: now },
      },
      data: {
        passwordHash,
        status: STAFF_STATUS.ACTIVE,
        inviteTokenHash: null,
        inviteExpiresAt: null,
      },
    });
    if (claimed.count !== 1) {
      throw new BadRequestException('Invalid or expired invite token');
    }

    await this.auditService.log({
      actorId: staff.id,
      action: 'staff.invite_accepted',
      entityType: 'staff',
      entityCode: staff.code,
      before: { status: STAFF_STATUS.PENDING_INVITE },
      after: { status: STAFF_STATUS.ACTIVE },
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
    if (target.status === STAFF_STATUS.DEACTIVATED) {
      return { staff: target, sessionsRevoked: 0 };
    }

    // The record is kept (data retention): only access is removed. Any unused
    // invite is voided so it cannot bring the account back.
    const staff = await this.prisma.staff.update({
      where: { id: staffId },
      data: {
        status: STAFF_STATUS.DEACTIVATED,
        deactivatedAt: now,
        inviteTokenHash: null,
        inviteExpiresAt: null,
      },
      select: STAFF_VIEW_SELECT,
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

  /**
   * Codes come from a sequence, but other writers (seed, hand-keyed rows) can
   * occupy the next value. A `code` collision therefore retries with a fresh
   * code, while an `email` collision is a genuine duplicate. Anything else is
   * rethrown untouched.
   */
  private async insertWithFreshCode(
    role: Role,
    build: (code: string) => Prisma.StaffUncheckedCreateInput,
  ): Promise<StaffView> {
    for (let attempt = 1; attempt <= MAX_CODE_ATTEMPTS; attempt++) {
      const code = await this.idService.generateCode(STAFF_CODE_PREFIX[role]);
      try {
        return await this.prisma.staff.create({
          data: build(code),
          select: STAFF_VIEW_SELECT,
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
}
