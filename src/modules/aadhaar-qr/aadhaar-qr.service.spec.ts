import { BadRequestException, ConflictException, ForbiddenException, HttpException, Logger } from '@nestjs/common';
import { encode as encodeJpeg } from 'jpeg-js';
import { inflateSecureQrText, parseSecureQr, TrustedKey } from './secure-qr.parser';
import { AadhaarQrService, QR_ATTEMPTS_PER_HOUR, QR_BAD_SIGNATURES_BEFORE_FLAG } from './aadhaar-qr.service';
import { ID_PHOTO_MAX_DAYS, IdCheckPhotoService } from './id-check-photo.service';
import { IdCheckAccessService } from './id-check-access.service';
import { ALREADY_DECIDED_MESSAGE, CAPTURE_NONCE_MESSAGE, OPEN_PHOTO_FIRST_MESSAGE, OtherIdInput, OtherIdService, PHOTO_GONE_MESSAGE } from './other-id.service';
import { OtherIdApprovalService, SELF_APPROVAL_REFUSED } from './other-id-approval.service';
import { ID_PHOTO_EXPIRED_REASON } from './id-check-photo.service';
import { UNDER_18_SELF_LIFT_REFUSED, Under18StopService } from './under18-stop.service';
import { oneRegistrationCheck, REGISTRATION_ALREADY_CHECKED } from './one-registration-check';
import { MemoryCandidatePhotoStorage } from '../job-seeker/photo-storage';
import { buildSecureQr, testSigner } from './testing/secure-qr.fixtures';
import { fakePrisma, FakePrisma } from './testing/fake-prisma';
import { aadhaarFingerprint, BANNED_MESSAGE, otherIdFingerprint } from '../conduct/permanent-ban.check';

const DAY_MS = 24 * 60 * 60 * 1000;
const signer = testSigner();
const stranger = testSigner('someone-else');
const NOW = new Date('2026-11-14T06:00:00Z');

/** Address parts that must never be kept, logged or sent anywhere. */
const SECRET_ADDRESS = { house: 'Flat 9Z Secret Tower', street: 'Hidden Lane Road', careOf: 'W/O Never Kept', landmark: 'Behind Private Temple' };

/** A real JPEG the size a capture canvas makes (what a live camera photo of an ID card looks like to the server). */
function jpegOf(width: number, height: number): Buffer {
  const data = Buffer.alloc(width * height * 4, 0x80);
  for (let i = 0; i < data.length; i += 4) data[i + 3] = 0xff;
  return Buffer.from(encodeJpeg({ data, width, height }, 80).data);
}
const CARD_PHOTO = jpegOf(640, 400);

/** Puts an APP1 (or other) segment right after SOI, as a camera or an editor would. */
function withSegment(jpeg: Buffer, marker: number, payload: Buffer): Buffer {
  const length = Buffer.alloc(2);
  length.writeUInt16BE(payload.length + 2);
  return Buffer.concat([jpeg.subarray(0, 2), Buffer.from([0xff, marker]), length, payload, jpeg.subarray(2)]);
}

/** A minimal EXIF block whose IFD0 carries one tag (e.g. 0x010f Make). */
function exifWithTag(tag: number): Buffer {
  const tiff = Buffer.alloc(8 + 2 + 12 + 4);
  tiff.write('II', 0, 'latin1');
  tiff.writeUInt16LE(42, 2);
  tiff.writeUInt32LE(8, 4);
  tiff.writeUInt16LE(1, 8);
  tiff.writeUInt16LE(tag, 10);
  tiff.writeUInt16LE(2, 12);
  tiff.writeUInt32LE(4, 14);
  tiff.write('Cam', 18, 'latin1');
  return Buffer.concat([Buffer.from('Exif\u0000\u0000', 'latin1'), tiff]);
}

function setup(options: { trusted?: TrustedKey[] } = {}) {
  const prisma: FakePrisma = fakePrisma({
    jobSeekers: [
      { id: 'js-1', code: 'JS-00001', name: 'Kavya Ramesh', phone: '+919876500001', phoneVerified: true, city: 'Bengaluru', registeredByStaffId: 'agent-1', anonymisedAt: null, photoStoragePath: 'job-seekers/js-1/selfie', createdAt: NOW },
      { id: 'js-2', code: 'JS-00002', name: 'Kavya Ramesh', phone: '+919876500002', phoneVerified: true, city: 'Bengaluru', registeredByStaffId: 'agent-2', anonymisedAt: null, photoStoragePath: 'job-seekers/js-2/selfie', createdAt: NOW },
      { id: 'js-3', code: 'JS-00003', name: 'Ravi Kumar', phone: '+919876500003', phoneVerified: true, city: 'Bengaluru', registeredByStaffId: 'agent-1', anonymisedAt: null, photoStoragePath: null, createdAt: NOW },
    ],
    referrals: [{ id: 'rf-1', code: 'RF-00001', name: 'Kavya Ramesh', phone: '+919876500001', phoneVerified: true, city: 'Bengaluru', registeredByStaffId: 'agent-1', photoStoragePath: 'referrals/rf-1/profile-photo', createdAt: NOW }],
    // Bengaluru: tl-1 (agent-1, fa-1) and tl-2 (agent-2) under managers 1 and 2; Mysuru: tl-9 alone.
    staff: [
      { id: 'agent-1', role: 'field_agent', status: 'active', city: 'Bengaluru', teamLeadId: 'tl-1', reportsToId: 'tl-1' },
      { id: 'fa-1', role: 'field_agent', status: 'active', city: 'Bengaluru', teamLeadId: 'tl-1', reportsToId: 'tl-1' },
      { id: 'agent-2', role: 'field_agent', status: 'active', city: 'Bengaluru', teamLeadId: 'tl-2', reportsToId: 'tl-2' },
      { id: 'tl-1', role: 'team_lead', status: 'active', city: 'Bengaluru', teamLeadId: null, reportsToId: 'manager-1' },
      { id: 'tl-2', role: 'team_lead', status: 'active', city: 'Bengaluru', teamLeadId: null, reportsToId: 'manager-2' },
      { id: 'tl-9', role: 'team_lead', status: 'active', city: 'Mysuru', teamLeadId: null, reportsToId: 'manager-1' },
      { id: 'manager-1', role: 'manager', status: 'active', city: 'Bengaluru', teamLeadId: null, reportsToId: 'ceo-1' },
      { id: 'manager-2', role: 'manager', status: 'active', city: 'Bengaluru', teamLeadId: null, reportsToId: 'ceo-1' },
      { id: 'manager-9', role: 'manager', status: 'active', city: 'Mysuru', teamLeadId: null, reportsToId: 'ceo-1' },
      { id: 'ceo-1', role: 'ceo', status: 'active', city: 'Bengaluru', teamLeadId: null, reportsToId: null },
    ],
    consents: [
      { id: 'consent-1', subjectType: 'job_seeker', subjectId: 'js-1', purpose: 'aadhaar_verification', granted: true, grantedAt: NOW, withdrawnAt: null, createdAt: NOW },
      { id: 'consent-3', subjectType: 'job_seeker', subjectId: 'js-2', purpose: 'aadhaar_verification', granted: true, grantedAt: NOW, withdrawnAt: null, createdAt: NOW },
      { id: 'consent-4', subjectType: 'job_seeker', subjectId: 'js-3', purpose: 'aadhaar_verification', granted: true, grantedAt: NOW, withdrawnAt: null, createdAt: NOW },
      // The partner accepted Referral Partner Terms v1.0 with its separate ID-check consent (S2, rev 176).
      { id: 'consent-2', subjectType: 'referral', subjectId: 'rf-1', purpose: 'aadhaar_verification', granted: true, grantedAt: NOW, withdrawnAt: null, createdAt: NOW },
      { id: 'consent-2t', subjectType: 'referral', subjectId: 'rf-1', purpose: 'agreement_terms', granted: true, grantedAt: NOW, withdrawnAt: null, createdAt: NOW },
    ],
    legalAcceptances: [
      { id: 'acc-rf-1', subjectType: 'referral', subjectId: 'rf-1', documentKey: 'referral_terms', version: '1.0', language: 'en', context: 'partner_terms', noticeVersion: null, acceptedAt: NOW },
    ],
  });
  const auditCalls: Record<string, unknown>[] = [];
  const audit = { log: jest.fn(async (entry: Record<string, unknown>) => void auditCalls.push(entry)) };
  const flagCalls: Record<string, unknown>[] = [];
  const flags = {
    raise: jest.fn(async (params: Record<string, unknown>, options?: { tx?: unknown }) => {
      void options;
      flagCalls.push(params);
      const { owner, ...data } = params;
      void owner;
      return prisma.reviewFlag.create({ data: { ...data, status: 'open' } });
    }),
    refreshBell: jest.fn(async () => undefined),
  };
  const pricing = { current: jest.fn(async () => ({ adultMinimumAge: 18 })) };
  const storage = new MemoryCandidatePhotoStorage();
  const photos = new IdCheckPhotoService(prisma as never, audit as never, storage);
  // Reporting lines: manager-1 has agent-1 under them; manager-2 has agent-2.
  const scope = { peopleUnder: jest.fn(async (id: string) => (id === 'manager-1' ? ['tl-1', 'agent-1'] : id === 'manager-2' ? ['agent-2'] : [])) };
  const access = new IdCheckAccessService(scope as never);
  const stops = new Under18StopService(prisma as never, audit as never, access);
  const approvals = new OtherIdApprovalService(prisma as never);
  const otherIds = new OtherIdService(prisma as never, audit as never, photos, stops, approvals, flags as never);
  const service = new AadhaarQrService(prisma as never, audit as never, pricing as never, flags as never, photos, stops, options.trusted ?? [signer.trusted]);
  /** A one-time capture token, as the page gets it when the camera opens. */
  const nonce = async (type: 'job_seeker' | 'referral' = 'job_seeker', id = 'js-1', staffId?: string) =>
    (await otherIds.issueCaptureNonce(type, id, { staffId, now: NOW })).captureNonce;
  /** A complete other-ID upload for the link (or Laboura Field with staffId). */
  const card = async (input: Partial<OtherIdInput> = {}, who: { type?: 'job_seeker' | 'referral'; id?: string; staffId?: string } = {}): Promise<OtherIdInput> => ({
    idType: 'pan',
    idNumber: 'abcde 1234 f',
    captureSource: 'live_camera',
    photo: { buffer: CARD_PHOTO },
    captureNonce: 'captureNonce' in input ? input.captureNonce : await nonce(who.type ?? 'job_seeker', who.id ?? 'js-1', who.staffId),
    ...input,
  });
  /** The decider opened the photos (the audit row GET …/aadhaar-check writes). */
  const viewPhoto = async (actorId: string, type: 'job_seeker' | 'referral' = 'job_seeker', id = 'js-1') => {
    const rows = type === 'job_seeker' ? prisma.identityVerification.rows.filter((r) => r.jobSeekerId === id) : prisma.referralIdentityVerification.rows.filter((r) => r.referralId === id);
    const latest = rows.at(-1)!;
    const code = (type === 'job_seeker' ? prisma.jobSeeker : prisma.referral).rows.find((r) => r.id === id)!.code;
    await prisma.auditLog.create({ data: { actorId, action: 'identity.id_check_viewed', entityType: type, entityCode: code, after: { verificationId: latest.id, idPhotoLinkIssued: true } } });
  };
  return { prisma, audit, auditCalls, flags, flagCalls, storage, photos, stops, otherIds, approvals, access, service, nonce, card, viewPhoto };
}

const qr = (input: Parameters<typeof buildSecureQr>[1] = {}) => buildSecureQr(signer, { mobile: '9876500001', address: SECRET_ADDRESS, ...input });

describe('AadhaarQrService (guide: Aadhaar verification, 14 Nov)', () => {
  it('verifies a genuine QR: stores only the listed fields and the photo, answers with the masked reference', async () => {
    const { service, prisma, storage } = setup();
    const out = await service.checkJobSeeker('js-1', qr({ last4: '4321' }), { channel: 'link', now: NOW });
    expect(out).toMatchObject({
      status: 'verified', result: 'verified', verifiedByUidai: true, nameMatches: true, isAdult: true, phoneLinked: 'linked',
      maskedReference: 'XXXX-XXXX-4321', person: { name: 'Kavya Ramesh', dateOfBirth: '1998-08-15', gender: 'F' }, offerOtherId: false,
    });
    const [row] = prisma.identityVerification.rows;
    expect(row).toMatchObject({
      jobSeekerId: 'js-1', method: 'aadhaar_qr', vendor: 'uidai_secure_qr', vendorReference: '432120260101101530123',
      status: 'verified', last4: '4321', nameMatches: true, isAdult: true, phoneLinked: 'linked', consentId: 'consent-1',
    });
    expect((row!.qrIssuedAt as Date).toISOString()).toBe('2026-01-01T04:45:30.123Z');
    const [detail] = prisma.idCheckDetail.rows;
    expect(detail).toMatchObject({
      subjectType: 'job_seeker', subjectId: 'js-1', verificationId: row!.id, nameOnId: 'Kavya Ramesh', dateOfBirth: '1998-08-15',
      gender: 'F', area: 'JP Nagar 8th Phase', pincode: '560076',
    });
    expect(detail!.photoPath).toBe(`aadhaar-qr/job_seeker/js-1/${row!.id}.jpg`);
    expect((detail!.photoExpiresAt as Date).getTime()).toBe(NOW.getTime() + ID_PHOTO_MAX_DAYS * DAY_MS);
    expect(storage.has(detail!.photoPath as string)).toBe(true);
    // Only these columns exist on the detail: no address, no hashes, no QR text.
    expect(Object.keys(detail!).sort()).toEqual(
      ['area', 'createdAt', 'dateOfBirth', 'gender', 'id', 'kind', 'nameOnId', 'photoDeletedAt', 'photoDeletedReason', 'photoExpiresAt', 'photoPath', 'pincode', 'subjectId', 'subjectType', 'updatedAt', 'verificationId'].sort(),
    );
    expect(detail!.kind).toBe('aadhaar_qr');
    expect(prisma.aadhaarQrAttempt.rows).toEqual([expect.objectContaining({ outcome: 'verified', channel: 'link' })]);
    // The attempt is claimed first, under a lock on this person.
    expect(prisma.locks[0]).toBe('aadhaar-qr:job_seeker:js-1');
  });

  it('Laboura Field gets the result without anything read from the card', async () => {
    const { service, prisma, auditCalls } = setup();
    const out = await service.checkJobSeeker('js-1', qr(), { channel: 'field', staffId: 'fa-1', now: NOW });
    expect(out.result).toBe('verified');
    expect(out.person).toBeNull();
    expect(prisma.aadhaarQrAttempt.rows[0]).toMatchObject({ channel: 'field', staffId: 'fa-1' });
    expect(auditCalls[0]).toMatchObject({ actorId: 'fa-1', action: 'identity.aadhaar_qr_checked' });
  });

  it('refuses without the aadhaar_verification consent', async () => {
    const { service, prisma } = setup();
    prisma.consent.rows.splice(0, 1);
    await expect(service.checkJobSeeker('js-1', qr(), { channel: 'link', now: NOW })).rejects.toThrow('Consent for aadhaar_verification');
  });

  it('refuses before the live selfie (nothing stored, no attempt counted)', async () => {
    const { service, prisma } = setup();
    await expect(service.checkJobSeeker('js-3', qr({ name: 'Ravi Kumar' }), { channel: 'link', now: NOW })).rejects.toThrow('Take the selfie first');
    expect(prisma.identityVerification.rows).toHaveLength(0);
    expect(prisma.aadhaarQrAttempt.rows).toHaveLength(0);
  });

  it('an edited or fake card fails the signature: nothing stored but the attempt', async () => {
    const { service, prisma } = setup();
    const out = await service.checkJobSeeker('js-1', buildSecureQr(stranger, { mobile: '9876500001' }), { channel: 'link', now: NOW });
    expect(out).toMatchObject({ status: 'failed', result: 'bad_signature', verifiedByUidai: false, offerOtherId: true, maskedReference: null });
    expect(prisma.identityVerification.rows).toHaveLength(0);
    expect(prisma.idCheckDetail.rows).toHaveLength(0);
    expect(prisma.aadhaarQrAttempt.rows[0]).toMatchObject({ outcome: 'bad_signature' });
  });

  it('refuses an old unsigned (XML) QR with its own result, and unreadable text', async () => {
    const { service } = setup();
    const old = await service.checkJobSeeker('js-1', '<?xml version="1.0"?><PrintLetterBarcodeData name="X"/>', { channel: 'link', now: NOW });
    expect(old).toMatchObject({ status: 'failed', result: 'old_qr', offerOtherId: true });
    expect(old.failureReason).toContain('e-Aadhaar');
    const junk = await service.checkJobSeeker('js-1', 'hello', { channel: 'link', now: NOW });
    expect(junk.result).toBe('unreadable');
  });

  it('under 18: stops, keeps only the result (no name, date of birth, gender, area, pincode or photo)', async () => {
    const { service, prisma } = setup();
    const out = await service.checkJobSeeker('js-1', qr({ dob: '15-11-2008' }), { channel: 'link', now: NOW });
    expect(out).toMatchObject({ status: 'failed', result: 'under_18', isAdult: false, person: null, maskedReference: null, dateOfBirthUnreadable: false });
    // The person is told a Manager can lift it if it was a family member's card by mistake (L4).
    expect(out.failureReason).toMatch(/family member's card by mistake, a Manager can lift/);
    // M-4: only the results — no last 4, no QR reference, no QR time stamp.
    expect(prisma.identityVerification.rows[0]).toMatchObject({ status: 'failed', isAdult: false, verifiedAt: null, vendor: 'uidai_secure_qr', last4: null, vendorReference: null, qrIssuedAt: null });
    expect(prisma.idCheckDetail.rows).toHaveLength(0);
  });

  it('L4: an unreadable date of birth is treated as under 18 (the safe side) and says a Manager can review it', async () => {
    const { service, stops } = setup();
    const out = await service.checkJobSeeker('js-1', qr({ dob: 'unknown' }), { channel: 'link', now: NOW });
    expect(out).toMatchObject({ result: 'under_18', isAdult: false, dateOfBirthUnreadable: true });
    expect(out.failureReason).toMatch(/could not be read.*A Manager can review it/);
    expect(await stops.isStopped('job_seeker', 'js-1')).toBe(true);
  });

  it('L4 (owner correction): under 18 with a name that does not match still sets the sticky stop — a minor must not switch to an adult card', async () => {
    const { service, stops, prisma } = setup();
    const out = await service.checkJobSeeker('js-1', qr({ dob: '15-11-2008', name: 'Somebody Else' }), { channel: 'link', now: NOW });
    expect(out).toMatchObject({ result: 'under_18', nameMatches: false });
    expect(await stops.isStopped('job_seeker', 'js-1')).toBe(true);
    await expect(service.checkJobSeeker('js-1', qr(), { channel: 'link', now: NOW })).rejects.toThrow(/family member's card by mistake/);
    expect(prisma.identityVerification.rows[0]).toMatchObject({ last4: null, vendorReference: null, qrIssuedAt: null });
  });

  describe('the under-18 stop is sticky (rev 154)', () => {
    async function stopped() {
      const ctx = setup();
      await ctx.service.checkJobSeeker('js-1', qr({ dob: '15-11-2008' }), { channel: 'link', now: NOW });
      return ctx;
    }

    it('a new QR — even an adult one — and another ID are refused while it stands', async () => {
      const { service, otherIds, stops, prisma } = await stopped();
      expect(await stops.isStopped('job_seeker', 'js-1')).toBe(true);
      await expect(service.checkJobSeeker('js-1', qr(), { channel: 'link', now: NOW })).rejects.toThrow(/under 18/);
      await expect(service.checkJobSeeker('js-1', qr(), { channel: 'field', staffId: 'fa-1', now: NOW })).rejects.toThrow(/under 18/);
      const stale = { idType: 'pan', idNumber: 'ABCDE1234F', captureSource: 'live_camera', captureNonce: 'n'.repeat(32), photo: { buffer: CARD_PHOTO } };
      await expect(otherIds.submitForJobSeeker('js-1', stale, { channel: 'link', now: NOW })).rejects.toThrow(/under 18/);
      // Not even a camera token is given while it stands.
      await expect(otherIds.issueCaptureNonce('job_seeker', 'js-1', { now: NOW })).rejects.toThrow(/under 18/);
      expect(prisma.identityVerification.rows).toHaveLength(1);
    });

    it('M-2: "Looks right" on an older pending other ID is refused as a whole — nothing changes and no photo is deleted', async () => {
      const { service, otherIds, prisma, card, viewPhoto, storage } = setup();
      await otherIds.submitForJobSeeker('js-1', await card(), { channel: 'link', now: NOW });
      const path = prisma.idCheckDetail.rows[0]!.photoPath as string;
      await viewPhoto('tl-1');
      await service.checkJobSeeker('js-1', qr({ dob: '15-11-2008' }), { channel: 'link', now: new Date(NOW.getTime() + 1000) });
      await expect(otherIds.recordDecision('job_seeker', 'js-1', 'ok', { id: 'tl-1', role: 'team_lead' }, NOW)).rejects.toThrow(/under 18/);
      expect(prisma.identityVerification.rows.find((r) => r.method === 'pan')).toMatchObject({ status: 'pending' });
      expect(storage.has(path)).toBe(true);
      expect(prisma.idCheckDetail.rows[0]).toMatchObject({ photoPath: path, photoDeletedAt: null });
    });

    it('only a Manager over that registration or the CEO can lift it, with a reason; audited', async () => {
      const { stops, service, auditCalls, prisma } = await stopped();
      await expect(stops.lift({ id: 'tl-1', role: 'team_lead' }, 'job_seeker', 'js-1', 'The card had a wrong year')).rejects.toThrow(/Manager or the CEO/);
      await expect(stops.lift({ id: 'agent-1', role: 'field_agent' }, 'job_seeker', 'js-1', 'The card had a wrong year')).rejects.toThrow(/Manager or the CEO/);
      await expect(stops.lift({ id: 'manager-2', role: 'manager' }, 'job_seeker', 'js-1', 'The card had a wrong year')).rejects.toThrow(/your teams/);
      await expect(stops.lift({ id: 'manager-1', role: 'manager' }, 'job_seeker', 'js-1', 'ok')).rejects.toThrow(/Write why/);
      await expect(stops.lift({ id: 'manager-1', role: 'manager' }, 'job_seeker', 'js-1', '          ')).rejects.toThrow(/Write why/);
      expect(await stops.lift({ id: 'manager-1', role: 'manager' }, 'job_seeker', 'js-1', 'Birth certificate shows he is 19')).toEqual({ lifted: 1 });
      expect(prisma.identityVerification.rows[0]).toMatchObject({ under18LiftedByStaffId: 'manager-1', under18LiftReason: 'Birth certificate shows he is 19' });
      expect(auditCalls.at(-1)).toMatchObject({ actorId: 'manager-1', action: 'identity.under18_stop_lifted', reason: 'Birth certificate shows he is 19' });
      await expect(stops.lift({ id: 'ceo-1', role: 'ceo' }, 'job_seeker', 'js-1', 'Birth certificate shows he is 19')).rejects.toThrow(/no under-18 stop/);
      // After the lift a new check is possible.
      expect((await service.checkJobSeeker('js-1', qr(), { channel: 'link', now: NOW })).result).toBe('verified');
    });

    it('the CEO can lift any stop; referral partners have the same stop', async () => {
      const { service, stops } = setup();
      await service.checkReferral('rf-1', qr({ dob: '15-11-2008' }), { channel: 'link', now: NOW });
      await expect(service.checkReferral('rf-1', qr(), { channel: 'link', now: NOW })).rejects.toThrow(/under 18/);
      expect(await stops.lift({ id: 'ceo-1', role: 'ceo' }, 'referral', 'rf-1', 'School leaving certificate checked')).toEqual({ lifted: 1 });
      expect(await stops.isStopped('referral', 'rf-1')).toBe(false);
    });
  });

  it('name mismatch: other-ID offer and a name check for the Team Lead, marked when it looks like spelling', async () => {
    const { service, flagCalls, prisma } = setup();
    const out = await service.checkJobSeeker('js-1', qr({ name: 'Kaavya Ramesh' }), { channel: 'link', now: NOW });
    expect(out).toMatchObject({ status: 'failed', result: 'name_mismatch', nameMatches: false, verifiedByUidai: true, offerOtherId: true, person: null, maskedReference: null });
    // M-4: a failed check keeps only results: no last 4, no QR reference, no QR time stamp.
    expect(prisma.identityVerification.rows[0]).toMatchObject({ status: 'failed', nameMatches: false, last4: null, vendorReference: null, qrIssuedAt: null });
    // Only the result: no name, date of birth, gender, area, pincode or photo.
    expect(prisma.idCheckDetail.rows).toHaveLength(0);
    expect(flagCalls).toEqual([
      expect.objectContaining({ kind: 'name_check', subjectType: 'job_seeker', subjectId: 'js-1', raisedForStaffId: 'agent-1', details: expect.objectContaining({ likelySpelling: true, method: 'aadhaar_qr' }) }),
    ]);
  });

  it('name matcher (adversarial): a QR with only one word of his name, or initials, is not verified', async () => {
    for (const name of ['Kavya', 'K Ramesh', 'Ramesh', 'K R', 'Kavyaramesh']) {
      const { service, flagCalls } = setup();
      const out = await service.checkJobSeeker('js-1', qr({ name }), { channel: 'link', now: NOW });
      expect(out.result).toBe('name_mismatch');
      expect(flagCalls[0]).toMatchObject({ kind: 'name_check' });
    }
  });

  it('phone not linked to that Aadhaar: still verified, a flag for the Team Lead', async () => {
    const { service, flagCalls } = setup();
    const out = await service.checkJobSeeker('js-1', qr({ mobile: '9000000009' }), { channel: 'link', now: NOW });
    expect(out).toMatchObject({ status: 'verified', result: 'verified', phoneLinked: 'not_linked' });
    expect(flagCalls).toEqual([expect.objectContaining({ kind: 'aadhaar_phone_not_linked', subjectId: 'js-1' })]);
  });

  it('newer cards (V2): the phone link from the last 4 digits', async () => {
    const { service } = setup();
    expect((await service.checkJobSeeker('js-1', qr({ version: 'V2' }), { channel: 'link', now: NOW })).phoneLinked).toBe('linked');
  });

  it('rate-limits each person across link and field, and raises one fraud flag after repeated invalid signatures', async () => {
    const { service, flagCalls } = setup();
    const fake = buildSecureQr(stranger, { mobile: '9876500001' });
    for (let i = 0; i < QR_BAD_SIGNATURES_BEFORE_FLAG + 2; i += 1) {
      await service.checkJobSeeker('js-1', fake, { channel: i % 2 ? 'field' : 'link', staffId: i % 2 ? 'fa-1' : null, now: new Date(NOW.getTime() + i * 1000) });
    }
    const tampered = flagCalls.filter((f) => f.kind === 'aadhaar_qr_tampered');
    expect(tampered).toHaveLength(1);
    expect(flagCalls.filter((f) => f.kind === 'aadhaar_cert_missing')).toHaveLength(0);
    expect(tampered[0]).toMatchObject({ subjectId: 'js-1', raisedForStaffId: 'agent-1', details: expect.objectContaining({ invalidSignatureAttempts: QR_BAD_SIGNATURES_BEFORE_FLAG }) });

    for (let i = QR_BAD_SIGNATURES_BEFORE_FLAG + 2; i < QR_ATTEMPTS_PER_HOUR; i += 1) {
      await service.checkJobSeeker('js-1', 'junk', { channel: 'link', now: new Date(NOW.getTime() + i * 1000) });
    }
    const blocked = service.checkJobSeeker('js-1', qr(), { channel: 'link', now: new Date(NOW.getTime() + 60_000) });
    await expect(blocked).rejects.toBeInstanceOf(HttpException);
    await expect(service.checkJobSeeker('js-1', qr(), { channel: 'field', now: new Date(NOW.getTime() + 60_000) })).rejects.toMatchObject({ status: 429 });
    // An hour later it works again.
    const later = await service.checkJobSeeker('js-1', qr(), { channel: 'link', now: new Date(NOW.getTime() + 61 * 60_000) });
    expect(later.result).toBe('verified');
  });

  it('the fraud flag is raised once per person, ever — a day later more bad scans do not raise another', async () => {
    const { service, flagCalls } = setup();
    const fake = buildSecureQr(stranger, { mobile: '9876500001' });
    for (let i = 0; i < QR_BAD_SIGNATURES_BEFORE_FLAG; i += 1) await service.checkJobSeeker('js-1', fake, { channel: 'link', now: new Date(NOW.getTime() + i * 1000) });
    for (let i = 0; i < QR_BAD_SIGNATURES_BEFORE_FLAG; i += 1) await service.checkJobSeeker('js-1', fake, { channel: 'link', now: new Date(NOW.getTime() + 2 * DAY_MS + i * 1000) });
    expect(flagCalls.filter((f) => f.kind === 'aadhaar_qr_tampered')).toHaveLength(1);
  });

  it('raises the tampered flag and the certificate flag while the advisory lock is held (parallel scans raise each once)', async () => {
    const { service, prisma, flags } = setup({ trusted: [{ ...signer.trusted, notAfter: new Date('2025-12-31T00:00:00Z') }] });
    let depth = 0;
    const transaction = prisma.$transaction.bind(prisma);
    prisma.$transaction = (async (fn: (tx: unknown) => Promise<unknown>, options?: unknown) => {
      depth += 1;
      try {
        return await transaction(fn, options);
      } finally {
        depth -= 1;
      }
    }) as typeof prisma.$transaction;
    const seen: { kind: unknown; inTransaction: boolean; lastLock: string | undefined }[] = [];
    const raise = flags.raise.getMockImplementation()!;
    flags.raise.mockImplementation(async (params: Record<string, unknown>) => {
      seen.push({ kind: params.kind, inTransaction: depth > 0, lastLock: prisma.locks[prisma.locks.length - 1] });
      return raise(params);
    });
    const older = buildSecureQr(stranger, { mobile: '9876500001', timestamp: '20251001101530123' });
    for (let i = 0; i < QR_BAD_SIGNATURES_BEFORE_FLAG; i += 1) await service.checkJobSeeker('js-1', older, { channel: 'link', now: new Date(NOW.getTime() + i * 1000) });
    await service.checkJobSeeker('js-2', buildSecureQr(stranger, { mobile: '9876500002', timestamp: '20260101101530123' }), { channel: 'link', now: NOW });
    expect(seen).toEqual([
      { kind: 'aadhaar_qr_tampered', inTransaction: true, lastLock: 'aadhaar-qr-flag:job_seeker:js-1' },
      { kind: 'aadhaar_cert_missing', inTransaction: true, lastLock: 'aadhaar-qr-system:aadhaar_cert_missing' },
    ]);
  });

  describe('a card newer than our newest UIDAI certificate (H3)', () => {
    // Our certificate ends on 1 Jan 2026 at noon; this QR was made after that and is signed with a key we don't hold.
    const trusted = [{ ...signer.trusted, notAfter: new Date('2025-12-31T00:00:00Z') }];
    const newer = buildSecureQr(stranger, { mobile: '9876500001', timestamp: '20260101101530123' });

    it('is not called tampered: "use another ID", and one non-fraud flag for the CEO a day', async () => {
      const { service, flagCalls, prisma } = setup({ trusted });
      for (let i = 0; i < QR_BAD_SIGNATURES_BEFORE_FLAG + 1; i += 1) {
        const out = await service.checkJobSeeker('js-1', newer, { channel: 'link', now: new Date(NOW.getTime() + i * 1000) });
        expect(out).toMatchObject({ status: 'failed', result: 'cert_missing', offerOtherId: true });
        expect(out.failureReason).toBe('This Aadhaar is newer than our check supports. Please use another ID.');
      }
      expect(flagCalls.filter((f) => f.kind === 'aadhaar_qr_tampered')).toHaveLength(0);
      expect(flagCalls.filter((f) => f.kind === 'aadhaar_cert_missing')).toEqual([expect.objectContaining({ subjectType: 'system', raisedForStaffId: null })]);
      expect(prisma.aadhaarQrAttempt.rows.every((r) => r.outcome === 'cert_missing')).toBe(true);
      // A day later (the earlier flag is old), one more.
      prisma.reviewFlag.rows[0]!.raisedAt = new Date(NOW.getTime() - 2 * DAY_MS);
      await service.checkJobSeeker('js-2', newer, { channel: 'link', now: NOW });
      expect(flagCalls.filter((f) => f.kind === 'aadhaar_cert_missing')).toHaveLength(2);
    });

    it('an older card with a bad signature is still a bad signature', async () => {
      const { service } = setup({ trusted });
      const older = buildSecureQr(stranger, { mobile: '9876500001', timestamp: '20251001101530123' });
      expect((await service.checkJobSeeker('js-1', older, { channel: 'link', now: NOW })).result).toBe('bad_signature');
    });

    it('a genuine card signed with a key we hold still verifies, whatever its date', async () => {
      const { service } = setup({ trusted });
      expect((await service.checkJobSeeker('js-1', qr({ timestamp: '20270101101530123' }), { channel: 'link', now: NOW })).result).toBe('verified');
    });
  });

  it('the same Aadhaar already verified for another person: a flag for the Manager, never a block', async () => {
    const { service, flagCalls } = setup();
    await service.checkJobSeeker('js-1', qr({ last4: '4321' }), { channel: 'link', now: NOW });
    const second = await service.checkJobSeeker('js-2', qr({ last4: '4321', mobile: '9876500002' }), { channel: 'link', now: NOW });
    expect(second.result).toBe('verified');
    const dup = flagCalls.filter((f) => f.kind === 'aadhaar_duplicate_person');
    expect(dup).toEqual([expect.objectContaining({ subjectId: 'js-2', raisedForStaffId: 'agent-2', owner: { role: 'manager' }, details: expect.objectContaining({ sameAadhaarAs: [{ subjectType: 'job_seeker', subjectId: 'js-1' }] }) })]);
    // A different card (other last 4) is not a duplicate.
    const { service: fresh, flagCalls: freshFlags } = setup();
    await fresh.checkJobSeeker('js-1', qr({ last4: '4321' }), { channel: 'link', now: NOW });
    await fresh.checkJobSeeker('js-2', qr({ last4: '9999', mobile: '9876500002' }), { channel: 'link', now: NOW });
    expect(freshFlags.filter((f) => f.kind === 'aadhaar_duplicate_person')).toHaveLength(0);
  });

  it('referral partners get the same check (no QR photo kept: there is no Team Lead photo check for partners)', async () => {
    const { service, prisma } = setup();
    const out = await service.checkReferral('rf-1', qr(), { channel: 'link', now: NOW });
    expect(out).toMatchObject({ status: 'verified', result: 'verified', maskedReference: 'XXXX-XXXX-1234', phoneLinked: 'linked' });
    expect(prisma.referralIdentityVerification.rows[0]).toMatchObject({ referralId: 'rf-1', method: 'aadhaar_qr', consentId: 'consent-2' });
    expect(prisma.idCheckDetail.rows[0]).toMatchObject({ subjectType: 'referral', photoPath: null });
  });

  it('S2 (rev 176): a partner who accepted the full v1.0 terms needs the separate ID-check consent; the old short-terms tick does not count', async () => {
    const { service, prisma } = setup();
    prisma.consent.rows.splice(prisma.consent.rows.findIndex((r) => r.id === 'consent-2'), 1);
    await expect(service.checkReferral('rf-1', qr(), { channel: 'link', now: NOW })).rejects.toThrow('The ID-check consent is required');
    prisma.consent.rows.push({ id: 'consent-9', subjectType: 'referral', subjectId: 'rf-1', purpose: 'aadhaar_verification', granted: true, grantedAt: NOW, withdrawnAt: null, createdAt: NOW });
    await service.checkReferral('rf-1', qr(), { channel: 'link', now: NOW });
    expect(prisma.referralIdentityVerification.rows[0]).toMatchObject({ referralId: 'rf-1', consentId: 'consent-9' });
  });

  it('M6 / H3: a partner who signed only the older short terms must accept v1.0 first (RECONSENT_REQUIRED), for the QR and for another ID', async () => {
    const { service, otherIds, prisma, card } = setup();
    prisma.legalAcceptance.rows.splice(0, 1);
    prisma.consent.rows.splice(prisma.consent.rows.findIndex((r) => r.id === 'consent-2'), 1);
    const refused = await service.checkReferral('rf-1', qr(), { channel: 'link', now: NOW }).catch((e: HttpException) => e);
    expect((refused as HttpException).getResponse()).toMatchObject({ code: 'RECONSENT_REQUIRED', documentKey: 'referral_terms', currentVersion: '1.0' });
    await expect(otherIds.submitForReferral('rf-1', await card({}, { type: 'referral', id: 'rf-1' }), { channel: 'link', now: NOW })).rejects.toThrow('accept the updated terms');
  });

  it('H3: a job seeker who must accept the updated terms (five consents under the old notice, no acceptance yet) gets no ID check', async () => {
    const { service, prisma } = setup();
    for (const purpose of ['job_matching', 'profile_sharing', 'call_recording', 'job_updates']) {
      prisma.consent.rows.push({ id: `c-${purpose}`, subjectType: 'job_seeker', subjectId: 'js-1', purpose, granted: true, grantedAt: NOW, withdrawnAt: null, createdAt: NOW });
    }
    await expect(service.checkJobSeeker('js-1', qr({ last4: '4321' }), { channel: 'link', now: NOW })).rejects.toThrow('accept the updated terms');
    prisma.legalAcceptance.rows.push({ id: 'acc-js', subjectType: 'job_seeker', subjectId: 'js-1', documentKey: 'job_seeker_terms', version: '1.1', context: 'reconsent', noticeVersion: '1.2', acceptedAt: NOW });
    expect((await service.checkJobSeeker('js-1', qr({ last4: '4321' }), { channel: 'link', now: NOW })).result).toBe('verified');
  });

  it('H2 (rev 181): the same PAN, driving licence or voter ID as a banned person is never a ban by itself: a review item for a Manager/CEO, and the ID check waits ("under review", never "ban")', async () => {
    const { otherIds, service, prisma, card, flagCalls } = setup();
    prisma.permanentBan.rows.push({ id: 'ban-2', subjectType: 'job_seeker', subjectId: 'js-old', subjectCode: 'JS-00099', category: 'forged_id', liftedAt: null, idFingerprints: [otherIdFingerprint('pan', '234F', 'Kavya Ramesh')] });
    const refused = await otherIds.submitForJobSeeker('js-1', await card(), { channel: 'link', now: NOW }).catch((e: HttpException) => e);
    expect((refused as HttpException).getResponse()).toMatchObject({ code: 'UNDER_REVIEW' });
    expect(JSON.stringify((refused as HttpException).getResponse()).toLowerCase()).not.toContain('ban');
    expect(prisma.identityVerification.rows).toHaveLength(0);
    expect(flagCalls).toEqual([expect.objectContaining({ kind: 'possible_banned_person', subjectType: 'job_seeker', subjectId: 'js-1', owner: { role: 'manager' }, details: expect.objectContaining({ banId: 'ban-2', idType: 'pan' }) })]);
    // While it is open, the Aadhaar QR check waits too.
    await expect(service.checkJobSeeker('js-1', qr({ last4: '4321' }), { channel: 'link', now: NOW })).rejects.toThrow('being checked');
    // "Not the same person": the same match is not raised again; the check goes ahead.
    prisma.reviewFlag.rows[0]!.status = 'dismissed';
    prisma.reviewFlag.rows[0]!.details = { banId: 'ban-2', decision: 'not_same' };
    expect((await otherIds.submitForJobSeeker('js-1', await card(), { channel: 'link', now: NOW })).status).toBe('pending');
  });

  it('Fable final check: "not the same" for one ban never hides a second ban on the same ID', async () => {
    const { otherIds, prisma, card, flagCalls } = setup();
    const fp = otherIdFingerprint('pan', '234F', 'Kavya Ramesh');
    prisma.permanentBan.rows.push({ id: 'ban-2', subjectType: 'job_seeker', subjectId: 'js-old', subjectCode: 'JS-00099', category: 'forged_id', liftedAt: null, idFingerprints: [fp], createdAt: new Date(NOW.getTime() - 2000) });
    prisma.permanentBan.rows.push({ id: 'ban-3', subjectType: 'job_seeker', subjectId: 'js-older', subjectCode: 'JS-00098', category: 'fraud', liftedAt: null, idFingerprints: [fp], createdAt: new Date(NOW.getTime() - 1000) });
    prisma.reviewFlag.rows.push({ id: 'rf-decided', kind: 'possible_banned_person', subjectType: 'job_seeker', subjectId: 'js-1', status: 'dismissed', details: { banId: 'ban-2', decision: 'not_same' } });
    const refused = await otherIds.submitForJobSeeker('js-1', await card(), { channel: 'link', now: NOW }).catch((e: HttpException) => e);
    expect((refused as HttpException).getResponse()).toMatchObject({ code: 'UNDER_REVIEW' });
    expect(flagCalls).toEqual([expect.objectContaining({ kind: 'possible_banned_person', details: expect.objectContaining({ banId: 'ban-3' }) })]);
  });

  it('Fable final check: an ID sent before the ban was made is checked against it when it is approved', async () => {
    const { otherIds, prisma, card, viewPhoto, flagCalls } = setup();
    await otherIds.submitForJobSeeker('js-1', await card(), { channel: 'link', now: NOW });
    // The ban arrives after he sent the card and before the Team Lead looked at it.
    prisma.permanentBan.rows.push({ id: 'ban-4', subjectType: 'job_seeker', subjectId: 'js-old', subjectCode: 'JS-00097', category: 'forged_id', liftedAt: null, idFingerprints: [otherIdFingerprint('pan', '234F', 'Kavya Ramesh')] });
    await viewPhoto('tl-1');
    const refused = await otherIds.recordDecision('job_seeker', 'js-1', 'ok', { id: 'tl-1', role: 'team_lead' }, NOW).catch((e: HttpException) => e);
    expect((refused as HttpException).getResponse()).toMatchObject({ code: 'UNDER_REVIEW' });
    expect(prisma.identityVerification.rows[0]).toMatchObject({ status: 'pending' });
    expect(flagCalls).toEqual([expect.objectContaining({ kind: 'possible_banned_person', subjectId: 'js-1', details: expect.objectContaining({ banId: 'ban-4', matchedAt: 'approval' }) })]);
    // Still open: a second try waits too, and no second item is raised.
    await expect(otherIds.recordDecision('job_seeker', 'js-1', 'ok', { id: 'tl-1', role: 'team_lead' }, NOW)).rejects.toThrow(/Manager or the CEO decides/);
    expect(flagCalls).toHaveLength(1);
    // "Fake" is never held up.
    expect((await otherIds.recordDecision('job_seeker', 'js-1', 'fake', { id: 'tl-1', role: 'team_lead' }, NOW)).otherIdDecided).toBe('failed');
  });

  it('D11 (rev 176): the same Aadhaar as a permanently banned person cannot register again', async () => {
    const { service, prisma } = setup();
    prisma.permanentBan.rows.push({ id: 'ban-1', subjectType: 'job_seeker', subjectId: 'js-old', category: 'fraud', idFingerprints: [aadhaarFingerprint('4321', '1998-08-15', 'Kavya Ramesh')] });
    await expect(service.checkJobSeeker('js-1', qr({ last4: '4321' }), { channel: 'link', now: NOW })).rejects.toThrow(BANNED_MESSAGE);
    expect(prisma.identityVerification.rows).toHaveLength(0);
    // A different card is not blocked.
    expect((await service.checkJobSeeker('js-1', qr({ last4: '9999' }), { channel: 'link', now: NOW })).result).toBe('verified');
  });

  it("a referral partner whose phone isn't verified never counts as linked to the Aadhaar", async () => {
    const { service, prisma } = setup();
    prisma.referral.rows[0]!.phoneVerified = false;
    expect((await service.checkReferral('rf-1', qr(), { channel: 'link', now: NOW })).phoneLinked).not.toBe('linked');
  });

  describe('the QR photo', () => {
    it('is deleted when the Team Lead approves or rejects, and that is audited', async () => {
      for (const reason of ['team_lead_approved', 'team_lead_rejected'] as const) {
        const { service, prisma, photos, storage, auditCalls } = setup();
        await service.checkJobSeeker('js-1', qr(), { channel: 'link', now: NOW });
        const path = prisma.idCheckDetail.rows[0]!.photoPath as string;
        expect(await photos.deletePhotos('job_seeker', 'js-1', reason, 'tl-1', NOW)).toBe(1);
        expect(storage.has(path)).toBe(false);
        expect(prisma.idCheckDetail.rows[0]).toMatchObject({ photoPath: null, photoDeletedReason: reason });
        expect(auditCalls.at(-1)).toMatchObject({ actorId: 'tl-1', action: 'identity.id_photo_deleted', after: { photoKept: false, reason } });
        expect((await photos.latestForJobSeeker('js-1'))?.photo).toMatchObject({ kept: false, deletedReason: reason });
        expect(await photos.photoLink(prisma.idCheckDetail.rows[0]!.verificationId as string)).toBeNull();
      }
    });

    it('is deleted by the daily job after 30 days at most', async () => {
      const { service, prisma, photos, storage } = setup();
      await service.checkJobSeeker('js-1', qr(), { channel: 'link', now: NOW });
      const path = prisma.idCheckDetail.rows[0]!.photoPath as string;
      expect(await photos.deleteExpiredPhotos(new Date(NOW.getTime() + 29 * DAY_MS))).toBe(0);
      expect(storage.has(path)).toBe(true);
      expect(await photos.deleteExpiredPhotos(new Date(NOW.getTime() + 30 * DAY_MS), true)).toBe(1);
      expect(storage.has(path)).toBe(true);
      expect(await photos.deleteExpiredPhotos(new Date(NOW.getTime() + 30 * DAY_MS))).toBe(1);
      expect(storage.has(path)).toBe(false);
      expect(prisma.idCheckDetail.rows[0]).toMatchObject({ photoPath: null, photoDeletedReason: 'expired' });
    });

    it('a newer scan replaces the older photo', async () => {
      const { service, prisma, storage } = setup();
      await service.checkJobSeeker('js-1', qr(), { channel: 'link', now: NOW });
      const first = prisma.idCheckDetail.rows[0]!.photoPath as string;
      await service.checkJobSeeker('js-1', qr(), { channel: 'field', staffId: 'fa-1', now: NOW });
      expect(storage.has(first)).toBe(false);
      expect(prisma.idCheckDetail.rows[0]).toMatchObject({ photoDeletedReason: 'replaced' });
      expect(prisma.idCheckDetail.rows[1]!.photoPath).toBeTruthy();
    });

    it('is shown only through a short-lived signed link', async () => {
      const { service, prisma, photos } = setup();
      await service.checkJobSeeker('js-1', qr(), { channel: 'link', now: NOW });
      const link = await photos.photoLink(prisma.idCheckDetail.rows[0]!.verificationId as string);
      expect(link).toMatchObject({ expiresInSeconds: 300 });
      expect(link!.url).toMatch(/^memory:\/\/candidate-photos\/aadhaar-qr\/job_seeker\/js-1\/.+\.jpg\?exp=/);
    });

    it('is not stored when the Team Lead has already checked this registration', async () => {
      const { service, prisma } = setup();
      prisma.teamLeadCheck.rows.push({ id: 'tlc-1', subjectType: 'job_seeker', subjectId: 'js-1', verdict: 'ok', createdAt: NOW });
      const out = await service.checkJobSeeker('js-1', qr(), { channel: 'link', now: NOW });
      expect(out.result).toBe('verified');
      expect(prisma.idCheckDetail.rows[0]).toMatchObject({ photoPath: null });
    });

    it('a delete that fails after the decision keeps the row for the daily run (expiry = now), which retries it first', async () => {
      const { service, prisma, photos, storage } = setup();
      await service.checkJobSeeker('js-1', qr(), { channel: 'link', now: NOW });
      const path = prisma.idCheckDetail.rows[0]!.photoPath as string;
      const spy = jest.spyOn(storage, 'delete').mockRejectedValueOnce(new Error('Candidate photo delete failed with status 500'));
      const decidedAt = new Date(NOW.getTime() + 60_000);
      expect(await photos.deletePhotos('job_seeker', 'js-1', 'team_lead_approved', 'tl-1', decidedAt)).toBe(0);
      expect(prisma.idCheckDetail.rows[0]).toMatchObject({ photoPath: path, photoExpiresAt: decidedAt, photoDeletedAt: null });
      spy.mockRestore();
      expect(await photos.deleteExpiredPhotos(new Date(decidedAt.getTime() + 1000))).toBe(1);
      expect(storage.has(path)).toBe(false);
    });

    it('if the database write fails after the upload, the photo is removed again (no orphan)', async () => {
      const { prisma, photos, storage } = setup();
      prisma.idCheckDetail.rows.push({ id: 'd-1', subjectType: 'job_seeker', subjectId: 'js-1', verificationId: 'v-1', kind: 'aadhaar_qr', photoPath: null });
      prisma.idCheckDetail.options.failNextUpdate = true;
      await expect(photos.attachPhoto('d-1', 'aadhaar-qr/job_seeker/js-1/v-1.jpg', CARD_PHOTO, 'image/jpeg', NOW)).rejects.toThrow('database write failed');
      expect(storage.has('aadhaar-qr/job_seeker/js-1/v-1.jpg')).toBe(false);
    });
  });

  describe('another ID, checked by the Team Lead by eye (rev 154)', () => {
    it('stores a pending check with the ID type and the last 4 only, and the card photo privately', async () => {
      const { otherIds, prisma, storage, auditCalls, card } = setup();
      const out = await otherIds.submitForJobSeeker('js-1', await card(), { channel: 'link', now: NOW });
      expect(out).toMatchObject({ method: 'pan', status: 'pending', idNumberLast4: '234F' });
      const [row] = prisma.identityVerification.rows;
      expect(row).toMatchObject({ method: 'pan', vendor: 'team_lead_check', status: 'pending', last4: '234F', vendorReference: null, nameMatches: null, isAdult: null, consentId: 'consent-1' });
      expect(JSON.stringify(prisma.identityVerification.rows)).not.toContain('ABCDE1234F');
      const [detail] = prisma.idCheckDetail.rows;
      expect(detail).toMatchObject({ kind: 'id_card_photo', verificationId: row!.id, photoPath: `id-card/job_seeker/js-1/${row!.id}.jpg` });
      expect(detail!.nameOnId ?? null).toBeNull();
      expect((detail!.photoExpiresAt as Date).getTime()).toBe(NOW.getTime() + ID_PHOTO_MAX_DAYS * DAY_MS);
      expect(storage.has(detail!.photoPath as string)).toBe(true);
      expect(JSON.stringify(auditCalls)).not.toContain('ABCDE1234F');
      expect(auditCalls.at(-1)).toMatchObject({ action: 'identity.other_id_submitted', after: expect.objectContaining({ idNumberLast4: '234F', status: 'pending' }) });
    });

    it('refuses (adversarial): gallery or file uploads, no photo, a non-image, a wrong number, an Aadhaar number, no selfie, no consent', async () => {
      const { otherIds, prisma, card } = setup();
      const go = async (input: Record<string, unknown>, id = 'js-1') => otherIds.submitForJobSeeker(id, await card(input as Partial<OtherIdInput>, { id }), { channel: 'link', now: NOW });
      await expect(go({ captureSource: 'gallery' })).rejects.toThrow(/live camera/);
      await expect(go({ captureSource: undefined })).rejects.toThrow(/live camera/);
      await expect(go({ photo: undefined })).rejects.toThrow(/photo of the card/);
      await expect(go({ photo: { buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>') } })).rejects.toThrow(/uploaded pictures are refused/);
      await expect(go({ idNumber: 'ABC123' })).rejects.toThrow(/exactly as it is/);
      await expect(go({ idType: 'voter_id', idNumber: 'ABCDE1234F' })).rejects.toThrow(/exactly as it is/);
      await expect(go({ idType: 'driving_licence', idNumber: '1234 5678 9012' })).rejects.toThrow(/Aadhaar/);
      await expect(go({ idType: 'aadhaar_qr' })).rejects.toThrow(/Aadhaar/);
      await expect(go({ idType: 'passport' })).rejects.toThrow(/Choose the ID/);
      await expect(otherIds.submitForJobSeeker('js-3', await card({ captureNonce: 'n'.repeat(32) }), { channel: 'link', now: NOW })).rejects.toThrow(/selfie/);
      prisma.consent.rows.splice(0, 1);
      await expect(go({})).rejects.toThrow(/Consent/);
      expect(prisma.identityVerification.rows).toHaveLength(0);
    });

    it('a card photo that cannot be stored leaves no pending check behind (nothing for the Team Lead, nothing holding up terms)', async () => {
      const { otherIds, prisma, storage, card } = setup();
      jest.spyOn(storage, 'put').mockRejectedValueOnce(new Error('storage down'));
      await expect(otherIds.submitForJobSeeker('js-1', await card(), { channel: 'link', now: NOW })).rejects.toThrow(/could not be saved/);
      expect(prisma.identityVerification.rows).toEqual([expect.objectContaining({ status: 'failed', failureReason: 'The photo of the card could not be saved' })]);
      expect(prisma.idCheckDetail.rows).toHaveLength(0);
      // He tries again and it works: one pending check, with its photo.
      await otherIds.submitForJobSeeker('js-1', await card(), { channel: 'link', now: NOW });
      expect(prisma.identityVerification.rows.filter((r) => r.status === 'pending')).toHaveLength(1);
      expect(prisma.idCheckDetail.rows).toEqual([expect.objectContaining({ kind: 'id_card_photo', photoPath: expect.any(String) })]);
    });

    it('"Looks right": verified (name and 18+ confirmed by eye) and the card photo deleted; "Fake": failed and deleted', async () => {
      for (const verdict of ['ok', 'fake'] as const) {
        const { otherIds, prisma, storage, card, viewPhoto } = setup();
        await otherIds.submitForJobSeeker('js-1', await card(), { channel: 'link', now: NOW });
        const path = prisma.idCheckDetail.rows[0]!.photoPath as string;
        await viewPhoto('tl-1');
        const decided = await otherIds.recordDecision('job_seeker', 'js-1', verdict, { id: 'tl-1', role: 'team_lead' }, NOW);
        expect(decided).toEqual({ otherIdDecided: verdict === 'ok' ? 'verified' : 'failed', photosDeleted: 1 });
        expect(prisma.identityVerification.rows[0]).toMatchObject(
          verdict === 'ok' ? { status: 'verified', nameMatches: true, isAdult: true, verifiedAt: NOW } : { status: 'failed', failureReason: 'Rejected by the Team Lead' },
        );
        expect(storage.has(path)).toBe(false);
        expect(prisma.idCheckDetail.rows[0]).toMatchObject({ photoPath: null, photoDeletedReason: verdict === 'ok' ? 'team_lead_approved' : 'team_lead_rejected' });
      }
    });

    it('Laboura Field and referral partners use the same check', async () => {
      const { otherIds, prisma, card } = setup();
      await otherIds.submitForJobSeeker('js-1', await card({ idType: 'voter_id', idNumber: 'ABC1234567' }, { staffId: 'fa-1' }), { channel: 'field', staffId: 'fa-1', now: NOW });
      expect(prisma.identityVerification.rows[0]).toMatchObject({ method: 'voter_id', last4: '4567', status: 'pending' });
      await otherIds.submitForReferral('rf-1', await card({ idType: 'driving_licence', idNumber: 'KA01 20201234567' }, { type: 'referral', id: 'rf-1' }), { channel: 'link', now: NOW });
      expect(prisma.referralIdentityVerification.rows[0]).toMatchObject({ method: 'driving_licence', last4: '4567', status: 'pending', vendor: 'team_lead_check' });
      expect(prisma.idCheckDetail.rows[1]).toMatchObject({ subjectType: 'referral', kind: 'id_card_photo' });
    });

    it('the Team Lead / Manager view shows the last 4 and the kept card photo, not "verified by UIDAI"', async () => {
      const { otherIds, photos, card } = setup();
      await otherIds.submitForJobSeeker('js-1', await card(), { channel: 'link', now: NOW });
      expect(await photos.latestFor('job_seeker', 'js-1')).toMatchObject({
        method: 'pan', status: 'pending', verifiedByUidai: false, maskedReference: null, idNumberLast4: '234F', under18Stop: false,
        photo: { kind: 'id_card_photo', kept: true },
      });
    });
  });

  it('who may see an ID check: CEO; Manager / Team Lead for their teams only; never agents', async () => {
    const { access } = setup();
    expect(await access.canView({ id: 'ceo-1', role: 'ceo' }, 'agent-9')).toBe(true);
    expect(await access.canView({ id: 'manager-1', role: 'manager' }, 'agent-1')).toBe(true);
    expect(await access.canView({ id: 'manager-2', role: 'manager' }, 'agent-1')).toBe(false);
    expect(await access.canView({ id: 'manager-1', role: 'manager' }, null)).toBe(false);
    expect(await access.canView({ id: 'agent-1', role: 'field_agent' }, 'agent-1')).toBe(false);
    expect(await access.canView({ id: 'fin-1', role: 'finance' }, 'agent-1')).toBe(false);
  });

  it('never stores, logs, audits or flags the raw QR text, the inflated bytes, the full address or the hashes', async () => {
    const logged: string[] = [];
    const capture = (...args: unknown[]) => void logged.push(args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' '));
    const spies = [
      jest.spyOn(Logger.prototype, 'log').mockImplementation(capture),
      jest.spyOn(Logger.prototype, 'warn').mockImplementation(capture),
      jest.spyOn(Logger.prototype, 'error').mockImplementation(capture),
      jest.spyOn(Logger.prototype, 'debug').mockImplementation(capture),
      jest.spyOn(console, 'log').mockImplementation(capture),
      jest.spyOn(console, 'warn').mockImplementation(capture),
      jest.spyOn(console, 'error').mockImplementation(capture),
    ];
    try {
      const { service, prisma, auditCalls, flagCalls } = setup();
      const texts = [
        qr({ mobile: '9876500001', indicator: 3 }),
        qr({ name: 'Somebody Else' }),
        qr({ mobile: '9000000009' }),
        buildSecureQr(stranger, { address: SECRET_ADDRESS }),
      ];
      for (const text of texts) await service.checkJobSeeker('js-1', text, { channel: 'link', now: NOW });
      await service.checkReferral('rf-1', texts[0], { channel: 'link', now: NOW });

      const forbidden: string[] = [];
      for (const text of texts) {
        const parsed = parseSecureQr(text);
        forbidden.push(text, text.slice(0, 60), inflateSecureQrText(text).toString('hex').slice(0, 64), parsed.signature.toString('hex').slice(0, 64));
        if (parsed.mobileHash) forbidden.push(parsed.mobileHash.toString('hex'));
        if (parsed.emailHash) forbidden.push(parsed.emailHash.toString('hex'));
      }
      forbidden.push(...Object.values(SECRET_ADDRESS), 'Bengaluru South', 'Karnataka');

      const stored = JSON.stringify({
        identity: prisma.identityVerification.rows,
        referralIdentity: prisma.referralIdentityVerification.rows,
        details: prisma.idCheckDetail.rows,
        attempts: prisma.aadhaarQrAttempt.rows,
        flags: flagCalls,
        audit: auditCalls,
        logs: logged,
      });
      for (const value of forbidden) expect(stored).not.toContain(value);
      // No 12-digit run (a full Aadhaar number) anywhere.
      expect(stored.replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '')).not.toMatch(/(?<!\d)\d{12}(?!\d)/);
    } finally {
      for (const spy of spies) spy.mockRestore();
    }
  });
});

describe('Fable re-check of PR #135 (rev 169 and the review fixes)', () => {
  const tl = (id: string) => ({ id, role: 'team_lead' });

  describe('H-1: nobody approves the other ID of a person they registered (rev 169)', () => {
    /** A job seeker registered by `registrar` (or nobody), in `city`, with a pending other ID whose photo `viewers` opened. */
    async function pendingFor(registrar: string | null, city = 'Bengaluru', viewers: string[] = []) {
      const ctx = setup();
      const seeker = ctx.prisma.jobSeeker.rows.find((r) => r.id === 'js-1')!;
      seeker.registeredByStaffId = registrar;
      seeker.city = city;
      await ctx.otherIds.submitForJobSeeker('js-1', await ctx.card(), { channel: 'link', now: NOW });
      for (const viewer of viewers) await ctx.viewPhoto(viewer);
      return ctx;
    }
    const subjectOf = (ctx: ReturnType<typeof setup>) => {
      const row = ctx.prisma.jobSeeker.rows.find((r) => r.id === 'js-1')!;
      return { registeredByStaffId: row.registeredByStaffId as string | null, city: row.city as string };
    };

    it('own team: the agent\'s Team Lead approves; another Team Lead, a Manager and the CEO do not', async () => {
      const ctx = await pendingFor('agent-1', 'Bengaluru', ['tl-2', 'manager-1', 'ceo-1', 'tl-1']);
      expect((await ctx.approvals.routeFor(subjectOf(ctx))).mode).toBe('own_team');
      for (const actor of [tl('tl-2'), { id: 'manager-1', role: 'manager' }, { id: 'ceo-1', role: 'ceo' }]) {
        await expect(ctx.otherIds.recordDecision('job_seeker', 'js-1', 'ok', actor, NOW)).rejects.toBeInstanceOf(ForbiddenException);
      }
      expect(ctx.prisma.identityVerification.rows[0]).toMatchObject({ status: 'pending' });
      expect((await ctx.otherIds.recordDecision('job_seeker', 'js-1', 'ok', tl('tl-1'), NOW)).otherIdDecided).toBe('verified');
    });

    it('a Team Lead registered the person: refused for that Team Lead (for every verdict), approved by another Team Lead of the city', async () => {
      const ctx = await pendingFor('tl-1', 'Bengaluru', ['tl-1', 'tl-2', 'manager-1']);
      expect((await ctx.approvals.routeFor(subjectOf(ctx))).mode).toBe('another_team_lead');
      for (const verdict of ['ok', 'fake'] as const) {
        await expect(ctx.otherIds.recordDecision('job_seeker', 'js-1', verdict, tl('tl-1'), NOW)).rejects.toThrow(SELF_APPROVAL_REFUSED);
      }
      // Not a Manager while another Team Lead can do it; not a Team Lead of another city.
      await expect(ctx.otherIds.recordDecision('job_seeker', 'js-1', 'ok', { id: 'manager-1', role: 'manager' }, NOW)).rejects.toBeInstanceOf(ForbiddenException);
      await expect(ctx.otherIds.recordDecision('job_seeker', 'js-1', 'ok', tl('tl-9'), NOW)).rejects.toBeInstanceOf(ForbiddenException);
      expect(ctx.storage.has(ctx.prisma.idCheckDetail.rows[0]!.photoPath as string)).toBe(true);
      expect((await ctx.otherIds.recordDecision('job_seeker', 'js-1', 'ok', tl('tl-2'), NOW)).otherIdDecided).toBe('verified');
      expect(ctx.auditCalls.find((a) => a.action === 'identity.other_id_approved')).toMatchObject({ actorId: 'tl-2', after: expect.objectContaining({ approvalMode: 'another_team_lead' }) });
    });

    it('no Team Lead\'s team (registered by a Manager, the CEO or nobody): another Team Lead of the city approves, never the registrar', async () => {
      for (const registrar of ['manager-1', 'ceo-1', null]) {
        const ctx = await pendingFor(registrar, 'Bengaluru', ['tl-2', 'manager-1', 'ceo-1']);
        expect((await ctx.approvals.routeFor(subjectOf(ctx))).mode).toBe('another_team_lead');
        if (registrar) {
          const role = registrar.startsWith('ceo') ? 'ceo' : 'manager';
          await expect(ctx.otherIds.recordDecision('job_seeker', 'js-1', 'ok', { id: registrar, role }, NOW)).rejects.toThrow(SELF_APPROVAL_REFUSED);
        }
        expect((await ctx.otherIds.recordDecision('job_seeker', 'js-1', 'ok', tl('tl-2'), NOW)).otherIdDecided).toBe('verified');
      }
    });

    it('no other active Team Lead in the city: a Manager of that city or the CEO approves (and is told by a flag); never the registrar', async () => {
      // Mysuru: tl-9 registered the person and is its only Team Lead.
      const ctx = await pendingFor('tl-9', 'Mysuru', ['tl-9', 'manager-1', 'manager-9', 'ceo-1']);
      expect((await ctx.approvals.routeFor(subjectOf(ctx))).mode).toBe('manager_or_ceo');
      expect(ctx.flagCalls).toEqual([expect.objectContaining({ kind: 'other_id_needs_manager', subjectId: 'js-1', owner: { role: 'manager' } })]);
      await expect(ctx.otherIds.recordDecision('job_seeker', 'js-1', 'ok', tl('tl-9'), NOW)).rejects.toThrow(SELF_APPROVAL_REFUSED);
      await expect(ctx.otherIds.recordDecision('job_seeker', 'js-1', 'ok', tl('tl-1'), NOW)).rejects.toBeInstanceOf(ForbiddenException);
      await expect(ctx.otherIds.recordDecision('job_seeker', 'js-1', 'ok', { id: 'manager-1', role: 'manager' }, NOW)).rejects.toBeInstanceOf(ForbiddenException);
      expect((await ctx.otherIds.recordDecision('job_seeker', 'js-1', 'ok', { id: 'manager-9', role: 'manager' }, NOW)).otherIdDecided).toBe('verified');
      // The flag for the Manager is closed by the decision.
      expect(ctx.prisma.reviewFlag.rows.find((f) => f.kind === 'other_id_needs_manager')).toMatchObject({ status: 'resolved', resolvedByStaffId: 'manager-9' });

      const ceo = await pendingFor('manager-9', 'Mysuru', ['ceo-1', 'manager-9']);
      expect((await ceo.approvals.routeFor(subjectOf(ceo))).mode).toBe('another_team_lead');
      ceo.prisma.staff.rows.find((r) => r.id === 'tl-9')!.status = 'deactivated';
      expect((await ceo.approvals.routeFor(subjectOf(ceo))).mode).toBe('manager_or_ceo');
      await expect(ceo.otherIds.recordDecision('job_seeker', 'js-1', 'ok', { id: 'manager-9', role: 'manager' }, NOW)).rejects.toThrow(SELF_APPROVAL_REFUSED);
      expect((await ceo.otherIds.recordDecision('job_seeker', 'js-1', 'ok', { id: 'ceo-1', role: 'ceo' }, NOW)).otherIdDecided).toBe('verified');
    });

    it('an inactive Team Lead never decides, and a deactivated own-team Team Lead sends the row to another Team Lead', async () => {
      const ctx = await pendingFor('agent-1', 'Bengaluru', ['tl-1', 'tl-2']);
      ctx.prisma.staff.rows.find((r) => r.id === 'tl-1')!.status = 'deactivated';
      expect((await ctx.approvals.routeFor(subjectOf(ctx))).mode).toBe('another_team_lead');
      await expect(ctx.otherIds.recordDecision('job_seeker', 'js-1', 'ok', tl('tl-1'), NOW)).rejects.toBeInstanceOf(ForbiddenException);
      expect((await ctx.otherIds.recordDecision('job_seeker', 'js-1', 'ok', tl('tl-2'), NOW)).otherIdDecided).toBe('verified');
    });

    it('a role in the token that is not the account\'s role is refused', async () => {
      const ctx = await pendingFor('tl-1', 'Bengaluru', ['agent-2']);
      await expect(ctx.otherIds.recordDecision('job_seeker', 'js-1', 'ok', { id: 'agent-2', role: 'team_lead' }, NOW)).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  describe('the general registration check follows the same rule (rev 169)', () => {
    const since = new Date(NOW.getTime() - 7 * DAY_MS);
    function withRegistrar(registrar: string | null, city = 'Bengaluru') {
      const ctx = setup();
      const seeker = ctx.prisma.jobSeeker.rows.find((r) => r.id === 'js-1')!;
      seeker.registeredByStaffId = registrar;
      seeker.city = city;
      // js-2 (agent-2, tl-2's team) and js-3 stay with their own team's Team Lead.
      return ctx;
    }

    it('a Team Lead\'s registration goes to the other Team Leads of the city, never to him, and leaves the list once checked', async () => {
      const { approvals, prisma } = withRegistrar('tl-1');
      expect(await approvals.uncheckedRegistrationsFor(tl('tl-2'), 'another_team_lead', since)).toEqual(['js-1']);
      expect(await approvals.uncheckedRegistrationsFor(tl('tl-1'), 'another_team_lead', since)).toEqual([]);
      expect(await approvals.uncheckedRegistrationsFor({ id: 'manager-1', role: 'manager' }, 'manager_or_ceo', since)).toEqual([]);
      expect(await approvals.uncheckedRegistrationsFor(tl('tl-9'), 'another_team_lead', since)).toEqual([]);
      expect((await approvals.rightFor(tl('tl-1'), { registeredByStaffId: 'tl-1', city: 'Bengaluru' })).reason).toBe(SELF_APPROVAL_REFUSED);
      prisma.teamLeadCheck.rows.push({ id: 'tlc-1', subjectType: 'job_seeker', subjectId: 'js-1', verdict: 'ok', createdAt: NOW });
      expect(await approvals.uncheckedRegistrationsFor(tl('tl-2'), 'another_team_lead', since)).toEqual([]);
    });

    it('no team (a Manager, the CEO or nobody registered): another Team Lead of the city', async () => {
      for (const registrar of ['manager-1', 'ceo-1', null]) {
        const { approvals } = withRegistrar(registrar);
        expect(await approvals.uncheckedRegistrationsFor(tl('tl-1'), 'another_team_lead', since)).toContain('js-1');
      }
    });

    it('no other active Team Lead in the city: a Manager of that city or the CEO', async () => {
      const { approvals } = withRegistrar('tl-9', 'Mysuru');
      expect(await approvals.uncheckedRegistrationsFor({ id: 'manager-9', role: 'manager' }, 'manager_or_ceo', since)).toEqual(['js-1']);
      expect(await approvals.uncheckedRegistrationsFor({ id: 'ceo-1', role: 'ceo' }, 'manager_or_ceo', since)).toEqual(['js-1']);
      expect(await approvals.uncheckedRegistrationsFor({ id: 'manager-1', role: 'manager' }, 'manager_or_ceo', since)).toEqual([]);
      expect(await approvals.uncheckedRegistrationsFor(tl('tl-9'), 'another_team_lead', since)).toEqual([]);
    });

    it('an agent\'s registration stays with that agent\'s own Team Lead (not listed for anyone else)', async () => {
      const { approvals } = setup();
      for (const actor of [tl('tl-1'), tl('tl-2')]) expect(await approvals.uncheckedRegistrationsFor(actor, 'another_team_lead', since)).toEqual([]);
      expect((await approvals.rightFor(tl('tl-2'), { registeredByStaffId: 'agent-2', city: 'Bengaluru' })).allowed).toBe(true);
      expect((await approvals.rightFor(tl('tl-1'), { registeredByStaffId: 'agent-2', city: 'Bengaluru' })).allowed).toBe(false);
    });
  });

  describe('M-2: an approval needs the photo, opened by this decider', () => {
    it('refused until this decider opened the photo (another person opening it does not count)', async () => {
      const { otherIds, card, viewPhoto, prisma } = setup();
      await otherIds.submitForJobSeeker('js-1', await card(), { channel: 'link', now: NOW });
      await expect(otherIds.recordDecision('job_seeker', 'js-1', 'ok', tl('tl-1'), NOW)).rejects.toThrow(OPEN_PHOTO_FIRST_MESSAGE);
      await viewPhoto('tl-2');
      await expect(otherIds.recordDecision('job_seeker', 'js-1', 'ok', tl('tl-1'), NOW)).rejects.toThrow(OPEN_PHOTO_FIRST_MESSAGE);
      // A view of an older check does not count for a newer photo.
      prisma.auditLog.rows.push({ id: 'old', actorId: 'tl-1', action: 'identity.id_check_viewed', entityType: 'job_seeker', entityCode: 'JS-00001', after: { verificationId: 'older-check', idPhotoLinkIssued: true }, createdAt: new Date() });
      await expect(otherIds.recordDecision('job_seeker', 'js-1', 'ok', tl('tl-1'), NOW)).rejects.toThrow(OPEN_PHOTO_FIRST_MESSAGE);
      await viewPhoto('tl-1');
      expect((await otherIds.recordDecision('job_seeker', 'js-1', 'ok', tl('tl-1'), NOW)).otherIdDecided).toBe('verified');
    });

    it('L-3: a pending check whose photo is gone cannot be approved (409) and is closed at once: the person is asked for a new photo', async () => {
      const { otherIds, card, viewPhoto, prisma } = setup();
      await otherIds.submitForJobSeeker('js-1', await card(), { channel: 'link', now: NOW });
      await viewPhoto('tl-1');
      prisma.idCheckDetail.rows[0]!.photoPath = null;
      await expect(otherIds.recordDecision('job_seeker', 'js-1', 'ok', tl('tl-1'), NOW)).rejects.toBeInstanceOf(ConflictException);
      expect(prisma.identityVerification.rows[0]).toMatchObject({ status: 'failed', failureReason: ID_PHOTO_EXPIRED_REASON, last4: null });
      // Not pending forever: nothing is left to decide.
      expect((await otherIds.recordDecision('job_seeker', 'js-1', 'ok', tl('tl-1'), NOW)).otherIdDecided).toBeNull();
      expect(PHOTO_GONE_MESSAGE).toMatch(/closed and the person is asked for a new photo/);
    });

    it('a card photo that expires before a decision closes the check as failed; the person is asked for a new photo', async () => {
      const { otherIds, card, photos, prisma, storage, viewPhoto, auditCalls } = setup();
      await otherIds.submitForJobSeeker('js-1', await card(), { channel: 'link', now: NOW });
      const path = prisma.idCheckDetail.rows[0]!.photoPath as string;
      await viewPhoto('tl-1');
      expect(await photos.deleteExpiredPhotos(new Date(NOW.getTime() + 30 * DAY_MS))).toBe(1);
      expect(storage.has(path)).toBe(false);
      expect(prisma.identityVerification.rows[0]).toMatchObject({ status: 'failed', failureReason: ID_PHOTO_EXPIRED_REASON });
      expect(auditCalls.find((a) => a.action === 'identity.other_id_expired')).toBeTruthy();
      // Nothing left to approve.
      expect((await otherIds.recordDecision('job_seeker', 'js-1', 'ok', tl('tl-1'), NOW)).otherIdDecided).toBeNull();
      expect(prisma.identityVerification.rows[0]).toMatchObject({ status: 'failed' });
    });

    it('even when the expired photo cannot be deleted, the check still closes (the delete is retried)', async () => {
      const { otherIds, card, photos, prisma, storage } = setup();
      await otherIds.submitForJobSeeker('js-1', await card(), { channel: 'link', now: NOW });
      jest.spyOn(storage, 'delete').mockRejectedValueOnce(new Error('Candidate photo delete failed with status 503'));
      expect(await photos.deleteExpiredPhotos(new Date(NOW.getTime() + 30 * DAY_MS))).toBe(0);
      expect(prisma.identityVerification.rows[0]).toMatchObject({ status: 'failed', failureReason: ID_PHOTO_EXPIRED_REASON });
      expect(prisma.idCheckDetail.rows[0]!.photoPath).toBeTruthy();
    });
  });

  describe('M-3: races', () => {
    it('two decisions at once: only the one that still finds the row pending wins; the other gets 409 and changes nothing', async () => {
      const { otherIds, card, viewPhoto, prisma } = setup();
      await otherIds.submitForJobSeeker('js-1', await card(), { channel: 'link', now: NOW });
      await viewPhoto('tl-1');
      const pending = { ...prisma.identityVerification.rows[0]! };
      expect((await otherIds.recordDecision('job_seeker', 'js-1', 'ok', tl('tl-1'), NOW)).otherIdDecided).toBe('verified');
      // The second decision read the row before the first one wrote it.
      const findFirst = prisma.identityVerification.findFirst.bind(prisma.identityVerification);
      jest.spyOn(prisma.identityVerification, 'findFirst').mockImplementation(async (args) => {
        const where = (args?.where ?? {}) as Record<string, unknown>;
        return where.status === 'pending' ? pending : (findFirst(args) as Promise<typeof pending>);
      });
      await expect(otherIds.recordDecision('job_seeker', 'js-1', 'fake', tl('tl-1'), NOW)).rejects.toThrow(ALREADY_DECIDED_MESSAGE);
      expect(prisma.identityVerification.rows[0]).toMatchObject({ status: 'verified', nameMatches: true });
    });

    it('two submissions: each under the person\'s advisory lock; the newer one closes the older pending check', async () => {
      const { otherIds, card, prisma } = setup();
      await Promise.all([
        otherIds.submitForJobSeeker('js-1', await card(), { channel: 'link', now: NOW }),
        otherIds.submitForJobSeeker('js-1', await card({ idType: 'voter_id', idNumber: 'ABC1234567' }), { channel: 'link', now: NOW }),
      ]);
      expect(prisma.locks.filter((k) => k === 'other-id:job_seeker:js-1')).toHaveLength(2);
      expect(prisma.identityVerification.rows.filter((r) => r.status === 'pending')).toHaveLength(1);
      expect(prisma.identityVerification.rows.filter((r) => r.failureReason === 'Replaced by a newer photo of the card')).toHaveLength(1);
      expect(prisma.idCheckDetail.rows.filter((d) => d.photoPath)).toHaveLength(1);
    });
  });

  describe('M-1: the live photo of the card', () => {
    it('needs a one-time token from when the camera opened: missing, made up, reused, expired, for someone else or another agent — refused', async () => {
      const { otherIds, card, nonce, prisma } = setup();
      const submit = (input: OtherIdInput, context: { channel: 'link' | 'field'; staffId?: string; now?: Date } = { channel: 'link' }) =>
        otherIds.submitForJobSeeker('js-1', input, { now: NOW, ...context });
      await expect(submit(await card({ captureNonce: undefined }))).rejects.toThrow(CAPTURE_NONCE_MESSAGE);
      await expect(submit(await card({ captureNonce: 'x'.repeat(32) }))).rejects.toThrow(CAPTURE_NONCE_MESSAGE);
      const once = await nonce();
      await submit(await card({ captureNonce: once }));
      await expect(submit(await card({ captureNonce: once }))).rejects.toThrow(CAPTURE_NONCE_MESSAGE);
      const late = await nonce();
      await expect(submit(await card({ captureNonce: late }), { channel: 'link', now: new Date(NOW.getTime() + 121_000) })).rejects.toThrow(CAPTURE_NONCE_MESSAGE);
      await expect(submit(await card({ captureNonce: await nonce('job_seeker', 'js-2') }))).rejects.toThrow(CAPTURE_NONCE_MESSAGE);
      await expect(submit(await card({ captureNonce: await nonce('job_seeker', 'js-1', 'fa-1') }), { channel: 'field', staffId: 'agent-1' })).rejects.toThrow(CAPTURE_NONCE_MESSAGE);
      await expect(submit(await card({ captureNonce: await nonce('job_seeker', 'js-1', 'fa-1') }))).rejects.toThrow(CAPTURE_NONCE_MESSAGE);
      // Only the token's hash is kept.
      expect(JSON.stringify(prisma.idCaptureNonce.rows)).not.toContain(once);
      expect(prisma.identityVerification.rows.filter((r) => r.status === 'pending')).toHaveLength(1);
    });

    it('refuses camera or editor metadata, other formats and sizes the capture canvas cannot make', async () => {
      const { otherIds, card } = setup();
      const go = async (buffer: Buffer) => otherIds.submitForJobSeeker('js-1', await card({ photo: { buffer } }), { channel: 'link', now: NOW });
      for (const tag of [0x010f, 0x0110, 0x0131, 0x8825]) await expect(go(withSegment(CARD_PHOTO, 0xe1, exifWithTag(tag)))).rejects.toThrow(/camera or editing details/);
      await expect(go(withSegment(CARD_PHOTO, 0xe1, Buffer.from('http://ns.adobe.com/xap/1.0/\u0000<x:xmpmeta/>', 'latin1')))).rejects.toThrow(/camera or editing details/);
      await expect(go(withSegment(CARD_PHOTO, 0xed, Buffer.from('Photoshop 3.0\u0000', 'latin1')))).rejects.toThrow(/camera or editing details/);
      await expect(go(withSegment(CARD_PHOTO, 0xee, Buffer.from('Adobe\u0000', 'latin1')))).rejects.toThrow(/camera or editing details/);
      await expect(go(jpegOf(1600, 1000))).rejects.toThrow(/not the size/);
      await expect(go(jpegOf(200, 150))).rejects.toThrow(/not the size/);
      await expect(go(Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), Buffer.alloc(64)]))).rejects.toThrow(/uploaded pictures are refused/);
      await expect(go(Buffer.concat([CARD_PHOTO.subarray(0, 40), Buffer.alloc(20)]))).rejects.toThrow(/could not be read/);
    });

    it('stores a re-encoded copy: no metadata at all (an EXIF block without camera tags is accepted, then stripped)', async () => {
      const { otherIds, card, storage } = setup();
      const put = jest.spyOn(storage, 'put');
      const harmless = withSegment(CARD_PHOTO, 0xe1, exifWithTag(0x0112)); // Orientation only
      await otherIds.submitForJobSeeker('js-1', await card({ photo: { buffer: harmless } }), { channel: 'link', now: NOW });
      const stored = put.mock.calls[0]![1] as Buffer;
      expect(put.mock.calls[0]![2]).toBe('image/jpeg');
      expect(stored.subarray(0, 3).toString('hex')).toBe('ffd8ff');
      expect(stored.includes(Buffer.from('Exif', 'latin1'))).toBe(false);
      expect(stored.equals(harmless)).toBe(false);
    });
  });

  it('L2: failed signatures on recent QR codes from three different people in a day raise one CEO alert; old codes do not', async () => {
    const { service, flagCalls } = setup();
    const recent = (mobile: string) => buildSecureQr(stranger, { mobile, timestamp: '20261110101530123' });
    const old = (mobile: string) => buildSecureQr(stranger, { mobile, timestamp: '20250110101530123' });
    await service.checkJobSeeker('js-1', old('9876500001'), { channel: 'link', now: NOW });
    await service.checkJobSeeker('js-2', old('9876500002'), { channel: 'link', now: NOW });
    await service.checkReferral('rf-1', old('9876500001'), { channel: 'link', now: NOW });
    expect(flagCalls.filter((f) => f.kind === 'aadhaar_key_rotation_suspected')).toHaveLength(0);
    await service.checkJobSeeker('js-1', recent('9876500001'), { channel: 'link', now: NOW });
    await service.checkJobSeeker('js-1', recent('9876500001'), { channel: 'link', now: NOW });
    await service.checkJobSeeker('js-2', recent('9876500002'), { channel: 'link', now: NOW });
    expect(flagCalls.filter((f) => f.kind === 'aadhaar_key_rotation_suspected')).toHaveLength(0);
    await service.checkReferral('rf-1', recent('9876500001'), { channel: 'link', now: NOW });
    await service.checkJobSeeker('js-2', recent('9876500002'), { channel: 'link', now: NOW });
    expect(flagCalls.filter((f) => f.kind === 'aadhaar_key_rotation_suspected')).toEqual([
      expect.objectContaining({ subjectType: 'system', raisedForStaffId: null, details: expect.objectContaining({ differentPeopleToday: 3 }) }),
    ]);
  });

  it('L3: a genuine signature on a QR dated outside its certificate is only logged (no personal data) and still verifies', async () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    try {
      const trusted = [{ ...signer.trusted, notBefore: new Date('2020-01-01T00:00:00Z'), notAfter: new Date('2025-01-01T00:00:00Z') }];
      const { service } = setup({ trusted });
      const out = await service.checkJobSeeker('js-1', buildSecureQr(signer, { mobile: '9876500001', timestamp: '20240101101530123' }), { channel: 'link', now: NOW });
      expect(out.result).toBe('verified');
      expect(warn).not.toHaveBeenCalledWith(expect.stringContaining('outside'));
      // Dated after the certificate ended (genuine key): logged, never a refusal.
      const later = await service.checkJobSeeker('js-1', buildSecureQr(signer, { mobile: '9876500001', name: 'Kavya Ramesh', timestamp: '20260101101530123' }), { channel: 'link', now: NOW });
      expect(later.result).toBe('verified');
      const notes = warn.mock.calls.map((c) => String(c[0])).filter((m) => m.includes('outside'));
      expect(notes).toEqual([expect.stringContaining('test-key')]);
      expect(notes.join(' ')).not.toMatch(/Kavya|9876500001|2026/);
    } finally {
      warn.mockRestore();
    }
  });

  it('L6: a stored photo that cannot be recorded or deleted is reported loudly, and the other ID is closed (not left pending)', async () => {
    const error = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    try {
      const { otherIds, card, prisma, storage } = setup();
      prisma.idCheckDetail.options.failNextUpdate = true;
      jest.spyOn(storage, 'delete').mockRejectedValueOnce(new Error('Candidate photo delete failed with status 500'));
      await expect(otherIds.submitForJobSeeker('js-1', await card(), { channel: 'link', now: NOW })).rejects.toThrow(/could not be saved/);
      expect(error.mock.calls.map((c) => String(c[0])).join(' ')).toMatch(/stored but could not be recorded or deleted/);
      expect(prisma.identityVerification.rows[0]).toMatchObject({ status: 'failed', failureReason: 'The photo of the card could not be saved' });
    } finally {
      error.mockRestore();
    }
  });

  it('L7: the tampered flag is written on the locked transaction itself, and its bell goes out after the commit', async () => {
    const { service, flags } = setup();
    const fake = buildSecureQr(stranger, { mobile: '9876500001' });
    for (let i = 0; i < QR_BAD_SIGNATURES_BEFORE_FLAG; i += 1) await service.checkJobSeeker('js-1', fake, { channel: 'link', now: new Date(NOW.getTime() + i * 1000) });
    const call = flags.raise.mock.calls.find((c) => c[0].kind === 'aadhaar_qr_tampered')!;
    expect(call[1]).toEqual({ tx: expect.anything() });
    const flagId = (await flags.raise.mock.results[flags.raise.mock.calls.indexOf(call)]!.value) as { id: string };
    expect(flags.refreshBell).toHaveBeenCalledWith(flagId.id);
  });

  it('M-4: a verified QR still keeps its last 4, reference and time stamp (the duplicate check uses verified rows only)', async () => {
    const { service, prisma } = setup();
    await service.checkJobSeeker('js-1', qr({ last4: '4321' }), { channel: 'link', now: NOW });
    expect(prisma.identityVerification.rows[0]).toMatchObject({ status: 'verified', last4: '4321', vendorReference: expect.stringMatching(/^4321/) });
    expect(prisma.identityVerification.rows[0]!.qrIssuedAt).toBeInstanceOf(Date);
  });

  it('refuses a decision on the stop as a BadRequest (not a 500)', async () => {
    const { service, otherIds } = setup();
    await service.checkJobSeeker('js-1', qr({ dob: '15-11-2008' }), { channel: 'link', now: NOW });
    await expect(otherIds.recordDecision('job_seeker', 'js-1', 'ok', tl('tl-1'), NOW)).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('Fable final re-check (round 6)', () => {
  const tl = (id: string) => ({ id, role: 'team_lead' });
  const since = new Date(NOW.getTime() - 7 * DAY_MS);

  describe('L-8: nobody lifts a stop on their own registration; one general check per person', () => {
    it('a Manager who registered the person cannot lift the under-18 stop; the CEO can', async () => {
      const ctx = setup();
      ctx.prisma.jobSeeker.rows.find((r) => r.id === 'js-1')!.registeredByStaffId = 'manager-1';
      await ctx.service.checkJobSeeker('js-1', qr({ dob: '15-11-2008' }), { channel: 'link', now: NOW });
      expect(await ctx.stops.isStopped('job_seeker', 'js-1')).toBe(true);
      const own = ctx.stops.lift({ id: 'manager-1', role: 'manager' }, 'job_seeker', 'js-1', 'Birth certificate shows he is 19');
      await expect(own).rejects.toBeInstanceOf(ForbiddenException);
      await expect(ctx.stops.lift({ id: 'manager-1', role: 'manager' }, 'job_seeker', 'js-1', 'Birth certificate shows he is 19')).rejects.toThrow(UNDER_18_SELF_LIFT_REFUSED);
      expect(await ctx.stops.isStopped('job_seeker', 'js-1')).toBe(true);
      expect(await ctx.stops.lift({ id: 'ceo-1', role: 'ceo' }, 'job_seeker', 'js-1', 'Birth certificate shows he is 19')).toEqual({ lifted: 1 });
    });

    it('a second general check of the same person is refused (409) under his lock, unless another ID waits', async () => {
      const { prisma } = setup();
      const work = jest.fn(async () => 'checked');
      expect(await oneRegistrationCheck(prisma as never, 'job_seeker', 'js-1', work)).toBe('checked');
      expect(prisma.locks.at(-1)).toBe('registration-check:job_seeker:js-1');
      prisma.teamLeadCheck.rows.push({ id: 'tlc-1', subjectType: 'job_seeker', subjectId: 'js-1', verdict: 'ok', createdAt: NOW });
      await expect(oneRegistrationCheck(prisma as never, 'job_seeker', 'js-1', work)).rejects.toBeInstanceOf(ConflictException);
      await expect(oneRegistrationCheck(prisma as never, 'job_seeker', 'js-1', work)).rejects.toThrow(REGISTRATION_ALREADY_CHECKED);
      expect(work).toHaveBeenCalledTimes(1);
      // A new other ID waiting for the Team Lead: that check decides it.
      prisma.identityVerification.rows.push({ id: 'idv-9', jobSeekerId: 'js-1', status: 'pending', vendor: 'team_lead_check', method: 'pan', createdAt: NOW });
      expect(await oneRegistrationCheck(prisma as never, 'job_seeker', 'js-1', work)).toBe('checked');
      // Another person is not held up.
      expect(await oneRegistrationCheck(prisma as never, 'referral', 'rf-1', work)).toBe('checked');
    });
  });

  describe('L-5: a later name mismatch does not un-verify', () => {
    it('the name check for the Team Lead says the person is still verified', async () => {
      const { service, flagCalls } = setup();
      expect((await service.checkJobSeeker('js-1', qr(), { channel: 'link', now: NOW })).result).toBe('verified');
      const later = await service.checkJobSeeker('js-1', qr({ name: 'Kaavya Ramesh' }), { channel: 'link', now: new Date(NOW.getTime() + 60_000) });
      expect(later.result).toBe('name_mismatch');
      expect(flagCalls.find((f) => f.kind === 'name_check')).toMatchObject({ details: expect.objectContaining({ stillVerified: true, afterVerifiedId: expect.any(String) }) });
    });
  });

  describe('M-A: a locked Team Lead counts for nothing', () => {
    it('the city\'s only other Team Lead locked by a Manager: the Manager fallback works, and he can\'t decide', async () => {
      const ctx = setup();
      const seeker = ctx.prisma.jobSeeker.rows.find((r) => r.id === 'js-1')!;
      seeker.registeredByStaffId = 'tl-1';
      ctx.prisma.staff.rows.find((r) => r.id === 'tl-2')!.lockedByStaffId = 'manager-2';
      await ctx.otherIds.submitForJobSeeker('js-1', await ctx.card(), { channel: 'link', now: NOW });
      expect((await ctx.approvals.routeFor({ registeredByStaffId: 'tl-1', city: 'Bengaluru' })).mode).toBe('manager_or_ceo');
      expect(ctx.flagCalls.some((f) => f.kind === 'other_id_needs_manager')).toBe(true);
      expect(await ctx.approvals.waitingFor({ id: 'manager-1', role: 'manager' }, 'manager_or_ceo')).toEqual([{ subjectType: 'job_seeker', id: 'js-1' }]);
      await ctx.viewPhoto('tl-2');
      await expect(ctx.otherIds.recordDecision('job_seeker', 'js-1', 'ok', tl('tl-2'), NOW)).rejects.toBeInstanceOf(ForbiddenException);
      await ctx.viewPhoto('manager-1');
      expect((await ctx.otherIds.recordDecision('job_seeker', 'js-1', 'ok', { id: 'manager-1', role: 'manager' }, NOW)).otherIdDecided).toBe('verified');
    });

    it('a lock that has run out (lockedUntil in the past) counts as unlocked; one still running does not', async () => {
      const { approvals, prisma } = setup();
      const tl2 = prisma.staff.rows.find((r) => r.id === 'tl-2')!;
      tl2.lockedUntil = new Date(Date.now() + 3600_000);
      expect((await approvals.routeFor({ registeredByStaffId: 'tl-1', city: 'Bengaluru' })).mode).toBe('manager_or_ceo');
      tl2.lockedUntil = new Date(Date.now() - 3600_000);
      expect((await approvals.routeFor({ registeredByStaffId: 'tl-1', city: 'Bengaluru' })).mode).toBe('another_team_lead');
    });

    it('the own Team Lead locked: his team\'s registrations go to another Team Lead of the city', async () => {
      const { approvals, prisma } = setup();
      prisma.staff.rows.find((r) => r.id === 'tl-1')!.lockedByStaffId = 'manager-1';
      expect((await approvals.routeFor({ registeredByStaffId: 'agent-1', city: 'Bengaluru' })).mode).toBe('another_team_lead');
      expect((await approvals.rightFor(tl('tl-1'), { registeredByStaffId: 'agent-1', city: 'Bengaluru' })).allowed).toBe(false);
    });
  });

  describe('app self-registrations (#144 + rev 169)', () => {
    it('assigned to an agent: that agent\'s Team Lead (own team); nobody else of the city', async () => {
      const ctx = setup();
      const seeker = ctx.prisma.jobSeeker.rows.find((r) => r.id === 'js-1')!;
      seeker.registeredByStaffId = null;
      ctx.prisma.signupTracker.rows.push({ id: 'st-1', subjectType: 'job_seeker', subjectId: 'js-1', assignedStaffId: 'agent-2', updatedAt: NOW });
      const subject = { registeredByStaffId: null, city: 'Bengaluru', id: 'js-1', subjectType: 'job_seeker' as const };
      expect(await ctx.approvals.routeFor(subject)).toMatchObject({ mode: 'own_team', ownTeamLead: 'tl-2', ownerStaffId: 'agent-2' });
      expect((await ctx.approvals.rightFor(tl('tl-2'), subject)).allowed).toBe(true);
      expect((await ctx.approvals.rightFor(tl('tl-1'), subject)).allowed).toBe(false);
      expect(await ctx.approvals.uncheckedRegistrationsFor(tl('tl-1'), 'another_team_lead', since)).toEqual([]);
      // Its other ID is decided by tl-2 only.
      await ctx.otherIds.submitForJobSeeker('js-1', await ctx.card(), { channel: 'link', now: NOW });
      await ctx.viewPhoto('tl-1');
      await expect(ctx.otherIds.recordDecision('job_seeker', 'js-1', 'ok', tl('tl-1'), NOW)).rejects.toBeInstanceOf(ForbiddenException);
      await ctx.viewPhoto('tl-2');
      expect((await ctx.otherIds.recordDecision('job_seeker', 'js-1', 'ok', tl('tl-2'), NOW)).otherIdDecided).toBe('verified');
    });

    it('unassigned: no team — another active Team Lead of the city, else that city\'s Manager or the CEO', async () => {
      const ctx = setup();
      ctx.prisma.jobSeeker.rows.find((r) => r.id === 'js-1')!.registeredByStaffId = null;
      const subject = { registeredByStaffId: null, city: 'Bengaluru', id: 'js-1', subjectType: 'job_seeker' as const };
      expect((await ctx.approvals.routeFor(subject)).mode).toBe('another_team_lead');
      expect(await ctx.approvals.uncheckedRegistrationsFor(tl('tl-1'), 'another_team_lead', since)).toContain('js-1');
      expect(await ctx.approvals.uncheckedRegistrationsFor(tl('tl-2'), 'another_team_lead', since)).toContain('js-1');
      for (const id of ['tl-1', 'tl-2']) ctx.prisma.staff.rows.find((r) => r.id === id)!.status = 'deactivated';
      expect((await ctx.approvals.routeFor(subject)).mode).toBe('manager_or_ceo');
      expect(await ctx.approvals.uncheckedRegistrationsFor({ id: 'manager-1', role: 'manager' }, 'manager_or_ceo', since)).toContain('js-1');
    });
  });

  describe('L-3 / L-4: pending photos and failed other IDs', () => {
    it('a verified Aadhaar QR never deletes the card photo of an other ID still waiting for its decision', async () => {
      const { otherIds, service, card, prisma, storage } = setup();
      await otherIds.submitForJobSeeker('js-1', await card(), { channel: 'link', now: NOW });
      const cardPath = prisma.idCheckDetail.rows[0]!.photoPath as string;
      expect((await service.checkJobSeeker('js-1', qr(), { channel: 'link', now: NOW })).result).toBe('verified');
      expect(storage.has(cardPath)).toBe(true);
      expect(prisma.idCheckDetail.rows[0]).toMatchObject({ photoPath: cardPath, photoDeletedAt: null });
    });

    it('the daily run closes a pending other ID that has no photo left', async () => {
      const { otherIds, card, photos, prisma } = setup();
      await otherIds.submitForJobSeeker('js-1', await card(), { channel: 'link', now: NOW });
      prisma.idCheckDetail.rows[0]!.photoPath = null;
      await photos.deleteExpiredPhotos(NOW);
      expect(prisma.identityVerification.rows[0]).toMatchObject({ status: 'failed', failureReason: ID_PHOTO_EXPIRED_REASON, last4: null });
    });

    it('a rejected, replaced or expired other ID keeps no last 4 (and the rejection audit doesn\'t carry it)', async () => {
      const rejected = setup();
      await rejected.otherIds.submitForJobSeeker('js-1', await rejected.card(), { channel: 'link', now: NOW });
      await rejected.otherIds.recordDecision('job_seeker', 'js-1', 'fake', tl('tl-1'), NOW);
      expect(rejected.prisma.identityVerification.rows[0]).toMatchObject({ status: 'failed', last4: null });
      expect(JSON.stringify(rejected.auditCalls.find((a) => a.action === 'identity.other_id_rejected'))).not.toContain('234F');

      const replaced = setup();
      await replaced.otherIds.submitForJobSeeker('js-1', await replaced.card(), { channel: 'link', now: NOW });
      await replaced.otherIds.submitForJobSeeker('js-1', await replaced.card({ idType: 'voter_id', idNumber: 'ABC1234567' }), { channel: 'link', now: NOW });
      expect(replaced.prisma.identityVerification.rows[0]).toMatchObject({ status: 'failed', failureReason: 'Replaced by a newer photo of the card', last4: null });
      expect(replaced.prisma.identityVerification.rows[1]).toMatchObject({ status: 'pending', last4: '4567' });

      const expired = setup();
      await expired.otherIds.submitForJobSeeker('js-1', await expired.card(), { channel: 'link', now: NOW });
      await expired.photos.deleteExpiredPhotos(new Date(NOW.getTime() + 30 * DAY_MS));
      expect(expired.prisma.identityVerification.rows[0]).toMatchObject({ status: 'failed', last4: null });
    });
  });
});
