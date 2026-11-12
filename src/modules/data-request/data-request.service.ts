import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { DataRequest, Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { IdService } from '../../common/id/id.service';
import { AuditService } from '../../common/audit/audit.service';

/** Injectable time, so tests can fix "today" (AGENTS.md §9). */
export class DataRequestClock {
  now(): Date {
    return new Date();
  }
}

export const DATA_REQUEST_KINDS = ['access', 'correction', 'erasure'] as const;
export const DATA_REQUEST_STATUSES = ['open', 'in_progress', 'closed'] as const;
export const DATA_REQUEST_OUTCOMES = ['done', 'partly_done', 'refused', 'withdrawn'] as const;
export type DataRequestKind = (typeof DATA_REQUEST_KINDS)[number];
export type DataRequestOutcome = (typeof DATA_REQUEST_OUTCOMES)[number];

/**
 * Days Laboura has to answer a data request. The Master Guide's privacy
 * section gives no deadline, so 30 days is used until a lawyer confirms it
 * (Master Guide, open question: lawyer review of the privacy notice).
 */
export const DATA_REQUEST_DUE_DAYS = 30;

const IST_OFFSET_MS = 330 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

/** The IST calendar day of an instant, as YYYY-MM-DD. */
export function istDateKey(at: Date): string {
  return new Date(at.getTime() + IST_OFFSET_MS).toISOString().slice(0, 10);
}

/** A DATE column value for a YYYY-MM-DD key (UTC midnight, as Prisma stores DATE). */
function dateOnly(key: string): Date {
  return new Date(`${key}T00:00:00.000Z`);
}

export function dueDateFor(receivedOn: string): string {
  return new Date(dateOnly(receivedOn).getTime() + DATA_REQUEST_DUE_DAYS * DAY_MS).toISOString().slice(0, 10);
}

const SUBJECT_BY_PREFIX: Record<string, 'job_seeker' | 'business' | 'referral'> = {
  JS: 'job_seeker',
  BZ: 'business',
  RF: 'referral',
};

/** No phone, Aadhaar or account numbers in the register's free text: any run of 10+ digits is refused. */
const LONG_NUMBER = /\d(?:[\s.-]?\d){9,}/;

export interface DataRequestActor {
  id: string;
  role: string;
}

export interface CreateDataRequestDto {
  kind?: string;
  subjectCode?: string;
  receivedOn?: string;
  details?: string | null;
}

export interface UpdateDataRequestDto {
  status?: string;
  details?: string | null;
}

export interface CloseDataRequestDto {
  outcome?: string;
  outcomeNote?: string;
}

export interface DataRequestView {
  id: string;
  code: string;
  kind: string;
  subjectType: string;
  subjectCode: string;
  details: string | null;
  receivedOn: string;
  dueOn: string;
  /** Whole days until the due date (negative once overdue); null once closed. */
  daysLeft: number | null;
  overdue: boolean;
  status: string;
  outcome: string | null;
  outcomeNote: string | null;
  loggedBy: { id: string; name: string | null };
  closedBy: { id: string; name: string | null } | null;
  closedAt: string | null;
}

/**
 * The register of data requests under India's data law (C-Privacy). Only the
 * CEO logs, updates and closes them; every write is audited (codes, kinds,
 * statuses and dates only — never the free text, which may name the person).
 */
@Injectable()
export class DataRequestService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ids: IdService,
    private readonly audit: AuditService,
    private readonly clock: DataRequestClock,
  ) {}

  async list(actor: DataRequestActor, filters: { status?: string } = {}) {
    this.assertCeo(actor);
    const where: Prisma.DataRequestWhereInput = {};
    if (filters.status === 'open_or_in_progress' || filters.status === 'not_closed') {
      where.status = { in: ['open', 'in_progress'] };
    } else if (filters.status && (DATA_REQUEST_STATUSES as readonly string[]).includes(filters.status)) {
      where.status = filters.status;
    }
    const rows = await this.prisma.dataRequest.findMany({
      where,
      orderBy: [{ dueOn: 'asc' }, { createdAt: 'asc' }],
      take: 500,
    });
    const today = istDateKey(this.clock.now());
    const views = await this.views(rows, today);
    const open = views.filter((r) => r.status !== 'closed');
    // Open requests first (soonest due first), then closed ones (latest first).
    const closed = views.filter((r) => r.status === 'closed').sort((a, b) => (b.closedAt ?? '').localeCompare(a.closedAt ?? ''));
    return {
      dueDays: DATA_REQUEST_DUE_DAYS,
      summary: {
        open: open.length,
        overdue: open.filter((r) => r.overdue).length,
        closedThisMonth: closed.filter((r) => r.closedAt && istDateKey(new Date(r.closedAt)).slice(0, 7) === today.slice(0, 7)).length,
      },
      rows: [...open, ...closed],
    };
  }

  async create(actor: DataRequestActor, dto: CreateDataRequestDto): Promise<DataRequestView> {
    this.assertCeo(actor);
    const kind = this.kind(dto.kind);
    const subject = await this.subject(dto.subjectCode);
    const today = istDateKey(this.clock.now());
    const receivedOn = this.receivedOn(dto.receivedOn, today);
    const details = this.text(dto.details, 'details', 500);
    const code = await this.ids.generateCode('data_request');
    const row = await this.prisma.dataRequest.create({
      data: {
        code,
        kind,
        subjectType: subject.type,
        subjectId: subject.id,
        subjectCode: subject.code,
        details,
        receivedOn: dateOnly(receivedOn),
        dueOn: dateOnly(dueDateFor(receivedOn)),
        status: 'open',
        loggedByStaffId: actor.id,
      },
    });
    await this.audit.log({
      actorId: actor.id,
      action: 'data_request.logged',
      entityType: 'data_request',
      entityCode: row.code,
      after: { kind, subjectType: subject.type, subjectCode: subject.code, receivedOn, dueOn: dueDateFor(receivedOn), status: 'open' },
      changedFields: details ? ['details'] : [],
    });
    return (await this.views([row], today))[0];
  }

  async update(actor: DataRequestActor, id: string, dto: UpdateDataRequestDto): Promise<DataRequestView> {
    this.assertCeo(actor);
    const row = await this.find(id);
    if (row.status === 'closed') {
      throw new BadRequestException('This request is closed and can no longer be changed');
    }
    const data: Prisma.DataRequestUpdateInput = { updatedByStaffId: actor.id };
    const changed: string[] = [];
    if (dto.status !== undefined) {
      if (dto.status !== 'open' && dto.status !== 'in_progress') {
        throw new BadRequestException('Status must be open or in_progress (use close to close a request)');
      }
      if (dto.status !== row.status) {
        data.status = dto.status;
        changed.push('status');
      }
    }
    if (dto.details !== undefined) {
      const details = this.text(dto.details, 'details', 500);
      if (details !== row.details) {
        data.details = details;
        changed.push('details');
      }
    }
    if (changed.length === 0) {
      return (await this.views([row], istDateKey(this.clock.now())))[0];
    }
    const updated = await this.prisma.dataRequest.update({ where: { id: row.id }, data });
    await this.audit.log({
      actorId: actor.id,
      action: 'data_request.updated',
      entityType: 'data_request',
      entityCode: row.code,
      before: { status: row.status },
      after: { status: updated.status },
      changedFields: changed,
    });
    return (await this.views([updated], istDateKey(this.clock.now())))[0];
  }

  async close(actor: DataRequestActor, id: string, dto: CloseDataRequestDto): Promise<DataRequestView> {
    this.assertCeo(actor);
    const row = await this.find(id);
    if (row.status === 'closed') {
      throw new BadRequestException('This request is already closed');
    }
    if (!dto.outcome || !(DATA_REQUEST_OUTCOMES as readonly string[]).includes(dto.outcome)) {
      throw new BadRequestException(`Outcome must be one of: ${DATA_REQUEST_OUTCOMES.join(', ')}`);
    }
    const outcomeNote = this.text(dto.outcomeNote, 'outcomeNote', 1000);
    if (!outcomeNote) {
      throw new BadRequestException('Write what was done (the outcome note)');
    }
    const now = this.clock.now();
    const updated = await this.prisma.dataRequest.update({
      where: { id: row.id },
      data: { status: 'closed', outcome: dto.outcome, outcomeNote, closedAt: now, closedByStaffId: actor.id, updatedByStaffId: actor.id },
    });
    await this.audit.log({
      actorId: actor.id,
      action: 'data_request.closed',
      entityType: 'data_request',
      entityCode: row.code,
      before: { status: row.status },
      after: { status: 'closed', outcome: dto.outcome, closedOn: istDateKey(now), dueOn: row.dueOn.toISOString().slice(0, 10) },
      changedFields: ['status', 'outcome', 'outcomeNote', 'closedAt'],
    });
    return (await this.views([updated], istDateKey(now)))[0];
  }

  private async find(id: string): Promise<DataRequest> {
    const row = await this.prisma.dataRequest.findUnique({ where: { id } });
    if (!row) {
      throw new NotFoundException('Data request not found');
    }
    return row;
  }

  private assertCeo(actor: DataRequestActor): void {
    if (actor.role !== 'ceo') {
      throw new ForbiddenException('Only the CEO handles data requests');
    }
  }

  private kind(value: string | undefined): DataRequestKind {
    if (!value || !(DATA_REQUEST_KINDS as readonly string[]).includes(value)) {
      throw new BadRequestException(`Kind must be one of: ${DATA_REQUEST_KINDS.join(', ')}`);
    }
    return value as DataRequestKind;
  }

  private receivedOn(value: string | undefined, today: string): string {
    if (!value) {
      return today;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(dateOnly(value).getTime()) || dateOnly(value).toISOString().slice(0, 10) !== value) {
      throw new BadRequestException('receivedOn must be a date (YYYY-MM-DD)');
    }
    if (value > today) {
      throw new BadRequestException('A request cannot be received in the future');
    }
    return value;
  }

  private text(value: string | null | undefined, field: string, max: number): string | null {
    if (value === null || value === undefined) {
      return null;
    }
    if (typeof value !== 'string') {
      throw new BadRequestException(`${field} must be text`);
    }
    const trimmed = value.trim();
    if (!trimmed) {
      return null;
    }
    if (trimmed.length > max) {
      throw new BadRequestException(`${field} is too long (at most ${max} characters)`);
    }
    if (LONG_NUMBER.test(trimmed)) {
      throw new BadRequestException('Leave out phone, Aadhaar and account numbers: name the person by their JS-, BZ- or RF- code');
    }
    return trimmed;
  }

  private async subject(raw: string | undefined): Promise<{ type: 'job_seeker' | 'business' | 'referral'; id: string; code: string }> {
    const code = raw?.trim().toUpperCase() ?? '';
    const type = SUBJECT_BY_PREFIX[code.split('-')[0]];
    if (!type || !/^[A-Z]{2}-\d+$/.test(code)) {
      throw new BadRequestException('Name who asked by their code: JS- (job seeker), BZ- (business) or RF- (referral partner)');
    }
    const found =
      type === 'job_seeker'
        ? await this.prisma.jobSeeker.findUnique({ where: { code }, select: { id: true } })
        : type === 'business'
          ? await this.prisma.business.findUnique({ where: { code }, select: { id: true } })
          : await this.prisma.referral.findUnique({ where: { code }, select: { id: true } });
    if (!found) {
      throw new NotFoundException(`No one found with the code ${code}`);
    }
    return { type, id: found.id, code };
  }

  private async views(rows: DataRequest[], today: string): Promise<DataRequestView[]> {
    const staffIds = [...new Set(rows.flatMap((r) => [r.loggedByStaffId, r.closedByStaffId].filter((x): x is string => !!x)))];
    const staff = staffIds.length
      ? await this.prisma.staff.findMany({ where: { id: { in: staffIds } }, select: { id: true, name: true } })
      : [];
    const names = new Map(staff.map((s) => [s.id, s.name]));
    return rows.map((r) => {
      const dueOn = r.dueOn.toISOString().slice(0, 10);
      const open = r.status !== 'closed';
      const daysLeft = open ? Math.round((dateOnly(dueOn).getTime() - dateOnly(today).getTime()) / DAY_MS) : null;
      return {
        id: r.id,
        code: r.code,
        kind: r.kind,
        subjectType: r.subjectType,
        subjectCode: r.subjectCode,
        details: r.details,
        receivedOn: r.receivedOn.toISOString().slice(0, 10),
        dueOn,
        daysLeft,
        overdue: daysLeft !== null && daysLeft < 0,
        status: r.status,
        outcome: r.outcome,
        outcomeNote: r.outcomeNote,
        loggedBy: { id: r.loggedByStaffId, name: names.get(r.loggedByStaffId) ?? null },
        closedBy: r.closedByStaffId ? { id: r.closedByStaffId, name: names.get(r.closedByStaffId) ?? null } : null,
        closedAt: r.closedAt ? r.closedAt.toISOString() : null,
      };
    });
  }
}
