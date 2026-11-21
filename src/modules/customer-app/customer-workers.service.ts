import { HttpStatus, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { CustomerAuthClock } from '../../common/customer-auth/customer-auth.clock';
import { CustomerScopeService, ScopedProfile } from '../../common/customer-auth/customer-scope.service';
import { CUSTOMER_ERROR_CODES, CustomerApiError } from '../../common/customer-auth/customer-auth.errors';
import { PricingService } from '../pricing/pricing.service';
import { ACCEPT_CLAIM_REASONS, REJECT_CLAIM_REASONS } from '../placement/claim-reasons';
import { addDays, istDayOf, istDayStart } from '../placement/claim-dates';
import { firstName } from '../customer-account/customer-account.service';

type Body = Record<string, unknown>;

/** The same reasons the staff "Report worker left" form offers (placement/worker-left.service.ts). */
export const WORKER_LEFT_COVERED_REASONS = ACCEPT_CLAIM_REASONS.filter((r) => r !== 'never_joined');
export const WORKER_LEFT_NOT_COVERED_REASONS = [...REJECT_CLAIM_REASONS];
const NEVER_JOINED_REASONS = ['never_joined'] as const;
/** Placements a business can tell us about: working now, or selected and paid but never came (D2). */
const REPORTABLE_STATUSES = ['active', 'confirmed'];
const NOTE_MAX = 200;
/** How many earlier reports Home shows. */
const RECENT_REPORTS = 10;

export type WorkerState = 'can_report' | 'reported' | 'claim_open' | 'guarantee_over' | 'not_started';

function validation(message: string, field: string): CustomerApiError {
  return new CustomerApiError(HttpStatus.BAD_REQUEST, CUSTOMER_ERROR_CODES.VALIDATION, message, { field });
}

function notAllowed(message: string, reason: string): CustomerApiError {
  return new CustomerApiError(HttpStatus.CONFLICT, CUSTOMER_ERROR_CODES.NOT_ALLOWED, message, { reason });
}

interface PlacementRow {
  id: string;
  code: string;
  status: string;
  joinedDate: Date | null;
  joiningDate: Date | null;
  rootPlacementId: string | null;
  vacancy: { tradeSkill: string; branchId: string | null };
  jobSeeker: { name: string | null };
  replacementClaims: { id: string; decision: string | null }[];
}

/**
 * "A worker left" in the app (Master Guide, customer app 14 Nov: a business
 * may report a worker leaving in the app; claims still go to the Team Lead).
 *
 * This is a report, not the replacement claim. The claim needs an answered,
 * recorded call with the owner and is filed by staff
 * (PlacementService.reportClaim), so the report makes a "Call me back"
 * request at once and the call team takes it from there. The report keeps the
 * moment the business told Laboura.
 *
 * Only the caller's own business (a branch profile: only its branch's
 * workers). A worker shows by first name, trade and placement code, and only
 * once the fee is paid (active or confirmed). Never a phone number or money.
 */
@Injectable()
export class CustomerWorkersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: CustomerAuthClock,
    private readonly scope: CustomerScopeService,
    private readonly pricing: PricingService,
  ) {}

  private placementWhere(profile: ScopedProfile, extra: Prisma.PlacementWhereInput = {}): Prisma.PlacementWhereInput {
    return {
      businessId: profile.businessId!,
      status: { in: REPORTABLE_STATUSES },
      ...(profile.branchId ? { vacancy: { branchId: profile.branchId } } : {}),
      ...extra,
    };
  }

  private async placements(profile: ScopedProfile, extra: Prisma.PlacementWhereInput = {}): Promise<PlacementRow[]> {
    return this.prisma.placement.findMany({
      where: this.placementWhere(profile, extra),
      orderBy: [{ joinedDate: 'desc' }, { joiningDate: 'desc' }],
      take: 100,
      select: {
        id: true,
        code: true,
        status: true,
        joinedDate: true,
        joiningDate: true,
        rootPlacementId: true,
        vacancy: { select: { tradeSkill: true, branchId: true } },
        jobSeeker: { select: { name: true } },
        replacementClaims: { where: { decision: null }, select: { id: true, decision: true }, take: 1 },
      },
    });
  }

  /** The 60 days run from the first worker in the chain who joined (D2: a first candidate who never joined does not start it). */
  private async guaranteeStart(row: PlacementRow): Promise<Date | null> {
    const rootId = row.rootPlacementId ?? row.id;
    const root = row.rootPlacementId
      ? await this.prisma.placement.findUnique({ where: { id: row.rootPlacementId }, select: { joinedDate: true } })
      : { joinedDate: row.joinedDate };
    if (root?.joinedDate) return root.joinedDate;
    const first = await this.prisma.placement.findFirst({
      where: { rootPlacementId: rootId, joinedDate: { not: null } },
      orderBy: { joinedDate: 'asc' },
      select: { joinedDate: true },
    });
    return first?.joinedDate ?? null;
  }

  /** Dates and state for one placement, worked out the way the staff claim checks them. */
  private async describe(row: PlacementRow, openReports: Set<string>, windowDays: number) {
    const today = istDayOf(this.clock.now())!;
    const neverJoined = row.status === 'confirmed' && !row.joinedDate && Boolean(row.joiningDate) && istDayOf(row.joiningDate!)! <= today;
    const start = await this.guaranteeStart(row);
    const startDay = start ? istDayOf(start) : null;
    const ownStart = row.joinedDate ?? (neverJoined ? row.joiningDate : start);
    const earliest = ownStart ? istDayOf(ownStart) : null;
    const lastDay = startDay ? addDays(startDay, windowDays) : null;
    const latest = lastDay && lastDay < today ? lastDay : today;
    let state: WorkerState = 'can_report';
    if (openReports.has(row.id)) state = 'reported';
    else if (row.replacementClaims.length > 0) state = 'claim_open';
    else if (row.status !== 'active' && !neverJoined) state = 'not_started';
    else if (!earliest) state = 'not_started';
    else if (lastDay && today > lastDay && !neverJoined) state = 'guarantee_over';
    return { neverJoined, earliest, latest, guaranteeLastDay: lastDay, state };
  }

  /** GET /me/profiles/:profileId/workers — the workers this business can report on, and its recent reports. */
  async workers(accountId: string, profileId: string) {
    const profile = await this.scope.profile(accountId, profileId, 'business');
    const policy = await this.pricing.current();
    const rows = await this.placements(profile);
    const open = await this.prisma.customerWorkerLeftReport.findMany({
      where: { placementId: { in: rows.map((r) => r.id) }, status: 'open' },
      select: { placementId: true },
    });
    const openIds = new Set(open.map((r) => r.placementId));
    const workers = [];
    for (const row of rows) {
      const d = await this.describe(row, openIds, policy.replacementWindowDays);
      workers.push({
        placementId: row.id,
        placementCode: row.code,
        workerFirstName: firstName(row.jobSeeker.name),
        trade: row.vacancy.tradeSkill,
        joinedOn: row.joinedDate ? istDayOf(row.joinedDate) : null,
        joiningOn: row.joiningDate ? istDayOf(row.joiningDate) : null,
        neverJoined: d.neverJoined,
        guaranteeLastDay: d.guaranteeLastDay,
        leftOnEarliest: d.earliest,
        leftOnLatest: d.latest,
        state: d.state,
      });
    }
    const reports = await this.prisma.customerWorkerLeftReport.findMany({
      where: { businessId: profile.businessId!, ...(profile.branchId ? { branchId: profile.branchId } : {}) },
      orderBy: { createdAt: 'desc' },
      take: RECENT_REPORTS,
      select: { id: true, placementId: true, workerLeftOn: true, reason: true, status: true, claimId: true, createdAt: true },
    });
    const claimIds = reports.map((r) => r.claimId).filter((id): id is string => Boolean(id));
    const claims = claimIds.length
      ? await this.prisma.replacementClaim.findMany({ where: { id: { in: claimIds } }, select: { id: true, decision: true } })
      : [];
    const decisionOf = new Map(claims.map((c) => [c.id, c.decision]));
    const codes = await this.prisma.placement.findMany({
      where: { id: { in: reports.map((r) => r.placementId) }, businessId: profile.businessId! },
      select: { id: true, code: true, jobSeeker: { select: { name: true } } },
    });
    const codeOf = new Map(codes.map((p) => [p.id, p]));
    return {
      reasons: {
        covered: [...WORKER_LEFT_COVERED_REASONS],
        notCovered: WORKER_LEFT_NOT_COVERED_REASONS,
        neverJoined: [...NEVER_JOINED_REASONS],
      },
      reportWithinDays: policy.claimReportDays,
      windowDays: policy.replacementWindowDays,
      workers,
      reports: reports.map((r) => ({
        id: r.id,
        placementCode: codeOf.get(r.placementId)?.code ?? null,
        workerFirstName: firstName(codeOf.get(r.placementId)?.jobSeeker.name ?? null),
        workerLeftOn: istDayOf(r.workerLeftOn),
        reason: r.reason,
        status: r.status,
        /** accepted / rejected once the Team Lead decided the claim filed from it; null while waiting. */
        claimDecision: r.claimId ? decisionOf.get(r.claimId) ?? null : null,
        reportedAt: r.createdAt,
      })),
    };
  }

  /**
   * POST /me/profiles/:profileId/workers/:placementId/left
   * Body: { workerLeftOn: "YYYY-MM-DD", reason, note? }
   * Saves the report and asks the call team to call (a "Call me back" with
   * topic worker_left, unless one is already open for this account).
   */
  async reportLeft(accountId: string, profileId: string, placementId: string, body: Body) {
    const profile = await this.scope.profile(accountId, profileId, 'business');
    const policy = await this.pricing.current();
    const rows = typeof placementId === 'string' && placementId.length <= 64 ? await this.placements(profile, { id: placementId }) : [];
    const row = rows[0];
    // Someone else's placement, or not reportable: the same answer as one that does not exist.
    if (!row) throw new CustomerApiError(HttpStatus.NOT_FOUND, CUSTOMER_ERROR_CODES.PROFILE_NOT_FOUND, 'Worker not found');
    const existing = await this.prisma.customerWorkerLeftReport.findFirst({
      where: { placementId: row.id, status: 'open' },
      select: { id: true, status: true, createdAt: true },
    });
    if (existing) return { created: false, body: { reportId: existing.id, status: existing.status, reportedAt: existing.createdAt } };

    const d = await this.describe(row, new Set(), policy.replacementWindowDays);
    if (d.state === 'claim_open') throw notAllowed('Our team is already looking at this worker leaving', 'claim_open');
    if (d.state === 'not_started') throw notAllowed('This worker has not started yet', 'not_started');
    if (d.state === 'guarantee_over') throw notAllowed('The free replacement time for this worker is over', 'guarantee_over');

    const leftDay = typeof body?.workerLeftOn === 'string' ? istDayOf(body.workerLeftOn) : null;
    if (!leftDay || !/^\d{4}-\d{2}-\d{2}$/.test(String(body.workerLeftOn).trim())) throw validation('workerLeftOn must be a date (YYYY-MM-DD)', 'workerLeftOn');
    if (d.earliest && leftDay < d.earliest) throw validation(`workerLeftOn cannot be before ${d.earliest}`, 'workerLeftOn');
    if (leftDay > d.latest) throw validation(`workerLeftOn cannot be after ${d.latest}`, 'workerLeftOn');

    const allowed: readonly string[] = d.neverJoined ? NEVER_JOINED_REASONS : [...WORKER_LEFT_COVERED_REASONS, ...WORKER_LEFT_NOT_COVERED_REASONS];
    const reason = typeof body?.reason === 'string' ? body.reason : '';
    if (!allowed.includes(reason)) throw validation(`reason must be one of ${allowed.join(', ')}`, 'reason');

    const note = typeof body?.note === 'string' && body.note.trim() ? body.note.trim() : null;
    if (note && note.length > NOTE_MAX) throw validation(`note is too long (${NOTE_MAX} characters at most)`, 'note');
    // No ID or phone numbers in free text (never a raw Aadhaar).
    if (note && /\d{9,}/.test(note.replace(/[\s-]/g, ''))) throw validation('Do not write ID or phone numbers in the note', 'note');

    try {
      const created = await this.prisma.$transaction(async (tx) => {
        const openCallback = await tx.customerCallbackRequest.findFirst({
          where: { accountId, status: { in: ['open', 'assigned'] } },
          select: { id: true },
        });
        const callback = openCallback
          ? null
          : await tx.customerCallbackRequest.create({
              data: { accountId, profileId: profile.id, topic: 'worker_left', note: `${row.code}: worker left on ${leftDay}`, preferredFrom: null, preferredTo: null },
              select: { id: true },
            });
        return tx.customerWorkerLeftReport.create({
          data: {
            accountId,
            profileId: profile.id,
            businessId: profile.businessId!,
            branchId: row.vacancy.branchId,
            placementId: row.id,
            workerLeftOn: istDayStart(leftDay),
            reason,
            note,
            callbackRequestId: callback?.id ?? openCallback?.id ?? null,
          },
          select: { id: true, status: true, createdAt: true },
        });
      });
      return { created: true, body: { reportId: created.id, status: created.status, reportedAt: created.createdAt } };
    } catch (error) {
      // Two taps at once: the partial unique index keeps one open report per placement.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const again = await this.prisma.customerWorkerLeftReport.findFirst({
          where: { placementId: row.id, status: 'open' },
          select: { id: true, status: true, createdAt: true },
        });
        if (again) return { created: false, body: { reportId: again.id, status: again.status, reportedAt: again.createdAt } };
      }
      throw error;
    }
  }
}
