import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import * as request from 'supertest';
import * as bcrypt from 'bcrypt';
import { AppModule } from '../../app.module';
import { PrismaService } from '../../common/prisma/prisma.service';
import { OtpService } from '../../common/otp/otp.service';
import { MockOtpProvider } from '../../common/otp/mock-otp.provider';
import { MessagingService } from '../message/messaging.service';
import { CallAgentMetricsService } from '../target/call-agent-metrics.service';
import { enrolledLogin } from '../../test-support/enrolled-login-spec';

describe('Phase 20 Task 8: every vacancy confirmed by OTP, and the minimum-wage warning', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let otp: OtpService;
  let messaging: MessagingService;

  const ts = Date.now();
  const suffix = ts.toString().slice(-7);
  const password = 'Password123!Secure';
  const staffIds: string[] = [];
  let callAgentId: string;
  let callAgentToken: string;
  let teamLeadToken: string;
  let managerToken: string;
  let businessId: string;
  let branchId: string;
  const businessPhone = `76${suffix}1`;
  const branchPhone = `77${suffix}2`;

  const code = (requestId: string) => (otp.getProvider() as MockOtpProvider).getCode(requestId)!;
  const server = () => app.getHttpServer();

  const createVacancy = (body: Record<string, unknown>) => request(server())
    .post(`/businesses/${businessId}/vacancies`)
    .set('Authorization', `Bearer ${callAgentToken}`)
    .send({ tradeSkill: 'Electrician', salaryMinPaise: 2500000, headcount: 2, shift: 'day', ...body });

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);
    otp = app.get(OtpService);
    messaging = app.get(MessagingService);

    const passwordHash = await bcrypt.hash(password, 10);
    const teamLead = await prisma.staff.create({ data: {
      code: `TL-P20T8-${ts}`, name: 'Task 8 Team Lead', email: `tl_p20t8_${ts}@laboura.local`, passwordHash, role: 'team_lead',
    } });
    const callAgent = await prisma.staff.create({ data: {
      code: `CA-P20T8-${ts}`, name: 'Task 8 Call Agent', email: `ca_p20t8_${ts}@laboura.local`, passwordHash, role: 'call_agent',
      teamLeadId: teamLead.id,
    } });
    const manager = await prisma.staff.create({ data: {
      code: `MG-P20T8-${ts}`, name: 'Task 8 Manager', email: `mg_p20t8_${ts}@laboura.local`, passwordHash, role: 'manager',
    } });
    staffIds.push(teamLead.id, callAgent.id, manager.id);
    callAgentId = callAgent.id;

    const login = async (email: string | null) => (await enrolledLogin(server(), { email, password })).body.accessToken as string;
    callAgentToken = await login(callAgent.email);
    teamLeadToken = await login(teamLead.email);
    managerToken = await login(manager.email);

    const business = await prisma.business.create({ data: {
      code: `BZ-P20T8-${ts}`, name: 'Task 8 Bakery', phone: businessPhone, phoneVerified: true,
      additionalContactName: 'Ganesh', contactRole: 'owner', locality: 'Jayanagar',
      verificationStatus: 'verified', accountAgentId: callAgent.id,
    } });
    businessId = business.id;
    const branch = await prisma.businessBranch.create({ data: {
      businessId, name: 'JP Nagar outlet', locality: 'JP Nagar',
      contactPersonName: 'Lakshmi', contactPersonRole: 'manager', contactPersonPhone: branchPhone,
    } });
    branchId = branch.id;
  });

  afterAll(async () => {
    try {
      if (prisma) {
        await prisma.publicLink.deleteMany({ where: { purpose: 'vacancy_confirm', createdByStaffId: { in: staffIds } } });
        await prisma.vacancyInterviewSlot.deleteMany({ where: { vacancy: { businessId } } });
        await prisma.statusHistory.deleteMany({ where: { subjectType: 'vacancy', changedByStaffId: { in: staffIds } } });
        await prisma.reviewFlag.deleteMany({ where: { raisedForStaffId: { in: staffIds } } });
        await prisma.vacancy.deleteMany({ where: { businessId } });
        await prisma.businessBranch.deleteMany({ where: { businessId } });
        await prisma.business.deleteMany({ where: { id: businessId } });
        await prisma.auditLog.deleteMany({ where: { actorId: { in: staffIds } } });
        await prisma.staff.deleteMany({ where: { id: { in: staffIds } } });
      }
    } finally {
      if (app) await app.close();
    }
  });

  it('a new vacancy waits for the contact person, never appears in matching, and the code read out on the call opens it', async () => {
    const created = await createVacancy({}).expect(201);
    expect(created.body.status).toBe('awaiting_confirmation');
    expect(created.body.confirmation).toMatchObject({ sentToLast4: businessPhone.slice(-4), contactName: 'Ganesh' });

    await request(server()).get(`/vacancies/${created.body.id}/shortlist`)
      .set('Authorization', `Bearer ${callAgentToken}`).expect(400);
    await request(server()).get(`/vacancies/${created.body.id}/candidates`)
      .set('Authorization', `Bearer ${callAgentToken}`).expect(400);

    const requestId = created.body.confirmation.otpRequestId as string;
    const wrong = code(requestId) === '000000' ? '111111' : '000000';
    await request(server()).post(`/vacancies/${created.body.id}/confirm`)
      .set('Authorization', `Bearer ${callAgentToken}`)
      .send({ otpRequestId: requestId, code: wrong }).expect(400);

    const confirmed = await request(server()).post(`/vacancies/${created.body.id}/confirm`)
      .set('Authorization', `Bearer ${callAgentToken}`)
      .send({ otpRequestId: requestId, code: code(requestId), method: 'code_on_call' }).expect(201);
    expect(confirmed.body).toMatchObject({
      status: 'open', confirmationMethod: 'code_on_call', confirmedByName: 'Ganesh', confirmedByRole: 'owner',
      confirmedPhoneLast4: businessPhone.slice(-4), confirmationRecordedByStaffId: callAgentId,
    });
    expect(confirmed.body.confirmedAt).toBeTruthy();

    const audit = await prisma.auditLog.findFirst({ where: { action: 'vacancy.confirmed', entityCode: created.body.code } });
    expect(audit).toBeTruthy();
    const history = await prisma.statusHistory.findFirst({
      where: { subjectType: 'vacancy', subjectId: created.body.id, fromStatus: 'awaiting_confirmation', toStatus: 'open' },
    });
    expect(history).toBeTruthy();

    // A second confirmation is refused.
    await request(server()).post(`/vacancies/${created.body.id}/confirm`)
      .set('Authorization', `Bearer ${callAgentToken}`)
      .send({ otpRequestId: requestId, code: code(requestId) }).expect(400);
    await request(server()).get(`/vacancies/${created.body.id}/shortlist`)
      .set('Authorization', `Bearer ${callAgentToken}`).expect(200);
  });

  it('the contact person can confirm later from the SMS link, which works once and not after it expires', async () => {
    const created = await createVacancy({}).expect(201);
    const sendSpy = jest.spyOn(messaging, 'send');
    try {
      await request(server()).post(`/vacancies/${created.body.id}/confirmation-link`)
        .set('Authorization', `Bearer ${callAgentToken}`).expect(201);
      const call = sendSpy.mock.calls.find(([input]) => input.template === 'vacancy_confirm_link');
      expect(call?.[0].recipientPhone).toBe(businessPhone);
      const token = (call![0].variables!.link as string).split('/vacancy-confirm/')[1];

      const details = await request(server()).get(`/vacancy-confirm/${token}`).expect(200);
      expect(details.body).toMatchObject({ status: 'awaiting_confirmation', trade: 'Electrician', headcount: '2', business: 'Task 8 Bakery' });
      expect(JSON.stringify(details.body)).not.toContain(businessPhone);

      const sent = await request(server()).post(`/vacancy-confirm/${token}/send-otp`).send({}).expect(201);
      const ok = await request(server()).post(`/vacancy-confirm/${token}`)
        .send({ otpRequestId: sent.body.otpRequestId, code: code(sent.body.otpRequestId) }).expect(201);
      expect(ok.body).toMatchObject({ status: 'open', confirmationMethod: 'sms_link', confirmationRecordedByStaffId: null });

      // The link is spent.
      await request(server()).get(`/vacancy-confirm/${token}`).expect(400);

      // An expired link is refused.
      const later = await createVacancy({}).expect(201);
      await request(server()).post(`/vacancies/${later.body.id}/confirmation-link`)
        .set('Authorization', `Bearer ${callAgentToken}`).expect(201);
      const laterCall = sendSpy.mock.calls.filter(([input]) => input.template === 'vacancy_confirm_link').pop();
      const laterToken = (laterCall![0].variables!.link as string).split('/vacancy-confirm/')[1];
      await prisma.publicLink.updateMany({
        where: { purpose: 'vacancy_confirm', subjectId: later.body.id },
        data: { expiresAt: new Date(Date.now() - 1000) },
      });
      await request(server()).post(`/vacancy-confirm/${laterToken}/send-otp`).send({}).expect(400);
      expect((await prisma.vacancy.findUniqueOrThrow({ where: { id: later.body.id } })).status).toBe('awaiting_confirmation');
    } finally {
      sendSpy.mockRestore();
    }
  });

  it('a branch vacancy is confirmed by the branch contact, not the main contact', async () => {
    const created = await createVacancy({ branchId }).expect(201);
    expect(created.body.confirmation.sentToLast4).toBe(branchPhone.slice(-4));
    expect(created.body.confirmation.contactName).toBe('Lakshmi');

    // A code sent to the main contact can't confirm the branch vacancy.
    const mainRequest = await otp.getProvider().sendOtp(businessPhone, { purpose: 'vacancy_confirm' });
    await request(server()).post(`/vacancies/${created.body.id}/confirm`)
      .set('Authorization', `Bearer ${callAgentToken}`)
      .send({ otpRequestId: mainRequest.requestId, code: code(mainRequest.requestId) }).expect(400);

    const requestId = created.body.confirmation.otpRequestId as string;
    const confirmed = await request(server()).post(`/vacancies/${created.body.id}/confirm`)
      .set('Authorization', `Bearer ${callAgentToken}`)
      .send({ otpRequestId: requestId, code: code(requestId), method: 'code_on_visit' }).expect(201);
    expect(confirmed.body).toMatchObject({ status: 'open', confirmedByName: 'Lakshmi', confirmedPhoneLast4: branchPhone.slice(-4) });

    await createVacancy({ branchId: '00000000-0000-0000-0000-000000000000' }).expect(400);
  });

  it('below the legal minimum needs the owner-told tick; it is marked and listed for Team Leads and Managers', async () => {
    const refused = await createVacancy({ salaryMinPaise: 2000000 }).expect(400);
    expect(refused.body.legalMinimumPaise).toBe(2337600);

    const saved = await createVacancy({ salaryMinPaise: 2000000, ownerToldMinimumWage: true }).expect(201);
    expect(saved.body).toMatchObject({ belowLegalMinimum: true, ownerToldMinimumWage: true, legalMinimumPaise: 2337600 });

    // Daily pay is converted with salaryDaysPerMonth (26): ₹900 a day = ₹23,400 a month, at the minimum.
    const daily = await createVacancy({ salaryMinPaise: 90000, salaryPeriod: 'daily' }).expect(201);
    expect(daily.body.belowLegalMinimum).toBe(false);
    await createVacancy({ salaryMinPaise: 89000, salaryPeriod: 'daily' }).expect(400);

    const tlList = await request(server()).get('/vacancies/below-legal-minimum')
      .set('Authorization', `Bearer ${teamLeadToken}`).expect(200);
    expect(tlList.body.map((row: { id: string }) => row.id)).toContain(saved.body.id);
    const mgList = await request(server()).get('/vacancies/below-legal-minimum')
      .set('Authorization', `Bearer ${managerToken}`).expect(200);
    expect(mgList.body.map((row: { id: string }) => row.id)).toContain(saved.body.id);
    await request(server()).get('/vacancies/below-legal-minimum')
      .set('Authorization', `Bearer ${callAgentToken}`).expect(403);
  });

  it('a draft is completed, checked and confirmed; only confirmed vacancies count as captured', async () => {
    const metrics = app.get(CallAgentMetricsService);
    const before = (await metrics.getCallAgentMetrics(callAgentId)).metrics.vacanciesCaptured;

    const draft = await prisma.vacancy.create({ data: {
      code: `VC-P20T8D-${ts}`, businessId, capturedByStaffId: callAgentId, tradeSkill: 'Electrician', headcount: 1,
      salaryMinPaise: 2000000, salaryMaxPaise: 2400000, salaryPeriod: 'monthly', shift: 'day',
      startDate: new Date('2026-12-01T00:00:00.000Z'), status: 'draft',
    } });
    await request(server()).get(`/vacancies/${draft.id}/shortlist`)
      .set('Authorization', `Bearer ${callAgentToken}`).expect(400);
    // Below the legal minimum without the tick is refused, with the tick it moves on.
    await request(server()).post(`/vacancies/${draft.id}/submit-for-confirmation`)
      .set('Authorization', `Bearer ${callAgentToken}`).send({}).expect(400);
    const submitted = await request(server()).post(`/vacancies/${draft.id}/submit-for-confirmation`)
      .set('Authorization', `Bearer ${callAgentToken}`).send({ ownerToldMinimumWage: true }).expect(201);
    expect(submitted.body).toMatchObject({ status: 'awaiting_confirmation', belowLegalMinimum: true });

    const awaiting = (await metrics.getCallAgentMetrics(callAgentId)).metrics.vacanciesCaptured;
    expect(awaiting).toBe(before);

    const requestId = submitted.body.confirmation.otpRequestId as string;
    await request(server()).post(`/vacancies/${draft.id}/confirm`)
      .set('Authorization', `Bearer ${callAgentToken}`)
      .send({ otpRequestId: requestId, code: code(requestId) }).expect(201);
    const after = (await metrics.getCallAgentMetrics(callAgentId)).metrics.vacanciesCaptured;
    expect(after).toBe(before + 1);
  });
});
