import { randomUUID } from 'crypto';
import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import * as request from 'supertest';
import { AppModule } from '../../app.module';
import { PrismaService } from '../../common/prisma/prisma.service';
import { ConsentService } from '../consent/consent.service';

type Person = { id: string; role: string; code: string; email: string | null };

/**
 * IdentityVerification rows (Phase 12 Task 5, reworked by guide rev 154):
 * no staff member can record or mark an ID check — Aadhaar is checked against
 * UIDAI's signature, another ID by the Team Lead in T-Verify. The list of a
 * person's checks is for the Team Lead / Manager of that registration and the
 * CEO, without references, consent ids or the last 4 of an Aadhaar.
 */
describe('Phase 12 Task 5 — IdentityVerification (rev 154: no staff-marked checks)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let jwt: JwtService;
  let consentService: ConsentService;
  const suffix = randomUUID().replace(/-/g, '').slice(0, 6).toUpperCase();
  const createdStaffIds: string[] = [];
  const createdSeekerIds: string[] = [];
  let ceo: Person;
  let manager: Person;
  let otherManager: Person;
  let lead: Person;
  let caller: Person;
  let fielder: Person;
  let finance: Person;

  const token = (p: Person) => jwt.sign({ sub: p.id, role: p.role, code: p.code, email: p.email });

  async function make(role: string, tag: string, reportsToId: string | null = null): Promise<Person> {
    const agent = role === 'call_agent' || role === 'field_agent';
    const row = await prisma.staff.create({
      data: {
        code: `${tag}-IDV-${suffix}`,
        name: `Task 5 ${tag}`,
        email: `${tag.toLowerCase()}_idv_${suffix}@laboura.local`,
        passwordHash: 'hash',
        role,
        status: 'active',
        reportsToId,
        teamLeadId: agent ? reportsToId : null,
      },
    });
    createdStaffIds.push(row.id);
    return row;
  }

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);
    jwt = app.get(JwtService);
    consentService = app.get(ConsentService);
    ceo = await make('ceo', 'CEO');
    manager = await make('manager', 'MGR', ceo.id);
    otherManager = await make('manager', 'MGRB', ceo.id);
    lead = await make('team_lead', 'TL', manager.id);
    caller = await make('call_agent', 'CA', lead.id);
    fielder = await make('field_agent', 'FA', lead.id);
    finance = await make('finance', 'FIN');
  });

  afterAll(async () => {
    if (createdSeekerIds.length > 0) {
      await prisma.identityVerification.deleteMany({ where: { jobSeekerId: { in: createdSeekerIds } } });
      await prisma.consent.deleteMany({ where: { subjectId: { in: createdSeekerIds } } });
      await prisma.jobSeeker.deleteMany({ where: { id: { in: createdSeekerIds } } });
    }
    if (createdStaffIds.length > 0) await prisma.staff.deleteMany({ where: { id: { in: createdStaffIds } } });
    await app.close();
  });

  async function createCandidate(): Promise<string> {
    const tag = randomUUID().replace(/-/g, '').slice(0, 8).toUpperCase();
    const seeker = await prisma.jobSeeker.create({
      data: {
        code: `JS-IDV-${tag}`,
        name: `Candidate ${tag}`,
        phone: `+9193${Math.floor(10000000 + Math.random() * 90000000)}`,
        minSalary: 1500000,
        maxSalary: 2500000,
        preferredCallWindowStart: '09:00',
        preferredCallWindowEnd: '18:00',
        status: 'consented',
        registeredByStaffId: fielder.id,
      },
    });
    createdSeekerIds.push(seeker.id);
    await consentService.grant({ subjectType: 'job_seeker', subjectId: seeker.id, purpose: 'aadhaar_verification', noticeVersion: '1.1', language: 'en', method: 'sms_link' });
    return seeker.id;
  }

  it('1. No staff role can record or mark an ID check ("verified" or otherwise)', async () => {
    const seekerId = await createCandidate();
    for (const who of [caller, fielder, lead, manager, ceo, finance]) {
      for (const body of [
        { method: 'pan', status: 'verified', last4: '1234', nameMatches: true, isAdult: true },
        { method: 'voter_id', status: 'pending' },
        { method: 'aadhaar_qr', status: 'verified' },
      ]) {
        const res = await request(app.getHttpServer()).post(`/job-seekers/${seekerId}/identity-verification`).set('Authorization', `Bearer ${token(who)}`).send(body);
        expect(res.status).toBe(404);
      }
      const provider = await request(app.getHttpServer()).post(`/job-seekers/${seekerId}/identity-verification/provider`).set('Authorization', `Bearer ${token(who)}`).send({ method: 'pan' });
      expect(provider.status).toBe(404);
    }
    expect(await prisma.identityVerification.count({ where: { jobSeekerId: seekerId } })).toBe(0);
  });

  it('2. IdentityVerification has no update or delete route', async () => {
    const seekerId = await createCandidate();
    const row = await prisma.identityVerification.create({ data: { jobSeekerId: seekerId, method: 'pan', vendor: 'team_lead_check', status: 'pending', last4: '234F' } });
    for (const method of ['patch', 'put', 'delete'] as const) {
      const res = await request(app.getHttpServer())[method](`/identity-verifications/${row.id}`).set('Authorization', `Bearer ${token(ceo)}`).send({ status: 'verified' });
      expect(res.status).toBe(404);
    }
    expect((await prisma.identityVerification.findUniqueOrThrow({ where: { id: row.id } })).status).toBe('pending');
  });

  it('3. The list: Team Lead / Manager of that registration and the CEO only; agents and Finance never', async () => {
    const seekerId = await createCandidate();
    await prisma.identityVerification.create({ data: { jobSeekerId: seekerId, method: 'pan', vendor: 'team_lead_check', status: 'pending', last4: '234F' } });
    for (const who of [caller, fielder, finance]) {
      expect((await request(app.getHttpServer()).get(`/job-seekers/${seekerId}/identity-verifications`).set('Authorization', `Bearer ${token(who)}`)).status).toBe(403);
    }
    expect((await request(app.getHttpServer()).get(`/job-seekers/${seekerId}/identity-verifications`).set('Authorization', `Bearer ${token(otherManager)}`)).status).toBe(404);
    for (const who of [lead, manager, ceo]) {
      const res = await request(app.getHttpServer()).get(`/job-seekers/${seekerId}/identity-verifications`).set('Authorization', `Bearer ${token(who)}`);
      expect(res.status).toBe(200);
      expect(res.body).toEqual([expect.objectContaining({ method: 'pan', status: 'pending', checkedBy: 'team_lead', idNumberLast4: '234F', verifiedByUidai: false })]);
    }
  });

  it('4. The list carries no references, consent ids or Aadhaar last 4 — only the masked reference of a signed QR', async () => {
    const seekerId = await createCandidate();
    await prisma.identityVerification.create({
      data: { jobSeekerId: seekerId, method: 'aadhaar_qr', vendor: 'uidai_secure_qr', vendorReference: '432120260101101530123', status: 'verified', last4: '4321', nameMatches: true, isAdult: true, verifiedAt: new Date() },
    });
    // A sample row with method aadhaar_qr that is not from the signed check never shows as verified by UIDAI.
    await prisma.identityVerification.create({ data: { jobSeekerId: seekerId, method: 'aadhaar_qr', vendor: 'seed_sample', vendorReference: 'sample-ref', status: 'verified', last4: '9999' } });
    const res = await request(app.getHttpServer()).get(`/job-seekers/${seekerId}/identity-verifications`).set('Authorization', `Bearer ${token(lead)}`).expect(200);
    const signed = (res.body as Array<Record<string, unknown>>).find((r) => r.maskedReference === 'XXXX-XXXX-4321');
    expect(signed).toMatchObject({ verifiedByUidai: true, checkedBy: 'uidai_signature', idNumberLast4: null });
    const sample = (res.body as Array<Record<string, unknown>>).find((r) => r.maskedReference !== 'XXXX-XXXX-4321');
    expect(sample).toMatchObject({ verifiedByUidai: false, maskedReference: null, idNumberLast4: null });
    const body = JSON.stringify(res.body);
    for (const never of ['432120260101101530123', 'sample-ref', 'vendorReference', 'consentId', '"last4"', '9999']) expect(body).not.toContain(never);
  });
});
