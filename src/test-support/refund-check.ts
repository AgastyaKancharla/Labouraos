import { randomUUID } from 'crypto';
import { PrismaClient } from '@prisma/client';

/**
 * Test-only. Records the refund-check call ("are you working at a business Laboura
 * introduced?") as done for a job seeker's current guarantee. The Master Guide requires
 * it before any ₹499 refund is approved.
 */
export async function recordRefundCheck(
  prisma: Pick<PrismaClient, 'followUpTask'>,
  jobSeekerId: string,
  answer: 'not_working' | 'working_elsewhere' | 'no_answer' | 'working_at_introduced_business' = 'not_working',
  at: Date = new Date(),
) {
  return prisma.followUpTask.create({
    data: {
      code: `FU-T-${randomUUID().replace(/-/g, '').slice(0, 12)}`,
      kind: 'refund_check',
      subjectType: 'job_seeker',
      subjectId: jobSeekerId,
      dueAt: at,
      status: 'done',
      completedAt: at,
      answer,
      createdAt: at,
    },
  });
}
