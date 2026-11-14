import { HttpException, Logger } from '@nestjs/common';
import { inflateSecureQrText, parseSecureQr, TrustedKey } from './secure-qr.parser';
import { AadhaarQrService, QR_ATTEMPTS_PER_HOUR, QR_BAD_SIGNATURES_BEFORE_FLAG } from './aadhaar-qr.service';
import { ID_PHOTO_MAX_DAYS, IdCheckPhotoService } from './id-check-photo.service';
import { IdCheckAccessService } from './id-check-access.service';
import { OtherIdService } from './other-id.service';
import { Under18StopService } from './under18-stop.service';
import { MemoryCandidatePhotoStorage } from '../job-seeker/photo-storage';
import { buildSecureQr, testSigner } from './testing/secure-qr.fixtures';
import { fakePrisma, FakePrisma } from './testing/fake-prisma';

const DAY_MS = 24 * 60 * 60 * 1000;
const signer = testSigner();
const stranger = testSigner('someone-else');
const NOW = new Date('2026-11-14T06:00:00Z');

/** Address parts that must never be kept, logged or sent anywhere. */
const SECRET_ADDRESS = { house: 'Flat 9Z Secret Tower', street: 'Hidden Lane Road', careOf: 'W/O Never Kept', landmark: 'Behind Private Temple' };

/** A JPEG by its first bytes: what a live camera photo of an ID card looks like to the server. */
const CARD_PHOTO = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1]);

function setup(options: { trusted?: TrustedKey[] } = {}) {
  const prisma: FakePrisma = fakePrisma({
    jobSeekers: [
      { id: 'js-1', code: 'JS-00001', name: 'Kavya Ramesh', phone: '+919876500001', phoneVerified: true, city: 'Bengaluru', registeredByStaffId: 'agent-1', anonymisedAt: null, photoStoragePath: 'job-seekers/js-1/selfie', createdAt: NOW },
      { id: 'js-2', code: 'JS-00002', name: 'Kavya Ramesh', phone: '+919876500002', phoneVerified: true, city: 'Bengaluru', registeredByStaffId: 'agent-2', anonymisedAt: null, photoStoragePath: 'job-seekers/js-2/selfie', createdAt: NOW },
      { id: 'js-3', code: 'JS-00003', name: 'Ravi Kumar', phone: '+919876500003', phoneVerified: true, city: 'Bengaluru', registeredByStaffId: 'agent-1', anonymisedAt: null, photoStoragePath: null, createdAt: NOW },
    ],
    referrals: [{ id: 'rf-1', code: 'RF-00001', name: 'Kavya Ramesh', phone: '+919876500001', phoneVerified: true, city: 'Bengaluru', registeredByStaffId: 'agent-1', photoStoragePath: 'referrals/rf-1/profile-photo', createdAt: NOW }],
    consents: [
      { id: 'consent-1', subjectType: 'job_seeker', subjectId: 'js-1', purpose: 'aadhaar_verification', granted: true, grantedAt: NOW, withdrawnAt: null, createdAt: NOW },
      { id: 'consent-3', subjectType: 'job_seeker', subjectId: 'js-2', purpose: 'aadhaar_verification', granted: true, grantedAt: NOW, withdrawnAt: null, createdAt: NOW },
      { id: 'consent-4', subjectType: 'job_seeker', subjectId: 'js-3', purpose: 'aadhaar_verification', granted: true, grantedAt: NOW, withdrawnAt: null, createdAt: NOW },
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
  const photos = new IdCheckPhotoService(prisma as never, audit as never, storage);
  // Reporting lines: manager-1 has agent-1 under them; manager-2 has agent-2.
  const scope = { peopleUnder: jest.fn(async (id: string) => (id === 'manager-1' ? ['tl-1', 'agent-1'] : id === 'manager-2' ? ['agent-2'] : [])) };
  const access = new IdCheckAccessService(scope as never);
  const stops = new Under18StopService(prisma as never, audit as never, access);
  const otherIds = new OtherIdService(prisma as never, audit as never, photos, stops);
  const service = new AadhaarQrService(prisma as never, audit as never, pricing as never, flags as never, photos, stops, options.trusted ?? [signer.trusted]);
  return { prisma, audit, auditCalls, flags, flagCalls, storage, photos, stops, otherIds, access, service };
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
    expect(out).toMatchObject({ status: 'failed', result: 'under_18', isAdult: false, person: null });
    expect(prisma.identityVerification.rows[0]).toMatchObject({ status: 'failed', isAdult: false, verifiedAt: null, vendor: 'uidai_secure_qr' });
    expect(prisma.idCheckDetail.rows).toHaveLength(0);
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
      await expect(otherIds.submitForJobSeeker('js-1', { idType: 'pan', idNumber: 'ABCDE1234F', captureSource: 'live_camera', photo: { buffer: CARD_PHOTO } }, { channel: 'link', now: NOW }))
        .rejects.toThrow(/under 18/);
      expect(prisma.identityVerification.rows).toHaveLength(1);
    });

    it('a Team Lead "Looks right" on an older pending other ID does not get past it', async () => {
      const { service, otherIds, prisma } = setup();
      await otherIds.submitForJobSeeker('js-1', { idType: 'pan', idNumber: 'ABCDE1234F', captureSource: 'live_camera', photo: { buffer: CARD_PHOTO } }, { channel: 'link', now: NOW });
      await service.checkJobSeeker('js-1', qr({ dob: '15-11-2008' }), { channel: 'link', now: new Date(NOW.getTime() + 1000) });
      const decided = await otherIds.recordTeamLeadDecision('job_seeker', 'js-1', 'ok', 'tl-1', NOW);
      expect(decided.otherIdDecided).toBeNull();
      expect(prisma.identityVerification.rows.find((r) => r.method === 'pan')).toMatchObject({ status: 'pending' });
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
    expect(out).toMatchObject({ status: 'failed', result: 'name_mismatch', nameMatches: false, verifiedByUidai: true, offerOtherId: true, person: null });
    expect(prisma.identityVerification.rows[0]).toMatchObject({ status: 'failed', nameMatches: false });
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
    const pan = { idType: 'pan', idNumber: 'abcde 1234 f', captureSource: 'live_camera', photo: { buffer: CARD_PHOTO } };

    it('stores a pending check with the ID type and the last 4 only, and the card photo privately', async () => {
      const { otherIds, prisma, storage, auditCalls } = setup();
      const out = await otherIds.submitForJobSeeker('js-1', pan, { channel: 'link', now: NOW });
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
      const { otherIds, prisma } = setup();
      const go = (input: Record<string, unknown>, id = 'js-1') => otherIds.submitForJobSeeker(id, { ...pan, ...input } as never, { channel: 'link', now: NOW });
      await expect(go({ captureSource: 'gallery' })).rejects.toThrow(/live camera/);
      await expect(go({ captureSource: undefined })).rejects.toThrow(/live camera/);
      await expect(go({ photo: undefined })).rejects.toThrow(/photo of the card/);
      await expect(go({ photo: { buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>') } })).rejects.toThrow(/JPEG, PNG or WebP/);
      await expect(go({ idNumber: 'ABC123' })).rejects.toThrow(/exactly as it is/);
      await expect(go({ idType: 'voter_id', idNumber: 'ABCDE1234F' })).rejects.toThrow(/exactly as it is/);
      await expect(go({ idType: 'driving_licence', idNumber: '1234 5678 9012' })).rejects.toThrow(/Aadhaar/);
      await expect(go({ idType: 'aadhaar_qr' })).rejects.toThrow(/Aadhaar/);
      await expect(go({ idType: 'passport' })).rejects.toThrow(/Choose the ID/);
      await expect(go({}, 'js-3')).rejects.toThrow(/selfie/);
      prisma.consent.rows.splice(0, 1);
      await expect(go({})).rejects.toThrow(/Consent/);
      expect(prisma.identityVerification.rows).toHaveLength(0);
    });

    it('"Looks right": verified (name and 18+ confirmed by eye) and the card photo deleted; "Fake": failed and deleted', async () => {
      for (const verdict of ['ok', 'fake'] as const) {
        const { otherIds, prisma, storage } = setup();
        await otherIds.submitForJobSeeker('js-1', pan, { channel: 'link', now: NOW });
        const path = prisma.idCheckDetail.rows[0]!.photoPath as string;
        const decided = await otherIds.recordTeamLeadDecision('job_seeker', 'js-1', verdict, 'tl-1', NOW);
        expect(decided).toEqual({ otherIdDecided: verdict === 'ok' ? 'verified' : 'failed', photosDeleted: 1 });
        expect(prisma.identityVerification.rows[0]).toMatchObject(
          verdict === 'ok' ? { status: 'verified', nameMatches: true, isAdult: true, verifiedAt: NOW } : { status: 'failed', failureReason: 'Rejected by the Team Lead' },
        );
        expect(storage.has(path)).toBe(false);
        expect(prisma.idCheckDetail.rows[0]).toMatchObject({ photoPath: null, photoDeletedReason: verdict === 'ok' ? 'team_lead_approved' : 'team_lead_rejected' });
      }
    });

    it('Laboura Field and referral partners use the same check', async () => {
      const { otherIds, prisma } = setup();
      await otherIds.submitForJobSeeker('js-1', { ...pan, idType: 'voter_id', idNumber: 'ABC1234567' }, { channel: 'field', staffId: 'fa-1', now: NOW });
      expect(prisma.identityVerification.rows[0]).toMatchObject({ method: 'voter_id', last4: '4567', status: 'pending' });
      await otherIds.submitForReferral('rf-1', { ...pan, idType: 'driving_licence', idNumber: 'KA01 20201234567' }, { channel: 'link', now: NOW });
      expect(prisma.referralIdentityVerification.rows[0]).toMatchObject({ method: 'driving_licence', last4: '4567', status: 'pending', vendor: 'team_lead_check' });
      expect(prisma.idCheckDetail.rows[1]).toMatchObject({ subjectType: 'referral', kind: 'id_card_photo' });
    });

    it('the Team Lead / Manager view shows the last 4 and the kept card photo, not "verified by UIDAI"', async () => {
      const { otherIds, photos } = setup();
      await otherIds.submitForJobSeeker('js-1', pan, { channel: 'link', now: NOW });
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
