import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import * as request from 'supertest';
import { AppModule } from '../../app.module';
import { PrismaService } from '../../common/prisma/prisma.service';
import { PublicLinkStoreService } from '../../common/public-link-store.service';
import { ConsentService } from '../consent/consent.service';
import { verifiedOtpFor } from '../../test-support/verified-otp';
import { UIDAI_SAMPLE_SECURE_QR } from './testing/uidai-sample-qr';
import { AnonymisationService } from '../../common/anonymisation/anonymisation.service';
import { CANDIDATE_PHOTO_STORAGE, CandidatePhotoStorage } from '../job-seeker/photo-storage';
import { encode as encodeJpeg } from 'jpeg-js';

jest.setTimeout(180000);

type Person = { id: string; role: string; code: string };

/**
 * The Aadhaar Secure QR endpoints end to end (guide, 14 Nov), with UIDAI's own
 * sample QR (signed with UIDAI's committed certificate; the person on it is
 * "Sumit Kumar", born 01-01-1984). Nothing is mocked but the OTP provider.
 */
describe('Aadhaar Secure QR — link, Laboura Field, Team Lead check', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let jwt: JwtService;
  const stamp = `${Date.now()}`.slice(-8);
  const staffIds: string[] = [];
  const seekerIds: string[] = [];
  let ceo: Person;
  let lead: Person;
  let otherLead: Person;
  let fielder: Person;
  let otherFielder: Person;
  let caller: Person;
  let manager: Person;
  let otherManager: Person;
  /** A real JPEG the size the capture canvas makes: a live camera photo of an ID card. */
  const CARD_PHOTO = (() => {
    const width = 640;
    const height = 400;
    const data = Buffer.alloc(width * height * 4, 0x90);
    return Buffer.from(encodeJpeg({ data, width, height }, 80).data);
  })();
  /**
   * Sends another ID as the page does: first the camera's one-time token (POST …/capture-nonce),
   * then the photo with it. nonce: a token to use instead (null sends none).
   */
  const otherId = async (path: string, fields: Record<string, string>, photo: Buffer | null = CARD_PHOTO, auth?: Person, nonce?: string | null) => {
    let captureNonce = nonce;
    if (captureNonce === undefined) {
      let ask = request(app.getHttpServer()).post(`${path}/capture-nonce`);
      if (auth) ask = ask.set('Authorization', `Bearer ${token(auth)}`);
      const issued = await ask.send(fields.requestId ? { requestId: fields.requestId } : {});
      captureNonce = (issued.body as { captureNonce?: string })?.captureNonce ?? null;
    }
    let req = request(app.getHttpServer()).post(path);
    if (auth) req = req.set('Authorization', `Bearer ${token(auth)}`);
    for (const [k, v] of Object.entries(fields)) req = req.field(k, v);
    if (captureNonce) req = req.field('captureNonce', captureNonce);
    return photo ? req.attach('photo', photo, { filename: 'card.jpg', contentType: 'image/jpeg' }) : req;
  };
  /** The decider opens the photos (GET …/aadhaar-check), as T-Verify's "Show photos" does. */
  const openPhotos = (p: Person, id: string, subjects = 'job-seekers') => get(p, `/identity/${subjects}/${id}/aadhaar-check`).expect(200);

  const token = (p: Person) => jwt.sign({ sub: p.id, email: `${p.id}@laboura.local`, role: p.role, code: p.code });
  const get = (p: Person, path: string) => request(app.getHttpServer()).get(path).set('Authorization', `Bearer ${token(p)}`);
  const post = (p: Person, path: string, body: Record<string, unknown> = {}) =>
    request(app.getHttpServer()).post(path).set('Authorization', `Bearer ${token(p)}`).send(body);

  async function make(role: string, prefix: string, reportsToId?: string, city = 'Bengaluru'): Promise<Person> {
    const agent = role === 'call_agent' || role === 'field_agent';
    const row = await prisma.staff.create({
      data: {
        code: `${prefix}-QR-${stamp}-${staffIds.length}`,
        name: `${prefix} Person`,
        email: `${prefix.toLowerCase()}.qr.${staffIds.length}.${stamp}@laboura.local`,
        passwordHash: 'hash',
        role,
        city,
        status: 'active',
        teamLeadId: agent ? (reportsToId ?? null) : null,
        reportsToId: reportsToId ?? null,
      },
    });
    staffIds.push(row.id);
    return row;
  }

  async function seeker(n: number, name = 'Sumit Kumar', registeredByStaffId?: string | null, city = 'Bengaluru') {
    const phone = `+919${stamp.slice(-7)}${String(n).padStart(2, '0')}`;
    const row = await prisma.jobSeeker.create({
      data: {
        code: `JS-QR-${stamp}-${n}`,
        name,
        phone,
        phoneVerified: true,
        minSalary: 1500000,
        maxSalary: 2500000,
        preferredCallWindowStart: '09:00',
        preferredCallWindowEnd: '18:00',
        status: 'consented',
        city,
        registeredByStaffId: registeredByStaffId === undefined ? fielder.id : registeredByStaffId,
        photoStoragePath: `job-seekers/qr-${stamp}-${n}/profile-photo`,
        photoTakenAt: new Date(),
      },
    });
    seekerIds.push(row.id);
    await app.get(ConsentService).grant({
      subjectType: 'job_seeker',
      subjectId: row.id,
      purpose: 'aadhaar_verification',
      noticeVersion: '1.0',
      language: 'en',
      method: 'sms_link',
    });
    return row;
  }

  async function registrationLink(s: { id: string; phone: string }) {
    const link = await app.get(PublicLinkStoreService).create({
      purpose: 'registration',
      subjectType: 'job_seeker',
      subjectId: s.id,
      phone: s.phone,
      language: 'en',
      expiresAt: new Date(Date.now() + 48 * 3600 * 1000),
    });
    return { token: link.token, requestId: await verifiedOtpFor(app, s.phone) };
  }

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);
    jwt = app.get(JwtService);
    ceo = await make('ceo', 'CEO');
    manager = await make('manager', 'MGR', ceo.id);
    otherManager = await make('manager', 'MGR2', ceo.id);
    lead = await make('team_lead', 'TL', manager.id);
    otherLead = await make('team_lead', 'TL2', manager.id);
    fielder = await make('field_agent', 'FA', lead.id);
    otherFielder = await make('field_agent', 'FA2', lead.id);
    caller = await make('call_agent', 'CA', lead.id);
  });

  afterAll(async () => {
    const verifications = await prisma.identityVerification.findMany({ where: { jobSeekerId: { in: seekerIds } }, select: { id: true } });
    await prisma.idCheckDetail.deleteMany({ where: { subjectId: { in: seekerIds } } });
    await prisma.aadhaarQrAttempt.deleteMany({ where: { subjectId: { in: seekerIds } } });
    await prisma.idCaptureNonce.deleteMany({ where: { subjectId: { in: seekerIds } } });
    await prisma.reviewFlag.deleteMany({ where: { subjectId: { in: seekerIds } } });
    await prisma.teamLeadCheck.deleteMany({ where: { subjectId: { in: seekerIds } } });
    const seekers = await prisma.jobSeeker.findMany({ where: { id: { in: seekerIds } }, select: { code: true } });
    await prisma.auditLog.deleteMany({ where: { entityCode: { in: [...verifications.map((v) => v.id), ...seekers.map((x) => x.code)] } } });
    await prisma.identityVerification.deleteMany({ where: { jobSeekerId: { in: seekerIds } } });
    await prisma.consent.deleteMany({ where: { subjectId: { in: seekerIds } } });
    await prisma.publicLink.deleteMany({ where: { subjectId: { in: seekerIds } } });
    await prisma.jobSeeker.deleteMany({ where: { id: { in: seekerIds } } });
    await prisma.staff.deleteMany({ where: { id: { in: staffIds } } });
    await app.close();
  });

  it("his link: the QR text only, checked against UIDAI's key; the answer is the result, never the raw data", async () => {
    const s = await seeker(1);
    const { token: linkToken, requestId } = await registrationLink(s);

    // Without his verified code nothing happens.
    expect((await request(app.getHttpServer()).post(`/registration/${linkToken}/aadhaar-qr`).send({ qrText: UIDAI_SAMPLE_SECURE_QR })).status).toBe(400);
    // Aadhaar can't go through the other-ID route.
    expect((await otherId(`/registration/${linkToken}/other-id`, { requestId, idType: 'aadhaar_qr', idNumber: 'ABCDE1234F', captureSource: 'live_camera' })).status).toBe(400);
    // The old route for an outside ID company is gone.
    expect((await request(app.getHttpServer()).post(`/registration/${linkToken}/id-check`).send({ requestId, method: 'pan' })).status).toBe(404);
    expect((await request(app.getHttpServer()).post(`/registration/${linkToken}/id-check-wait`).send({ requestId })).status).toBe(404);

    const res = await request(app.getHttpServer()).post(`/registration/${linkToken}/aadhaar-qr`).send({ requestId, qrText: UIDAI_SAMPLE_SECURE_QR }).expect(201);
    expect(res.body).toMatchObject({
      method: 'aadhaar_qr',
      status: 'verified',
      result: 'verified',
      verifiedByUidai: true,
      nameMatches: true,
      isAdult: true,
      phoneLinked: 'not_linked',
      maskedReference: 'XXXX-XXXX-2697',
      person: { name: 'Sumit Kumar', dateOfBirth: '1984-01-01', gender: 'M' },
    });
    const body = JSON.stringify(res.body);
    for (const never of ['Radhey Shyam', 'B-31', 'Ishwar Chand', 'Krishna Nagar', '110051', UIDAI_SAMPLE_SECURE_QR.slice(0, 40)]) expect(body).not.toContain(never);

    const row = await prisma.identityVerification.findFirstOrThrow({ where: { jobSeekerId: s.id } });
    expect(row).toMatchObject({ method: 'aadhaar_qr', vendor: 'uidai_secure_qr', vendorReference: '269720190308114407437', status: 'verified', last4: '2697', phoneLinked: 'not_linked' });
    expect(row.consentId).toBeTruthy();
    const detail = await prisma.idCheckDetail.findUniqueOrThrow({ where: { verificationId: row.id } });
    expect(detail).toMatchObject({ nameOnId: 'Sumit Kumar', dateOfBirth: '1984-01-01', gender: 'M', area: 'Krishna Nagar', pincode: '110051' });
    expect(detail.photoPath).toBe(`aadhaar-qr/job_seeker/${s.id}/${row.id}.jpg`);
    // Not linked is a flag for the Team Lead, not a block: the step is done.
    expect(await prisma.reviewFlag.count({ where: { kind: 'aadhaar_phone_not_linked', subjectId: s.id } })).toBe(1);
    const journey = await request(app.getHttpServer()).get(`/registration/${linkToken}/status`).query({ requestId }).expect(200);
    expect(journey.body.steps.idCheck).toBe(true);
    // No audit entry carries the QR's text or the address.
    const audits = JSON.stringify(await prisma.auditLog.findMany({ where: { entityCode: { in: [s.code, row.id] } } }));
    for (const never of ['Radhey Shyam', 'B-31', UIDAI_SAMPLE_SECURE_QR.slice(0, 40)]) expect(audits).not.toContain(never);
  });

  it('an old unsigned QR and a name that does not match are told apart, and both offer another ID', async () => {
    const s = await seeker(2, 'Ravi Shankar');
    const { token: linkToken, requestId } = await registrationLink(s);
    const old = await request(app.getHttpServer()).post(`/registration/${linkToken}/aadhaar-qr`).send({ requestId, qrText: '<?xml version="1.0"?><PrintLetterBarcodeData name="X"/>' }).expect(201);
    expect(old.body).toMatchObject({ status: 'failed', result: 'old_qr', offerOtherId: true });
    const mismatch = await request(app.getHttpServer()).post(`/registration/${linkToken}/aadhaar-qr`).send({ requestId, qrText: UIDAI_SAMPLE_SECURE_QR }).expect(201);
    expect(mismatch.body).toMatchObject({ status: 'failed', result: 'name_mismatch', nameMatches: false, offerOtherId: true });
    expect(await prisma.reviewFlag.count({ where: { kind: 'name_check', subjectId: s.id } })).toBe(1);
  });

  it('another ID: a live photo of the card and the number; pending (no terms, no payment) until the Team Lead approves', async () => {
    const s = await seeker(5, 'Ravi Shankar');
    // Every required consent, so the terms step is held back only by the pending ID.
    for (const purpose of ['job_matching', 'profile_sharing', 'call_recording', 'job_updates']) {
      await app.get(ConsentService).grant({ subjectType: 'job_seeker', subjectId: s.id, purpose, noticeVersion: '1.1', language: 'en', method: 'sms_link' });
    }
    const { token: linkToken, requestId } = await registrationLink(s);
    const path = `/registration/${linkToken}/other-id`;
    // Adversarial: gallery, no photo, a non-image, a wrong number.
    expect((await otherId(path, { requestId, idType: 'pan', idNumber: 'ABCDE1234F', captureSource: 'gallery' })).status).toBe(400);
    expect((await otherId(path, { requestId, idType: 'pan', idNumber: 'ABCDE1234F', captureSource: 'live_camera' }, null)).status).toBe(400);
    expect((await otherId(path, { requestId, idType: 'pan', idNumber: 'ABCDE1234F', captureSource: 'live_camera' }, Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'))).status).toBe(400);
    expect((await otherId(path, { requestId, idType: 'pan', idNumber: '12345', captureSource: 'live_camera' })).status).toBe(400);
    expect((await otherId(path, { idType: 'pan', idNumber: 'ABCDE1234F', captureSource: 'live_camera' })).status).toBe(400);

    // M-1: no camera token, or one already used, is refused.
    expect((await otherId(path, { requestId, idType: 'pan', idNumber: 'ABCDE1234F', captureSource: 'live_camera' }, CARD_PHOTO, undefined, null)).status).toBe(400);
    const sent = await otherId(path, { requestId, idType: 'pan', idNumber: 'ABCDE1234F', captureSource: 'live_camera' });
    expect(sent.status).toBe(201);
    expect(sent.body).toMatchObject({ method: 'pan', status: 'pending', idNumberLast4: '234F' });
    const row = await prisma.identityVerification.findFirstOrThrow({ where: { jobSeekerId: s.id, method: 'pan' } });
    expect(row).toMatchObject({ vendor: 'team_lead_check', status: 'pending', last4: '234F', vendorReference: null });
    const detail = await prisma.idCheckDetail.findUniqueOrThrow({ where: { verificationId: row.id } });
    expect(detail).toMatchObject({ kind: 'id_card_photo', nameOnId: null, dateOfBirth: null });
    expect(detail.photoPath).toBe(`id-card/job_seeker/${s.id}/${row.id}.jpg`);

    const journey = await request(app.getHttpServer()).get(`/registration/${linkToken}/status`).query({ requestId }).expect(200);
    expect(journey.body).toMatchObject({ steps: { idCheck: false }, idCheck: { waitingForTeamLead: true, lastResult: 'pending' } });
    const terms = await request(app.getHttpServer()).get(`/registration/${linkToken}/terms`).query({ requestId });
    expect(terms.status).toBe(400);
    expect(terms.body.message).toMatch(/Team Lead/);
    expect((await post(caller, `/job-seekers/${s.id}/activation-payment`)).status).toBe(400);

    // T-Verify: the card photo next to the selfie, the type and the last 4, pending first.
    const list = await get(lead, '/team-lead/registrations').expect(200);
    const tv = (list.body.rows as Array<{ person: { id: string }; idCheck: Record<string, unknown> }>)[0];
    expect(tv.person.id).toBe(s.id);
    expect(tv.idCheck).toMatchObject({ method: 'pan', status: 'pending', waitingForTeamLead: true, idNumberLast4: '234F', idPhotoKept: true, verifiedByUidai: false });
    // M-2: approving a card nobody opened is refused.
    expect((await post(lead, `/team-lead/registrations/${s.id}/check`, { verdict: 'ok' })).status).toBe(400);
    const view = await get(lead, `/identity/job-seekers/${s.id}/aadhaar-check`).expect(200);
    expect(view.body.check).toMatchObject({ method: 'pan', idNumberLast4: '234F', photo: { kind: 'id_card_photo', kept: true } });
    expect(view.body.decision).toMatchObject({ canDecide: true, mode: 'own_team' });
    expect(view.body.idPhotoUrl).toEqual(expect.any(String));
    expect(await prisma.auditLog.count({ where: { action: 'identity.id_check_viewed', entityCode: s.code, actorId: lead.id } })).toBe(1);

    const approved = await post(lead, `/team-lead/registrations/${s.id}/check`, { verdict: 'ok' }).expect(200);
    expect(approved.body).toMatchObject({ otherIdDecided: 'verified', idPhotoDeleted: true });
    expect(await prisma.identityVerification.findUniqueOrThrow({ where: { id: row.id } })).toMatchObject({ status: 'verified', nameMatches: true, isAdult: true });
    expect(await prisma.idCheckDetail.findUniqueOrThrow({ where: { verificationId: row.id } })).toMatchObject({ photoPath: null, photoDeletedReason: 'team_lead_approved' });
    const after = await request(app.getHttpServer()).get(`/registration/${linkToken}/status`).query({ requestId }).expect(200);
    expect(after.body.steps.idCheck).toBe(true);
  });

  it('"Fake · flag it" rejects a pending other ID and deletes the card photo', async () => {
    const s = await seeker(6, 'Ravi Shankar');
    const { token: linkToken, requestId } = await registrationLink(s);
    expect((await otherId(`/registration/${linkToken}/other-id`, { requestId, idType: 'voter_id', idNumber: 'ABC1234567', captureSource: 'live_camera' })).status).toBe(201);
    const res = await post(lead, `/team-lead/registrations/${s.id}/check`, { verdict: 'fake', note: 'The card photo is a printout' }).expect(200);
    expect(res.body).toMatchObject({ otherIdDecided: 'failed', idPhotoDeleted: true });
    const row = await prisma.identityVerification.findFirstOrThrow({ where: { jobSeekerId: s.id, method: 'voter_id' } });
    expect(row.status).toBe('failed');
  });

  it('Laboura Field: the field agent who registered him only, live camera only, and no card data in the answer', async () => {
    const s = await seeker(3);
    expect((await post(caller, `/field-work/job-seekers/${s.id}/aadhaar-qr`, { qrText: UIDAI_SAMPLE_SECURE_QR, captureSource: 'live_camera' })).status).toBe(403);
    // Another field agent (same team) can't scan or photograph an ID for someone he didn't register.
    expect((await post(otherFielder, `/field-work/job-seekers/${s.id}/aadhaar-qr`, { qrText: UIDAI_SAMPLE_SECURE_QR, captureSource: 'live_camera' })).status).toBe(404);
    expect((await otherId(`/field-work/job-seekers/${s.id}/other-id`, { idType: 'pan', idNumber: 'ABCDE1234F', captureSource: 'live_camera' }, CARD_PHOTO, otherFielder)).status).toBe(404);
    expect(await prisma.aadhaarQrAttempt.count({ where: { subjectId: s.id } })).toBe(0);
    expect((await post(fielder, `/field-work/job-seekers/${s.id}/aadhaar-qr`, { qrText: UIDAI_SAMPLE_SECURE_QR, captureSource: 'gallery' })).status).toBe(400);
    const res = await post(fielder, `/field-work/job-seekers/${s.id}/aadhaar-qr`, { qrText: UIDAI_SAMPLE_SECURE_QR, captureSource: 'live_camera' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ result: 'verified', maskedReference: 'XXXX-XXXX-2697', person: null });
    const attempt = await prisma.aadhaarQrAttempt.findFirstOrThrow({ where: { subjectId: s.id } });
    expect(attempt).toMatchObject({ channel: 'field', staffId: fielder.id, outcome: 'verified' });
  });

  it("the Team Lead sees the QR photo next to the selfie (agents never), and it is deleted when the check is done", async () => {
    const s = await seeker(4);
    await post(fielder, `/field-work/job-seekers/${s.id}/aadhaar-qr`, { qrText: UIDAI_SAMPLE_SECURE_QR, captureSource: 'live_camera' }).expect(200);

    expect((await get(caller, `/identity/job-seekers/${s.id}/aadhaar-check`)).status).toBe(403);
    expect((await get(fielder, `/identity/job-seekers/${s.id}/aadhaar-check`)).status).toBe(403);
    expect((await get(otherLead, `/identity/job-seekers/${s.id}/aadhaar-check`)).status).toBe(404);
    expect((await get(otherManager, `/identity/job-seekers/${s.id}/aadhaar-check`)).status).toBe(404);
    expect((await get(manager, `/identity/job-seekers/${s.id}/aadhaar-check`)).status).toBe(200);
    const view = await get(lead, `/identity/job-seekers/${s.id}/aadhaar-check`).expect(200);
    expect(view.body.check).toMatchObject({ method: 'aadhaar_qr', verifiedByUidai: true, maskedReference: 'XXXX-XXXX-2697', nameMatches: true, phoneLinked: 'not_linked', photo: { kept: true } });
    expect(view.body.qrPhotoUrl).toEqual(expect.any(String));
    expect(view.body.selfieUrl).toEqual(expect.any(String));
    expect((await get(ceo, `/identity/job-seekers/${s.id}/aadhaar-check`)).status).toBe(200);

    const list = await get(lead, '/team-lead/registrations').expect(200);
    const row = (list.body.rows as Array<{ person: { id: string }; idCheck: Record<string, unknown> }>).find((r) => r.person.id === s.id);
    expect(row?.idCheck).toMatchObject({ verifiedByUidai: true, maskedReference: 'XXXX-XXXX-2697', phoneLinked: 'not_linked', qrPhotoKept: true });

    const done = await post(lead, `/team-lead/registrations/${s.id}/check`, { verdict: 'ok' }).expect(200);
    expect(done.body.qrPhotoDeleted).toBe(true);
    // L-8: one general check per person — a second tap records nothing.
    const again = await post(lead, `/team-lead/registrations/${s.id}/check`, { verdict: 'fake', note: 'Second tap' });
    expect(again.status).toBe(409);
    expect(await prisma.teamLeadCheck.count({ where: { subjectId: s.id } })).toBe(1);
    const after = await get(lead, `/identity/job-seekers/${s.id}/aadhaar-check`).expect(200);
    expect(after.body.check.photo).toMatchObject({ kept: false, deletedReason: 'team_lead_approved' });
    expect(after.body.qrPhotoUrl).toBeNull();
    const verification = await prisma.identityVerification.findFirstOrThrow({ where: { jobSeekerId: s.id } });
    expect(await prisma.auditLog.count({ where: { action: 'identity.id_photo_deleted', entityCode: verification.id, actorId: lead.id } })).toBe(1);
    // Every view is audited, with or without a photo.
    expect(await prisma.auditLog.count({ where: { action: 'identity.id_check_viewed', entityCode: s.code } })).toBeGreaterThanOrEqual(4);
  });

  it('staff cannot record or mark an ID check, and the list is trimmed and scoped', async () => {
    const s = await seeker(7);
    for (const who of [caller, fielder, lead, manager, ceo]) {
      expect((await post(who, `/job-seekers/${s.id}/identity-verification`, { method: 'pan', status: 'verified' })).status).toBe(404);
      expect((await post(who, `/job-seekers/${s.id}/identity-verification/provider`, { method: 'pan' })).status).toBe(404);
    }
    expect(await prisma.identityVerification.count({ where: { jobSeekerId: s.id } })).toBe(0);
    await post(fielder, `/field-work/job-seekers/${s.id}/aadhaar-qr`, { qrText: UIDAI_SAMPLE_SECURE_QR, captureSource: 'live_camera' }).expect(200);
    expect((await get(caller, `/job-seekers/${s.id}/identity-verifications`)).status).toBe(403);
    expect((await get(otherManager, `/job-seekers/${s.id}/identity-verifications`)).status).toBe(404);
    const list = await get(lead, `/job-seekers/${s.id}/identity-verifications`).expect(200);
    expect(list.body[0]).toMatchObject({ method: 'aadhaar_qr', status: 'verified', verifiedByUidai: true, maskedReference: 'XXXX-XXXX-2697', under18Stop: false });
    expect(list.body[0]).not.toHaveProperty('vendorReference');
    expect(list.body[0]).not.toHaveProperty('consentId');
    expect(list.body[0]).not.toHaveProperty('last4');
  });

  it('a signed under-18 result is sticky until a Manager or the CEO lifts it with a reason', async () => {
    const s = await seeker(8, 'Ravi Shankar');
    // As a signed QR showing under 18 leaves it (the UIDAI sample is an adult, so the row is written here).
    await prisma.identityVerification.create({
      data: { jobSeekerId: s.id, method: 'aadhaar_qr', vendor: 'uidai_secure_qr', vendorReference: '269720190308114407437', status: 'failed', last4: '2697', nameMatches: true, isAdult: false, failureReason: 'Applicant is under 18' },
    });
    const { token: linkToken, requestId } = await registrationLink(s);
    const refused = await otherId(`/registration/${linkToken}/other-id`, { requestId, idType: 'pan', idNumber: 'ABCDE1234F', captureSource: 'live_camera' });
    expect(refused.status).toBe(400);
    expect(refused.body.message).toMatch(/under 18/);
    expect((await request(app.getHttpServer()).post(`/registration/${linkToken}/aadhaar-qr`).send({ requestId, qrText: UIDAI_SAMPLE_SECURE_QR })).status).toBe(400);
    expect((await post(fielder, `/field-work/job-seekers/${s.id}/aadhaar-qr`, { qrText: UIDAI_SAMPLE_SECURE_QR, captureSource: 'live_camera' })).status).toBe(400);
    expect((await post(caller, `/job-seekers/${s.id}/activation-payment`)).status).toBe(400);
    expect((await request(app.getHttpServer()).get(`/registration/${linkToken}/terms`).query({ requestId })).status).toBe(400);
    const journey = await request(app.getHttpServer()).get(`/registration/${linkToken}/status`).query({ requestId }).expect(200);
    expect(journey.body).toMatchObject({ stopped: 'under_18', idCheck: { lastResult: 'under_18' } });
    const view = await get(manager, `/identity/job-seekers/${s.id}/aadhaar-check`).expect(200);
    expect(view.body.check.under18Stop).toBe(true);

    expect((await post(lead, `/identity/job-seekers/${s.id}/under-18/lift`, { reason: 'Birth certificate shows 19' })).status).toBe(403);
    expect((await post(otherManager, `/identity/job-seekers/${s.id}/under-18/lift`, { reason: 'Birth certificate shows 19' })).status).toBe(404);
    expect((await post(manager, `/identity/job-seekers/${s.id}/under-18/lift`, {})).status).toBe(400);
    const lifted = await post(manager, `/identity/job-seekers/${s.id}/under-18/lift`, { reason: 'Birth certificate shows 19' }).expect(200);
    expect(lifted.body).toEqual({ lifted: 1 });
    expect(await prisma.auditLog.count({ where: { action: 'identity.under18_stop_lifted', entityCode: s.code, actorId: manager.id } })).toBe(1);
    const again = await otherId(`/registration/${linkToken}/other-id`, { requestId, idType: 'pan', idNumber: 'ABCDE1234F', captureSource: 'live_camera' });
    expect(again.status).toBe(201);
  });

  it('erasure: ID details go only once the photo is confirmed deleted; the ID number parts are wiped either way', async () => {
    const storage = app.get<CandidatePhotoStorage>(CANDIDATE_PHOTO_STORAGE);
    // The photo delete fails: personal fields wiped now, the row kept for the daily run (expiry = now).
    const failing = await seeker(9);
    await post(fielder, `/field-work/job-seekers/${failing.id}/aadhaar-qr`, { qrText: UIDAI_SAMPLE_SECURE_QR, captureSource: 'live_camera' }).expect(200);
    const spy = jest.spyOn(storage, 'delete').mockRejectedValue(new Error('Candidate photo delete failed with status 500'));
    try {
      await app.get(AnonymisationService).anonymise('job_seeker', failing.id, 'DPDP erasure request', ceo.id);
    } finally {
      spy.mockRestore();
    }
    const kept = await prisma.idCheckDetail.findFirstOrThrow({ where: { subjectId: failing.id } });
    expect(kept).toMatchObject({ nameOnId: null, dateOfBirth: null, gender: null, area: null, pincode: null });
    expect(kept.photoPath).toBeTruthy();
    expect(kept.photoExpiresAt!.getTime()).toBeLessThanOrEqual(Date.now());
    expect(await prisma.identityVerification.findFirstOrThrow({ where: { jobSeekerId: failing.id } })).toMatchObject({ last4: null, vendorReference: null });

    // The photo delete works: the detail row goes.
    const working = await seeker(10);
    await post(fielder, `/field-work/job-seekers/${working.id}/aadhaar-qr`, { qrText: UIDAI_SAMPLE_SECURE_QR, captureSource: 'live_camera' }).expect(200);
    await app.get(AnonymisationService).anonymise('job_seeker', working.id, 'DPDP erasure request', ceo.id);
    expect(await prisma.idCheckDetail.count({ where: { subjectId: working.id } })).toBe(0);
    expect(await prisma.identityVerification.findFirstOrThrow({ where: { jobSeekerId: working.id } })).toMatchObject({ last4: null, vendorReference: null, status: 'verified' });
  });

  describe('rev 169: nobody approves the other ID of a person they registered', () => {
    type Row = { person: { id: string }; approval: { canDecide: boolean; needsAnotherTeamLead: boolean; fromAnotherTeam: boolean; reason: string | null } };
    async function pending(n: number, registeredBy: string | null, city = 'Bengaluru') {
      const s = await seeker(n, 'Ravi Shankar', registeredBy, city);
      const { token: linkToken, requestId } = await registrationLink(s);
      expect((await otherId(`/registration/${linkToken}/other-id`, { requestId, idType: 'pan', idNumber: 'ABCDE1234F', captureSource: 'live_camera' })).status).toBe(201);
      return s;
    }

    it('a Team Lead\'s own registration: refused for him (marked on his T-Verify), decided by another Team Lead of the city', async () => {
      const s = await pending(20, lead.id);
      const mine = await get(lead, '/team-lead/registrations').expect(200);
      expect((mine.body.rows as Row[]).find((r) => r.person.id === s.id)?.approval).toMatchObject({ canDecide: false, needsAnotherTeamLead: true, fromAnotherTeam: false });
      await openPhotos(lead, s.id);
      for (const verdict of ['ok', 'fake']) {
        const refused = await post(lead, `/team-lead/registrations/${s.id}/check`, { verdict, note: 'x' });
        expect(refused.status).toBe(403);
        expect(refused.body.message).toMatch(/another Team Lead/);
      }
      expect(await prisma.teamLeadCheck.count({ where: { subjectId: s.id } })).toBe(0);

      const theirs = await get(otherLead, '/team-lead/registrations').expect(200);
      expect((theirs.body.rows as Row[]).find((r) => r.person.id === s.id)?.approval).toMatchObject({ canDecide: true, needsAnotherTeamLead: true, fromAnotherTeam: true });
      // The selfie link and the ID check open for him too (audited); the approval needs that first.
      expect((await post(otherLead, `/team-lead/registrations/${s.id}/check`, { verdict: 'ok' })).status).toBe(400);
      const view = await openPhotos(otherLead, s.id);
      expect(view.body.decision).toMatchObject({ canDecide: true, mode: 'another_team_lead' });
      expect((await get(otherLead, `/team-lead/registrations/${s.id}/selfie`)).status).toBe(200);
      // A Manager is not the fallback while another Team Lead can decide.
      await openPhotos(manager, s.id);
      expect((await post(manager, `/identity/job-seekers/${s.id}/other-id/decision`, { verdict: 'ok' })).status).toBe(403);
      const ok = await post(otherLead, `/team-lead/registrations/${s.id}/check`, { verdict: 'ok' }).expect(200);
      expect(ok.body).toMatchObject({ otherIdDecided: 'verified', idPhotoDeleted: true });
      // A second decision finds nothing pending to approve.
      expect((await prisma.identityVerification.findFirstOrThrow({ where: { jobSeekerId: s.id, method: 'pan' } })).status).toBe('verified');
    });

    it('no Team Lead\'s team (registered by a Manager or by nobody): any other Team Lead of the city, never the registrar', async () => {
      const byManager = await pending(21, manager.id);
      await openPhotos(manager, byManager.id);
      expect((await post(manager, `/identity/job-seekers/${byManager.id}/other-id/decision`, { verdict: 'ok' })).status).toBe(403);
      await openPhotos(lead, byManager.id);
      expect((await post(lead, `/team-lead/registrations/${byManager.id}/check`, { verdict: 'ok' })).status).toBe(200);

      const byNobody = await pending(22, null);
      await openPhotos(otherLead, byNobody.id);
      expect((await post(otherLead, `/team-lead/registrations/${byNobody.id}/check`, { verdict: 'fake', note: 'Not the person on the selfie' })).status).toBe(200);
      expect((await prisma.identityVerification.findFirstOrThrow({ where: { jobSeekerId: byNobody.id, method: 'pan' } })).status).toBe('failed');
    });

    it('no other active Team Lead in the city: a Manager of that city or the CEO decides, through the waiting list', async () => {
      const city = `Testpur${stamp}`;
      const cityManager = await make('manager', 'MGRT', ceo.id, city);
      const cityLead = await make('team_lead', 'TLT', cityManager.id, city);
      const s = await pending(23, cityLead.id, city);
      expect(await prisma.reviewFlag.count({ where: { kind: 'other_id_needs_manager', subjectId: s.id, status: 'open' } })).toBe(1);
      await openPhotos(cityLead, s.id);
      expect((await post(cityLead, `/team-lead/registrations/${s.id}/check`, { verdict: 'ok' })).status).toBe(403);
      // Another city's Team Lead never sees or decides it.
      expect(((await get(otherLead, '/team-lead/registrations').expect(200)).body.rows as Row[]).some((r) => r.person.id === s.id)).toBe(false);
      expect((await post(otherLead, `/team-lead/registrations/${s.id}/check`, { verdict: 'ok' })).status).toBe(404);

      const waiting = (p: Person) => get(p, '/identity/other-id/waiting').expect(200).then((r) => (r.body.rows as Array<{ person: { id: string } }>).map((row) => row.person.id));
      expect(await waiting(cityManager)).toContain(s.id);
      expect(await waiting(ceo)).toContain(s.id);
      expect(await waiting(manager)).not.toContain(s.id);
      expect((await get(lead, '/identity/other-id/waiting')).status).toBe(403);
      expect((await post(cityManager, `/identity/job-seekers/${s.id}/other-id/decision`, { verdict: 'ok' })).status).toBe(400);
      await openPhotos(cityManager, s.id);
      expect((await post(manager, `/identity/job-seekers/${s.id}/other-id/decision`, { verdict: 'ok' })).status).toBe(403);
      const ok = await post(cityManager, `/identity/job-seekers/${s.id}/other-id/decision`, { verdict: 'ok' }).expect(200);
      expect(ok.body).toMatchObject({ verdict: 'ok', otherIdDecided: 'verified' });
      expect(await prisma.reviewFlag.count({ where: { kind: 'other_id_needs_manager', subjectId: s.id, status: 'resolved' } })).toBe(1);
      expect(await waiting(ceo)).not.toContain(s.id);
    });

    it('the general registration check: a Team Lead\'s registration is checked by another Team Lead of the city, never by him', async () => {
      // A city of its own, so registrations from other test files don't crowd the list.
      const city = `Twopur${stamp}`;
      const cityManager = await make('manager', 'MGRW', ceo.id, city);
      const leadA = await make('team_lead', 'TLWA', cityManager.id, city);
      const leadB = await make('team_lead', 'TLWB', cityManager.id, city);
      const s = await seeker(25, 'Ravi Shankar', leadA.id, city);
      const mine = await get(leadA, '/team-lead/registrations').expect(200);
      expect((mine.body.rows as Row[]).some((r) => r.person.id === s.id)).toBe(false);
      const refused = await post(leadA, `/team-lead/registrations/${s.id}/check`, { verdict: 'ok' });
      expect(refused.status).toBe(403);
      expect(refused.body.message).toMatch(/can't check this registration yourself/);
      const theirs = await get(leadB, '/team-lead/registrations').expect(200);
      expect((theirs.body.rows as Row[]).find((r) => r.person.id === s.id)?.approval).toMatchObject({ canDecide: true, needsAnotherTeamLead: true, fromAnotherTeam: true });
      // A Team Lead of another city never sees or checks it.
      expect(((await get(otherLead, '/team-lead/registrations').expect(200)).body.rows as Row[]).some((r) => r.person.id === s.id)).toBe(false);
      expect((await post(otherLead, `/team-lead/registrations/${s.id}/check`, { verdict: 'ok' })).status).toBe(404);
      // He can open it (audited) and check it.
      expect((await get(leadB, `/identity/job-seekers/${s.id}/aadhaar-check`)).status).toBe(200);
      const ok = await post(leadB, `/team-lead/registrations/${s.id}/check`, { verdict: 'ok' }).expect(200);
      expect(ok.body.verdict).toBe('ok');
      expect(await prisma.teamLeadCheck.count({ where: { subjectId: s.id, checkedByStaffId: leadB.id } })).toBe(1);
      expect(((await get(leadB, '/team-lead/registrations').expect(200)).body.rows as Row[]).some((r) => r.person.id === s.id)).toBe(false);
      // A Manager is not the fallback while another Team Lead can check it.
      expect((await post(cityManager, `/identity/job-seekers/${s.id}/registration-check`, { verdict: 'ok' })).status).toBe(403);
      // M-B: the right to open another team's registration lasts only while it waits — once checked, he is refused.
      expect((await get(leadB, `/identity/job-seekers/${s.id}/aadhaar-check`)).status).toBe(404);
      expect((await get(leadB, `/team-lead/registrations/${s.id}/selfie`)).status).toBe(404);
      expect((await post(leadB, `/team-lead/registrations/${s.id}/check`, { verdict: 'ok' })).status).toBe(404);
      // ...while leadA's own Team Lead line (the Manager over the team) still sees it.
      expect((await get(cityManager, `/identity/job-seekers/${s.id}/aadhaar-check`)).status).toBe(200);
    });

    it('the general registration check: no other Team Lead in the city, so a Manager of that city or the CEO checks it from the waiting list', async () => {
      const city = `Checkpur${stamp}`;
      const cityManager = await make('manager', 'MGRC', ceo.id, city);
      const cityLead = await make('team_lead', 'TLC', cityManager.id, city);
      const s = await seeker(26, 'Ravi Shankar', cityLead.id, city);
      expect((await post(cityLead, `/team-lead/registrations/${s.id}/check`, { verdict: 'ok' })).status).toBe(403);
      const rows = async (p: Person) => (await get(p, '/identity/other-id/waiting').expect(200)).body.rows as Array<{ kind: string; person: { id: string } }>;
      expect((await rows(cityManager)).find((r) => r.person.id === s.id)).toMatchObject({ kind: 'registration' });
      expect((await rows(ceo)).some((r) => r.person.id === s.id)).toBe(true);
      expect((await rows(manager)).some((r) => r.person.id === s.id)).toBe(false);
      expect((await post(manager, `/identity/job-seekers/${s.id}/registration-check`, { verdict: 'ok' })).status).toBe(403);
      expect((await post(cityLead, `/identity/job-seekers/${s.id}/registration-check`, { verdict: 'ok' })).status).toBe(403);
      expect((await post(cityManager, `/identity/job-seekers/${s.id}/registration-check`, { verdict: 'fake' })).status).toBe(400);
      const fake = await post(cityManager, `/identity/job-seekers/${s.id}/registration-check`, { verdict: 'fake', note: 'Not the person in the selfie' }).expect(200);
      expect(fake.body).toMatchObject({ verdict: 'fake', flagId: expect.any(String) });
      expect(await prisma.teamLeadCheck.count({ where: { subjectId: s.id, checkedByStaffId: cityManager.id, verdict: 'fake' } })).toBe(1);
      // L-8: one general check per person — the Manager again, or the CEO, records nothing more.
      expect((await post(cityManager, `/identity/job-seekers/${s.id}/registration-check`, { verdict: 'ok' })).status).toBe(409);
      expect((await post(ceo, `/identity/job-seekers/${s.id}/registration-check`, { verdict: 'ok' })).status).toBe(409);
      expect(await prisma.teamLeadCheck.count({ where: { subjectId: s.id } })).toBe(1);
      expect((await rows(cityManager)).some((r) => r.person.id === s.id)).toBe(false);
    });

    it('Laboura Field: the camera token belongs to the field agent who registered the person, and works once', async () => {
      const s = await seeker(24, 'Ravi Shankar');
      expect((await post(otherFielder, `/field-work/job-seekers/${s.id}/other-id/capture-nonce`)).status).toBe(404);
      const issued = await post(fielder, `/field-work/job-seekers/${s.id}/other-id/capture-nonce`).expect(200);
      expect(issued.body).toMatchObject({ captureNonce: expect.any(String), expiresInSeconds: 120 });
      const path = `/field-work/job-seekers/${s.id}/other-id`;
      const fields = { idType: 'pan', idNumber: 'ABCDE1234F', captureSource: 'live_camera' };
      expect((await otherId(path, fields, CARD_PHOTO, fielder, issued.body.captureNonce)).status).toBe(200);
      expect((await otherId(path, fields, CARD_PHOTO, fielder, issued.body.captureNonce)).status).toBe(400);
      expect(await prisma.idCaptureNonce.count({ where: { subjectId: s.id, usedAt: { not: null } } })).toBe(1);
    });
  });
});
