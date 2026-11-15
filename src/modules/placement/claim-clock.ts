import { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';

/**
 * M10 (Master Guide rev 178): while a business is suspended, the 15-day
 * replacement clock of its open claims stands still and then continues from
 * where it stopped. The pause is stored on the claim — `clockPausedAt` (paused
 * since) and `clockPausedSeconds` (earlier pauses added up) — never by moving
 * the report date. A suspension that ends on its date stops the pause at that
 * date even before the daily job folds it in; a permanent one keeps the clock
 * paused.
 */
export interface ClaimClock {
  clockPausedAt: Date | null;
  clockPausedSeconds: number;
}

export interface SuspensionWindow {
  suspendedAt: Date | null;
  suspendedUntil: Date | null;
}

type Client = PrismaService | Prisma.TransactionClient;

/** When the current pause ends: the suspension's end date if it has passed, otherwise still running (null). */
function pauseEnd(business: SuspensionWindow | null | undefined, now: Date): Date | null {
  if (!business?.suspendedAt) return now; // suspension lifted: whatever was not folded in stops now
  if (business.suspendedUntil && business.suspendedUntil.getTime() <= now.getTime()) return business.suspendedUntil;
  return null;
}

/** Milliseconds the claim's clock has stood still, up to now. */
export function claimPausedMs(claim: Partial<ClaimClock> | null | undefined, business: SuspensionWindow | null | undefined, now: Date): number {
  if (!claim) return 0;
  const earlier = (claim.clockPausedSeconds ?? 0) * 1000;
  if (!claim.clockPausedAt) return earlier;
  const end = pauseEnd(business, now) ?? now;
  return earlier + Math.max(0, end.getTime() - claim.clockPausedAt.getTime());
}

/** True while the clock stands still (the business is suspended now). */
export function claimClockPaused(claim: Partial<ClaimClock> | null | undefined, business: SuspensionWindow | null | undefined, now: Date): boolean {
  return Boolean(claim?.clockPausedAt) && pauseEnd(business, now) === null;
}

/** Claims whose 15-day clock may run: waiting for a decision or accepted, guarantee not ended. */
const openClaimsOf = (businessId: string): Prisma.ReplacementClaimWhereInput => ({
  OR: [{ decision: null }, { decision: 'accepted' }],
  placement: { businessId, guaranteeEndedReason: null },
});

/** The business was suspended (or banned): pause every open claim's clock now. */
export async function pauseClaimClocks(client: Client, businessId: string, now: Date): Promise<number> {
  const res = await client.replacementClaim.updateMany({
    where: { ...openClaimsOf(businessId), clockPausedAt: null },
    data: { clockPausedAt: now },
  });
  return res.count;
}

/** The suspension ended at `endedAt`: fold each running pause into clockPausedSeconds. */
export async function resumeClaimClocks(client: Client, businessId: string, endedAt: Date): Promise<number> {
  const paused = await client.replacementClaim.findMany({
    where: { placement: { businessId }, clockPausedAt: { not: null } },
    select: { id: true, clockPausedAt: true, clockPausedSeconds: true },
  });
  for (const claim of paused) {
    const seconds = Math.max(0, Math.floor((endedAt.getTime() - claim.clockPausedAt!.getTime()) / 1000));
    await client.replacementClaim.update({
      where: { id: claim.id },
      data: { clockPausedAt: null, clockPausedSeconds: claim.clockPausedSeconds + seconds },
    });
  }
  return paused.length;
}

/** Daily: suspensions that ended on their date resume their claims' clocks from that date. */
export async function resumeEndedSuspensions(client: Client, now: Date): Promise<number> {
  const ended = await client.business.findMany({
    where: { suspendedUntil: { lte: now }, placements: { some: { replacementClaims: { some: { clockPausedAt: { not: null } } } } } },
    select: { id: true, suspendedUntil: true },
  });
  let resumed = 0;
  for (const business of ended) resumed += await resumeClaimClocks(client, business.id, business.suspendedUntil!);
  return resumed;
}
