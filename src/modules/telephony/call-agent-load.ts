import { PrismaService } from '../../common/prisma/prisma.service';

const IST_OFFSET_MS = (5 * 60 + 30) * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Start of the IST calendar day containing `at`, as a UTC instant. */
export function istDayStartUtc(at: Date): Date {
  return new Date(Math.floor((at.getTime() + IST_OFFSET_MS) / DAY_MS) * DAY_MS - IST_OFFSET_MS);
}

/** The IST calendar date of `at` as a @db.Date value (UTC midnight of that date). */
export function istDateValue(at: Date): Date {
  return new Date(istDayStartUtc(at).getTime() + IST_OFFSET_MS);
}

/** Minutes past IST midnight. */
export function istMinute(at: Date): number {
  return Math.floor(((at.getTime() + IST_OFFSET_MS) % DAY_MS) / 60000);
}

export function clockMinutes(hhmm: string | null | undefined): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm ?? '').trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

/**
 * An agent's shift. TODO(Builder A, per-agent shifts): read the agent's own
 * shift start and end once that is merged; until then the company shift in
 * PricingPolicy (shiftStart / shiftEnd).
 */
export function shiftOf(
  policy: { shiftStart?: string | null; shiftEnd?: string | null },
  staff?: { shiftStart?: string | null; shiftEnd?: string | null } | null,
): { start: string; end: string } {
  return {
    start: staff?.shiftStart ?? policy.shiftStart ?? '09:30',
    end: staff?.shiftEnd ?? policy.shiftEnd ?? '18:30',
  };
}

/**
 * Open items per agent (21 Nov fixes: "the agent with the fewest open items"):
 * open call tasks due by the end of today, missed calls they hold, and pending
 * follow-ups due by the end of today.
 */
export async function openItemCounts(prisma: PrismaService, staffIds: string[], now: Date): Promise<Map<string, number>> {
  const counts = new Map<string, number>(staffIds.map((id) => [id, 0]));
  if (staffIds.length === 0) return counts;
  const endOfToday = new Date(istDayStartUtc(now).getTime() + DAY_MS);
  const [tasks, callbacks, followUps] = await Promise.all([
    prisma.callTask.groupBy({ by: ['staffId'], where: { staffId: { in: staffIds }, status: 'open', dueAt: { lt: endOfToday } }, _count: { _all: true } }),
    prisma.callbackTask.groupBy({ by: ['assignedToStaffId'], where: { assignedToStaffId: { in: staffIds }, status: 'assigned' }, _count: { _all: true } }),
    prisma.followUpTask.groupBy({ by: ['assignedStaffId'], where: { assignedStaffId: { in: staffIds }, status: 'pending', dueAt: { lt: endOfToday } }, _count: { _all: true } }),
  ]);
  for (const t of tasks) counts.set(t.staffId, (counts.get(t.staffId) ?? 0) + t._count._all);
  for (const c of callbacks) if (c.assignedToStaffId) counts.set(c.assignedToStaffId, (counts.get(c.assignedToStaffId) ?? 0) + c._count._all);
  for (const f of followUps) if (f.assignedStaffId) counts.set(f.assignedStaffId, (counts.get(f.assignedStaffId) ?? 0) + f._count._all);
  return counts;
}

/**
 * Call agents on shift now: active, not locked, today's attendance day open
 * (logged in, not logged out, not a leave day). Sorted by staff code.
 */
export async function onShiftCallAgents(prisma: PrismaService, now: Date, among?: string[]): Promise<string[]> {
  const staff = await prisma.staff.findMany({
    where: {
      role: 'call_agent',
      status: 'active',
      lockedByStaffId: null,
      OR: [{ lockedUntil: null }, { lockedUntil: { lte: now } }],
      ...(among ? { id: { in: among } } : {}),
    },
    select: { id: true },
    orderBy: { code: 'asc' },
  });
  if (staff.length === 0) return [];
  const days = await prisma.attendanceDay.findMany({
    where: { staffId: { in: staff.map((s) => s.id) }, date: istDateValue(now), loginAt: { not: null }, logoutAt: null, dayType: { not: 'leave' } },
    select: { staffId: true },
  });
  const open = new Set(days.map((d) => d.staffId));
  return staff.map((s) => s.id).filter((id) => open.has(id));
}

/** The one with the fewest open items; ties go to whoever was given work longest ago, then by the list order. */
export function fewestOpen(candidates: string[], counts: Map<string, number>, lastGiven: Map<string, Date | null> = new Map()): string | null {
  let best: string | null = null;
  for (const id of candidates) {
    if (best === null) {
      best = id;
      continue;
    }
    const a = counts.get(id) ?? 0;
    const b = counts.get(best) ?? 0;
    if (a < b) {
      best = id;
    } else if (a === b) {
      const ta = lastGiven.get(id)?.getTime() ?? 0;
      const tb = lastGiven.get(best)?.getTime() ?? 0;
      if (ta < tb) best = id;
    }
  }
  return best;
}
