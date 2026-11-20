/**
 * "Is this consent purpose withdrawn right now?" — one rule for every refund guard (Master Guide rev 200,
 * owner decision 17 Nov): a withdrawal ends the ₹499 refund guarantee only while it stands. If he gives
 * the same purpose again later (a new live grant — consent once per item makes that a new row, the
 * withdrawn row stays as history), the guarantee is back as if the withdrawal had not happened.
 *
 * Used by the refund decision (job-seeker.service), the refund list (refund.service), the refund
 * approval (payment.service), money under guarantee (growth) and the customer app's home.
 */

/** Withdrawing one of these after paying ends the refund guarantee (guide, refund rules). */
export const REFUND_ENDING_CONSENT_PURPOSES = ['job_matching', 'profile_sharing', 'call_recording'] as const;

export interface ConsentStateRow {
  subjectId: string;
  purpose: string;
  granted: boolean;
  grantedAt: Date | null;
  withdrawnAt: Date | null;
}

/**
 * For each subject, the time of its latest withdrawal that still stands: no live grant (granted, not
 * withdrawn) of the same purpose given after it. Subjects with none are absent from the map.
 */
export function standingWithdrawals(rows: ConsentStateRow[]): Map<string, Date> {
  const out = new Map<string, Date>();
  for (const w of rows) {
    if (!w.withdrawnAt) continue;
    const regranted = rows.some(
      (r) => r.subjectId === w.subjectId && r.purpose === w.purpose && r.granted && !r.withdrawnAt && r.grantedAt && r.grantedAt.getTime() > w.withdrawnAt!.getTime(),
    );
    if (regranted) continue;
    const latest = out.get(w.subjectId);
    if (!latest || w.withdrawnAt > latest) out.set(w.subjectId, w.withdrawnAt);
  }
  return out;
}

type ConsentReader = { consent: { findMany: (args: never) => Promise<unknown[]> } };

/** Loads the consent rows of these job seekers for the purposes and returns standingWithdrawals(). */
export async function loadStandingWithdrawals(
  prisma: ConsentReader,
  jobSeekerIds: string[],
  purposes: readonly string[] = REFUND_ENDING_CONSENT_PURPOSES,
): Promise<Map<string, Date>> {
  if (jobSeekerIds.length === 0) return new Map();
  const rows = (await prisma.consent.findMany({
    where: { subjectType: 'job_seeker', subjectId: { in: [...new Set(jobSeekerIds)] }, purpose: { in: [...purposes] } },
    select: { subjectId: true, purpose: true, granted: true, grantedAt: true, withdrawnAt: true },
  } as never)) as ConsentStateRow[];
  return standingWithdrawals(rows ?? []);
}
