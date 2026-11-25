import { randomUUID } from 'crypto';
import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import * as request from 'supertest';
import { AppModule } from '../../app.module';
import { PrismaService } from '../../common/prisma/prisma.service';
import { OtpService } from '../../common/otp/otp.service';
import { MockOtpProvider } from '../../common/otp/mock-otp.provider';
import { ConsentLinkService } from '../consent/consent-link.service';
import { BUSINESS_PHOTO_STORAGE, MemoryBusinessPhotoStorage } from './storefront-photo.storage';
import { gstinCheckCharacter } from './business-proofs';
import { businessCandidateAccess } from './business-candidate-access';
import { seedOwnerPhotos } from '../../test-support/owner-photos';
import { confirmVacancyForTest } from '../../test-support/confirm-vacancy';

/**
 * Business automatic verification (Master Guide rev 211–212, 25 Nov): B1 owner photos, B3 the
 * automatic decision (pass, 200 m, duplicates, re-run when a proof is added), B4 the vacancy
 * check, B5 no visit request after a pass, B6 the shop check after the first interview, B9 the
 * small-business path, and the Team Lead's queue showing every item.
 */
describe('Business automatic verification (rev 211–212)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let jwt: JwtService;
  let otp: OtpService;
  let consentLinks: ConsentLinkService;
  const photoStorage = new MemoryBusinessPhotoStorage();
  const suffix = randomUUID().replace(/-/g, '').slice(0, 8).toUpperCase();
  const digits = String(Date.now()).slice(-6);
  let seq = 0;
  const staffIds: string[] = [];
  const businessIds: string[] = [];
  let teamLead: { id: string; token: string };
  let otherLead: { id: string; token: string };
  let callAgent: { id: string; token: string };
  let otherAgent: { id: string; token: string };
  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
  // A tiny real JPEG header so the image type check passes.
  const jpeg = (n: number) => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from(`photo-${suffix}-${n}-${Math.random()}`)]);

  /** A valid GSTIN with a fresh PAN part (state 29). */
  function gstin(): string {
    seq += 1;
    const letters = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
    const pan = `${suffix.replace(/[^A-Z]/g, 'Q').slice(0, 3).padEnd(3, 'Q')}${letters[seq % letters.length]}${letters[(seq * 7) % letters.length]}${String(1000 + seq).slice(-4)}${letters[(seq * 3) % letters.length]}`;
    const first14 = `29${pan}1Z`;
    return `${first14}${gstinCheckCharacter(first14)}`;
  }

  async function makeBusiness(fields: Partial<{ gstNumber: string | null; mapsLatitude: number | null; mapsLongitude: number | null; fssaiNumber: string | null; businessType: string; runsFromHome: boolean; leadCreatedByStaffId: string }> = {}) {
    seq += 1;
    const business = await prisma.business.create({
      data: {
        code: `BZ-AV-${suffix}-${seq}`,
        name: `Auto Verify Shop ${suffix} ${seq}`,
        phone: `+9195${digits}${String(seq).padStart(2, '0')}`.slice(0, 13),
        phoneVerified: true,
        city: 'Bengaluru',
        ownerName: 'Ravi Kumar',
        contactRole: 'owner',
        latitude: 12.95,
        longitude: 77.6,
        verificationStatus: 'lead',
        leadChannel: 'phone_call',
        leadCreatedByStaffId: fields.leadCreatedByStaffId ?? callAgent.id,
        businessType: fields.businessType ?? 'restaurant',
        runsFromHome: fields.runsFromHome ?? false,
        gstNumber: fields.gstNumber === undefined ? gstin() : fields.gstNumber,
        fssaiNumber: fields.fssaiNumber ?? null,
        mapsLink: fields.mapsLatitude === null ? null : 'https://www.google.com/maps/place/Shop/@12.95,77.6,17z',
        mapsLatitude: fields.mapsLatitude === undefined ? 12.95 + seq * 0.01 : fields.mapsLatitude,
        mapsLongitude: fields.mapsLongitude === undefined ? 77.6 : fields.mapsLongitude,
      },
    });
    businessIds.push(business.id);
    return business;
  }

  async function sign(businessId: string) {
    const link = await consentLinks.createAgreementLink(businessId, callAgent.id, 'en');
    const sent = await consentLinks.sendOtp(link.token);
    const code = (otp.getProvider() as MockOtpProvider).getCode(sent.requestId)!;
    await consentLinks.submitConsent({ token: link.token, otpRequestId: sent.requestId, otpCode: code, signedName: 'Ravi Kumar', purposes: ['agreement_terms', 'agreement_authority', 'call_recording'] });
    return link.token;
  }

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(BUSINESS_PHOTO_STORAGE)
      .useValue(photoStorage)
      .compile();
    app = moduleRef.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);
    jwt = app.get(JwtService);
    otp = app.get(OtpService);
    consentLinks = app.get(ConsentLinkService);
    const createStaff = async (role: string, tag: string, lead?: string) => {
      const staff = await prisma.staff.create({
        data: { code: `AV-${tag}-${suffix}`, name: `Auto ${tag}`, email: `av_${tag.toLowerCase()}_${suffix.toLowerCase()}@laboura.local`, passwordHash: 'x', role, status: 'active', city: 'Bengaluru', teamLeadId: lead ?? null },
      });
      staffIds.push(staff.id);
      return { id: staff.id, token: jwt.sign({ sub: staff.id, role: staff.role, code: staff.code, email: staff.email }) };
    };
    teamLead = await createStaff('team_lead', 'TL');
    otherLead = await createStaff('team_lead', 'TL2');
    callAgent = await createStaff('call_agent', 'CA', teamLead.id);
    otherAgent = await createStaff('call_agent', 'CA2', otherLead.id);
  }, 120000);

  afterAll(async () => {
    if (!prisma) return;
    await prisma.reviewFlag.deleteMany({ where: { subjectId: { in: businessIds } } });
    await prisma.statusHistory.deleteMany({ where: { subjectType: 'business', subjectId: { in: businessIds } } });
    await app.close();
  });

  it('B1: the owner photo on the agreement link is camera only; the shop photo carries the location', async () => {
    const business = await makeBusiness();
    const link = await consentLinks.createAgreementLink(business.id, callAgent.id, 'en');
    await request(app.getHttpServer()).post(`/consent/${link.token}/owner-photo`)
      .field('kind', 'selfie').field('captureSource', 'gallery').attach('photo', jpeg(1), 'a.jpg').expect(400);
    await request(app.getHttpServer()).post(`/consent/${link.token}/owner-photo`)
      .field('kind', 'selfie').field('captureSource', 'live_camera').attach('photo', jpeg(2), 'a.jpg').expect(201);
    const shop = await request(app.getHttpServer()).post(`/consent/${link.token}/owner-photo`)
      .field('kind', 'shop').field('captureSource', 'live_camera').field('latitude', '12.9501').field('longitude', '77.6001').attach('photo', jpeg(3), 'b.jpg').expect(201);
    expect(shop.body).toMatchObject({ locationStatus: 'recorded', ownerPhotos: { selfie: true, shop: true } });
    const rows = await prisma.businessOwnerPhoto.findMany({ where: { businessId: business.id } });
    expect(rows.map((r) => r.kind).sort()).toEqual(['owner_selfie', 'shop_board']);
    expect(rows.every((r) => photoStorage.has(r.storagePath))).toBe(true);
    // Refused location: the photo is still taken.
    const refused = await request(app.getHttpServer()).post(`/consent/${link.token}/owner-photo`)
      .field('kind', 'shop').field('captureSource', 'live_camera').field('locationStatus', 'refused').attach('photo', jpeg(4), 'c.jpg').expect(201);
    expect(refused.body.locationStatus).toBe('refused');
  });

  it('B3 pass: signed with photos within 200 m of the Maps pin and 2 proofs → verified automatically, no visit request', async () => {
    const business = await makeBusiness();
    await prisma.visitAssignment.create({ data: { businessId: business.id, purpose: 'verification', status: 'pending' } });
    await seedOwnerPhotos(prisma, business.id, { at: { latitude: business.mapsLatitude! + 0.0005, longitude: business.mapsLongitude! } });
    await sign(business.id);
    const after = await prisma.business.findUniqueOrThrow({ where: { id: business.id } });
    expect(after).toMatchObject({ verificationStatus: 'verified', autoCheckStatus: 'passed', verifiedByStaffId: null, verificationPath: 'standard' });
    expect(after.autoVerifiedAt).not.toBeNull();
    expect(after.autoCheckDistanceMeters).toBeLessThan(200);
    expect(businessCandidateAccess(after).allowed).toBe(true);
    // No field visit is needed: the open request was cancelled and none was made.
    expect(await prisma.visitAssignment.count({ where: { businessId: business.id, status: { in: ['pending', 'assigned'] } } })).toBe(0);
    const history = await prisma.statusHistory.findFirst({ where: { subjectType: 'business', subjectId: business.id, toStatus: 'verified' } });
    expect(history).toMatchObject({ changedByStaffId: null });
    expect(history?.reason).toMatch(/Verified automatically/);
    expect(await prisma.auditLog.count({ where: { action: 'business.verified_automatically', entityCode: business.code, actorId: 'system' } })).toBe(1);
  });

  it('B3 fail: the shop photo 260 m from the pin → pending_tl_check with the reason; the Team Lead queue shows it; approve needs no visit', async () => {
    const business = await makeBusiness();
    await seedOwnerPhotos(prisma, business.id, { at: { latitude: business.mapsLatitude! + 260 / 111_195, longitude: business.mapsLongitude! } });
    await sign(business.id);
    const after = await prisma.business.findUniqueOrThrow({ where: { id: business.id } });
    expect(after).toMatchObject({ verificationStatus: 'pending_tl_check', autoCheckStatus: 'failed' });
    expect(JSON.stringify(after.autoCheckReasons)).toMatch(/more than 200 m/);
    expect(await prisma.reviewFlag.count({ where: { kind: 'business_auto_check_failed', subjectId: business.id, status: 'open' } })).toBe(1);
    expect(businessCandidateAccess(after).allowed).toBe(false);

    const queue = await request(app.getHttpServer()).get('/team-lead/business-checks').set(auth(teamLead.token)).expect(200);
    const row = queue.body.businesses.find((b: { id: string }) => b.id === business.id);
    expect(row).toMatchObject({ canDecide: true, verification: { autoCheck: { status: 'failed', distanceMeters: expect.any(Number) } } });
    expect(row.verification.autoCheck.failed.join(' ')).toMatch(/200 m/);
    // Another team's Team Lead does not see it.
    const other = await request(app.getHttpServer()).get('/team-lead/business-checks').set(auth(otherLead.token)).expect(200);
    expect(other.body.businesses.some((b: { id: string }) => b.id === business.id)).toBe(false);
    // TL owner photos: another team's business is 404
    await request(app.getHttpServer()).get(`/team-lead/businesses/${business.id}/owner-photos`).set(auth(otherLead.token)).expect(404);
    const photos = await request(app.getHttpServer()).get(`/team-lead/businesses/${business.id}/owner-photos`).set(auth(teamLead.token)).expect(200);
    expect(photos.body).toMatchObject({ selfie: { kind: 'owner_selfie' }, shop: { kind: 'shop_board' } });

    await request(app.getHttpServer()).post(`/businesses/${business.id}/verification/approve`).set(auth(teamLead.token)).send({}).expect(201);
    expect((await prisma.business.findUniqueOrThrow({ where: { id: business.id } })).verificationStatus).toBe('verified');
    expect(await prisma.reviewFlag.count({ where: { kind: 'business_auto_check_failed', subjectId: business.id, status: 'open' } })).toBe(0);
  });

  /** Rev 213: a field agent's in-person visit — board photo with GPS and his selfie at the board. */
  async function fieldVisit(businessId: string, at: { latitude: number; longitude: number }, extra: { gpsSuspect?: boolean } = {}) {
    return prisma.businessVisit.create({
      data: {
        businessId, staffId: callAgent.id, latitude: at.latitude, longitude: at.longitude, shopName: 'Field shop',
        boardPhotoPath: `visits/${businessId}/board.jpg`, selfieUrl: `visits/${businessId}/selfie.jpg`, photoLive: true,
        gpsSuspect: extra.gpsSuspect ?? false, visitedAt: new Date(),
      },
    });
  }

  it('rev 213: onboarded in the field — the visit photos count; no owner photos, signing works, verified automatically', async () => {
    const business = await makeBusiness();
    await fieldVisit(business.id, { latitude: business.mapsLatitude! + 0.0005, longitude: business.mapsLongitude! });
    const link = await consentLinks.createAgreementLink(business.id, callAgent.id, 'en');
    const page = await request(app.getHttpServer()).get(`/consent/${link.token}`).expect(200);
    expect(page.body.ownerPhotos).toMatchObject({ selfie: true, shop: true, fromFieldVisit: true });
    // Sign on the same link (a second link within a minute is refused).
    const sent = await consentLinks.sendOtp(link.token);
    const code = (otp.getProvider() as MockOtpProvider).getCode(sent.requestId)!;
    await consentLinks.submitConsent({ token: link.token, otpRequestId: sent.requestId, otpCode: code, signedName: 'Ravi Kumar', purposes: ['agreement_terms', 'agreement_authority', 'call_recording'] });
    const after = await prisma.business.findUniqueOrThrow({ where: { id: business.id } });
    expect(after).toMatchObject({ verificationStatus: 'verified', autoCheckStatus: 'passed' });
    expect(JSON.stringify(after.autoCheckReasons)).toMatch(/in-person visit/);
    expect(await prisma.businessOwnerPhoto.count({ where: { businessId: business.id } })).toBe(0);
  });

  it('rev 213: the visit GPS is checked against the Maps pin; a GPS-suspect visit does not count', async () => {
    const far = await makeBusiness();
    await fieldVisit(far.id, { latitude: far.mapsLatitude! + 400 / 111_195, longitude: far.mapsLongitude! });
    await sign(far.id);
    const farAfter = await prisma.business.findUniqueOrThrow({ where: { id: far.id } });
    expect(farAfter.verificationStatus).toBe('pending_tl_check');
    expect(JSON.stringify(farAfter.autoCheckReasons)).toMatch(/more than 200 m/);

    const suspect = await makeBusiness();
    await fieldVisit(suspect.id, { latitude: suspect.mapsLatitude!, longitude: suspect.mapsLongitude! }, { gpsSuspect: true });
    const link = await consentLinks.createAgreementLink(suspect.id, callAgent.id, 'en');
    const page = await request(app.getHttpServer()).get(`/consent/${link.token}`).expect(200);
    expect(page.body.ownerPhotos).toMatchObject({ selfie: false, shop: false, fromFieldVisit: false });
  });

  it('B3 duplicates: the same GST as another business fails the check', async () => {
    const first = await makeBusiness();
    const twin = await makeBusiness({ gstNumber: first.gstNumber });
    await seedOwnerPhotos(prisma, twin.id, { at: { latitude: twin.mapsLatitude!, longitude: twin.mapsLongitude! } });
    await sign(twin.id);
    const after = await prisma.business.findUniqueOrThrow({ where: { id: twin.id } });
    expect(after.verificationStatus).toBe('pending_tl_check');
    expect(JSON.stringify(after.autoCheckReasons)).toContain(`Same GST number as ${first.code}`);
  });

  it('B3 again when a missing proof is added: 1 proof fails, adding the Maps link verifies it automatically', async () => {
    const business = await makeBusiness({ mapsLatitude: null, mapsLongitude: null });
    await seedOwnerPhotos(prisma, business.id, { at: { latitude: 12.9716, longitude: 77.5946 } });
    await sign(business.id);
    expect((await prisma.business.findUniqueOrThrow({ where: { id: business.id } })).verificationStatus).toBe('pending_tl_check');
    // An agent of another team cannot add it; the business's Team Lead can.
    await request(app.getHttpServer()).post(`/businesses/${business.id}/proofs`).set(auth(otherAgent.token)).send({ mapsLink: 'https://www.google.com/maps/place/X/@12.9716,77.5946,17z' }).expect(403);
    await request(app.getHttpServer()).post(`/businesses/${business.id}/proofs`).set(auth(teamLead.token)).send({ fssaiNumber: '123' }).expect(400);
    await request(app.getHttpServer()).post(`/businesses/${business.id}/proofs`).set(auth(teamLead.token))
      .send({ mapsLink: 'https://www.google.com/maps/place/X/@12.9716,77.5946,17z' }).expect(201);
    const after = await prisma.business.findUniqueOrThrow({ where: { id: business.id } });
    expect(after).toMatchObject({ verificationStatus: 'verified', autoCheckStatus: 'passed', mapsLatitude: 12.9716 });
    expect(await prisma.reviewFlag.count({ where: { kind: 'business_auto_check_failed', subjectId: business.id, status: 'open' } })).toBe(0);
  });

  it('B4: a vacancy with more than 5 openings waits for the Team Lead before candidates; approved, it opens', async () => {
    const business = await makeBusiness();
    await prisma.business.update({ where: { id: business.id }, data: { verificationStatus: 'verified', verifiedAt: new Date() } });
    const vacancy = await prisma.vacancy.create({
      data: { code: `VC-AV-${suffix}`, city: 'Bengaluru', businessId: business.id, capturedByStaffId: callAgent.id, tradeSkill: 'Helper', headcount: 6, salaryMinPaise: 1500000, salaryMaxPaise: 1600000, salaryPeriod: 'monthly', shift: 'day', status: 'awaiting_confirmation' },
    });
    await confirmVacancyForTest(app, vacancy);
    const held = await prisma.vacancy.findUniqueOrThrow({ where: { id: vacancy.id } });
    expect(held.status).toBe('pending_tl_check');
    expect(JSON.stringify(held.tlCheckReasons)).toMatch(/6 openings/);
    await request(app.getHttpServer()).get(`/vacancies/${vacancy.id}/candidates`).set(auth(callAgent.token)).expect(400);
    const queue = await request(app.getHttpServer()).get('/team-lead/business-checks').set(auth(teamLead.token)).expect(200);
    expect(queue.body.vacancies.some((v: { id: string }) => v.id === vacancy.id)).toBe(true);
    await request(app.getHttpServer()).post(`/vacancies/${vacancy.id}/tl-check`).set(auth(otherLead.token)).send({ decision: 'approve' }).expect(403);
    await request(app.getHttpServer()).post(`/vacancies/${vacancy.id}/tl-check`).set(auth(teamLead.token)).send({ decision: 'approve' }).expect(201);
    expect((await prisma.vacancy.findUniqueOrThrow({ where: { id: vacancy.id } })).status).toBe('open');
  });

  it('B6: "No" to the shop question pauses the business, raises the Team Lead item and asks for a visit', async () => {
    const business = await makeBusiness();
    await prisma.business.update({ where: { id: business.id }, data: { verificationStatus: 'verified', verifiedAt: new Date() } });
    const vacancy = await prisma.vacancy.create({ data: { code: `VC-AV6-${suffix}`, city: 'Bengaluru', businessId: business.id, tradeSkill: 'Helper', headcount: 1, salaryMinPaise: 1500000, status: 'open' } });
    const seeker = await prisma.jobSeeker.create({ data: { code: `JS-AV-${suffix}`, name: 'Shop Check Candidate', phone: `+9194${digits}11`.slice(0, 13), status: 'active', minSalary: 1000000, maxSalary: 2000000, preferredCallWindowStart: '09:00', preferredCallWindowEnd: '21:00' } });
    const slot = await prisma.vacancyInterviewSlot.create({ data: { vacancyId: vacancy.id, startsAt: new Date(Date.now() - 3 * 3600_000), endsAt: new Date(Date.now() - 2 * 3600_000), capacity: 1 } });
    const interview = await prisma.interview.create({
      data: {
        code: `IV-AV-${suffix}`, vacancyId: vacancy.id, businessId: business.id, jobSeekerId: seeker.id, vacancyInterviewSlotId: slot.id,
        slotStartsAt: slot.startsAt, slotEndsAt: slot.endsAt, proposedByStaffId: callAgent.id, suitabilitySnapshot: {}, offerSentAt: new Date(),
        replyDueAt: new Date(), resultDueAt: new Date(Date.now() + 3600_000), status: 'confirmed', resultRequestSentAt: new Date(), candidateCheckAnswer: 'no_answer', shopCheckAsked: true,
      },
    });
    // shop check: another agent's call is refused (403)
    const call = await prisma.callRecord.create({ data: { code: `CL-AV-${suffix}`, provider: 'mock', providerCallId: `pc-${suffix}`, providerStatus: 'completed', staffId: callAgent.id, subjectType: 'job_seeker', subjectId: seeker.id, direction: 'outbound', purpose: 'general', answered: true, startedAt: new Date() } });
    await request(app.getHttpServer()).post(`/interviews/${interview.id}/shop-check`).set(auth(otherAgent.token)).send({ answer: 'no', note: 'Said no shop', callRecordId: call.id }).expect(403);

    const token = await consentLinks.createInterviewActionToken(interview.id, 'candidate_check', seeker.phone, new Date(Date.now() + 3600_000));
    const page = await request(app.getHttpServer()).get(`/interviews/check/${token}`).set('Accept', 'application/json').expect(200);
    expect(page.body.askShopCheck).toBe(true);
    await request(app.getHttpServer()).post(`/interviews/check/${token}`).send({ answer: 'yes', shopAnswer: 'no' }).expect(201);
    const after = await prisma.business.findUniqueOrThrow({ where: { id: business.id } });
    expect(after.pausedAt).not.toBeNull();
    expect(after.pausedByStaffId).toBeNull();
    expect(businessCandidateAccess(after)).toEqual({ allowed: false, reason: 'paused' });
    expect(await prisma.reviewFlag.count({ where: { kind: 'candidate_shop_report', subjectId: business.id } })).toBe(1);
    expect(await prisma.visitAssignment.count({ where: { businessId: business.id, purpose: 'candidate_report', status: 'pending' } })).toBe(1);
    expect((await prisma.interview.findUniqueOrThrow({ where: { id: interview.id } }))).toMatchObject({ shopCheckAnswer: 'no', shopCheckChannel: 'link' });
    await prisma.interview.deleteMany({ where: { id: interview.id } });
    await prisma.vacancyInterviewSlot.deleteMany({ where: { id: slot.id } });
    await prisma.callRecord.deleteMany({ where: { id: call.id } });
  });

  it('B9: fewer than 2 proofs → the small-business path; approve waits for ID, address proof, business proof and the video call', async () => {
    const business = await makeBusiness({ gstNumber: null, mapsLatitude: null, mapsLongitude: null });
    const link = await consentLinks.createAgreementLink(business.id, callAgent.id, 'en');
    const state0 = await request(app.getHttpServer()).get(`/consent/${link.token}/small-business`).expect(200);
    expect(state0.body).toMatchObject({ required: true });
    // The workspace photo counts as the second photo here.
    await request(app.getHttpServer()).post(`/consent/${link.token}/owner-photo`).field('kind', 'selfie').field('captureSource', 'live_camera').attach('photo', jpeg(10), 'a.jpg').expect(201);
    await request(app.getHttpServer()).post(`/consent/${link.token}/owner-photo`).field('kind', 'shop').field('shopVariant', 'workspace').field('captureSource', 'live_camera')
      .field('latitude', '12.95').field('longitude', '77.6').attach('photo', jpeg(11), 'b.jpg').expect(201);
    const sent = await consentLinks.sendOtp(link.token);
    const code = (otp.getProvider() as MockOtpProvider).getCode(sent.requestId)!;
    await consentLinks.submitConsent({ token: link.token, otpRequestId: sent.requestId, otpCode: code, signedName: 'Ravi Kumar', purposes: ['agreement_terms', 'agreement_authority', 'call_recording'] });
    const signed = await prisma.business.findUniqueOrThrow({ where: { id: business.id } });
    expect(signed).toMatchObject({ verificationStatus: 'pending_tl_check', verificationPath: 'small_business' });
    expect(JSON.stringify(signed.autoCheckReasons)).toMatch(/small business checks instead/);
    expect(await prisma.visitAssignment.count({ where: { businessId: business.id } })).toBe(0);

    const refused = await request(app.getHttpServer()).post(`/businesses/${business.id}/verification/approve`).set(auth(teamLead.token)).send({}).expect(400);
    expect(refused.body.code).toBe('SMALL_BUSINESS_CHECKS_MISSING');

    // The owner's steps still work on the signed (used) link.
    await request(app.getHttpServer()).post(`/consent/${link.token}/small-business/other-id`).field('idType', 'pan').field('idNumber', 'ABCDE1234F').field('nameOnId', 'Ravi Kumar')
      .field('captureSource', 'live_camera').attach('photo', jpeg(12), 'id.jpg').expect(201);
    await request(app.getHttpServer()).post(`/consent/${link.token}/small-business/address-proof`).field('docType', 'electricity_bill').field('captureSource', 'live_camera').attach('photo', jpeg(13), 'bill.jpg').expect(201);
    await request(app.getHttpServer()).post(`/consent/${link.token}/small-business/business-proof`).send({ kind: 'bank_upi', value: '123456789012' }).expect(201);
    const check = await prisma.businessOwnerCheck.findUniqueOrThrow({ where: { businessId: business.id } });
    expect(check).toMatchObject({ idType: 'pan', idLast4: '234F', idResult: 'pending', addressResult: 'pending', businessProofValue: 'Account ending 9012' });
    const idPath = check.idPhotoPath!;
    const addressPath = check.addressPhotoPath!;
    expect(photoStorage.has(idPath)).toBe(true);

    const queue = await request(app.getHttpServer()).get('/team-lead/business-checks').set(auth(teamLead.token)).expect(200);
    const row = queue.body.businesses.find((b: { id: string }) => b.id === business.id);
    expect(row.smallBusiness).toMatchObject({ idPhotoWaiting: true, addressPhotoWaiting: true });
    expect(row.smallBusiness.missing).toEqual(expect.arrayContaining(['the video call with the Team Lead']));

    await request(app.getHttpServer()).post(`/businesses/${business.id}/small-business/owner-id`).set(auth(teamLead.token)).send({ decision: 'approve' }).expect(201);
    await request(app.getHttpServer()).post(`/businesses/${business.id}/small-business/address-proof`).set(auth(teamLead.token)).send({ decision: 'approve', addressMatched: '12, 3rd Cross, JP Nagar' }).expect(201);
    expect(photoStorage.has(idPath)).toBe(false);
    expect(photoStorage.has(addressPath)).toBe(false);
    await request(app.getHttpServer()).post(`/businesses/${business.id}/verification/approve`).set(auth(teamLead.token)).send({}).expect(400);
    await request(app.getHttpServer()).post(`/businesses/${business.id}/small-business/video-call`).set(auth(teamLead.token)).send({ note: 'Saw the home kitchen and the owner' }).expect(201);
    await request(app.getHttpServer()).post(`/businesses/${business.id}/verification/approve`).set(auth(teamLead.token)).send({}).expect(201);
    const done = await prisma.businessOwnerCheck.findUniqueOrThrow({ where: { businessId: business.id } });
    expect(done).toMatchObject({ idResult: 'verified', idPhotoPath: null, addressResult: 'checked', addressPhotoPath: null, addressMatched: '12, 3rd Cross, JP Nagar' });
    expect((await prisma.business.findUniqueOrThrow({ where: { id: business.id } })).verificationStatus).toBe('verified');
  });

  it('households keep the visit: never checked automatically', async () => {
    const household = await makeBusiness({ businessType: 'household' });
    await seedOwnerPhotos(prisma, household.id, { at: { latitude: household.mapsLatitude!, longitude: household.mapsLongitude! } });
    await sign(household.id);
    const after = await prisma.business.findUniqueOrThrow({ where: { id: household.id } });
    expect(after.verificationStatus).toBe('lead');
    expect(after.autoCheckStatus).toBeNull();
  });
});
