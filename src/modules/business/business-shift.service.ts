import { HttpStatus, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import { codedError } from '../../common/http/coded-error';
import { MAX_SHIFTS_PER_BUSINESS, readShiftInput, shiftCategory, shiftLabel } from './business-shift';

/** Who changes a shift: a staff member, or the owner's Laboura app account. */
export type ShiftActor = { staffId: string } | { accountId: string };

export interface ShiftView {
  id: string;
  businessId: string;
  name: string;
  startTime: string;
  endTime: string;
  /** "Morning 07:00–15:00". */
  label: string;
  /** day or night, read from the times (what matching uses). */
  category: 'day' | 'night';
}

/**
 * Shifts per business (17 Nov, Master Guide rev 193): each business keeps
 * its own list of shifts; a vacancy picks one. The staff routes are scoped
 * by the business write rule (field agent: own businesses; call agent: own
 * leads; Team Lead: own team; Manager / CEO: all); the owner changes his
 * own business's shifts in the Laboura app. Every change is audit-logged.
 */
@Injectable()
export class BusinessShiftService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  static view(row: { id: string; businessId: string; name: string; startTime: string; endTime: string }): ShiftView {
    return {
      id: row.id,
      businessId: row.businessId,
      name: row.name,
      startTime: row.startTime,
      endTime: row.endTime,
      label: shiftLabel(row),
      category: shiftCategory(row.startTime, row.endTime),
    };
  }

  private async business(ref: string): Promise<{ id: string; code: string }> {
    const business = typeof ref === 'string' && ref.length <= 64
      ? await this.prisma.business.findFirst({ where: { OR: [{ id: ref }, { code: ref.toUpperCase() }], anonymisedAt: null }, select: { id: true, code: true } })
      : null;
    if (!business) throw new NotFoundException('Business not found');
    return business;
  }

  private actorId(actor: ShiftActor): string {
    return 'staffId' in actor ? actor.staffId : `customer:${actor.accountId}`;
  }

  async list(ref: string): Promise<ShiftView[]> {
    const { id: businessId } = await this.business(ref);
    const rows = await this.prisma.businessShift.findMany({ where: { businessId }, orderBy: [{ startTime: 'asc' }, { name: 'asc' }] });
    return rows.map(BusinessShiftService.view);
  }

  async create(ref: string, body: unknown, actor: ShiftActor): Promise<ShiftView> {
    const { id: businessId, code } = await this.business(ref);
    const { value, errors } = readShiftInput(body);
    if (errors.length) throw codedError(HttpStatus.BAD_REQUEST, 'SHIFT_INVALID', 'Give the shift a name and its start and end as HH:MM', { fields: errors });
    if ((await this.prisma.businessShift.count({ where: { businessId } })) >= MAX_SHIFTS_PER_BUSINESS) {
      throw codedError(HttpStatus.CONFLICT, 'SHIFT_LIMIT', `A business keeps at most ${MAX_SHIFTS_PER_BUSINESS} shifts`);
    }
    try {
      const createdByStaffId = 'staffId' in actor ? actor.staffId : null;
      const createdByAccountId = 'accountId' in actor ? actor.accountId : null;
      const row = await this.prisma.businessShift.create({
        data: { businessId, name: value.name!, startTime: value.startTime!, endTime: value.endTime!, createdByStaffId, createdByAccountId },
      });
      await this.audit.log({ actorId: this.actorId(actor), action: 'business.shift_added', entityType: 'business', entityCode: code, after: { shiftId: row.id, shiftName: row.name, startTime: row.startTime, endTime: row.endTime } });
      return BusinessShiftService.view(row);
    } catch (error) {
      throw this.duplicate(error);
    }
  }

  async update(ref: string, shiftId: string, body: unknown, actor: ShiftActor): Promise<ShiftView> {
    const { id: businessId, code } = await this.business(ref);
    const before = await this.own(businessId, shiftId);
    const { value, errors } = readShiftInput(body, true);
    const startTime = value.startTime ?? before.startTime;
    const endTime = value.endTime ?? before.endTime;
    if (startTime === endTime && !errors.includes('endTime')) errors.push('endTime');
    if (errors.length) throw codedError(HttpStatus.BAD_REQUEST, 'SHIFT_INVALID', 'Give the shift a name and its start and end as HH:MM', { fields: errors });
    try {
      const row = await this.prisma.businessShift.update({
        where: { id: before.id },
        data: { name: value.name, startTime: value.startTime, endTime: value.endTime },
      });
      await this.audit.log({
        actorId: this.actorId(actor), action: 'business.shift_changed', entityType: 'business', entityCode: code,
        before: { shiftId: before.id, shiftName: before.name, startTime: before.startTime, endTime: before.endTime },
        after: { shiftId: row.id, shiftName: row.name, startTime: row.startTime, endTime: row.endTime },
      });
      return BusinessShiftService.view(row);
    } catch (error) {
      throw this.duplicate(error);
    }
  }

  /** Removes a shift. Vacancies that picked it keep its label and times (their own copy). */
  async remove(ref: string, shiftId: string, actor: ShiftActor): Promise<{ removed: true }> {
    const { id: businessId, code } = await this.business(ref);
    const before = await this.own(businessId, shiftId);
    await this.prisma.businessShift.delete({ where: { id: before.id } });
    await this.audit.log({
      actorId: this.actorId(actor), action: 'business.shift_removed', entityType: 'business', entityCode: code,
      before: { shiftId: before.id, shiftName: before.name, startTime: before.startTime, endTime: before.endTime },
    });
    return { removed: true };
  }

  private async own(businessId: string, shiftId: string) {
    const row = typeof shiftId === 'string' && shiftId.length <= 64
      ? await this.prisma.businessShift.findFirst({ where: { id: shiftId, businessId } })
      : null;
    if (!row) throw codedError(HttpStatus.NOT_FOUND, 'SHIFT_NOT_FOUND', 'Shift not found for this business');
    return row;
  }

  private duplicate(error: unknown): unknown {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      return codedError(HttpStatus.CONFLICT, 'SHIFT_NAME_TAKEN', 'This business already has a shift with this name');
    }
    return error;
  }
}
