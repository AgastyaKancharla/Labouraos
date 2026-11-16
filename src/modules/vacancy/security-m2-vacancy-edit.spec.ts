import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import * as request from 'supertest';
import { AppModule } from '../../app.module';
import { PrismaService } from '../../common/prisma/prisma.service';
import { OtpService } from '../../common/otp/otp.service';
import { MockOtpProvider } from '../../common/otp/mock-otp.provider';
import { VacancyConfirmationService } from './vacancy-confirmation.service';
import { EditPolicyService } from '../../common/edit-policy/edit-policy.service';
import { PublicLinkStoreService } from '../../common/public-link-store.service';

/**
 * Security follow-up M2 (proved): PATCH /vacancies/:id skipped the legal
 * minimum wage check and kept the owner's OTP confirmation after the details
 * changed. Now the form's checks run, and a change past the draft sends the
 * vacancy back to "waiting for the owner's OTP" with earlier codes and links dead.
 */
describe('Security M2: vacancy edits re-check the minimum wage and need the owner to confirm again', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let token = '';
  const suffix = Date.now().toString().slice(-7);
  const digits = suffix.slice(-5);
  const ids = { staff: '', business: '', vacancies: [] as string[] };

  const server = () => app.getHttpServer();
  const auth = () => ({ Authorization: `Bearer ${token}` });
  const patch = (id: string, body: object) => request(server()).patch(`/vacancies/${id}`).set(auth()).send(body);

  async function vacancy(overrides: Record<string, unknown> = {}) {
    const n = ids.vacancies.length + 1;
    const v = await prisma.vacancy.create({
      data: {
        code: `VC-M2-${suffix}-${n}`, businessId: ids.business, tradeSkill: 'Cook', city: 'Bengaluru',
        salaryMinPaise: 2500000, salaryMaxPaise: 3000000, salaryPeriod: 'monthly', headcount: 1,
        status: 'open', confirmedAt: new Date(), confirmationMethod: 'code_on_call', confirmedByName: 'Owner', confirmedPhoneLast4: '1234',
        ...overrides,
      },
    });
    ids.vacancies.push(v.id);
    return v;
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);
    const staff = await prisma.staff.create({ data: { code: `M2MG-${suffix}`, name: 'M2 Manager', email: `m2_${suffix}@laboura.local`, passwordHash: 'h', role: 'manager', city: 'Bengaluru' } });
    ids.staff = staff.id;
    token = await app.get(JwtService).signAsync({ sub: staff.id, role: 'manager', email: staff.email, code: staff.code });
    const business = await prisma.business.create({
      data: { code: `BZ-M2-${suffix}`, name: `M2 Shop ${suffix}`, phone: `+9193${digits}210`, ownerName: 'M2 Owner', contactRole: 'owner', city: 'Bengaluru', verificationStatus: 'verified' },
    });
    ids.business = business.id;
  });

  afterAll(async () => {
    try {
      await prisma.publicLink.deleteMany({ where: { subjectId: { in: ids.vacancies } } }).catch(() => undefined);
      await prisma.statusHistory.deleteMany({ where: { subjectId: { in: ids.vacancies } } }).catch(() => undefined);
      await prisma.vacancy.deleteMany({ where: { id: { in: ids.vacancies } } }).catch(() => undefined);
      await prisma.messageLog.deleteMany({ where: { subjectId: ids.business } }).catch(() => undefined);
      await prisma.business.deleteMany({ where: { id: ids.business } }).catch(() => undefined);
      await prisma.auditLog.deleteMany({ where: { actorId: ids.staff } }).catch(() => undefined);
      await prisma.staff.deleteMany({ where: { id: ids.staff } }).catch(() => undefined);
    } finally {
      await app?.close();
    }
  });

  it('refuses an unknown salary period and a minimum above the maximum', async () => {
    const v = await vacancy();
    expect((await patch(v.id, { salaryPeriod: 'weekly', reason: 'x' })).status).toBe(400);
    expect((await patch(v.id, { salaryMinPaise: 3500000, reason: 'x' })).status).toBe(400);
    expect((await prisma.vacancy.findUniqueOrThrow({ where: { id: v.id } })).salaryMinPaise).toBe(2500000);
  });

  it('a salary below the legal minimum needs the owner-told tick again; then it is saved and flagged', async () => {
    const v = await vacancy();
    const refused = await patch(v.id, { salaryMinPaise: 100000, reason: 'owner lowered it' });
    expect(refused.status).toBe(400);
    expect(refused.body.legalMinimumPaise).toBeGreaterThan(100000);
    const ok = await patch(v.id, { salaryMinPaise: 100000, ownerToldMinimumWage: true, reason: 'owner lowered it' });
    expect(ok.status).toBe(200);
    const saved = await prisma.vacancy.findUniqueOrThrow({ where: { id: v.id } });
    expect([saved.belowLegalMinimum, saved.ownerToldMinimumWage, saved.salaryMinPaise]).toEqual([true, true, 100000]);
  });

  it('an open, confirmed vacancy goes back to waiting for the owner: confirmation cleared, the agent told', async () => {
    const v = await vacancy();
    const res = await patch(v.id, { headcount: 2, reason: 'one more' });
    expect(res.status).toBe(200);
    expect(res.body.ownerMustConfirmAgain).toBe(true);
    expect(res.body.message).toMatch(/confirm/i);
    const saved = await prisma.vacancy.findUniqueOrThrow({ where: { id: v.id } });
    expect([saved.status, saved.confirmedAt, saved.confirmationMethod, saved.confirmedByName]).toEqual(['awaiting_confirmation', null, null, null]);
    expect(await prisma.statusHistory.count({ where: { subjectId: v.id, fromStatus: 'open', toStatus: 'awaiting_confirmation' } })).toBe(1);
  });

  it('while already waiting: a code or link sent for the old details no longer confirms it; a new code does', async () => {
    const v = await vacancy({ status: 'awaiting_confirmation', confirmedAt: null, confirmationMethod: null, confirmedByName: null, confirmedPhoneLast4: null });
    const sent = await request(server()).post(`/vacancies/${v.id}/confirmation/send-code`).set(auth()).send({}).expect(201);
    const provider = app.get(OtpService).getProvider() as MockOtpProvider;
    const oldCode = provider.getCode(sent.body.otpRequestId)!;
    await request(server()).post(`/vacancies/${v.id}/confirmation-link`).set(auth()).send({}).expect(201);
    expect(await prisma.publicLink.count({ where: { subjectId: v.id, purpose: 'vacancy_confirm', revokedAt: null } })).toBe(1);

    expect((await patch(v.id, { description: 'Night shift too', reason: 'owner asked' })).status).toBe(200);
    expect(await prisma.publicLink.count({ where: { subjectId: v.id, purpose: 'vacancy_confirm', revokedAt: null } })).toBe(0);
    const stale = await request(server()).post(`/vacancies/${v.id}/confirm`).set(auth()).send({ otpRequestId: sent.body.otpRequestId, code: oldCode, method: 'code_on_call' });
    expect(stale.status).toBe(400);
    expect((await prisma.vacancy.findUniqueOrThrow({ where: { id: v.id } })).status).toBe('awaiting_confirmation');

    const fresh = await request(server()).post(`/vacancies/${v.id}/confirmation/send-code`).set(auth()).send({}).expect(201);
    await request(server()).post(`/vacancies/${v.id}/confirm`).set(auth())
      .send({ otpRequestId: fresh.body.otpRequestId, code: provider.getCode(fresh.body.otpRequestId), method: 'code_on_call' })
      .expect(201);
    expect((await prisma.vacancy.findUniqueOrThrow({ where: { id: v.id } })).status).toBe('open');
  });

  it('a staff vacancy_confirm code from POST /otp/send does not confirm a vacancy', async () => {
    const v = await vacancy({ status: 'awaiting_confirmation', confirmedAt: null, confirmationMethod: null, confirmedByName: null, confirmedPhoneLast4: null });
    const business = await prisma.business.findUniqueOrThrow({ where: { id: ids.business } });
    const sent = await request(server()).post('/otp/send').set(auth()).send({ phone: business.phone, purpose: 'vacancy_confirm' }).expect(201);
    const code = (app.get(OtpService).getProvider() as MockOtpProvider).getCode(sent.body.requestId);
    const res = await request(server()).post(`/vacancies/${v.id}/confirm`).set(auth()).send({ otpRequestId: sent.body.requestId, code, method: 'code_on_call' });
    expect(res.status).toBe(400);
  });

  it('a draft stays a draft (it is checked when sent for confirmation)', async () => {
    const v = await vacancy({ status: 'draft', confirmedAt: null, confirmationMethod: null, confirmedByName: null, confirmedPhoneLast4: null });
    const res = await patch(v.id, { roleTitle: 'Head cook' });
    expect(res.status).toBe(200);
    expect(res.body.ownerMustConfirmAgain).toBeUndefined();
    expect((await prisma.vacancy.findUniqueOrThrow({ where: { id: v.id } })).status).toBe('draft');
  });

  it('a closed vacancy cannot be edited', async () => {
    const v = await vacancy({ status: 'cancelled' });
    expect((await patch(v.id, { roleTitle: 'x' })).status).toBe(409);
  });

  describe('M2-R1: an edit and a confirm racing (forced order)', () => {
    afterEach(() => jest.restoreAllMocks());
    const waiting = { status: 'awaiting_confirmation', confirmedAt: null, confirmationMethod: null, confirmedByName: null, confirmedPhoneLast4: null };

    it('a code checked for the old details does not confirm once an edit lands between the check and the confirm', async () => {
      const v = await vacancy(waiting);
      const sent = await request(server()).post(`/vacancies/${v.id}/confirmation/send-code`).set(auth()).send({}).expect(201);
      const provider = app.get(OtpService).getProvider() as MockOtpProvider;
      const code = provider.getCode(sent.body.otpRequestId)!;
      const otp = app.get(OtpService);
      const real = otp.consumeVerified.bind(otp);
      jest.spyOn(otp, 'consumeVerified').mockImplementationOnce(async (...args: Parameters<OtpService['consumeVerified']>) => {
        const ok = await real(...args);
        // The edit lands right after the code was checked for the old details.
        expect((await patch(v.id, { headcount: 3, reason: 'one more' })).status).toBe(200);
        return ok;
      });
      const res = await request(server()).post(`/vacancies/${v.id}/confirm`).set(auth()).send({ otpRequestId: sent.body.otpRequestId, code, method: 'code_on_call' });
      expect(res.status).toBe(400);
      const saved = await prisma.vacancy.findUniqueOrThrow({ where: { id: v.id } });
      expect([saved.status, saved.headcount, saved.confirmedAt]).toEqual(['awaiting_confirmation', 3, null]);
    });

    it('a link sent for the old details does not confirm once an edit lands while it is being used', async () => {
      const v = await vacancy(waiting);
      const links = app.get(PublicLinkStoreService);
      const realCreate = links.create.bind(links);
      let token = '';
      jest.spyOn(links, 'create').mockImplementationOnce(async (input) => {
        const made = await realCreate(input);
        token = made.token;
        return made;
      });
      await request(server()).post(`/vacancies/${v.id}/confirmation-link`).set(auth()).send({}).expect(201);
      const sentOtp = await request(server()).post(`/vacancy-confirm/${token}/send-otp`).send({});
      const otp = app.get(OtpService);
      const requestId = sentOtp.body.otpRequestId as string;
      const code = (otp.getProvider() as MockOtpProvider).getCode(requestId)!;
      const realMark = links.markUsed.bind(links);
      jest.spyOn(links, 'markUsed').mockImplementationOnce(async (...args: Parameters<PublicLinkStoreService['markUsed']>) => {
        // The edit's transaction has committed, and its revoking of the links has not run yet.
        jest.spyOn(app.get(VacancyConfirmationService), 'revokeLiveConfirmations').mockResolvedValueOnce(undefined);
        expect((await patch(v.id, { description: 'Night shift too', reason: 'owner asked' })).status).toBe(200);
        return realMark(...args);
      });
      const res = await request(server()).post(`/vacancy-confirm/${token}`).send({ otpRequestId: requestId, code });
      expect(res.status).toBe(400);
      expect((await prisma.vacancy.findUniqueOrThrow({ where: { id: v.id } })).status).toBe('awaiting_confirmation');
    });

    it('an edit that loaded the vacancy before a confirm landed is refused, not saved on top of the confirmation', async () => {
      const v = await vacancy(waiting);
      const sent = await request(server()).post(`/vacancies/${v.id}/confirmation/send-code`).set(auth()).send({}).expect(201);
      const code = (app.get(OtpService).getProvider() as MockOtpProvider).getCode(sent.body.otpRequestId)!;
      const policy = app.get(EditPolicyService);
      const real = policy.assertCanEdit.bind(policy);
      jest.spyOn(policy, 'assertCanEdit').mockImplementationOnce(async (...args: Parameters<EditPolicyService['assertCanEdit']>) => {
        const loaded = await real(...args);
        await request(server()).post(`/vacancies/${v.id}/confirm`).set(auth()).send({ otpRequestId: sent.body.otpRequestId, code, method: 'code_on_call' }).expect(201);
        return loaded;
      });
      expect((await patch(v.id, { headcount: 4, reason: 'more' })).status).toBe(409);
      const saved = await prisma.vacancy.findUniqueOrThrow({ where: { id: v.id } });
      expect([saved.status, saved.headcount]).toEqual(['open', 1]);
    });

    it('a draft edited while it is being sent for confirmation: the edit is refused', async () => {
      const v = await vacancy({ ...waiting, status: 'draft', shift: 'day', startDate: new Date('2026-12-01') });
      const policy = app.get(EditPolicyService);
      const real = policy.assertCanEdit.bind(policy);
      jest.spyOn(policy, 'assertCanEdit').mockImplementationOnce(async (...args: Parameters<EditPolicyService['assertCanEdit']>) => {
        const loaded = await real(...args);
        await request(server()).post(`/vacancies/${v.id}/submit-for-confirmation`).set(auth()).send({}).expect(201);
        return loaded;
      });
      expect((await patch(v.id, { salaryMinPaise: 100000, reason: 'lower' })).status).toBe(409);
      const saved = await prisma.vacancy.findUniqueOrThrow({ where: { id: v.id } });
      expect([saved.status, saved.salaryMinPaise]).toEqual(['awaiting_confirmation', 2500000]);
    });
  });
});
