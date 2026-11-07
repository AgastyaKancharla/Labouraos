import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import * as request from 'supertest';
import * as bcrypt from 'bcrypt';
import { AppModule } from '../../app.module';
import { PrismaService } from '../../common/prisma/prisma.service';
import { OtpService } from '../../common/otp/otp.service';
import { MockOtpProvider } from '../../common/otp/mock-otp.provider';
import { enrolledLogin } from '../../test-support/enrolled-login-spec';
import { getCalendarPartsInTimezone } from '../../common/time/period-boundary';
import { applyTrustProxy } from '../../common/http/trust-proxy';
import { IdService } from '../../common/id/id.service';
import { PricingService } from '../pricing/pricing.service';
import { createAwaitingPaymentPlacementFixture } from '../../test-support/paid-placement-fixture';

describe('Phase 6.7 Gate: End-to-End Proof', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let otpService: OtpService;

  let managerToken: string;

  let ca1Token: string;
  let ca1Id: string;
  let ca1Code: string;

  let ca2Token: string;
  let ca2Id: string;
  let ca2Code: string;

  let fa1Token: string;
  let fa1Id: string;
  let fa1Code: string;

  let fa2Token: string;
  let fa2Id: string;
  let fa2Code: string;

  let businessId: string;
  let businessCode: string;

  const timestamp = Date.now();
  const password = 'Password123!Secure';
  const koraArea = `Area-E2E-Kora-${timestamp}`;

  const cleanStaffIds: string[] = [];
  const cleanTargetIds: string[] = [];
  const cleanJobSeekerIds: string[] = [];
  const cleanPlacementIds: string[] = [];
  const cleanVacancyIds: string[] = [];
  const cleanBusinessIds: string[] = [];
  const cleanPaymentIds: string[] = [];

  let ipCounter = 200;
  const freshIp = () => `10.88.${Math.floor(ipCounter / 250)}.${(ipCounter++ % 250) + 1}`;

  const getVerifiedOtp = async (phone: string): Promise<string> => {
    const { requestId } = await otpService.sendOtp(phone);
    const mockProvider = otpService.getProvider() as MockOtpProvider;
    const code = mockProvider.getCode(requestId)!;
    await otpService.verifyOtp(requestId, code);
    return requestId;
  };

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    applyTrustProxy(app, '1');
    await app.init();

    prisma = app.get<PrismaService>(PrismaService);
    otpService = app.get<OtpService>(OtpService);

    const passwordHash = await bcrypt.hash(password, 10);

    // 1. Manager
    const mgr = await prisma.staff.create({
      data: {
        code: `MGR-E2E-${timestamp}`,
        name: 'Manager E2E Proof',
        email: `mgr_e2e_${timestamp}@laboura.local`,
        passwordHash,
        role: 'manager',
        city: 'Bengaluru',
      },
    });
    cleanStaffIds.push(mgr.id);

    // 2. Call Agent 1 (Active)
    ca1Code = `CA-E2E-1-${timestamp}`;
    const ca1 = await prisma.staff.create({
      data: {
        code: ca1Code,
        name: 'Call Agent 1 Active',
        email: `ca1_e2e_${timestamp}@laboura.local`,
        passwordHash,
        role: 'call_agent',
        city: 'Bengaluru',
      },
    });
    ca1Id = ca1.id;
    cleanStaffIds.push(ca1.id);

    // 3. Call Agent 2 (Control / Unaffected)
    ca2Code = `CA-E2E-2-${timestamp}`;
    const ca2 = await prisma.staff.create({
      data: {
        code: ca2Code,
        name: 'Call Agent 2 Control',
        email: `ca2_e2e_${timestamp}@laboura.local`,
        passwordHash,
        role: 'call_agent',
        city: 'Bengaluru',
      },
    });
    ca2Id = ca2.id;
    cleanStaffIds.push(ca2.id);

    // 4. Field Agent 1 (Active)
    fa1Code = `FA-E2E-1-${timestamp}`;
    const fa1 = await prisma.staff.create({
      data: {
        code: fa1Code,
        name: 'Field Agent 1 Active',
        email: `fa1_e2e_${timestamp}@laboura.local`,
        passwordHash,
        role: 'field_agent',
        city: 'Bengaluru',
      },
    });
    fa1Id = fa1.id;
    cleanStaffIds.push(fa1.id);

    // 5. Field Agent 2 (Control / Unaffected)
    fa2Code = `FA-E2E-2-${timestamp}`;
    const fa2 = await prisma.staff.create({
      data: {
        code: fa2Code,
        name: 'Field Agent 2 Control',
        email: `fa2_e2e_${timestamp}@laboura.local`,
        passwordHash,
        role: 'field_agent',
        city: 'Bengaluru',
      },
    });
    fa2Id = fa2.id;
    cleanStaffIds.push(fa2.id);

    // 6. Business in Koramangala
    businessCode = `BZ-E2E-${timestamp}`;
    const biz = await prisma.business.create({
      data: {
        code: businessCode,
        name: 'Tech Ventures Pvt Ltd',
        contactName: 'Ramesh Gupta',
        phone: `+9198${String(timestamp).slice(-8)}0`,
        locality: koraArea,
        accountAgentId: fa1Id,
        city: 'Bengaluru',
      },
    });
    businessId = biz.id;
    cleanBusinessIds.push(biz.id);

    // Log in all actors using enrolledLogin
    const mgrLogin = await enrolledLogin(app.getHttpServer(), {
      email: mgr.email,
      password,
    });
    managerToken = mgrLogin.body.accessToken;

    const ca1Login = await enrolledLogin(app.getHttpServer(), {
      email: ca1.email,
      password,
    });
    ca1Token = ca1Login.body.accessToken;

    const ca2Login = await enrolledLogin(app.getHttpServer(), {
      email: ca2.email,
      password,
    });
    ca2Token = ca2Login.body.accessToken;

    const fa1Login = await enrolledLogin(app.getHttpServer(), {
      email: fa1.email,
      password,
    });
    fa1Token = fa1Login.body.accessToken;

    const fa2Login = await enrolledLogin(app.getHttpServer(), {
      email: fa2.email,
      password,
    });
    fa2Token = fa2Login.body.accessToken;
  });

  afterAll(async () => {
    if (prisma) {
      await prisma.auditLog.deleteMany({
        where: {
          OR: [
            { actorId: { in: cleanStaffIds } },
            { entityCode: { contains: `${timestamp}` } },
          ],
        },
      });
      await prisma.target.deleteMany({
        where: { staffId: { in: cleanStaffIds } },
      });
      await prisma.payment.deleteMany({
        where: {
          OR: [
            { id: { in: cleanPaymentIds } },
            { code: { contains: `${timestamp}` } },
          ],
        },
      });
      await prisma.placement.deleteMany({
        where: { id: { in: cleanPlacementIds } },
      });
      await prisma.vacancy.deleteMany({
        where: { id: { in: cleanVacancyIds } },
      });
      await prisma.jobSeeker.deleteMany({
        where: { id: { in: cleanJobSeekerIds } },
      });
      await prisma.business.deleteMany({
        where: { id: { in: cleanBusinessIds } },
      });
      await prisma.staffSession.deleteMany({
        where: { staffId: { in: cleanStaffIds } },
      });
      await prisma.staff.deleteMany({
        where: { id: { in: cleanStaffIds } },
      });
    }
    if (app) {
      await app.close();
    }
  });

  it('executes full end-to-end proof: set targets, register, activate, capture, place, join, pay, and verify isolation', async () => {
    const { year, month } = getCalendarPartsInTimezone(new Date(), 'Bengaluru');
    console.log(`\n======================================================`);
    console.log(`PHASE 6.7 GATE END-TO-END PROOF RUN (${year}-${month})`);
    console.log(`======================================================\n`);

    // =========================================================================
    // STEP 1: Manager sets monthly targets for Call Agent 1 and Field Agent 1
    // =========================================================================
    console.log('--- STEP 1: Manager sets targets for CA1 and FA1 ---');

    // CA1 Target: 10 activated candidates, 5 vacancies captured, 10% refund rate ceiling
    const ca1TargetRes = await request(app.getHttpServer())
      .post('/targets')
      .set('Authorization', `Bearer ${managerToken}`)
      .set('X-Forwarded-For', freshIp())
      .send({
        staffId: ca1Id,
        year,
        month,
        candidatesActivated: 10,
        vacanciesCaptured: 5,
        refundRate: 0.1,
      });
    expect(ca1TargetRes.status).toBe(201);
    cleanTargetIds.push(ca1TargetRes.body.id);
    console.log(`[CA1 Target Set] ID: ${ca1TargetRes.body.id}, candidatesActivated: 10, vacanciesCaptured: 5, refundRate: 0.1`);

    // FA1 Target: 5 placements closed
    const fa1TargetRes = await request(app.getHttpServer())
      .post('/targets')
      .set('Authorization', `Bearer ${managerToken}`)
      .set('X-Forwarded-For', freshIp())
      .send({
        staffId: fa1Id,
        year,
        month,
        placementsClosed: 5,
      });
    expect(fa1TargetRes.status).toBe(201);
    cleanTargetIds.push(fa1TargetRes.body.id);
    console.log(`[FA1 Target Set] ID: ${fa1TargetRes.body.id}, placementsClosed: 5`);

    // =========================================================================
    // STEP 2: Baseline verification — all achieved figures are currently 0
    // =========================================================================
    console.log('\n--- STEP 2: Baseline check: initial metric values are 0 ---');

    const ca1Base = await request(app.getHttpServer())
      .get(`/targets/metrics/call-agent/${ca1Id}?year=${year}&month=${month}`)
      .set('Authorization', `Bearer ${ca1Token}`)
      .set('X-Forwarded-For', freshIp());
    expect(ca1Base.status).toBe(200);
    expect(ca1Base.body.metrics.candidatesActivated).toBe(0);
    expect(ca1Base.body.metrics.vacanciesCaptured).toBe(0);

    const fa1Base = await request(app.getHttpServer())
      .get(`/targets/metrics/field-agent/${fa1Id}?year=${year}&month=${month}`)
      .set('Authorization', `Bearer ${fa1Token}`)
      .set('X-Forwarded-For', freshIp());
    expect(fa1Base.status).toBe(200);
    expect(fa1Base.body.metrics.placementsClosed).toBe(0);

    const ca2Base = await request(app.getHttpServer())
      .get(`/targets/metrics/call-agent/${ca2Id}?year=${year}&month=${month}`)
      .set('Authorization', `Bearer ${ca2Token}`)
      .set('X-Forwarded-For', freshIp());
    expect(ca2Base.status).toBe(200);
    expect(ca2Base.body.metrics.candidatesActivated).toBe(0);
    expect(ca2Base.body.metrics.vacanciesCaptured).toBe(0);

    const fa2Base = await request(app.getHttpServer())
      .get(`/targets/metrics/field-agent/${fa2Id}?year=${year}&month=${month}`)
      .set('Authorization', `Bearer ${fa2Token}`)
      .set('X-Forwarded-For', freshIp());
    expect(fa2Base.status).toBe(200);
    expect(fa2Base.body.metrics.placementsClosed).toBe(0);
    console.log('[Baseline Verified] CA1: 0, FA1: 0, CA2: 0, FA2: 0');

    // =========================================================================
    // STEP 3: CA1 onboards a candidate and collects ₹499 activation fee
    // =========================================================================
    console.log('\n--- STEP 3: CA1 onboards candidate & collects ₹499 fee ---');
    const candidatePhone = `+9192${String(timestamp).slice(-8)}1`;
    const otpRequestId = await getVerifiedOtp(candidatePhone);

    const createCandidateRes = await request(app.getHttpServer())
      .post('/job-seekers')
      .set('Authorization', `Bearer ${ca1Token}`)
      .set('X-Forwarded-For', freshIp())
      .send({
        name: 'E2E Worker Candidate',
        phone: candidatePhone,
        otpRequestId,
        tradeSkill: 'Electrician',
        minSalary: 1800000,
        maxSalary: 2500000,
        preferredCallWindowStart: '09:00',
        preferredCallWindowEnd: '18:00',
        city: 'Bengaluru',
      });
    expect(createCandidateRes.status).toBe(201);
    const candidateId = createCandidateRes.body.id;
    cleanJobSeekerIds.push(candidateId);
    console.log(`[Candidate Created] ID: ${candidateId}, code: ${createCandidateRes.body.code}`);

    // Candidate payment link creation
    const paymentRes = await request(app.getHttpServer())
      .post(`/job-seekers/${candidateId}/activation-payment`)
      .set('Authorization', `Bearer ${ca1Token}`)
      .set('X-Forwarded-For', freshIp());
    expect(paymentRes.status).toBe(201);
    cleanPaymentIds.push(paymentRes.body.paymentId);
    console.log(`[Activation Payment Initiated] ID: ${paymentRes.body.paymentId}, amount: ${paymentRes.body.amount}`);

    // Gateway webhook marks payment succeeded (payer chooses card)
    let gatewayReference = paymentRes.body.gatewayReference;
    if (!gatewayReference && paymentRes.body.upiReference) {
      await request(app.getHttpServer()).post(`/payments/request/${encodeURIComponent(paymentRes.body.upiReference)}/card`).expect(200);
      const updated = await prisma.payment.findUniqueOrThrow({ where: { id: paymentRes.body.paymentId } });
      gatewayReference = updated.gatewayReference;
    }

    const webhookRes = await request(app.getHttpServer())
      .post('/payments/mock/simulate-webhook')
      .set('X-Forwarded-For', freshIp())
      .send({
        gatewayReference,
        status: 'succeeded',
        amountPaise: 49900,
      });
    expect(webhookRes.status).toBe(201);
    expect(webhookRes.body.status).toBe('succeeded');
    console.log(`[Webhook Processed] Payment succeeded, candidate activated`);

    // Verify candidate is active with payment timestamp
    const activatedCandidate = await prisma.jobSeeker.findUniqueOrThrow({
      where: { id: candidateId },
    });
    expect(activatedCandidate.status).toBe('active');
    expect(activatedCandidate.paymentReceivedAt).not.toBeNull();
    expect(activatedCandidate.registeredByStaffId).toBe(ca1Id);

    // =========================================================================
    // STEP 4: CA1 captures a vacancy
    // =========================================================================
    console.log('\n--- STEP 4: CA1 captures a vacancy ---');
    const vacancyRes = await request(app.getHttpServer())
      .post('/vacancies')
      .set('Authorization', `Bearer ${ca1Token}`)
      .set('X-Forwarded-For', freshIp())
      .send({
        businessId,
        tradeSkill: 'Electrician',
        salaryMinPaise: 2000000,
        description: 'Commercial electrician for tech park',
        city: 'Bengaluru',
      });
    expect(vacancyRes.status).toBe(201);
    const vacancyId = vacancyRes.body.id;
    cleanVacancyIds.push(vacancyId);
    console.log(`[Vacancy Captured] ID: ${vacancyId}, capturedByStaffId: ${ca1Id}`);

    const capturedVacancy = await prisma.vacancy.findUniqueOrThrow({
      where: { id: vacancyId },
    });
    expect(capturedVacancy.capturedByStaffId).toBe(ca1Id);

    // =========================================================================
    // STEP 5: A paid placement is joined; Task 15 owns selected-interview creation.
    // =========================================================================
    console.log('\n--- STEP 5: FA1 records joining for a paid placement ---');
    const policy = await app.get(PricingService).current();
    const { placement, payment } = await createAwaitingPaymentPlacementFixture({
      prisma, idService: app.get(IdService), vacancyId, jobSeekerId: candidateId, createdByStaffId: fa1Id,
      agreedSalary: 2000000, feePercent: policy.placementFeePercent, gstPercent: policy.gstPercent,
      paymentDueHours: policy.placementPaymentDueHours,
    });
    const placementId = placement.id;
    cleanPlacementIds.push(placementId);
    cleanPaymentIds.push(payment.id);
    console.log(`[Awaiting payment placement fixture] ID: ${placementId}, createdByStaffId: ${fa1Id}`);

    const feeWebhookRes = await request(app.getHttpServer())
      .post('/payments/mock/simulate-webhook')
      .set('X-Forwarded-For', freshIp())
      .send({ gatewayReference: payment.gatewayReference, status: 'succeeded', amountPaise: payment.amount });
    expect(feeWebhookRes.status).toBe(201);
    expect(feeWebhookRes.body.status).toBe('succeeded');
    console.log(`[Placement Fee Webhook Processed] Status: succeeded`);

    // Candidate joins the job
    const joinedRes = await request(app.getHttpServer())
      .post(`/placements/${placementId}/joined`)
      .set('Authorization', `Bearer ${fa1Token}`)
      .set('X-Forwarded-For', freshIp())
      .send({
        joinedDate: new Date().toISOString(),
      });
    expect(joinedRes.status).toBe(201);
    console.log(`[Candidate Joined Recorded] Placement status: active`);

    // Verify placement in DB
    const finalPlacement = await prisma.placement.findUniqueOrThrow({
      where: { id: placementId },
      include: { payments: true },
    });
    expect(finalPlacement.status).toBe('active');
    expect(finalPlacement.joinedDate).not.toBeNull();
    expect(finalPlacement.createdByStaffId).toBe(fa1Id);
    expect(finalPlacement.payments.some((p) => p.status === 'succeeded' && p.type === 'placement_fee')).toBe(true);

    // =========================================================================
    // STEP 6: Confirm each metric moves by expected amount for active agents
    // =========================================================================
    console.log('\n--- STEP 6: Confirm metrics moved by expected amount ---');

    // CA1 metrics: candidatesActivated moved from 0 to 1, vacanciesCaptured moved from 0 to 1
    const ca1After = await request(app.getHttpServer())
      .get(`/targets/metrics/call-agent/${ca1Id}?year=${year}&month=${month}`)
      .set('Authorization', `Bearer ${ca1Token}`)
      .set('X-Forwarded-For', freshIp());
    expect(ca1After.status).toBe(200);
    expect(ca1After.body.metrics.candidatesActivated).toBe(1);
    expect(ca1After.body.metrics.vacanciesCaptured).toBe(1);
    console.log(`[CA1 Metric Moved] candidatesActivated: 0 -> ${ca1After.body.metrics.candidatesActivated} (Expected: 1)`);
    console.log(`[CA1 Metric Moved] vacanciesCaptured: 0 -> ${ca1After.body.metrics.vacanciesCaptured} (Expected: 1)`);

    // FA1 metrics: placementsClosed moved from 0 to 1
    const fa1After = await request(app.getHttpServer())
      .get(`/targets/metrics/field-agent/${fa1Id}?year=${year}&month=${month}`)
      .set('Authorization', `Bearer ${fa1Token}`)
      .set('X-Forwarded-For', freshIp());
    expect(fa1After.status).toBe(200);
    expect(fa1After.body.metrics.placementsClosed).toBe(1);
    console.log(`[FA1 Metric Moved] placementsClosed: 0 -> ${fa1After.body.metrics.placementsClosed} (Expected: 1)`);

    // =========================================================================
    // STEP 7: Confirm second agents (CA2, FA2) are completely unaffected (0)
    // =========================================================================
    console.log('\n--- STEP 7: Confirm second agents (CA2, FA2) are unaffected ---');

    const ca2After = await request(app.getHttpServer())
      .get(`/targets/metrics/call-agent/${ca2Id}?year=${year}&month=${month}`)
      .set('Authorization', `Bearer ${ca2Token}`)
      .set('X-Forwarded-For', freshIp());
    expect(ca2After.status).toBe(200);
    expect(ca2After.body.metrics.candidatesActivated).toBe(0);
    expect(ca2After.body.metrics.vacanciesCaptured).toBe(0);
    console.log(`[CA2 Unaffected] candidatesActivated: ${ca2After.body.metrics.candidatesActivated}, vacanciesCaptured: ${ca2After.body.metrics.vacanciesCaptured} (Expected: 0)`);

    const fa2After = await request(app.getHttpServer())
      .get(`/targets/metrics/field-agent/${fa2Id}?year=${year}&month=${month}`)
      .set('Authorization', `Bearer ${fa2Token}`)
      .set('X-Forwarded-For', freshIp());
    expect(fa2After.status).toBe(200);
    expect(fa2After.body.metrics.placementsClosed).toBe(0);
    console.log(`[FA2 Unaffected] placementsClosed: ${fa2After.body.metrics.placementsClosed} (Expected: 0)`);

    // =========================================================================
    // STEP 8: Verify Dashboard, Overview, and Leaderboard reflect accurate state
    // =========================================================================
    console.log('\n--- STEP 8: Verify Dashboard and Leaderboard standings ---');

    // CA1 Dashboard: sees their own target and achieved figures
    const ca1Dashboard = await request(app.getHttpServer())
      .get(`/targets/dashboard?year=${year}&month=${month}`)
      .set('Authorization', `Bearer ${ca1Token}`)
      .set('X-Forwarded-For', freshIp());
    expect(ca1Dashboard.status).toBe(200);
    expect(ca1Dashboard.body.scope).toBe('agent');
    expect(ca1Dashboard.body.agent.staff.code).toBe(ca1Code);
    expect(ca1Dashboard.body.agent.achieved.candidatesActivated).toBe(1);
    expect(ca1Dashboard.body.agent.achieved.vacanciesCaptured).toBe(1);

    // FA1 Dashboard: sees their own target and achieved figures
    const fa1Dashboard = await request(app.getHttpServer())
      .get(`/targets/dashboard?year=${year}&month=${month}`)
      .set('Authorization', `Bearer ${fa1Token}`)
      .set('X-Forwarded-For', freshIp());
    expect(fa1Dashboard.status).toBe(200);
    expect(fa1Dashboard.body.scope).toBe('agent');
    expect(fa1Dashboard.body.agent.staff.code).toBe(fa1Code);
    expect(fa1Dashboard.body.agent.achieved.placementsClosed).toBe(1);

    // Placements Leaderboard: FA1 is ranked at position 1; FA2 is excluded (no target)
    const leaderboardRes = await request(app.getHttpServer())
      .get(`/targets/leaderboard?year=${year}&month=${month}`)
      .set('Authorization', `Bearer ${fa1Token}`)
      .set('X-Forwarded-For', freshIp());
    expect(leaderboardRes.status).toBe(200);
    const rankings = leaderboardRes.body.leaderboard;
    const fa1Rank = rankings.find((r: { staffCode: string }) => r.staffCode === fa1Code);
    expect(fa1Rank).toBeDefined();
    expect(fa1Rank.placementsClosed).toBe(1);
    expect(fa1Rank.target).toBeUndefined(); // strictly hides targets
    expect(fa1Rank.effectiveTarget).toBeUndefined(); // strictly hides targets
    const fa2Rank = rankings.find((r: { staffCode: string }) => r.staffCode === fa2Code);
    expect(fa2Rank).toBeUndefined(); // FA2 excluded as they have no target
    console.log(`[Leaderboard Verified] FA1 ranked at #${fa1Rank.position} with 1 placement closed. FA2 excluded.`);

    // Manager Overview: city-wide aggregate reflects 1 activation, 1 vacancy, 1 placement
    const mgrOverview = await request(app.getHttpServer())
      .get(`/targets/overview?year=${year}&month=${month}`)
      .set('Authorization', `Bearer ${managerToken}`)
      .set('X-Forwarded-For', freshIp());
    expect(mgrOverview.status).toBe(200);
    expect(mgrOverview.body.scope).toBe('city');
    expect(mgrOverview.body.totals.achieved.candidatesActivated).toBeGreaterThanOrEqual(1);
    expect(mgrOverview.body.totals.achieved.vacanciesCaptured).toBeGreaterThanOrEqual(1);
    expect(mgrOverview.body.totals.achieved.placementsClosed).toBeGreaterThanOrEqual(1);
    console.log(`[Manager Overview Verified] City aggregate confirmed.`);

    console.log(`\n======================================================`);
    console.log(`END-TO-END PROOF COMPLETED SUCCESSFULLY`);
    console.log(`======================================================\n`);
  });
});
