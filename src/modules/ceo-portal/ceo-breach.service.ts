import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import { IdService } from '../../common/id/id.service';

/** Guide, data and privacy: a data breach must be reported within 72 hours. */
export const BREACH_REPORT_HOURS = 72;
export const BREACH_TOLD = ['data_protection_board', 'affected_people', 'cert_in', 'police', 'other'] as const;
export type BreachTold = (typeof BREACH_TOLD)[number];

export const BREACH_TOLD_LABEL: Record<BreachTold, string> = {
  data_protection_board: 'Data Protection Board',
  affected_people: 'The people affected',
  cert_in: 'CERT-In',
  police: 'Police',
  other: 'Someone else',
};

export interface Step {
  at: string;
  text: string;
  byStaffId: string;
}
export interface Told {
  who: BreachTold;
  at: string;
  note: string | null;
  byStaffId: string;
}

function text(value: unknown, field: string, max = 1000, required = true): string {
  const s = typeof value === 'string' ? value.trim() : '';
  if (!s && required) throw new BadRequestException(`${field} is needed`);
  if (s.length > max) throw new BadRequestException(`${field} is at most ${max} characters`);
  return s;
}

/**
 * The 72-hour data-breach register on C-Privacy (CEO only): log a breach when
 * it is found, record each step taken, record who was told (the Data
 * Protection Board by the 72-hour deadline, the people affected, CERT-In…),
 * and close it. Every change is audited without the free text (personal data
 * never goes into the audit log). Holds no personal details itself.
 */
@Injectable()
export class CeoBreachService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly ids: IdService,
  ) {}

  private view(row: Prisma.DataBreachGetPayload<object>, now: Date) {
    const steps = (row.steps as unknown as Step[]) ?? [];
    const told = (row.told as unknown as Told[]) ?? [];
    const msLeft = row.reportDueAt.getTime() - now.getTime();
    return {
      id: row.id,
      code: row.code,
      discoveredAt: row.discoveredAt.toISOString(),
      reportDueAt: row.reportDueAt.toISOString(),
      summary: row.summary,
      dataAffected: row.dataAffected,
      peopleAffected: row.peopleAffected,
      status: row.status,
      steps,
      told: told.map((t) => ({ ...t, label: BREACH_TOLD_LABEL[t.who] ?? t.who })),
      boardToldAt: row.boardToldAt?.toISOString() ?? null,
      /** Past 72 hours and the Board not yet told. */
      overdue: !row.boardToldAt && msLeft < 0,
      hoursLeft: row.boardToldAt ? null : Math.ceil(msLeft / 3_600_000),
      closedAt: row.closedAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
    };
  }

  async list(now: Date) {
    const rows = await this.prisma.dataBreach.findMany({ orderBy: { discoveredAt: 'desc' }, take: 200 });
    const views = rows.map((r) => this.view(r, now));
    return {
      summary: {
        total: rows.length,
        open: views.filter((v) => v.status === 'open').length,
        overdue: views.filter((v) => v.overdue).length,
        boardToldInTime: views.filter((v) => v.boardToldAt && v.boardToldAt <= v.reportDueAt).length,
        reportHours: BREACH_REPORT_HOURS,
      },
      rows: views,
    };
  }

  async create(actorId: string, body: Record<string, unknown>, now: Date) {
    const summary = text(body.summary, 'What happened');
    const dataAffected = text(body.dataAffected, 'What data was affected');
    let discoveredAt = now;
    if (body.discoveredAt !== undefined && body.discoveredAt !== null && body.discoveredAt !== '') {
      const raw = String(body.discoveredAt);
      // A calendar day counts from the start of that day in India, so the deadline is never later than the truth.
      discoveredAt = new Date(/^\d{4}-\d{2}-\d{2}$/.test(raw) ? `${raw}T00:00:00+05:30` : raw);
      if (Number.isNaN(discoveredAt.getTime())) throw new BadRequestException('discoveredAt is a date');
      if (discoveredAt.getTime() > now.getTime()) throw new BadRequestException('A breach cannot be found in the future');
    }
    let peopleAffected: number | null = null;
    if (body.peopleAffected !== undefined && body.peopleAffected !== null && body.peopleAffected !== '') {
      peopleAffected = Number(body.peopleAffected);
      if (!Number.isInteger(peopleAffected) || peopleAffected < 0) throw new BadRequestException('peopleAffected is a whole number');
    }
    const code = await this.ids.generateCode('BR');
    const row = await this.prisma.dataBreach.create({
      data: {
        code,
        discoveredAt,
        reportDueAt: new Date(discoveredAt.getTime() + BREACH_REPORT_HOURS * 3_600_000),
        summary,
        dataAffected,
        peopleAffected,
        createdByStaffId: actorId,
        steps: [{ at: now.toISOString(), text: 'Breach logged', byStaffId: actorId }] as unknown as Prisma.InputJsonValue,
      },
    });
    await this.audit.log({
      actorId,
      action: 'privacy.breach_logged',
      entityType: 'data_breach',
      entityCode: code,
      after: { discoveredAt: discoveredAt.toISOString(), reportDueAt: row.reportDueAt.toISOString(), peopleAffected },
    });
    return this.view(row, now);
  }

  private async load(id: string) {
    const row = await this.prisma.dataBreach.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('Breach not found');
    return row;
  }

  async addStep(actorId: string, id: string, body: Record<string, unknown>, now: Date) {
    const row = await this.load(id);
    if (row.status === 'closed') throw new ConflictException('This breach is closed');
    const step: Step = { at: now.toISOString(), text: text(body.text, 'The step', 1000), byStaffId: actorId };
    const steps = [...((row.steps as unknown as Step[]) ?? []), step];
    const saved = await this.prisma.dataBreach.update({ where: { id }, data: { steps: steps as unknown as Prisma.InputJsonValue } });
    await this.audit.log({ actorId, action: 'privacy.breach_step', entityType: 'data_breach', entityCode: row.code, after: { steps: steps.length } });
    return this.view(saved, now);
  }

  async recordTold(actorId: string, id: string, body: Record<string, unknown>, now: Date) {
    const row = await this.load(id);
    const who = String(body.who ?? '') as BreachTold;
    if (!(BREACH_TOLD as readonly string[]).includes(who)) throw new BadRequestException(`who is one of ${BREACH_TOLD.join(', ')}`);
    let at = now;
    if (body.at) {
      at = new Date(String(body.at));
      if (Number.isNaN(at.getTime()) || at.getTime() > now.getTime()) throw new BadRequestException('at is a time that has passed');
    }
    const note = text(body.note, 'The note', 500, false) || null;
    const told = [...((row.told as unknown as Told[]) ?? []), { who, at: at.toISOString(), note, byStaffId: actorId }];
    const boardToldAt = who === 'data_protection_board' && !row.boardToldAt ? at : row.boardToldAt;
    const saved = await this.prisma.dataBreach.update({ where: { id }, data: { told: told as unknown as Prisma.InputJsonValue, boardToldAt } });
    await this.audit.log({
      actorId,
      action: 'privacy.breach_told',
      entityType: 'data_breach',
      entityCode: row.code,
      after: { who, at: at.toISOString(), withinDeadline: at.getTime() <= row.reportDueAt.getTime() },
    });
    return this.view(saved, now);
  }

  async close(actorId: string, id: string, body: Record<string, unknown>, now: Date) {
    const row = await this.load(id);
    if (row.status === 'closed') throw new ConflictException('This breach is already closed');
    if (!row.boardToldAt) throw new BadRequestException('Record when the Data Protection Board was told before closing');
    const closing = text(body.note, 'What closed it', 1000);
    const steps = [...((row.steps as unknown as Step[]) ?? []), { at: now.toISOString(), text: `Closed: ${closing}`, byStaffId: actorId }];
    const saved = await this.prisma.dataBreach.update({
      where: { id },
      data: { status: 'closed', closedAt: now, closedByStaffId: actorId, steps: steps as unknown as Prisma.InputJsonValue },
    });
    await this.audit.log({ actorId, action: 'privacy.breach_closed', entityType: 'data_breach', entityCode: row.code, before: { status: 'open' }, after: { status: 'closed' } });
    return this.view(saved, now);
  }
}
