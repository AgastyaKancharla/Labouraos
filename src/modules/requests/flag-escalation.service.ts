import { BadRequestException, ConflictException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma, ReviewFlag } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import { flagTitle, MONEY_FLAG_KINDS } from '../notification/notification.constants';
import { NotificationSourcesService } from '../notification/notification-sources.service';
import { ReviewFlagService } from '../review-flag/review-flag.service';
import { ReportingScopeService } from '../staff/reporting-scope.service';
import { CEO_OWNED_FLAG_KINDS } from '../review-flag/review-flag.constants';
import { effectiveOwner, FlagOwner, OWNER_LEVEL } from '../review-flag/flag-owner';
import { AttendanceClock } from '../attendance/attendance-clock';

interface Actor {
  id: string;
  role: string;
}

type Owner = FlagOwner;
const BRIEF = { id: true, code: true, name: true, role: true } as const;
export { effectiveOwner };
const LEVEL = OWNER_LEVEL;

/**
 * Review flags for the Team Lead and Manager portals (T-Flags, MG-Flags):
 * scoped to the caller's team or tree, resolved by the owner (or anyone
 * above), and escalated one level at a time: "Send to Manager" (Team Lead),
 * "Send to CEO" (Manager). Managers never see money flags.
 */
@Injectable()
export class FlagEscalationService {
  private readonly logger = new Logger(FlagEscalationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly scope: ReportingScopeService,
    private readonly flags: ReviewFlagService,
    private readonly bells: NotificationSourcesService,
    private readonly clock: AttendanceClock,
  ) {}

  async list(actor: Actor, query: { status?: string; kind?: string }) {
    const where = await this.scopeWhere(actor);
    if (query?.status) where.status = query.status;
    if (query?.kind) where.kind = query.kind;
    const rows = await this.prisma.reviewFlag.findMany({
      where,
      orderBy: { raisedAt: 'desc' },
      take: 500,
      include: { raisedForStaff: { select: BRIEF }, resolvedByStaff: { select: BRIEF } },
    });
    const people = actor.role === 'ceo' ? null : await this.scope.peopleUnder(actor.id);
    const owners = await this.ownerBriefs(rows);
    return rows.map((row) => this.view(actor, row, people, owners));
  }

  async resolve(actor: Actor, id: string, body: { status?: string; resolution?: string }) {
    const flag = await this.load(id);
    const view = await this.oneView(actor, flag);
    if (!view.canResolve) throw new ForbiddenException(view.ownerRole === 'ceo' ? 'The CEO decides this flag' : 'This flag is not yours to resolve');
    return this.flags.resolve(id, actor, { status: (body?.status as 'resolved' | 'dismissed') ?? 'resolved', resolution: String(body?.resolution ?? '') });
  }

  /** "Send to Manager" (Team Lead) / "Send to CEO" (Manager): one level up, with a note. */
  async escalate(actor: Actor, id: string, body: { note?: string }) {
    const note = String(body?.note ?? '').trim();
    if (!note) throw new BadRequestException('A note is required to send a flag up');
    const flag = await this.load(id);
    const view = await this.oneView(actor, flag);
    if (!view.canEscalate) {
      throw new ForbiddenException(view.status !== 'open' ? 'This flag is already closed' : 'Only the flag owner sends it up, one level at a time');
    }
    let ownerRole: Owner;
    let ownerStaffId: string | null = null;
    if (actor.role === 'team_lead') {
      const chain = await this.scope.chainOf(actor.id);
      ownerRole = chain.manager ? 'manager' : 'ceo';
      ownerStaffId = chain.manager?.id ?? null;
    } else {
      ownerRole = 'ceo';
    }
    const now = this.clock.now();
    const claimed = await this.prisma.reviewFlag.updateMany({
      where: { id, status: 'open', ownerRole: flag.ownerRole },
      data: { ownerRole, ownerStaffId, escalatedAt: now, escalatedByStaffId: actor.id, escalationNote: note },
    });
    if (claimed.count === 0) throw new ConflictException('This flag has just changed');
    await this.audit.log({
      actorId: actor.id,
      action: 'review_flag.escalated',
      entityType: 'review_flag',
      entityCode: flag.code,
      before: { ownerRole: view.ownerRole },
      after: { ownerRole, ownerStaffId },
      reason: note,
    });
    try {
      await this.bells.syncFlag(id);
    } catch (error) {
      this.logger.warn(`Bell for flag ${id} failed: ${(error as Error).message}`);
    }
    return this.oneView(actor, await this.load(id));
  }

  // ------------------------------------------------------------ internals

  private async scopeWhere(actor: Actor): Promise<Prisma.ReviewFlagWhereInput> {
    if (actor.role === 'ceo') return {};
    if (actor.role !== 'team_lead' && actor.role !== 'manager') {
      throw new ForbiddenException('Flags are for Team Leads, Managers and the CEO');
    }
    const people = await this.scope.peopleUnder(actor.id);
    const scoped: Prisma.ReviewFlagWhereInput = {
      OR: [{ raisedForStaffId: { in: people } }, ...(actor.role === 'manager' ? [{ ownerStaffId: actor.id }, { raisedForStaffId: null }] : [])],
      // Money flags belong to the CEO and Finance only; a Manager never sees money,
      // and money and bypass flags never go to a Manager at all (they are the CEO's).
      kind: { notIn: actor.role === 'manager' ? [...new Set([...MONEY_FLAG_KINDS, ...CEO_OWNED_FLAG_KINDS])] : MONEY_FLAG_KINDS },
    };
    return scoped;
  }

  private async load(id: string): Promise<ReviewFlag> {
    const flag = await this.prisma.reviewFlag.findUnique({ where: { id } });
    if (!flag) throw new NotFoundException('Flag not found');
    return flag;
  }

  private async oneView(actor: Actor, flag: ReviewFlag) {
    const where = await this.scopeWhere(actor);
    const found = await this.prisma.reviewFlag.findFirst({
      where: { AND: [where, { id: flag.id }] },
      include: { raisedForStaff: { select: BRIEF }, resolvedByStaff: { select: BRIEF } },
    });
    if (!found) throw new NotFoundException('Flag not found in your team');
    const people = actor.role === 'ceo' ? null : await this.scope.peopleUnder(actor.id);
    return this.view(actor, found, people, await this.ownerBriefs([found]));
  }

  private async ownerBriefs(rows: ReviewFlag[]) {
    const ids = [...new Set(rows.flatMap((row) => [row.ownerStaffId, row.escalatedByStaffId]).filter((x): x is string => Boolean(x)))];
    const staff = ids.length ? await this.prisma.staff.findMany({ where: { id: { in: ids } }, select: BRIEF }) : [];
    return new Map(staff.map((row) => [row.id, row]));
  }

  private view(
    actor: Actor,
    row: ReviewFlag & { raisedForStaff: { id: string; code: string; name: string; role: string } | null; resolvedByStaff: { id: string; code: string; name: string; role: string } | null },
    people: string[] | null,
    briefs: Map<string, { id: string; code: string; name: string; role: string }>,
  ) {
    const owner = effectiveOwner(row, row.raisedForStaff?.role ?? null);
    const level = actor.role === 'ceo' ? 3 : actor.role === 'manager' ? 2 : 1;
    const inScope =
      people === null ||
      (row.raisedForStaffId ? people.includes(row.raisedForStaffId) : actor.role === 'manager') ||
      row.ownerStaffId === actor.id;
    const open = row.status === 'open';
    const otherManager = owner === 'manager' && Boolean(row.ownerStaffId) && row.ownerStaffId !== actor.id && actor.role !== 'ceo';
    const atOrAbove = LEVEL[owner] <= level && !otherManager;
    const canResolve = open && inScope && (actor.role === 'ceo' || atOrAbove);
    const canEscalate = open && inScope && actor.role !== 'ceo' && atOrAbove;
    const details = (row.details ?? {}) as Record<string, unknown>;
    return {
      id: row.id,
      code: row.code,
      kind: row.kind,
      title: flagTitle(row.kind),
      subjectType: row.subjectType,
      subjectId: row.subjectId,
      raisedFor: row.raisedForStaff,
      details,
      status: row.status,
      raisedAt: row.raisedAt.toISOString(),
      resolvedAt: row.resolvedAt?.toISOString() ?? null,
      resolvedBy: row.resolvedByStaff,
      resolution: row.resolution,
      ownerRole: owner,
      owner: row.ownerStaffId ? (briefs.get(row.ownerStaffId) ?? null) : null,
      ceoDecides: CEO_OWNED_FLAG_KINDS.includes(row.kind),
      escalated: row.escalatedAt
        ? { at: row.escalatedAt.toISOString(), by: row.escalatedByStaffId ? (briefs.get(row.escalatedByStaffId) ?? null) : null, note: row.escalationNote }
        : null,
      canResolve,
      canEscalate,
    };
  }
}
