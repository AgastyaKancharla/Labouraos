import { PrismaService } from '../../common/prisma/prisma.service';
import { istDateKey } from '../signup-tracker/signup-timing';
import { ownerAccountIds } from '../signup-tracker/signup-owner-accounts';
import { ShiftPolicy, onShiftAt, shiftFor } from '../attendance/staff-shift';
import { NOT_IN_START_OF_DAY } from '../attendance/attendance.constants';

/**
 * Who gets an inbound WhatsApp conversation or a referral partner's lead
 * (Master Guide rev 202, 21 Nov: "assigned by the software like missed calls").
 *
 *   1. The person's own agent, when that agent is a call agent on shift.
 *   2. Otherwise the call agent on shift with the fewest open conversations and
 *      referral leads; ties go to whoever was given one least recently, then by
 *      staff code.
 *   3. Nobody on shift: it waits unassigned and is handed out when the next
 *      shift starts (the sweep runs every few minutes).
 *
 * "On shift" is the same as for sign-up help calls and missed calls: the agent's
 * attendance day is open today and is not a leave day, and now is inside the
 * agent's own shift (src/modules/attendance/staff-shift.ts; the company shift for
 * someone without one). An owner account (no attendance) counts while it is
 * signed in.
 */
export interface LeadAgent {
  id: string;
  code: string;
  teamLeadId: string | null;
  onShift: boolean;
  openItems: number;
  lastAssignedAt: Date | null;
}

export type LeadAssignmentReason = 'own_agent' | 'fair_share';

export function pickLeadAgent(candidates: LeadAgent[], ownAgentIds: Array<string | null | undefined>): { staffId: string; reason: LeadAssignmentReason } | null {
  const available = candidates.filter((c) => c.onShift);
  for (const id of ownAgentIds) {
    if (id && available.some((c) => c.id === id)) return { staffId: id, reason: 'own_agent' };
  }
  if (available.length === 0) return null;
  const pick = [...available].sort((a, b) => {
    if (a.openItems !== b.openItems) return a.openItems - b.openItems;
    const at = a.lastAssignedAt?.getTime() ?? 0;
    const bt = b.lastAssignedAt?.getTime() ?? 0;
    if (at !== bt) return at - bt;
    return a.code.localeCompare(b.code);
  })[0];
  return { staffId: pick.id, reason: 'fair_share' };
}

/** Every active call agent, with whether they are on shift now and how many open WhatsApp items they hold. */
export async function loadLeadAgents(prisma: PrismaService, now: Date, policy: ShiftPolicy): Promise<LeadAgent[]> {
  const staff = await prisma.staff.findMany({
    where: {
      role: 'call_agent',
      status: 'active',
      lockedByStaffId: null,
      OR: [{ lockedUntil: null }, { lockedUntil: { lte: now } }],
    },
    select: { id: true, code: true, teamLeadId: true, shiftStart: true, shiftEnd: true },
  });
  if (staff.length === 0) return [];
  const ids = staff.map((s) => s.id);
  const today = new Date(`${istDateKey(now.getTime())}T00:00:00.000Z`);
  const [days, sessions, conversations, leads, lastConversation, lastLead, owners] = await Promise.all([
    prisma.attendanceDay.findMany({
      where: { staffId: { in: ids }, date: today, loginAt: { not: null }, logoutAt: null, dayType: { not: 'leave' }, ...NOT_IN_START_OF_DAY },
      select: { staffId: true },
    }),
    prisma.staffSession.findMany({
      where: { staffId: { in: ids }, revokedAt: null, expiresAt: { gt: now }, absoluteExpiresAt: { gt: now } },
      select: { staffId: true },
    }),
    prisma.whatsAppConversation.groupBy({ by: ['assignedStaffId'], where: { assignedStaffId: { in: ids }, status: 'open' }, _count: { _all: true } }),
    prisma.referralLead.groupBy({ by: ['assignedStaffId'], where: { assignedStaffId: { in: ids }, status: 'open' }, _count: { _all: true } }),
    prisma.whatsAppConversation.groupBy({ by: ['assignedStaffId'], where: { assignedStaffId: { in: ids } }, _max: { assignedAt: true } }),
    prisma.referralLead.groupBy({ by: ['assignedStaffId'], where: { assignedStaffId: { in: ids } }, _max: { assignedAt: true } }),
    ownerAccountIds(prisma, ids),
  ]);
  const onDay = new Set(days.map((d) => d.staffId));
  const signedIn = new Set(sessions.map((s) => s.staffId));
  const open = new Map<string, number>();
  for (const row of [...conversations, ...leads]) {
    if (row.assignedStaffId) open.set(row.assignedStaffId, (open.get(row.assignedStaffId) ?? 0) + row._count._all);
  }
  const last = new Map<string, Date>();
  for (const row of [...lastConversation, ...lastLead]) {
    const at = row._max.assignedAt;
    if (!row.assignedStaffId || !at) continue;
    const before = last.get(row.assignedStaffId);
    if (!before || at > before) last.set(row.assignedStaffId, at);
  }
  return staff.map((s) => ({
    id: s.id,
    code: s.code,
    teamLeadId: s.teamLeadId,
    onShift: owners.has(s.id) ? signedIn.has(s.id) : onDay.has(s.id) && onShiftAt(now, shiftFor(s, policy)),
    openItems: open.get(s.id) ?? 0,
    lastAssignedAt: last.get(s.id) ?? null,
  }));
}

/** The agents who look after a person: assigned agent first, then who registered them (job seeker, partner), account agent then lead creator (business). */
export async function ownAgentsOf(prisma: PrismaService, subjectType: string | null, subjectId: string | null): Promise<string[]> {
  if (!subjectType || !subjectId) return [];
  if (subjectType === 'job_seeker') {
    const row = await prisma.jobSeeker.findUnique({ where: { id: subjectId }, select: { assignedStaffId: true, registeredByStaffId: true } });
    return [row?.assignedStaffId, row?.registeredByStaffId].filter((v): v is string => Boolean(v));
  }
  if (subjectType === 'referral') {
    const row = await prisma.referral.findUnique({ where: { id: subjectId }, select: { assignedStaffId: true, registeredByStaffId: true } });
    return [row?.assignedStaffId, row?.registeredByStaffId].filter((v): v is string => Boolean(v));
  }
  if (subjectType === 'business') {
    const row = await prisma.business.findUnique({ where: { id: subjectId }, select: { accountAgentId: true, leadCreatedByStaffId: true } });
    return [row?.accountAgentId, row?.leadCreatedByStaffId].filter((v): v is string => Boolean(v));
  }
  return [];
}
