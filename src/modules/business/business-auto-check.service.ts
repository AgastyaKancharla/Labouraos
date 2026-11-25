import { Injectable, Optional } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import { mobileLookupValues } from '../../common/phone/indian-mobile';
import { recordStatusChange } from '../../common/status-history/status-history.helper';
import { businessIdFingerprint, findBan } from '../conduct/permanent-ban.check';
import { CustomerNotificationHooks } from '../customer-notification/customer-notification-hooks.service';
import { ReviewFlagService } from '../review-flag/review-flag.service';
import { AutoCheckFacts, AutoCheckResult, decideAutoCheck, failedReasonText, SAME_PLACE_METERS, metresBetween } from './business-auto-check';
import { findFieldVisitProof } from './business-field-proof';
import { isBusinessSuspended } from './business-candidate-access';
import { BusinessClock } from './business-clock';
import { normaliseRegistrationNumber } from './business-proofs';
import { allowedShopKinds, isHouseholdBusiness, verificationPathOf } from './business-paths';

/**
 * Households hiring help (a maid, cook or driver at home; a villa) keep today's verification
 * visit and Team Lead check until the household research is decided (guide, 25 Nov).
 */
export { HOUSEHOLD_BUSINESS_TYPES, isHouseholdBusiness } from './business-paths';

/** The review flag the Team Lead's bell and queue show for a failed automatic check. */
export const AUTO_CHECK_FLAG = 'business_auto_check_failed';
/** Visit purposes that verify a business: a request still open is cancelled when it passes. */
const VERIFICATION_REQUEST_PURPOSES = ['verification', 'business_signup'];
/** The automatic check acts on these statuses only (never a verified or rejected business). */
const CHECKABLE_STATUSES = ['lead', 'pending_visit', 'pending_tl_check'];

export type AutoCheckOutcome = { ran: false; why: 'household' | 'not_found' | 'not_signed' | 'not_checkable' } | { ran: true; passed: boolean; result: AutoCheckResult };

/**
 * The automatic business verification (Master Guide rev 211, B3). Runs right after the
 * agreement is signed and again whenever a missing proof or photo is added. Verified
 * with no Team Lead (who: "automatic") when every condition holds; otherwise
 * pending_tl_check with the failed reasons, a review flag for the Team Lead (bell and
 * queue), the status history and the audit log.
 */
@Injectable()
export class BusinessAutoCheckService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly reviewFlags: ReviewFlagService,
    private readonly clock: BusinessClock,
    @Optional() private readonly customerNotifications?: CustomerNotificationHooks,
  ) {}

  /** The facts and the decision, without writing anything (the Team Lead's queue shows the same). */
  async evaluate(businessId: string): Promise<{ result: AutoCheckResult; facts: AutoCheckFacts } | null> {
    const business = await this.prisma.business.findUnique({
      where: { id: businessId },
      include: {
        agreements: { orderBy: { signedAt: 'desc' }, take: 1, select: { otpRequestId: true } },
        ownerPhotos: { orderBy: { takenAt: 'desc' } },
      },
    });
    if (!business) return null;
    const shopKinds: string[] = allowedShopKinds(business);
    const selfie = business.ownerPhotos.find((p) => p.kind === 'owner_selfie');
    const shop = business.ownerPhotos.find((p) => shopKinds.includes(p.kind));
    // Rev 213: onboarded in person — the visit's board photo (with its GPS) and the agent's
    // selfie at the board stand in for the owner's photos when he took none.
    const visit = selfie && shop ? null : await findFieldVisitProof(this.prisma, business.id);
    const shopLat = shop ? shop.latitude : visit?.latitude ?? null;
    const shopLng = shop ? shop.longitude : visit?.longitude ?? null;
    const now = this.clock.now();
    const ban = await findBan(this.prisma, {
      phone: business.phone,
      idFingerprints: [
        ...(business.gstNumber?.trim() ? [businessIdFingerprint('gstin', business.gstNumber)] : []),
        ...(business.pan?.trim() ? [businessIdFingerprint('pan', business.pan)] : []),
      ],
    }).catch(() => null);
    const facts: AutoCheckFacts = {
      phoneVerified: business.phoneVerified,
      agreementSignedByOtp: Boolean(business.agreements[0]?.otpRequestId),
      hasOwnerSelfie: Boolean(selfie) || Boolean(visit),
      hasShopPhoto: Boolean(shop) || Boolean(visit),
      photosFromFieldVisit: Boolean(visit) && !(selfie && shop),
      runsFromHome: business.runsFromHome,
      shopPhotoLatitude: shopLat,
      shopPhotoLongitude: shopLng,
      shopPhotoLocationRefused: Boolean(shop || visit) && (shopLat === null || shopLng === null),
      gstNumber: business.gstNumber,
      fssaiNumber: business.fssaiNumber,
      licenceNumber: business.licenceNumber,
      shopEstablishmentNumber: business.shopEstablishmentNumber,
      udyamNumber: business.udyamNumber,
      mapsLink: business.mapsLink,
      mapsLatitude: business.mapsLatitude,
      mapsLongitude: business.mapsLongitude,
      duplicates: await this.duplicates(business),
      banned: Boolean(ban),
      suspended: isBusinessSuspended(business, now),
      paused: Boolean(business.pausedAt),
    };
    return { result: decideAutoCheck(facts), facts };
  }

  /** Other businesses with the same GST, licence / FSSAI / Udyam number, Maps place (within ~30 m) or phone. */
  private async duplicates(business: {
    id: string; phone: string; gstNumber: string | null; fssaiNumber: string | null; licenceNumber: string | null;
    shopEstablishmentNumber: string | null; udyamNumber: string | null; mapsLink: string | null; mapsLatitude: number | null; mapsLongitude: number | null;
  }): Promise<Array<{ businessCode: string; on: string[] }>> {
    const found = new Map<string, Set<string>>();
    const add = (code: string, on: string) => {
      const set = found.get(code) ?? new Set<string>();
      set.add(on);
      found.set(code, set);
    };
    const others = { id: { not: business.id }, anonymisedAt: null };
    const numbers: Array<[string, 'gstNumber' | 'fssaiNumber' | 'licenceNumber' | 'shopEstablishmentNumber' | 'udyamNumber', string | null]> = [
      ['GST number', 'gstNumber', business.gstNumber],
      ['FSSAI number', 'fssaiNumber', business.fssaiNumber],
      ['trade licence', 'licenceNumber', business.licenceNumber],
      ['shop and establishment number', 'shopEstablishmentNumber', business.shopEstablishmentNumber],
      ['Udyam number', 'udyamNumber', business.udyamNumber],
    ];
    for (const [label, field, value] of numbers) {
      const normal = normaliseRegistrationNumber(value);
      if (!normal) continue;
      const rows = await this.prisma.business.findMany({
        where: { AND: [others, { [field]: { not: null } }] },
        select: { code: true, gstNumber: true, fssaiNumber: true, licenceNumber: true, shopEstablishmentNumber: true, udyamNumber: true },
      });
      for (const row of rows) if (normaliseRegistrationNumber(row[field]) === normal) add(row.code, label);
    }
    if (business.mapsLatitude !== null && business.mapsLongitude !== null) {
      const d = 0.001; // about 110 m: a box around the pin, then the exact distance
      const near = await this.prisma.business.findMany({
        where: {
          AND: [others, {
            mapsLatitude: { gte: business.mapsLatitude - d, lte: business.mapsLatitude + d },
            mapsLongitude: { gte: business.mapsLongitude - d, lte: business.mapsLongitude + d },
          }],
        },
        select: { code: true, mapsLatitude: true, mapsLongitude: true },
      });
      for (const row of near) {
        if (row.mapsLatitude !== null && row.mapsLongitude !== null
          && metresBetween(row.mapsLatitude, row.mapsLongitude, business.mapsLatitude, business.mapsLongitude) <= SAME_PLACE_METERS) {
          add(row.code, 'Maps place');
        }
      }
    }
    const phones = mobileLookupValues(business.phone);
    const samePhone = await this.prisma.business.findMany({
      where: { AND: [others, { OR: [
        { phone: { in: phones } },
        { additionalContactPhone: { in: phones } },
        { contactWhatsAppPhone: { in: phones } },
        { branches: { some: { contactPersonPhone: { in: phones } } } },
      ] }] },
      select: { code: true },
    });
    for (const row of samePhone) add(row.code, 'phone');
    return [...found.entries()].map(([businessCode, on]) => ({ businessCode, on: [...on] }));
  }

  /**
   * Runs the check and records the outcome. Households, a business with no signed agreement
   * and a verified or rejected business are left alone.
   */
  async run(businessId: string, trigger: string): Promise<AutoCheckOutcome> {
    const business = await this.prisma.business.findUnique({
      where: { id: businessId },
      select: { id: true, code: true, city: true, businessType: true, verificationStatus: true, autoCheckStatus: true, leadCreatedByStaffId: true, accountAgentId: true, agreements: { take: 1, select: { id: true } } },
    });
    if (!business) return { ran: false, why: 'not_found' };
    if (isHouseholdBusiness(business.businessType)) return { ran: false, why: 'household' };
    if (!business.agreements.length) return { ran: false, why: 'not_signed' };
    const status = business.verificationStatus ?? 'lead';
    if (!CHECKABLE_STATUSES.includes(status)) return { ran: false, why: 'not_checkable' };
    const evaluated = await this.evaluate(businessId);
    if (!evaluated) return { ran: false, why: 'not_found' };
    const { result } = evaluated;
    const path = verificationPathOf({ ...evaluated.facts, businessType: business.businessType });
    const now = this.clock.now();
    const reasonsJson = result.reasons.map((r) => ({ code: r.code, ok: r.ok, detail: r.detail })) as unknown as Prisma.InputJsonValue;

    if (result.passed) {
      const moved = await this.prisma.$transaction(async (tx) => {
        const changed = await tx.business.updateMany({
          where: { id: businessId, verificationStatus: { in: CHECKABLE_STATUSES } },
          data: {
            verificationStatus: 'verified',
            verifiedAt: now,
            verifiedByStaffId: null,
            autoVerifiedAt: now,
            verificationPath: path,
            autoCheckStatus: 'passed',
            autoCheckedAt: now,
            autoCheckReasons: reasonsJson,
            autoCheckDistanceMeters: result.distanceMeters,
          },
        });
        if (changed.count !== 1) return false;
        await recordStatusChange(tx, {
          subjectType: 'business',
          subjectId: businessId,
          fromStatus: status,
          toStatus: 'verified',
          changedByStaffId: null,
          reason: 'Verified automatically: owner phone and agreement by code, owner photos, 2 or more proofs, location, no duplicate',
          changedAt: now,
        });
        // No field visit is needed for a business that passes: an open verification request is cancelled.
        await tx.visitAssignment.updateMany({
          where: { businessId, purpose: { in: VERIFICATION_REQUEST_PURPOSES }, status: { in: ['pending', 'assigned'] } },
          data: { status: 'cancelled' },
        });
        return true;
      });
      if (!moved) return { ran: false, why: 'not_checkable' };
      await this.audit.log({
        actorId: 'system',
        action: 'business.verified_automatically',
        entityType: 'business',
        entityCode: business.code,
        before: { verificationStatus: status, autoCheckStatus: business.autoCheckStatus },
        after: { verificationStatus: 'verified', autoCheckStatus: 'passed', verifiedBy: 'automatic', reasons: reasonsJson, distanceMeters: result.distanceMeters },
        changedFields: ['verificationStatus', 'verifiedAt', 'autoVerifiedAt', 'autoCheckStatus', 'autoCheckReasons'],
        reason: `Automatic verification (${trigger}): every condition passed`,
        city: business.city,
      });
      // The Team Lead's open items about this business are done: it passed by itself.
      const open = await this.prisma.reviewFlag.findMany({
        where: { subjectType: 'business', subjectId: businessId, kind: { in: [AUTO_CHECK_FLAG, 'in_person_onboarding_review'] }, status: 'open' },
        select: { id: true },
      });
      for (const flag of open) await this.reviewFlags.resolveAutomatically(flag.id, 'The automatic check passed after the missing proof or photo was added');
      // business_registration_done goes from the WhatsApp-first event sweep (verifiedAt is set).
      await this.customerNotifications?.businessApproved(businessId);
      return { ran: true, passed: true, result };
    }

    const failedText = failedReasonText(result.reasons);
    await this.prisma.$transaction(async (tx) => {
      await tx.business.update({
        where: { id: businessId },
        data: {
          verificationStatus: 'pending_tl_check',
          verificationPath: path,
          autoCheckStatus: 'failed',
          autoCheckedAt: now,
          autoCheckReasons: reasonsJson,
          autoCheckDistanceMeters: result.distanceMeters,
        },
      });
      if (status !== 'pending_tl_check') {
        await recordStatusChange(tx, {
          subjectType: 'business',
          subjectId: businessId,
          fromStatus: status,
          toStatus: 'pending_tl_check',
          changedByStaffId: null,
          reason: `Automatic check failed, Team Lead to check: ${failedText}`.slice(0, 1000),
          changedAt: now,
        });
      }
    });
    await this.audit.log({
      actorId: 'system',
      action: 'business.auto_check_failed',
      entityType: 'business',
      entityCode: business.code,
      before: { verificationStatus: status, autoCheckStatus: business.autoCheckStatus },
      after: { verificationStatus: 'pending_tl_check', autoCheckStatus: 'failed', checkedBy: 'automatic', reasons: reasonsJson, distanceMeters: result.distanceMeters },
      changedFields: ['verificationStatus', 'autoCheckStatus', 'autoCheckReasons'],
      reason: `Automatic verification (${trigger}) failed: sent to the Team Lead`,
      city: business.city,
    });
    const failed = result.reasons.filter((r) => !r.ok).map((r) => ({ code: r.code, detail: r.detail }));
    const existing = await this.prisma.reviewFlag.findFirst({ where: { subjectType: 'business', subjectId: businessId, kind: AUTO_CHECK_FLAG, status: 'open' }, select: { id: true } });
    if (existing) {
      await this.prisma.reviewFlag.update({
        where: { id: existing.id },
        data: { details: { businessCode: business.code, failed, distanceMeters: result.distanceMeters, smallBusiness: path === 'small_business' } as unknown as Prisma.InputJsonValue },
      });
    } else {
      await this.reviewFlags.raise({
        kind: AUTO_CHECK_FLAG,
        subjectType: 'business',
        subjectId: businessId,
        raisedForStaffId: business.accountAgentId ?? business.leadCreatedByStaffId,
        details: { businessCode: business.code, failed, distanceMeters: result.distanceMeters, smallBusiness: path === 'small_business' },
      });
    }
    return { ran: true, passed: false, result };
  }
}
