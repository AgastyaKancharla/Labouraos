import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { verificationView } from '../business/business-verification-view';
import { smallBusinessMissing } from '../business/business-owner-check.service';
import { allowedShopKinds } from '../business/business-paths';
import { validProofCount } from '../business/business-proofs';
import { tradeNameKey } from '../trade/trade.service';

export interface BusinessChecksScope {
  /** Businesses the viewer may see (null: every business — the CEO). */
  business: Prisma.BusinessWhereInput | null;
  vacancy: Prisma.VacancyWhereInput | null;
  /** Businesses the viewer may decide (a Team Lead: his own team's; unowned ones he assigns first). */
  decidable?: Prisma.BusinessWhereInput | null;
}

/**
 * The Team Lead's check queue (Master Guide rev 211, B3 and B4): EVERY business the automatic
 * check sent to the Team Lead and every vacancy held for an unusual salary or many openings —
 * no sampling and no limit — oldest first, each with every failed reason, the proofs, the
 * distance to the Maps pin and which owner photos exist (pictures open through owner-photos).
 * The Team Lead approves or rejects as before (POST /businesses/:id/verification/approve|reject,
 * POST /vacancies/:id/tl-check). Households hiring help wait in the same list after their visit.
 */
/** B9 (rev 212): what the Team Lead sees of a small business's checks (never the card or address image itself). */
function smallBusinessView(b: Prisma.BusinessGetPayload<{ include: { ownerCheck: true; ownerPhotos: { select: { kind: true; takenAt: true; takenVia: true; locationStatus: true } } } }>) {
  const c = b.ownerCheck;
  const shopKinds: string[] = allowedShopKinds(b);
  const parts = {
    ownerId: { method: c?.idMethod ?? null, type: c?.idType ?? null, result: c?.idResult ?? null, last4: c?.idLast4 ?? null, failureReason: c?.idFailureReason ?? null },
    businessProof: { given: Boolean(c?.businessProofKind) || validProofCount(b) >= 1, kind: c?.businessProofKind ?? null, fromProofs: validProofCount(b) >= 1 },
    addressProof: { submitted: Boolean(c?.addressSubmittedAt), docType: c?.addressDocType ?? null, result: c?.addressResult ?? null },
    videoCall: { done: Boolean(c?.videoCallDoneAt), at: c?.videoCallDoneAt?.toISOString() ?? null },
    photos: { selfie: b.ownerPhotos.some((p) => p.kind === 'owner_selfie'), workspace: b.ownerPhotos.some((p) => shopKinds.includes(p.kind)) },
  };
  return {
    ...parts,
    ownerIdName: c?.idName ?? null,
    businessProofValue: c?.businessProofValue ?? null,
    addressMatched: c?.addressMatched ?? null,
    videoCallNote: c?.videoCallNote ?? null,
    idPhotoWaiting: Boolean(c?.idPhotoPath),
    addressPhotoWaiting: Boolean(c?.addressPhotoPath),
    missing: smallBusinessMissing(parts),
  };
}

@Injectable()
export class BusinessChecksService {
  constructor(private readonly prisma: PrismaService) {}

  async queue(scope: BusinessChecksScope) {
    const businessWhere: Prisma.BusinessWhereInput = {
      AND: [{ anonymisedAt: null, verificationStatus: 'pending_tl_check' }, ...(scope.business ? [scope.business] : [])],
    };
    const businesses = await this.prisma.business.findMany({
      where: businessWhere,
      orderBy: [{ autoCheckedAt: 'asc' }, { createdAt: 'asc' }],
      include: {
        ownerPhotos: { select: { kind: true, takenAt: true, takenVia: true, locationStatus: true } },
        ownerCheck: true,
        agreements: { orderBy: { signedAt: 'desc' }, take: 1, select: { signedAt: true } },
        visitAssignments: { where: { status: { in: ['pending', 'assigned', 'done'] } }, orderBy: { createdAt: 'desc' }, take: 1, select: { id: true, purpose: true, status: true } },
      },
    });
    const decidableIds = scope.decidable
      ? new Set((await this.prisma.business.findMany({ where: { AND: [businessWhere, scope.decidable] }, select: { id: true } })).map((b) => b.id))
      : null;
    const staffIds = [...new Set(businesses.flatMap((b) => [b.accountAgentId, b.leadCreatedByStaffId]).filter((v): v is string => Boolean(v)))];
    const staff = new Map((await this.prisma.staff.findMany({ where: { id: { in: staffIds } }, select: { id: true, name: true } })).map((s) => [s.id, s.name]));

    const vacancyWhere: Prisma.VacancyWhereInput = { AND: [{ status: 'pending_tl_check' }, ...(scope.vacancy ? [scope.vacancy] : [])] };
    const vacancies = await this.prisma.vacancy.findMany({
      where: vacancyWhere,
      orderBy: { confirmedAt: 'asc' },
      include: { business: { select: { id: true, code: true, name: true, locality: true } } },
    });
    const trades = new Map((await this.prisma.trade.findMany({ select: { nameKey: true, salaryMinPaise: true, salaryMaxPaise: true } })).map((t) => [t.nameKey, t]));

    return {
      businesses: businesses.map((b) => ({
        id: b.id,
        code: b.code,
        name: b.name,
        area: b.locality,
        type: b.businessType,
        since: (b.autoCheckedAt ?? b.updatedAt).toISOString(),
        agreementSignedAt: b.agreements[0]?.signedAt.toISOString() ?? null,
        candidatesShownMeanwhile: Boolean(b.inPersonOnboardedAt || b.fieldVerifiedAt),
        owner: (b.accountAgentId ? staff.get(b.accountAgentId) : b.leadCreatedByStaffId ? staff.get(b.leadCreatedByStaffId) : null) ?? null,
        canDecide: decidableIds ? decidableIds.has(b.id) : true,
        visit: b.visitAssignments[0] ?? null,
        verification: verificationView(b),
        smallBusiness: b.verificationPath === 'small_business' ? smallBusinessView(b) : null,
      })),
      vacancies: vacancies.map((v) => {
        const trade = trades.get(tradeNameKey(v.tradeSkill));
        return {
          id: v.id,
          code: v.code,
          trade: v.roleTitle?.trim() || v.tradeSkill,
          headcount: v.headcount,
          salaryMinPaise: v.salaryMinPaise,
          salaryMaxPaise: v.salaryMaxPaise,
          salaryPeriod: v.salaryPeriod,
          usualSalary: trade ? { minPaise: trade.salaryMinPaise, maxPaise: trade.salaryMaxPaise } : null,
          confirmedAt: v.confirmedAt?.toISOString() ?? null,
          reasons: Array.isArray(v.tlCheckReasons) ? (v.tlCheckReasons as Array<{ code: string; detail: string }>) : [],
          business: v.business,
        };
      }),
    };
  }
}
