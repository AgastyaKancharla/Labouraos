import { isHouseholdBusiness } from './business-auto-check.service';
import { parseOwnerPhotoLocation, shopPhotoKind } from './business-owner-photo.service';
import { vacancyCheckReasons } from '../vacancy/vacancy-tl-check';
import { homeWorkplaceInterviewAllowed } from '../vacancy/interview.service';
import { smallBusinessMissing } from './business-owner-check.service';
import { allowedShopKinds, verificationPathOf } from './business-paths';
import { businessStage } from '../signup-tracker/signup-stage';
import { AutoCheckFacts, decideAutoCheck, failedReasonText, metresBetween, SHOP_PHOTO_MAX_METERS_FROM_PIN } from './business-auto-check';
import { evaluateProofs, gstinCheckCharacter, isValidFssai, isValidGstin, isValidTradeLicence, isValidUdyam, proofFormatError, validProofCount } from './business-proofs';

/** 25 Nov (rev 211): B2 proofs and the B3 automatic decision, as pure functions. */
describe('B2 proofs: formats and the GSTIN check digit', () => {
  it('accepts real GSTINs and refuses a wrong check digit, state code or shape', () => {
    expect(isValidGstin('27AAPFU0939F1ZV')).toBe(true);
    expect(isValidGstin('29aagcb7383j1z4')).toBe(true);
    expect(isValidGstin('29AAGCB7383J1Z5')).toBe(false); // check digit
    expect(isValidGstin('29ABCDE1234F1Z5')).toBe(false); // the common made-up example has the wrong check digit
    expect(isValidGstin('45AAGCB7383J1Z4')).toBe(false); // no state 45
    expect(isValidGstin('29AAGCB7383J1Y4')).toBe(false); // 14th character must be Z
    expect(gstinCheckCharacter('27AAPFU0939F1Z')).toBe('V');
    expect(proofFormatError('gstNumber', '29AAGCB7383J1Z5')).toMatch(/GST number/);
    expect(proofFormatError('gstNumber', '')).toBeNull();
  });

  it('checks FSSAI, Udyam and trade licence shapes', () => {
    expect(isValidFssai('11521999000123')).toBe(true);
    expect(isValidFssai('21521999000123')).toBe(true);
    expect(isValidFssai('31521999000123')).toBe(false);
    expect(isValidFssai('1152199900012')).toBe(false);
    expect(isValidUdyam('UDYAM-KR-03-0012345')).toBe(true);
    expect(isValidUdyam('udyam-kr-03-0012345')).toBe(true);
    expect(isValidUdyam('UDYAM-KR-3-0012345')).toBe(false);
    expect(isValidTradeLicence('BBMP/TL/2024/1234')).toBe(true);
    expect(isValidTradeLicence('ABCD')).toBe(false);
    expect(isValidTradeLicence('ABCDE-12')).toBe(false); // fewer than 3 digits
  });

  it('counts the three proof groups: GST, FSSAI / trade licence / Udyam, Maps link with a pin', () => {
    expect(validProofCount({ gstNumber: '27AAPFU0939F1ZV', fssaiNumber: '11521999000123' })).toBe(2);
    // Two licence numbers are still ONE proof.
    expect(validProofCount({ fssaiNumber: '11521999000123', udyamNumber: 'UDYAM-KR-03-0012345' })).toBe(1);
    // A Maps link with no readable pin is not a valid proof.
    expect(validProofCount({ gstNumber: '27AAPFU0939F1ZV', mapsLink: 'https://maps.app.goo.gl/x' })).toBe(1);
    expect(validProofCount({ gstNumber: '27AAPFU0939F1ZV', mapsLink: 'https://maps.app.goo.gl/x', mapsLatitude: 12.9, mapsLongitude: 77.6 })).toBe(2);
    const proofs = evaluateProofs({ fssaiNumber: '999' });
    expect(proofs.find((p) => p.key === 'licence')).toEqual(expect.objectContaining({ given: true, valid: false }));
  });
});

const PIN = { lat: 12.9716, lng: 77.5946 };
function pass(): AutoCheckFacts {
  return {
    phoneVerified: true,
    agreementSignedByOtp: true,
    hasOwnerSelfie: true,
    hasShopPhoto: true,
    runsFromHome: false,
    shopPhotoLatitude: PIN.lat + 0.0005, // about 55 m north
    shopPhotoLongitude: PIN.lng,
    shopPhotoLocationRefused: false,
    gstNumber: '27AAPFU0939F1ZV',
    mapsLink: 'https://www.google.com/maps/place/Shop/@12.9716,77.5946,17z',
    mapsLatitude: PIN.lat,
    mapsLongitude: PIN.lng,
    duplicates: [],
    banned: false,
    suspended: false,
    paused: false,
  };
}
const failedCodes = (f: AutoCheckFacts) => decideAutoCheck(f).reasons.filter((r) => !r.ok).map((r) => r.code);

describe('B3 automatic decision: every condition passes, or each failure is named', () => {
  it('rev 213: an in-person field visit stands in for the owner photos and says so', () => {
    const result = decideAutoCheck({ ...pass(), photosFromFieldVisit: true });
    expect(result.passed).toBe(true);
    expect(result.reasons.find((r) => r.code === 'owner_selfie')?.detail).toMatch(/in-person visit/);
    expect(result.reasons.find((r) => r.code === 'shop_photo')?.detail).toMatch(/at the visit/);
  });

  it('passes when everything holds, with the distance to the Maps pin', () => {
    const result = decideAutoCheck(pass());
    expect(result.passed).toBe(true);
    expect(result.distanceMeters).toBeGreaterThan(40);
    expect(result.distanceMeters).toBeLessThan(70);
    expect(result.reasons).toHaveLength(8);
  });

  it.each([
    ['owner_phone_verified', { phoneVerified: false }],
    ['agreement_signed_by_otp', { agreementSignedByOtp: false }],
    ['owner_selfie', { hasOwnerSelfie: false }],
    ['shop_photo', { hasShopPhoto: false }],
    ['not_blocked', { banned: true }],
    ['not_blocked', { suspended: true }],
    ['not_blocked', { paused: true }],
  ] as const)('fails on %s', (code, change) => {
    const facts = { ...pass(), ...change };
    expect(decideAutoCheck(facts).passed).toBe(false);
    expect(failedCodes(facts)).toContain(code);
  });

  it('needs 2 valid proofs: one alone fails, a wrong GSTIN does not count', () => {
    expect(failedCodes({ ...pass(), mapsLink: null, mapsLatitude: null, mapsLongitude: null })).toEqual(['proofs']);
    const wrongGst = decideAutoCheck({ ...pass(), gstNumber: '29ABCDE1234F1Z5' });
    expect(wrongGst.passed).toBe(false);
    expect(wrongGst.reasons.find((r) => r.code === 'proofs')?.detail).toMatch(/check digit/);
    // GST + FSSAI and no Maps link: passes, and the location check is not needed.
    const noMaps = decideAutoCheck({ ...pass(), mapsLink: null, mapsLatitude: null, mapsLongitude: null, fssaiNumber: '11521999000123', shopPhotoLatitude: null, shopPhotoLongitude: null, shopPhotoLocationRefused: true });
    expect(noMaps.passed).toBe(true);
    expect(noMaps.reasons.find((r) => r.code === 'shop_location')?.detail).toMatch(/Not needed/);
  });

  it('200 m: the shop photo within 200 m of the Maps pin passes, farther fails, no location fails', () => {
    const at = (metresNorth: number) => ({ ...pass(), shopPhotoLatitude: PIN.lat + metresNorth / 111_195 });
    expect(decideAutoCheck(at(195)).passed).toBe(true);
    const far = decideAutoCheck(at(260));
    expect(far.passed).toBe(false);
    expect(far.reasons.find((r) => r.code === 'shop_location')?.detail).toMatch(/more than 200 m/);
    expect(far.distanceMeters).toBeGreaterThan(SHOP_PHOTO_MAX_METERS_FROM_PIN);
    const refused = { ...pass(), shopPhotoLatitude: null, shopPhotoLongitude: null, shopPhotoLocationRefused: true };
    expect(failedCodes(refused)).toEqual(['shop_location']);
  });

  it('duplicates: the same GST, licence, Maps place or phone as another business fails, naming it', () => {
    const facts = { ...pass(), duplicates: [{ businessCode: 'BZ-00042', on: ['GST number', 'Maps place'] }] };
    const result = decideAutoCheck(facts);
    expect(result.passed).toBe(false);
    expect(failedReasonText(result.reasons)).toBe('Same GST number, Maps place as BZ-00042');
  });

  it('a home business names the FSSAI licence photo', () => {
    const result = decideAutoCheck({ ...pass(), runsFromHome: true, hasShopPhoto: false });
    expect(result.reasons.find((r) => r.code === 'shop_photo')?.detail).toMatch(/holding the FSSAI licence/);
    expect(shopPhotoKind(true)).toBe('fssai_with_owner');
    expect(shopPhotoKind(false)).toBe('shop_board');
  });

  it('households keep the visit and the Team Lead check (never checked automatically)', () => {
    expect(isHouseholdBusiness('household')).toBe(true);
    expect(isHouseholdBusiness('villa_gated_community')).toBe(true);
    expect(isHouseholdBusiness('restaurant')).toBe(false);
    expect(isHouseholdBusiness(null)).toBe(false);
  });

  it('distance helper and the photo location parser', () => {
    expect(Math.round(metresBetween(12.9716, 77.5946, 12.9716 + 200 / 111_195, 77.5946))).toBe(200);
    expect(parseOwnerPhotoLocation({ latitude: '12.97', longitude: '77.59', accuracyMeters: '15' })).toEqual({ latitude: 12.97, longitude: 77.59, accuracyMeters: 15, status: 'recorded' });
    expect(parseOwnerPhotoLocation({ locationStatus: 'refused' })).toEqual(expect.objectContaining({ latitude: null, status: 'refused' }));
    expect(parseOwnerPhotoLocation({ latitude: 'abc', longitude: 77 })).toEqual(expect.objectContaining({ status: 'refused' }));
  });
});


describe('B4 vacancy check: unusual salary for the trade or more than 5 openings', () => {
  const base = { headcount: 1, salaryMinPaise: 1500000, salaryMaxPaise: 1800000, salaryPeriod: 'monthly', tradeSalaryMaxPaise: 2000000, salaryDaysPerMonth: 26 };
  it('a normal vacancy goes live; 6 openings or a salary above 1.5 × the trade top waits for the Team Lead', () => {
    expect(vacancyCheckReasons(base)).toEqual([]);
    expect(vacancyCheckReasons({ ...base, headcount: 5 })).toEqual([]);
    expect(vacancyCheckReasons({ ...base, headcount: 6 }).map((r) => r.code)).toEqual(['many_openings']);
    expect(vacancyCheckReasons({ ...base, salaryMaxPaise: 3000000 })).toEqual([]); // exactly 1.5×
    expect(vacancyCheckReasons({ ...base, salaryMaxPaise: 3000100 }).map((r) => r.code)).toEqual(['salary_high']);
    // A daily wage is compared as a month (× salary days).
    expect(vacancyCheckReasons({ ...base, salaryMinPaise: 120000, salaryMaxPaise: 120000, salaryPeriod: 'daily' }).map((r) => r.code)).toEqual(['salary_high']);
    // A typed trade with no usual range: only the openings rule.
    expect(vacancyCheckReasons({ ...base, salaryMaxPaise: 9000000, tradeSalaryMaxPaise: null })).toEqual([]);
  });
});

describe('B9 small businesses with little paperwork', () => {
  it('fewer than 2 proofs is the small-business path (households never); the workspace photo counts there', () => {
    expect(verificationPathOf({ businessType: 'restaurant', gstNumber: '27AAPFU0939F1ZV' })).toBe('small_business');
    expect(verificationPathOf({ businessType: 'restaurant', gstNumber: '27AAPFU0939F1ZV', fssaiNumber: '11521999000123' })).toBe('standard');
    expect(verificationPathOf({ businessType: 'household' })).toBe('household');
    expect(allowedShopKinds({ businessType: 'restaurant', runsFromHome: false, gstNumber: '27AAPFU0939F1ZV', fssaiNumber: '11521999000123' })).toEqual(['shop_board']);
    expect(allowedShopKinds({ businessType: 'tailoring', runsFromHome: false })).toEqual(['shop_board', 'workspace']);
    // A home food business may show the FSSAI licence held by the owner, or the workspace.
    expect(allowedShopKinds({ businessType: 'catering', runsFromHome: true })).toEqual(['fssai_with_owner', 'workspace']);
  });

  it('the Team Lead approves only when ID, photos, a business proof, the checked address proof and the video call are in', () => {
    const done = {
      ownerId: { method: 'aadhaar_qr', type: 'aadhaar', result: 'verified', last4: '1234', failureReason: null },
      businessProof: { given: true, kind: 'bank_upi', fromProofs: false },
      addressProof: { submitted: true, docType: 'electricity_bill', result: 'checked' },
      videoCall: { done: true, at: '2026-11-25T10:00:00Z' },
      photos: { selfie: true, workspace: true },
    };
    expect(smallBusinessMissing(done)).toEqual([]);
    expect(smallBusinessMissing({ ...done, videoCall: { done: false, at: null } })).toEqual(['the video call with the Team Lead']);
    // Rev 213: onboarded in person by a field agent, no video call is needed.
    expect(smallBusinessMissing({ ...done, videoCall: { done: false, at: null }, fieldVisit: true })).toEqual([]);
    expect(smallBusinessMissing({ ...done, ownerId: { ...done.ownerId, result: 'pending' } })).toEqual(["the Team Lead's check of the owner's ID"]);
    expect(smallBusinessMissing({ ...done, addressProof: { submitted: false, docType: null, result: null } })).toEqual(['an address proof']);
  });

  it('a workplace inside the owner\'s home: the first interview is by phone or at the Laboura office', () => {
    expect(homeWorkplaceInterviewAllowed(true, 0, undefined)).toBe(false);
    expect(homeWorkplaceInterviewAllowed(true, 0, 'at_shop')).toBe(false);
    expect(homeWorkplaceInterviewAllowed(true, 0, 'phone')).toBe(true);
    expect(homeWorkplaceInterviewAllowed(true, 0, 'laboura_office')).toBe(true);
    expect(homeWorkplaceInterviewAllowed(true, 1, 'at_shop')).toBe(true);
    expect(homeWorkplaceInterviewAllowed(false, 0, 'at_shop')).toBe(true);
  });
});

describe('B5 signup stages: agreement → automatic check → Team Lead only when it failed', () => {
  const f = { agreementSigned: false, visitBooked: false, visitRequested: false, visitDone: false, verified: false, rejected: false, household: false };
  it('no visit steps for a business that is not a household', () => {
    expect(businessStage(f)).toMatchObject({ stage: 'B', step: 'agreement', missing: ['agreement', 'approval'] });
    expect(businessStage({ ...f, agreementSigned: true })).toMatchObject({ stage: 'C', step: 'approval' });
    expect(businessStage({ ...f, agreementSigned: true, autoCheckFailed: true })).toMatchObject({ stage: 'E', stuckReason: 'Automatic check did not pass: Team Lead checking' });
    expect(businessStage({ ...f, agreementSigned: true, verified: true })).toMatchObject({ stage: 'done', step: 'complete' });
    // Households keep the visit stages.
    expect(businessStage({ ...f, household: true, agreementSigned: true }).missing).toContain('visit_booked');
  });
});
