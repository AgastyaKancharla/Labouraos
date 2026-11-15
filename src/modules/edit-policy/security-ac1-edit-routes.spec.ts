import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import * as request from 'supertest';
import { AppModule } from '../../app.module';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import { verifiedOtpFor } from '../../test-support/verified-otp';

/**
 * Security AC-1 (red team, proved on the range): PATCH /referrals/:id,
 * /businesses/:id, /vacancies/:id and /placements/:id copied the whole body
 * into prisma.update, so a call agent could create a CEO account, forge an
 * approved payout, mark a placement paid, confirm a vacancy and verify a
 * business, and a Team Lead or Manager could write suspension fields.
 */
describe('Security AC-1: edit routes write only their allowlisted columns', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const suffix = Date.now().toString().slice(-6);
  const digits = suffix.slice(-5);
  const ids = { staff: [] as string[], seekers: [] as string[], biz: [] as string[], vac: [] as string[], pl: [] as string[], ref: [] as string[] };
  const tokens: Record<'ceo' | 'manager' | 'teamLead' | 'callAgent', string> = { ceo: '', manager: '', teamLead: '', callAgent: '' };
  let callAgentId = '';
  let referralId = '';
  let businessId = '';
  let vacancyId = '';
  let placementId = '';

  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
  const patch = (token: string, path: string, body: unknown) =>
    request(app.getHttpServer()).patch(path).set(auth(token)).send(body as object);

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);
    const jwt = app.get(JwtService);

    const lead = await prisma.staff.create({
      data: { code: `AC1TL-${suffix}`, name: 'AC1 Lead', email: `ac1tl_${suffix}@laboura.local`, passwordHash: 'hash', role: 'team_lead', city: 'Bengaluru' },
    });
    const people: Array<[keyof typeof tokens, string, string | null]> = [
      ['ceo', 'ceo', null],
      ['manager', 'manager', null],
      ['callAgent', 'call_agent', lead.id],
    ];
    ids.staff.push(lead.id);
    tokens.teamLead = await jwt.signAsync({ sub: lead.id, role: 'team_lead', email: lead.email, code: lead.code });
    for (const [key, role, teamLeadId] of people) {
      const s = await prisma.staff.create({
        data: { code: `AC1${key}-${suffix}`, name: `AC1 ${key}`, email: `ac1${key}_${suffix}@laboura.local`, passwordHash: 'hash', role, city: 'Bengaluru', teamLeadId },
      });
      ids.staff.push(s.id);
      if (key === 'callAgent') callAgentId = s.id;
      tokens[key] = await jwt.signAsync({ sub: s.id, role, email: s.email, code: s.code, ...(teamLeadId ? { teamLeadId } : {}) });
    }

    const referral = await prisma.referral.create({
      data: { code: `RF-AC1-${suffix}`, name: 'AC1 Partner', phone: `+9196${digits}001`, phoneVerified: true, city: 'Bengaluru' },
    });
    referralId = referral.id;
    ids.ref.push(referral.id);
    // The call agent registered the partner (edit policy: creator edits).
    await app.get(AuditService).log({ actorId: callAgentId, action: 'referral.create', entityType: 'referral', entityCode: referral.code, city: 'Bengaluru' });

    const business = await prisma.business.create({
      data: {
        code: `BZ-AC1-${suffix}`, name: 'AC1 Shop', phone: `+9196${digits}002`, phoneVerified: true, city: 'Bengaluru',
        verificationStatus: 'lead', leadCreatedByStaffId: callAgentId,
      },
    });
    businessId = business.id;
    ids.biz.push(business.id);

    const vacancy = await prisma.vacancy.create({
      data: { code: `VC-AC1-${suffix}`, businessId, tradeSkill: 'Cook', status: 'open', capturedByStaffId: callAgentId, city: 'Bengaluru', salaryMinPaise: 1500000, salaryMaxPaise: 1800000 },
    });
    vacancyId = vacancy.id;
    ids.vac.push(vacancy.id);

    const seeker = await prisma.jobSeeker.create({
      data: {
        code: `JS-AC1-${suffix}`, name: 'AC1 Worker', phone: `+9196${digits}003`, city: 'Bengaluru',
        minSalary: 1500000, maxSalary: 1800000, preferredCallWindowStart: '09:00', preferredCallWindowEnd: '21:00',
      },
    });
    ids.seekers.push(seeker.id);

    const placement = await prisma.placement.create({
      data: {
        code: `PL-AC1-${suffix}`, businessId, vacancyId, jobSeekerId: seeker.id, agreedSalary: 1600000,
        placementFee: 800000, gstAmount: 144000, status: 'awaiting_payment', createdByStaffId: callAgentId, city: 'Bengaluru',
      },
    });
    placementId = placement.id;
    ids.pl.push(placement.id);
  });

  afterAll(async () => {
    try {
      await prisma.payment.deleteMany({ where: { OR: [{ referralId: { in: ids.ref } }, { placementId: { in: ids.pl } }] } }).catch(() => undefined);
      await prisma.placement.deleteMany({ where: { id: { in: ids.pl } } }).catch(() => undefined);
      await prisma.vacancy.deleteMany({ where: { id: { in: ids.vac } } }).catch(() => undefined);
      await prisma.business.deleteMany({ where: { id: { in: ids.biz } } }).catch(() => undefined);
      await prisma.jobSeeker.deleteMany({ where: { id: { in: ids.seekers } } }).catch(() => undefined);
      await prisma.referral.deleteMany({ where: { id: { in: ids.ref } } }).catch(() => undefined);
      await prisma.staff.deleteMany({ where: { code: { contains: suffix } } }).catch(() => undefined);
    } finally {
      await app?.close();
    }
  });

  describe('nested writes are refused with 400 and change nothing', () => {
    it('a call agent cannot create a staff account through registeredBy', async () => {
      const res = await patch(tokens.callAgent, `/referrals/${referralId}`, {
        registeredBy: { create: { code: `CEO-AC1-${suffix}`, name: 'Evil', email: `evil_${suffix}@x.test`, passwordHash: 'x', role: 'ceo', city: 'Bengaluru' } },
        reason: 'x',
      });
      expect(res.status).toBe(400);
      expect(await prisma.staff.count({ where: { code: `CEO-AC1-${suffix}` } })).toBe(0);
    });

    it('a call agent cannot forge a payout through payments', async () => {
      const res = await patch(tokens.callAgent, `/referrals/${referralId}`, {
        payments: { create: { amount: 99900, status: 'approved', type: 'referral_payout' } },
      });
      expect(res.status).toBe(400);
      expect(await prisma.payment.count({ where: { referralId } })).toBe(0);
    });

    it('a vacancy edit cannot verify its business through business.update', async () => {
      const res = await patch(tokens.callAgent, `/vacancies/${vacancyId}`, {
        business: { update: { verificationStatus: 'verified', verifiedAt: new Date().toISOString() } },
      });
      expect(res.status).toBe(400);
      expect((await prisma.business.findUniqueOrThrow({ where: { id: businessId } })).verificationStatus).toBe('lead');
    });

    it('a business edit cannot create placements', async () => {
      const res = await patch(tokens.manager, `/businesses/${businessId}`, {
        placements: { create: { code: `PL-EVIL-${suffix}`, vacancyId, jobSeekerId: ids.seekers[0], placementFee: 1, gstAmount: 1, status: 'confirmed' } },
      });
      expect(res.status).toBe(400);
      expect(await prisma.placement.count({ where: { code: `PL-EVIL-${suffix}` } })).toBe(0);
    });

    it('a placement edit cannot mark it paid or confirmed', async () => {
      const res = await patch(tokens.callAgent, `/placements/${placementId}`, {
        status: 'confirmed', paidAt: new Date().toISOString(), placementFee: 1,
      });
      expect(res.status).toBe(400);
      const saved = await prisma.placement.findUniqueOrThrow({ where: { id: placementId } });
      expect([saved.status, saved.paidAt, saved.placementFee]).toEqual(['awaiting_payment', null, 800000]);
    });

    it('a vacancy edit cannot confirm it or change its status', async () => {
      const res = await patch(tokens.callAgent, `/vacancies/${vacancyId}`, { confirmedAt: new Date().toISOString(), confirmationMethod: 'code_on_call' });
      expect(res.status).toBe(400);
      expect((await patch(tokens.callAgent, `/vacancies/${vacancyId}`, { status: 'filled' })).status).toBe(400);
      expect((await prisma.vacancy.findUniqueOrThrow({ where: { id: vacancyId } })).confirmedAt).toBeNull();
    });

    it('an operator object on an allowed column is refused', async () => {
      const res = await patch(tokens.callAgent, `/vacancies/${vacancyId}`, { salaryMinPaise: { increment: 100 } });
      expect(res.status).toBe(400);
    });
  });

  describe('CEO-only and dedicated-route fields are refused for Team Leads and Managers', () => {
    it.each(['teamLead', 'manager'] as const)('%s cannot suspend, pause or verify a business by editing it', async (who) => {
      for (const body of [
        { suspendedAt: new Date().toISOString(), suspensionReason: 'x' },
        { pausedAt: new Date().toISOString(), pauseReason: 'x' },
        { verificationStatus: 'verified' },
        { accountAgentId: callAgentId },
        { phoneVerified: true },
      ]) {
        const res = await patch(tokens[who], `/businesses/${businessId}`, { ...body, reason: 'x' });
        expect([JSON.stringify(body), res.status]).toEqual([JSON.stringify(body), 400]);
      }
      const saved = await prisma.business.findUniqueOrThrow({ where: { id: businessId } });
      expect([saved.suspendedAt, saved.pausedAt, saved.accountAgentId]).toEqual([null, null, null]);
    });

    it('a paid placement’s agreed salary: Manager refused (403), CEO allowed', async () => {
      await prisma.placement.update({ where: { id: placementId }, data: { paidAt: new Date(), status: 'confirmed' } });
      const byManager = await patch(tokens.manager, `/placements/${placementId}`, { agreedSalary: 2000000, reason: 'raise' });
      expect(byManager.status).toBe(403);
      const byCeo = await patch(tokens.ceo, `/placements/${placementId}`, { agreedSalary: 1700000, reason: 'corrected' });
      expect(byCeo.status).toBe(200);
      expect((await prisma.placement.findUniqueOrThrow({ where: { id: placementId } })).agreedSalary).toBe(1700000);
    });
  });

  describe('allowed edits still work', () => {
    it('a referral partner’s name and a vacancy’s job details', async () => {
      expect((await patch(tokens.callAgent, `/referrals/${referralId}`, { name: 'AC1 Partner Kumar', reason: 'spelling' })).status).toBe(200);
      // The vacancy has a paid placement by now (above), so its Team Lead edits it.
      const vac = await patch(tokens.teamLead, `/vacancies/${vacancyId}`, { salaryMaxPaise: 1900000, startDate: '2026-12-01T00:00:00.000Z', reason: 'owner asked' });
      expect(vac.status).toBe(200);
      expect(vac.body.salaryMaxPaise).toBe(1900000);
    });
  });

  describe('phone changes need an OTP on the new number', () => {
    it('referral: refused without OTP or with an OTP for another purpose; saved with a referral OTP, once', async () => {
      const newPhone = `+9197${digits}011`;
      expect((await patch(tokens.callAgent, `/referrals/${referralId}`, { phone: newPhone, reason: 'new number' })).status).toBe(400);
      const wrongPurpose = await verifiedOtpFor(app, newPhone, 'job_seeker');
      expect((await patch(tokens.callAgent, `/referrals/${referralId}`, { phone: newPhone, reason: 'new number', phoneOtpRequestId: wrongPurpose })).status).toBe(400);
      const otp = await verifiedOtpFor(app, newPhone, 'referral');
      const ok = await patch(tokens.callAgent, `/referrals/${referralId}`, { phone: newPhone, reason: 'new number', phoneOtpRequestId: otp });
      expect(ok.status).toBe(200);
      const saved = await prisma.referral.findUniqueOrThrow({ where: { id: referralId } });
      expect([saved.phone, saved.phoneVerified]).toEqual([newPhone, true]);
      // The same OTP cannot change it again.
      const again = await patch(tokens.callAgent, `/referrals/${referralId}`, { phone: `+9197${digits}012`, reason: 'again', phoneOtpRequestId: otp });
      expect(again.status).toBe(400);
    });

    it('business: refused without OTP; saved with a business_contact OTP', async () => {
      const newPhone = `+9197${digits}021`;
      expect((await patch(tokens.manager, `/businesses/${businessId}`, { phone: newPhone, reason: 'new number' })).status).toBe(400);
      const otp = await verifiedOtpFor(app, newPhone, 'business_contact');
      expect((await patch(tokens.manager, `/businesses/${businessId}`, { phone: newPhone, reason: 'new number', phoneOtpRequestId: otp })).status).toBe(200);
      expect((await prisma.business.findUniqueOrThrow({ where: { id: businessId } })).phone).toBe(newPhone);
    });
  });

  describe('closing a vacancy has its own route', () => {
    it('a call agent cannot close; a Manager closes with a reason', async () => {
      const post = (token: string, body: object) => request(app.getHttpServer()).post(`/vacancies/${vacancyId}/close`).set(auth(token)).send(body);
      expect((await post(tokens.callAgent, { reason: 'x' })).status).toBe(403);
      expect((await post(tokens.manager, {})).status).toBe(400);
      const res = await post(tokens.manager, { reason: 'Owner filled it himself' });
      expect(res.status).toBe(201);
      expect(res.body.status).toBe('cancelled');
      expect((await post(tokens.manager, { reason: 'again' })).status).toBe(400);
    });
  });
});
