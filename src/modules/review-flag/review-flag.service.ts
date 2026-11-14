import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { IdService } from '../../common/id/id.service';
import { AuditService } from '../../common/audit/audit.service';
import { NotificationSourcesService } from '../notification/notification-sources.service';
import { MONEY_FLAG_KINDS } from '../notification/notification.constants';
import { ReportingScopeService } from '../staff/reporting-scope.service';
import { effectiveOwner } from './flag-owner';
import {
  CEO_OWNED_FLAG_KINDS,
  REVIEW_FLAG_KINDS,
  ReviewFlagKind,
} from './review-flag.constants';

export interface RaiseReviewFlagParams {
  kind: ReviewFlagKind;
  subjectType: string;
  subjectId: string;
  raisedForStaffId?: string | null;
  details?: Record<string, unknown> | null;
  /** Raised straight to a level above (e.g. a Team Lead reporting an agent to their Manager). */
  owner?: { role: 'manager' | 'ceo'; staffId?: string | null; byStaffId?: string | null; note?: string | null } | null;
}

export interface ListReviewFlagsQuery {
  status?: string;
  kind?: string;
}

export interface ResolveReviewFlagDto {
  status?: 'resolved' | 'dismissed';
  resolution: string;
}

@Injectable()
export class ReviewFlagService {
  private readonly logger = new Logger(ReviewFlagService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly idService: IdService,
    private readonly auditService: AuditService,
    @Optional() private readonly bells?: NotificationSourcesService,
    @Optional() private readonly reportingScope?: ReportingScopeService,
  ) {}

  /** Everyone below the person on the reporting line (Team Lead: their team; Manager: their tree). */
  private async peopleUnder(staffId: string): Promise<string[]> {
    if (this.reportingScope) return this.reportingScope.peopleUnder(staffId);
    const rows = await this.prisma.staff.findMany({ where: { OR: [{ teamLeadId: staffId }, { reportsToId: staffId }] }, select: { id: true } });
    return rows.map((row) => row.id);
  }

  /** Puts the flag on (or takes it off) the right bells. Never blocks the flag itself. */
  private async syncBell(flagId: string): Promise<void> {
    if (!this.bells) return;
    try {
      await this.bells.syncFlag(flagId);
    } catch (error) {
      this.logger.warn(`Bell for review flag ${flagId} failed: ${(error as Error).message}`);
    }
  }

  /**
   * For flags closed outside resolve() (Finance resolving a payment or payout
   * flag, a bank credit set aside): takes the flag off the bells too.
   */
  async refreshBell(flagId: string): Promise<void> {
    await this.syncBell(flagId);
  }

  async raise(params: RaiseReviewFlagParams) {
    if (!REVIEW_FLAG_KINDS.includes(params.kind)) {
      throw new BadRequestException(`Invalid review flag kind: '${params.kind}'`);
    }

    const code = await this.idService.generateCode('review_flag');

    const flag = await this.prisma.reviewFlag.create({
      data: {
        code,
        kind: params.kind,
        subjectType: params.subjectType,
        subjectId: params.subjectId,
        raisedForStaffId: params.raisedForStaffId ?? null,
        details: (params.details ?? Prisma.JsonNull) as Prisma.InputJsonValue,
        status: 'open',
        // Money and bypass flags are always decided by the CEO (guide, Quality).
        ownerRole: CEO_OWNED_FLAG_KINDS.includes(params.kind) ? 'ceo' : (params.owner?.role ?? null),
        ownerStaffId: params.owner?.role === 'manager' ? (params.owner.staffId ?? null) : null,
        escalatedAt: params.owner ? new Date() : null,
        escalatedByStaffId: params.owner?.byStaffId ?? null,
        escalationNote: params.owner?.note ?? null,
      },
    });
    await this.syncBell(flag.id);
    return flag;
  }

  async list(actor: { id: string; role: string }, query?: ListReviewFlagsQuery) {
    const where: Prisma.ReviewFlagWhereInput = {};

    if (query?.status) {
      where.status = query.status;
    }
    if (query?.kind) {
      where.kind = query.kind;
    }

    if (actor.role === 'ceo') {
      // The CEO sees every flag.
    } else if (actor.role === 'manager') {
      // A Manager: flags about people in their tree, flags sent to them, and
      // flags about nobody in particular — never a money flag (no money at all).
      const people = await this.peopleUnder(actor.id);
      where.AND = [
        { OR: [{ raisedForStaffId: { in: people } }, { ownerStaffId: actor.id }, { raisedForStaffId: null }] },
        { kind: { notIn: MONEY_FLAG_KINDS } },
      ];
    } else if (actor.role === 'team_lead') {
      // A Team Lead: flags about their own team only.
      where.raisedForStaffId = { in: await this.peopleUnder(actor.id) };
    } else if (actor.role === 'field_agent') {
      where.raisedForStaffId = actor.id;
    } else {
      throw new ForbiddenException(
        'Review flags can only be viewed by Team Leads, Managers, or CEO',
      );
    }

    return this.prisma.reviewFlag.findMany({
      where,
      orderBy: { raisedAt: 'desc' },
      include: {
        raisedForStaff: {
          select: { id: true, code: true, name: true, role: true },
        },
        resolvedByStaff: {
          select: { id: true, code: true, name: true, role: true },
        },
      },
    });
  }

  /**
   * Who may resolve a flag: the CEO, any flag. Money and bypass flags (and
   * flags sent to the CEO): only the CEO. A Manager: flags in their tree (or
   * sent to them, or about nobody) owned by a Team Lead or a Manager, but not
   * one sent to another Manager. A Team Lead: their own team's flags that are
   * still theirs (not sent up).
   */
  private async assertCanResolve(
    flag: { kind: string; ownerRole: string | null; ownerStaffId: string | null; raisedForStaffId: string | null },
    actor: { id: string; role: string },
  ): Promise<void> {
    if (actor.role === 'ceo') return;
    if (actor.role !== 'manager' && actor.role !== 'team_lead') {
      throw new ForbiddenException('Only Team Leads, Managers, or CEO may resolve review flags');
    }
    const person = flag.raisedForStaffId
      ? await this.prisma.staff.findUnique({ where: { id: flag.raisedForStaffId }, select: { role: true } })
      : null;
    const owner = effectiveOwner(flag, person?.role ?? null);
    if (owner === 'ceo') throw new ForbiddenException('The CEO decides this flag (money, a business hiding a hire, or sent to the CEO)');
    const under = flag.raisedForStaffId ? (await this.peopleUnder(actor.id)).includes(flag.raisedForStaffId) : false;
    if (actor.role === 'team_lead') {
      if (!under) throw new ForbiddenException('Team leads can only resolve review flags raised for their own team members');
      if (owner !== 'team_lead') throw new ForbiddenException('This flag was sent to the Manager');
      return;
    }
    const inTree = under || flag.ownerStaffId === actor.id || !flag.raisedForStaffId;
    if (!inTree) throw new ForbiddenException('A Manager resolves flags only for their own teams');
    if (owner === 'manager' && flag.ownerStaffId && flag.ownerStaffId !== actor.id) {
      throw new ForbiddenException('This flag was sent to another Manager');
    }
  }

  async resolve(
    id: string,
    actor: { id: string; role: string },
    dto: ResolveReviewFlagDto,
    /** Closing a flag as part of work the caller already proved they may do (e.g. approving the business it is about). */
    opts: { closedByOwnWork?: boolean } = {},
  ) {
    if (!dto || !dto.resolution || !dto.resolution.trim()) {
      throw new BadRequestException(
        'A written resolution is required to resolve or dismiss a review flag',
      );
    }

    const targetStatus = (dto.status ?? 'resolved') as string;
    if (targetStatus !== 'resolved' && targetStatus !== 'dismissed') {
      throw new BadRequestException(
        "Status must be either 'resolved' or 'dismissed'",
      );
    }

    const flag = await this.prisma.reviewFlag.findUnique({
      where: { id },
    });
    if (!flag) {
      throw new NotFoundException(`Review flag '${id}' not found`);
    }

    if (!opts.closedByOwnWork) await this.assertCanResolve(flag, actor);

    const updated = await this.prisma.reviewFlag.update({
      where: { id },
      data: {
        status: targetStatus,
        resolution: dto.resolution.trim(),
        resolvedAt: new Date(),
        resolvedByStaffId: actor.id,
      },
      include: {
        raisedForStaff: {
          select: { id: true, code: true, name: true, role: true },
        },
        resolvedByStaff: {
          select: { id: true, code: true, name: true, role: true },
        },
      },
    });

    await this.auditService.log({
      actorId: actor.id,
      action: 'review_flag.resolved',
      entityType: 'review_flag',
      entityCode: flag.code,
      before: {
        status: flag.status,
        resolution: flag.resolution,
      },
      after: {
        status: updated.status,
        resolution: updated.resolution,
      },
    });
    await this.syncBell(id);

    return updated;
  }
}
