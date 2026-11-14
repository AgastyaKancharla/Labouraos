import { HttpException, Logger } from '@nestjs/common';
import { inflateSecureQrText, parseSecureQr } from './secure-qr.parser';
import { AadhaarQrService, QR_ATTEMPTS_PER_HOUR, QR_BAD_SIGNATURES_BEFORE_FLAG } from './aadhaar-qr.service';
import { AADHAAR_QR_PHOTO_MAX_DAYS, AadhaarQrPhotoService } from './aadhaar-qr-photo.service';
import { MemoryCandidatePhotoStorage } from '../job-seeker/photo-storage';
import { buildSecureQr, testSigner } from './testing/secure-qr.fixtures';
import { fakePrisma, FakePrisma } from './testing/fake-prisma';

const DAY_MS = 24 * 60 * 60 * 1000;
const signer = testSigner();
const stranger = testSigner('someone-else');
const NOW = new Date('2026-11-14T06:00:00Z');

/** Address parts that must never be kept, logged or sent anywhere. */
const SECRET_ADDRESS = { house: 'Flat 9Z Secret Tower', street: 'Hidden Lane Road', careOf: 'W/O Never Kept', landmark: 'Behind Private Temple' };

function setup() {
  const prisma: FakePrisma = fakePrisma({
    jobSeekers: [{ id: 'js-1', code: 'JS-00001', name: 'Kavya Ramesh', phone: '+919876500001', phoneVerified: true, city: 'Bengaluru', registeredByStaffId: 'agent-1', anonymisedAt: null, createdAt: NOW }],
    referrals: [{ id: 'rf-1', code: 'RF-00001', name: 'Kavya Ramesh', phone: '+919876500001', phoneVerified: true, city: 'Bengaluru', registeredByStaffId: 'agent-1', createdAt: NOW }],
    consents: [
      { id: 'consent-1', subjectType: 'job_seeker', subjectId: 'js-1', purpose: 'aadhaar_verification', granted: true, grantedAt: NOW, withdrawnAt: null, createdAt: NOW },
      { id: 'consent-2', subjectType: 'referral', subjectId: 'rf-1', purpose: 'agreement_terms', granted: true, grantedAt: NOW, withdrawnAt: null, createdAt: NOW },
    ],
  });
  const auditCalls: Record<string, unknown>[] = [];
  const audit = { log: jest.fn(async (entry: Record<string, unknown>) => void auditCalls.push(entry)) };
  const flagCalls: Record<string, unknown>[] = [];
  const flags = {
    raise: jest.fn(async (params: Record<string, unknown>) => {
      flagCalls.push(params);
      return prisma.reviewFlag.create({ data: { ...params, status: 'open' } });
    }),
  };
  const pricing = { current: jest.fn(async () => ({ adultMinimumAge: 18 })) };
  const storage = new MemoryCandidatePhotoStorage();
  const photos = new AadhaarQrPhotoService(prisma as never, audit as never, storage);
  const service = new AadhaarQrService(prisma as never, audit as never, pricing as never, flags as never, photos, storage, [signer.trusted]);
  return { prisma, audit, auditCalls, flags, flagCalls, storage, photos, service };
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
    const [detail] = prisma.aadhaarQrDetail.rows;
    expect(detail).toMatchObject({
      subjectType: 'job_seeker', subjectId: 'js-1', verificationId: row!.id, nameOnId: 'Kavya Ramesh', dateOfBirth: '1998-08-15',
      gender: 'F', area: 'JP Nagar 8th Phase', pincode: '560076',
    });
    expect(detail!.photoPath).toBe(`aadhaar-qr/job_seeker/js-1/${row!.id}.jpg`);
    expect((detail!.photoExpiresAt as Date).getTime()).toBe(NOW.getTime() + AADHAAR_QR_PHOTO_MAX_DAYS * DAY_MS);
    expect(storage.has(detail!.photoPath as string)).toBe(true);
    // Only these columns exist on the detail: no address, no hashes, no QR text.
    expect(Object.keys(detail!).sort()).toEqual(
      ['area', 'createdAt', 'dateOfBirth', 'gender', 'id', 'nameOnId', 'photoExpiresAt', 'photoPath', 'pincode', 'subjectId', 'subjectType', 'updatedAt', 'verificationId'].sort(),
    );
    expect(prisma.aadhaarQrAttempt.rows).toEqual([expect.objectContaining({ outcome: 'verified', channel: 'link' })]);
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

  it('an edited or fake card fails the signature: nothing stored but the attempt', async () => {
    const { service, prisma } = setup();
    const out = await service.checkJobSeeker('js-1', buildSecureQr(stranger, { mobile: '9876500001' }), { channel: 'link', now: NOW });
    expect(out).toMatchObject({ status: 'failed', result: 'bad_signature', verifiedByUidai: false, offerOtherId: true, maskedReference: null });
    expect(prisma.identityVerification.rows).toHaveLength(0);
    expect(prisma.aadhaarQrDetail.rows).toHaveLength(0);
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

  it('under 18: stops (no photo kept), the step is not done', async () => {
    const { service, prisma } = setup();
    const out = await service.checkJobSeeker('js-1', qr({ dob: '15-11-2008' }), { channel: 'link', now: NOW });
    expect(out).toMatchObject({ status: 'failed', result: 'under_18', isAdult: false });
    expect(prisma.identityVerification.rows[0]).toMatchObject({ status: 'failed', isAdult: false, verifiedAt: null });
    expect(prisma.aadhaarQrDetail.rows[0]!.photoPath).toBeNull();
  });

  it('name mismatch: other-ID offer and a name check for the Team Lead, marked when it looks like spelling', async () => {
    const { service, flagCalls, prisma } = setup();
    const out = await service.checkJobSeeker('js-1', qr({ name: 'Kaavya Ramesh' }), { channel: 'link', now: NOW });
    expect(out).toMatchObject({ status: 'failed', result: 'name_mismatch', nameMatches: false, verifiedByUidai: true, offerOtherId: true });
    expect(prisma.identityVerification.rows[0]).toMatchObject({ status: 'failed', nameMatches: false });
    expect(flagCalls).toEqual([
      expect.objectContaining({ kind: 'name_check', subjectType: 'job_seeker', subjectId: 'js-1', raisedForStaffId: 'agent-1', details: expect.objectContaining({ likelySpelling: true, method: 'aadhaar_qr' }) }),
    ]);
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

  it('referral partners get the same check (no QR photo kept: there is no Team Lead photo check for partners)', async () => {
    const { service, prisma } = setup();
    const out = await service.checkReferral('rf-1', qr(), { channel: 'link', now: NOW });
    expect(out).toMatchObject({ status: 'verified', result: 'verified', maskedReference: 'XXXX-XXXX-1234' });
    expect(prisma.referralIdentityVerification.rows[0]).toMatchObject({ referralId: 'rf-1', method: 'aadhaar_qr', consentId: 'consent-2' });
    expect(prisma.aadhaarQrDetail.rows[0]).toMatchObject({ subjectType: 'referral', photoPath: null });
  });

  describe('the QR photo', () => {
    it('is deleted when the Team Lead approves or rejects, and that is audited', async () => {
      for (const reason of ['team_lead_approved', 'team_lead_rejected'] as const) {
        const { service, prisma, photos, storage, auditCalls } = setup();
        await service.checkJobSeeker('js-1', qr(), { channel: 'link', now: NOW });
        const path = prisma.aadhaarQrDetail.rows[0]!.photoPath as string;
        expect(await photos.deletePhotos('job_seeker', 'js-1', reason, 'tl-1', NOW)).toBe(1);
        expect(storage.has(path)).toBe(false);
        expect(prisma.aadhaarQrDetail.rows[0]).toMatchObject({ photoPath: null, photoDeletedReason: reason });
        expect(auditCalls.at(-1)).toMatchObject({ actorId: 'tl-1', action: 'identity.aadhaar_qr_photo_deleted', after: { photoKept: false, reason } });
        expect((await photos.latestForJobSeeker('js-1'))?.photo).toMatchObject({ kept: false, deletedReason: reason });
        expect(await photos.photoLink(prisma.aadhaarQrDetail.rows[0]!.verificationId as string, 'tl-1')).toBeNull();
      }
    });

    it('is deleted by the daily job after 30 days at most', async () => {
      const { service, prisma, photos, storage } = setup();
      await service.checkJobSeeker('js-1', qr(), { channel: 'link', now: NOW });
      const path = prisma.aadhaarQrDetail.rows[0]!.photoPath as string;
      expect(await photos.deleteExpiredPhotos(new Date(NOW.getTime() + 29 * DAY_MS))).toBe(0);
      expect(storage.has(path)).toBe(true);
      expect(await photos.deleteExpiredPhotos(new Date(NOW.getTime() + 30 * DAY_MS), true)).toBe(1);
      expect(storage.has(path)).toBe(true);
      expect(await photos.deleteExpiredPhotos(new Date(NOW.getTime() + 30 * DAY_MS))).toBe(1);
      expect(storage.has(path)).toBe(false);
      expect(prisma.aadhaarQrDetail.rows[0]).toMatchObject({ photoPath: null, photoDeletedReason: 'expired' });
    });

    it('a newer scan replaces the older photo', async () => {
      const { service, prisma, storage } = setup();
      await service.checkJobSeeker('js-1', qr(), { channel: 'link', now: NOW });
      const first = prisma.aadhaarQrDetail.rows[0]!.photoPath as string;
      await service.checkJobSeeker('js-1', qr(), { channel: 'field', staffId: 'fa-1', now: NOW });
      expect(storage.has(first)).toBe(false);
      expect(prisma.aadhaarQrDetail.rows[0]).toMatchObject({ photoDeletedReason: 'replaced' });
      expect(prisma.aadhaarQrDetail.rows[1]!.photoPath).toBeTruthy();
    });

    it('is shown only through a short-lived signed link, and the view is audited', async () => {
      const { service, prisma, photos, auditCalls } = setup();
      await service.checkJobSeeker('js-1', qr(), { channel: 'link', now: NOW });
      const link = await photos.photoLink(prisma.aadhaarQrDetail.rows[0]!.verificationId as string, 'tl-1');
      expect(link).toMatchObject({ expiresInSeconds: 300 });
      expect(link!.url).toMatch(/^memory:\/\/candidate-photos\/aadhaar-qr\/job_seeker\/js-1\/.+\.jpg\?exp=/);
      expect(auditCalls.at(-1)).toMatchObject({ actorId: 'tl-1', action: 'identity.aadhaar_qr_photo_viewed' });
    });
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
        details: prisma.aadhaarQrDetail.rows,
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
