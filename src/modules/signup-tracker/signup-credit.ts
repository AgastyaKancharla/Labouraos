import { PrismaClient } from '@prisma/client';
import { NOT_OWNER_ACCOUNT } from '../staff/owner-account';

type Reader = Pick<PrismaClient, 'signupTracker' | 'jobSeeker' | 'staff'>;

/**
 * "Candidates activated" from app sign-ups (question 13, confirmed 14 Nov):
 * job seekers who signed up in the app, were helped by this call agent, and
 * whose 30 days started in the period (Master Guide rev 211, 25 Nov: the credit
 * counts when the ID check passes / the guarantee starts — paid AND ID passed —
 * not at payment; JobSeeker.guaranteeStartsAt). A sign-up counts as assisted only when the
 * tracker recorded the assigned agent's answered call (60 seconds or more)
 * between the assignment and the payment (SignupTrackerService.creditFor); a self-finished sign-up credits
 * nobody. A record this agent registered is already counted by the normal
 * rule and is not counted twice. Owner accounts have no targets (owner
 * decision 14 Nov): their assisted sign-ups stay in the lists, never here.
 */
export async function assistedActivations(prisma: Reader, staffId: string, from: Date, to: Date): Promise<number> {
  const counted = await prisma.staff.findFirst({ where: { id: staffId, ...NOT_OWNER_ACCOUNT }, select: { id: true } });
  if (!counted) return 0;
  const trackers = await prisma.signupTracker.findMany({
    where: { profileKind: 'job_seeker', subjectType: 'job_seeker', outcome: 'assisted', assignedStaffId: staffId, subjectId: { not: null }, assignedAt: { not: null } },
    select: { subjectId: true, assignedAt: true },
  });
  if (trackers.length === 0) return 0;
  const assignedAt = new Map(trackers.map((t) => [t.subjectId!, t.assignedAt!]));
  const paid = await prisma.jobSeeker.findMany({
    where: {
      id: { in: [...assignedAt.keys()] },
      paymentReceivedAt: { not: null },
      guaranteeStartsAt: { not: null, gte: from, lte: to },
      OR: [{ registeredByStaffId: null }, { registeredByStaffId: { not: staffId } }],
    },
    select: { id: true, paymentReceivedAt: true },
  });
  // The ₹499 must have arrived after the sign-up was given to this agent (his help led to the payment).
  return paid.filter((s) => s.paymentReceivedAt! > assignedAt.get(s.id)!).length;
}
