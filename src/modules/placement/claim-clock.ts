import { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';

/**
 * M10 (Master Guide rev 178): while a business is suspended, the 15-day
 * replacement clock of its open claims stands still and then continues from
 * where it stopped. The pause is stored on the claim — `searchPausedAt` (paused
 * since) and `searchPausedSeconds` (earlier pauses added up) — never by moving
 * the report date. A suspension that ends on its date stops the pause at that
 * date even before the daily job folds it in; a permanent one keeps the clock
 * paused.
 */
export interface ClaimClock {
  searchPausedAt: Date | null;
  searchPausedSeconds: number;
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
  const earlier = (claim.searchPausedSeconds ?? 0) * 1000;
  if (!claim.searchPausedAt) return earlier;
  const end = pauseEnd(business, now) ?? now;
  return earlier + Math.max(0, end.getTime() - claim.searchPausedAt.getTime());
}

/** True while the clock stands still (the business is suspended now). */
export function claimClockPaused(claim: Partial<ClaimClock> | null | undefined, business: SuspensionWindow | null | undefined, now: Date): boolean {
  return Boolean(claim?.searchPausedAt) && pauseEnd(business, now) === null;
}

/**
 * The pause inputs of a refund check (evaluatePlacementRefundEligibility). M3 (rev 181): a refund
 * already due before the current pause began stays due — only a window still running pauses.
 */
export function claimRefundPause(claim: Partial<ClaimClock> | null | undefined, business: SuspensionWindow | null | undefined, now: Date) {
  return {
    pausedMs: claimPausedMs(claim, business, now),
    searchPaused: claimClockPaused(claim, business, now),
    pauseStartedAt: claim?.searchPausedAt ?? null,
    pausedBeforeMs: (claim?.searchPausedSeconds ?? 0) * 1000,
  };
}

/**
 * Claims whose 15-day clock may run: waiting for a decision or accepted, the guarantee not ended and the
 * replacement search still open (no replacement candidate accepted yet). Every dropout under the
 * guarantee has a claim row (claims are how a dropout is reported since Phase 17), so no clock runs
 * without one.
 */
const openSearch = (businessId: string): Prisma.PlacementWhereInput => ({
  businessId,
  guaranteeEndedReason: null,
  replacementCandidates: { none: { status: 'accepted' } },
});
const openClaimsOf = (businessId: string): Prisma.ReplacementClaimWhereInput => ({
  OR: [{ decision: null }, { decision: 'accepted' }],
  placement: openSearch(businessId),
});

/** The business was suspended (or banned): pause every open claim's clock now. */
export async function pauseClaimClocks(client: Client, businessId: string, now: Date): Promise<number> {
  const res = await client.replacementClaim.updateMany({
    where: { ...openClaimsOf(businessId), searchPausedAt: null },
    data: { searchPausedAt: now },
  });
  return res.count;
}

/** The suspension ended at `endedAt`: fold each running pause into searchPausedSeconds. */
export async function resumeClaimClocks(client: Client, businessId: string, endedAt: Date): Promise<number> {
  const paused = await client.replacementClaim.findMany({
    where: { placement: { businessId }, searchPausedAt: { not: null } },
    select: { id: true, searchPausedAt: true, searchPausedSeconds: true },
  });
  let resumed = 0;
  for (const claim of paused) {
    // A pause that began after the end date (a later suspension) is not this one's to fold.
    if (claim.searchPausedAt!.getTime() > endedAt.getTime()) continue;
    const seconds = Math.max(0, Math.floor((endedAt.getTime() - claim.searchPausedAt!.getTime()) / 1000));
    // Only if nothing folded it meanwhile (the same pause start, still on or before the end).
    const done = await client.replacementClaim.updateMany({
      where: { id: claim.id, searchPausedAt: claim.searchPausedAt, searchPausedSeconds: claim.searchPausedSeconds },
      data: { searchPausedAt: null, searchPausedSeconds: claim.searchPausedSeconds + seconds },
    });
    resumed += done.count;
  }
  return resumed;
}

/** Daily: suspensions that ended on their date resume their claims' clocks from that date. */
export async function resumeEndedSuspensions(client: Client, now: Date): Promise<number> {
  const ended = await client.business.findMany({
    where: { suspendedUntil: { lte: now }, placements: { some: { replacementClaims: { some: { searchPausedAt: { not: null } } } } } },
    select: { id: true, suspendedUntil: true },
  });
  let resumed = 0;
  for (const business of ended) resumed += await resumeClaimClocks(client, business.id, business.suspendedUntil!);
  return resumed;
}
