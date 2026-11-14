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
  let caller: Person;

  const token = (p: Person) => jwt.sign({ sub: p.id, email: `${p.id}@laboura.local`, role: p.role, code: p.code });
  const get = (p: Person, path: string) => request(app.getHttpServer()).get(path).set('Authorization', `Bearer ${token(p)}`);
  const post = (p: Person, path: string, body: Record<string, unknown> = {}) =>
    request(app.getHttpServer()).post(path).set('Authorization', `Bearer ${token(p)}`).send(body);

  async function make(role: string, prefix: string, reportsToId?: string): Promise<Person> {
    const agent = role === 'call_agent' || role === 'field_agent';
    const row = await prisma.staff.create({
      data: {
        code: `${prefix}-QR-${stamp}-${staffIds.length}`,
        name: `${prefix} Person`,
        email: `${prefix.toLowerCase()}.qr.${staffIds.length}.${stamp}@laboura.local`,
        passwordHash: 'hash',
        role,
        status: 'active',
        teamLeadId: agent ? (reportsToId ?? null) : null,
        reportsToId: reportsToId ?? null,
      },
    });
    staffIds.push(row.id);
    return row;
  }

  async function seeker(n: number, name = 'Sumit Kumar') {
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
        registeredByStaffId: fielder.id,
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
    const manager = await make('manager', 'MGR', ceo.id);
    lead = await make('team_lead', 'TL', manager.id);
    otherLead = await make('team_lead', 'TL2', manager.id);
    fielder = await make('field_agent', 'FA', lead.id);
    caller = await make('call_agent', 'CA', lead.id);
  });

  afterAll(async () => {
    const verifications = await prisma.identityVerification.findMany({ where: { jobSeekerId: { in: seekerIds } }, select: { id: true } });
    await prisma.aadhaarQrDetail.deleteMany({ where: { subjectId: { in: seekerIds } } });
    await prisma.aadhaarQrAttempt.deleteMany({ where: { subjectId: { in: seekerIds } } });
    await prisma.reviewFlag.deleteMany({ where: { subjectId: { in: seekerIds } } });
    await prisma.teamLeadCheck.deleteMany({ where: { subjectId: { in: seekerIds } } });
    await prisma.auditLog.deleteMany({ where: { entityCode: { in: verifications.map((v) => v.id) } } });
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
    expect((await request(app.getHttpServer()).post(`/registration/${linkToken}/id-check`).send({ requestId, method: 'aadhaar_qr' })).status).toBe(400);

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
    const detail = await prisma.aadhaarQrDetail.findUniqueOrThrow({ where: { verificationId: row.id } });
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
    const pan = await request(app.getHttpServer()).post(`/registration/${linkToken}/id-check`).send({ requestId, method: 'pan' }).expect(201);
    expect(pan.body).toMatchObject({ method: 'pan', status: 'verified' });
  });

  it('Laboura Field: field agents only, live camera only, and no card data in the answer', async () => {
    const s = await seeker(3);
    expect((await post(caller, `/field-work/job-seekers/${s.id}/aadhaar-qr`, { qrText: UIDAI_SAMPLE_SECURE_QR, captureSource: 'live_camera' })).status).toBe(403);
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
    const view = await get(lead, `/identity/job-seekers/${s.id}/aadhaar-check`).expect(200);
    expect(view.body.check).toMatchObject({ method: 'aadhaar_qr', verifiedByUidai: true, maskedReference: 'XXXX-XXXX-2697', nameMatches: true, phoneLinked: 'not_linked', photo: { kept: true } });
    expect(view.body.qrPhotoUrl).toEqual(expect.any(String));
    expect(view.body.selfieUrl).toEqual(expect.any(String));
    expect((await get(ceo, `/identity/job-seekers/${s.id}/aadhaar-check`)).status).toBe(200);

    const list = await get(lead, '/team-lead/registrations').expect(200);
    const row = (list.body.rows as Array<{ jobSeeker: { id: string }; idCheck: Record<string, unknown> }>).find((r) => r.jobSeeker.id === s.id);
    expect(row?.idCheck).toMatchObject({ verifiedByUidai: true, maskedReference: 'XXXX-XXXX-2697', phoneLinked: 'not_linked', qrPhotoKept: true });

    const done = await post(lead, `/team-lead/registrations/${s.id}/check`, { verdict: 'ok' }).expect(200);
    expect(done.body.qrPhotoDeleted).toBe(true);
    const after = await get(lead, `/identity/job-seekers/${s.id}/aadhaar-check`).expect(200);
    expect(after.body.check.photo).toMatchObject({ kept: false, deletedReason: 'team_lead_approved' });
    expect(after.body.qrPhotoUrl).toBeNull();
    const verification = await prisma.identityVerification.findFirstOrThrow({ where: { jobSeekerId: s.id } });
    expect(await prisma.auditLog.count({ where: { action: 'identity.aadhaar_qr_photo_deleted', entityCode: verification.id, actorId: lead.id } })).toBe(1);
  });
});
