import { PrismaClient } from '@prisma/client';

type Reader = Pick<PrismaClient, 'signupTracker' | 'jobSeeker'>;

/**
 * "Candidates activated" from app sign-ups (question 13, confirmed 14 Nov):
 * job seekers who signed up in the app, were helped by this call agent, and
 * whose ₹499 arrived in the period. A sign-up counts as assisted only when the
 * tracker recorded the assigned agent's connected call or GPS visit before it
 * finished (SignupTrackerService.creditFor); a self-finished sign-up credits
 * nobody. A record this agent registered is already counted by the normal
 * rule and is not counted twice.
 */
export async function assistedActivations(prisma: Reader, staffId: string, from: Date, to: Date): Promise<number> {
  const trackers = await prisma.signupTracker.findMany({
    where: { profileKind: 'job_seeker', subjectType: 'job_seeker', outcome: 'assisted', assignedStaffId: staffId, subjectId: { not: null } },
    select: { subjectId: true },
  });
  const ids = [...new Set(trackers.map((t) => t.subjectId!))];
  if (ids.length === 0) return 0;
  return prisma.jobSeeker.count({
    where: {
      id: { in: ids },
      paymentReceivedAt: { not: null, gte: from, lte: to },
      OR: [{ registeredByStaffId: null }, { registeredByStaffId: { not: staffId } }],
    },
  });
}
