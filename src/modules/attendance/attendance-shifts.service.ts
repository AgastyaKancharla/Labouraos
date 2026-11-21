import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import { PricingService } from '../pricing/pricing.service';
import { ReportingScopeService } from '../staff/reporting-scope.service';
import { ATTENDANCE_ROLES } from './attendance-days.service';
import { shiftFor, shiftProblem } from './staff-shift';

interface Actor {
  id: string;
  role: string;
}

export interface ShiftRow {
  staffId: string;
  code: string;
  name: string;
  role: string;
  shiftStart: string;
  shiftEnd: string;
  /** False while the person works the company shift from Settings. */
  own: boolean;
}

/**
 * Own shifts (Master Guide rev 202, decided 21 Nov): set by the person's
 * Team Lead, a Manager over them, or the CEO; never by the person. A shift of
 * their own replaces the company shift for lateness, the shift shown on their
 * screens and the sign-in safety cap. Clearing it goes back to the company shift.
 */
@Injectable()
export class AttendanceShiftsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly pricing: PricingService,
    private readonly scope: ReportingScopeService,
    private readonly audit: AuditService,
  ) {}

  /** The people whose shift the actor may set: a Team Lead's team, a Manager's tree, everyone for the CEO. */
  async list(actor: Actor): Promise<{ companyShift: { start: string; end: string }; people: ShiftRow[] }> {
    if (!['ceo', 'manager', 'team_lead'].includes(actor.role)) {
      throw new ForbiddenException('Only a Team Lead, a Manager or the CEO sets shifts');
    }
    const policy = await this.pricing.current();
    const people = await this.prisma.staff.findMany({
      where: { role: { in: ATTENDANCE_ROLES }, status: { in: ['active', 'pending_invite'] }, id: { not: actor.id } },
      select: { id: true, code: true, name: true, role: true, shiftStart: true, shiftEnd: true },
      orderBy: { code: 'asc' },
    });
    const rows: ShiftRow[] = [];
    for (const person of people) {
      if (actor.role !== 'ceo' && !(await this.scope.personIsUnder(actor.id, person.id))) continue;
      const shift = shiftFor(person, policy);
      rows.push({
        staffId: person.id,
        code: person.code,
        name: person.name,
        role: person.role,
        shiftStart: shift.start,
        shiftEnd: shift.end,
        own: shift.own,
      });
    }
    return { companyShift: { start: policy.shiftStart, end: policy.shiftEnd }, people: rows };
  }

  /**
   * PUT /attendance/shifts/:staffId { shiftStart, shiftEnd } — both "HH:MM",
   * or both null to go back to the company shift. Audited with before/after.
   */
  async set(actor: Actor, staffId: string, body: { shiftStart?: unknown; shiftEnd?: unknown; reason?: unknown }): Promise<ShiftRow> {
    if (!['ceo', 'manager', 'team_lead'].includes(actor.role)) {
      throw new ForbiddenException('Only a Team Lead, a Manager or the CEO sets shifts');
    }
    if (staffId === actor.id) throw new ForbiddenException('You cannot set your own shift');
    const person = await this.prisma.staff.findUnique({
      where: { id: staffId },
      select: { id: true, code: true, name: true, role: true, shiftStart: true, shiftEnd: true },
    });
    if (!person) throw new NotFoundException('Staff account not found');
    if (!ATTENDANCE_ROLES.includes(person.role)) {
      throw new BadRequestException('Only people who mark attendance have a shift');
    }
    if (actor.role !== 'ceo' && !(await this.scope.personIsUnder(actor.id, staffId))) {
      throw new ForbiddenException("Only the person's Team Lead, a Manager over them or the CEO can set their shift");
    }
    const clearing = body?.shiftStart === null && body?.shiftEnd === null;
    let start: string | null = null;
    let end: string | null = null;
    if (!clearing) {
      const problem = shiftProblem(body?.shiftStart, body?.shiftEnd);
      if (problem) throw new BadRequestException(problem);
      start = body.shiftStart as string;
      end = body.shiftEnd as string;
    }
    const reason = typeof body?.reason === 'string' && body.reason.trim() ? body.reason.trim().slice(0, 500) : null;
    await this.prisma.staff.update({
      where: { id: staffId },
      data: { shiftStart: start, shiftEnd: end },
    });
    await this.audit.log({
      actorId: actor.id,
      action: 'staff.shift_changed',
      entityType: 'staff',
      entityCode: person.code,
      before: { shiftStart: person.shiftStart, shiftEnd: person.shiftEnd },
      after: { shiftStart: start, shiftEnd: end },
      ...(reason ? { reason } : {}),
    });
    const policy = await this.pricing.current();
    const shift = shiftFor({ shiftStart: start, shiftEnd: end }, policy);
    return {
      staffId: person.id,
      code: person.code,
      name: person.name,
      role: person.role,
      shiftStart: shift.start,
      shiftEnd: shift.end,
      own: shift.own,
    };
  }
}
