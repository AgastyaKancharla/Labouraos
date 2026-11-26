import { AutoCheckReason } from './business-auto-check';
import { isHouseholdBusiness } from './business-auto-check.service';
import { evaluateProofs } from './business-proofs';
import { OTHER_LICENCE_LABELS, readOtherLicences } from './other-licences';

/**
 * 25 Nov (rev 211): what the CEO, Manager and Team Lead see about a business's automatic
 * verification — the check's result and every reason, the proofs (given / valid, never the
 * numbers themselves here), the distance to the Maps pin and which owner photos exist (the
 * pictures themselves come through short-lived signed links: GET …/businesses/:id/owner-photos).
 */
export interface VerificationViewSource {
  businessType: string | null;
  runsFromHome: boolean;
  gstNumber: string | null;
  fssaiNumber: string | null;
  licenceNumber: string | null;
  shopEstablishmentNumber: string | null;
  udyamNumber: string | null;
  otherLicences?: unknown;
  mapsLink: string | null;
  mapsLatitude: number | null;
  mapsLongitude: number | null;
  mapsPlaceName: string | null;
  autoCheckStatus: string | null;
  autoCheckedAt: Date | null;
  autoCheckReasons: unknown;
  autoCheckDistanceMeters: number | null;
  autoVerifiedAt: Date | null;
  ownerPhotos?: Array<{ kind: string; takenAt: Date; takenVia: string; locationStatus: string | null }>;
}

const PROOF_LABELS: Record<string, string> = { gst: 'GST number', licence: 'FSSAI / trade licence / Udyam / other licence', maps: 'Google Maps link' };

export function verificationView(b: VerificationViewSource) {
  const photo = (kind: string) => {
    const row = (b.ownerPhotos ?? []).filter((p) => p.kind === kind).sort((x, y) => y.takenAt.getTime() - x.takenAt.getTime())[0];
    return row ? { kind: row.kind, takenAt: row.takenAt.toISOString(), takenVia: row.takenVia, locationStatus: row.locationStatus } : null;
  };
  const reasons = Array.isArray(b.autoCheckReasons) ? (b.autoCheckReasons as AutoCheckReason[]) : [];
  return {
    household: isHouseholdBusiness(b.businessType),
    runsFromHome: b.runsFromHome,
    autoCheck: b.autoCheckStatus
      ? {
          status: b.autoCheckStatus,
          checkedAt: b.autoCheckedAt?.toISOString() ?? null,
          verifiedAutomatically: Boolean(b.autoVerifiedAt),
          distanceMeters: b.autoCheckDistanceMeters,
          reasons: reasons.map((r) => ({ code: r.code, ok: r.ok, detail: r.detail })),
          failed: reasons.filter((r) => !r.ok).map((r) => r.detail),
        }
      : null,
    proofs: evaluateProofs(b).map((p) => ({ key: p.key, label: PROOF_LABELS[p.key], given: p.given, valid: p.valid, detail: p.detail })),
    mapsPlaceName: b.mapsPlaceName,
    /** 26 Nov: which other licences were given (names only, never the numbers here). */
    otherLicences: readOtherLicences(b.otherLicences).map((l) => ({ kind: l.kind, label: OTHER_LICENCE_LABELS[l.kind] })),
    ownerPhotos: { selfie: photo('owner_selfie'), shop: photo('shop_board') ?? photo('fssai_with_owner') ?? photo('workspace') },
  };
}
