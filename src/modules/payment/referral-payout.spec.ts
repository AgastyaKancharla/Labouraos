import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import * as request from 'supertest';
import * as bcrypt from 'bcrypt';
import { AppModule } from '../../app.module';
import { PrismaService } from '../../common/prisma/prisma.service';
import { IdService } from '../../common/id/id.service';
import { PaymentService } from './payment.service';
import { REFERRAL_PAYOUT_AMOUNT_PAISE } from '../../common/money/money';
import { enrolledLogin } from '../../test-support/enrolled-login-spec';

describe('Phase 6 Task 1: Referral Payout Trigger', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let idService: IdService;
  let paymentService: PaymentService;
  let caStaffId: string;
  let caToken: string;

  const timestamp = Date.now();
  const password = 'Password123!';

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();

    prisma = app.get<PrismaService>(PrismaService);
    idService = app.get<IdService>(IdService);
    paymentService = app.get<PaymentService>(PaymentService);

    const passwordHash = await bcrypt.hash(password, 10);

    const ca = await prisma.staff.create({
      data: {
        code: `CA-P6-${timestamp}`,
        name: 'Call Agent P6',
        email: `ca_p6_${timestamp}@laboura.local`,
        passwordHash,
        role: 'call_agent',
        city: 'Bengaluru',
      },
    });

    await prisma.staff.create({
      data: {
        code: `ST-CEO-${timestamp}`,
        name: 'CEO P6',
        email: `ceo_p6_${timestamp}@laboura.local`,
        passwordHash,
        role: 'ceo',
        city: 'Bengaluru',
      },
    });

    const caLogin = await enrolledLogin(app.getHttpServer(), { email: ca.email, password })
      .expect(200);
    caToken = caLogin.body.accessToken;
    caStaffId = ca.id;
  });

  afterAll(async () => {
    if (app) {
      await app.close();
    }
  });

  it('proves ₹499 activation fee receipt does NOT trigger a referral payout', async () => {
    // 1. Create a referral partner
    const referral = await prisma.referral.create({
      data: {
        code: `RF-P6-${timestamp}-1`,
        name: 'Partner One',
        phone: `91000${String(timestamp).slice(-5)}`,
        phoneVerified: true,
        type: 'individual',
        city: 'Bengaluru',
      },
    });

    // 2. Create a candidate linked to this referral partner
    const candidate = await prisma.jobSeeker.create({
      data: {
        code: `JS-P6-${timestamp}-1`,
        name: 'Candidate One',
        phone: `91001${String(timestamp).slice(-5)}`,
        phoneVerified: true,
        tradeSkill: 'Electrician',
        minSalary: 1500000,
        maxSalary: 2500000,
        preferredCallWindowStart: '09:00',
        preferredCallWindowEnd: '18:00',
        status: 'pending_activation',
        referredById: referral.id,
      },
    });

    // 3. Create activation payment for candidate
    const gwRef = `mock_act_${timestamp}_1`;
    const actPaymentCode = await idService.generateCode('payment');
    const actPayment = await prisma.payment.create({
      data: {
        code: actPaymentCode,
        type: 'activation',
        amount: 49900,
        status: 'pending',
        gatewayReference: gwRef,
        subjectType: 'job_seeker',
        subjectId: candidate.id,
        jobSeekerId: candidate.id,
        city: 'Bengaluru',
      },
    });
    expect(actPayment.status).toBe('pending');

    // 4. Simulate payment webhook completion (₹499 received)
    await request(app.getHttpServer())
      .post('/payments/webhook')
      .send({ gatewayReference: gwRef, status: 'succeeded' })
      .expect(201);

    // Verify candidate is activated
    const updatedCandidate = await prisma.jobSeeker.findUnique({
      where: { id: candidate.id },
    });
    expect(updatedCandidate?.status).toBe('active');
    expect(updatedCandidate?.paymentReceivedAt).toBeDefined();

    // Verify NO referral payout payment was created
    const payouts = await prisma.payment.findMany({
      where: {
        type: 'referral_payout',
        referralId: referral.id,
      },
    });
    expect(payouts).toHaveLength(0);
  });

  it('creates a referral payout of flat ₹200 (20000 paise) exactly once when candidate joins, and is idempotent', async () => {
    // 1. Create referral partner
    const referral = await prisma.referral.create({
      data: {
        code: `RF-P6-${timestamp}-2`,
        name: 'Partner Two',
        phone: `91002${String(timestamp).slice(-5)}`,
        phoneVerified: true,
        type: 'individual',
        city: 'Bengaluru',
      },
    });

    // 2. Create candidate referred by partner
    const candidate = await prisma.jobSeeker.create({
      data: {
        code: `JS-P6-${timestamp}-2`,
        name: 'Candidate Two',
        phone: `91003${String(timestamp).slice(-5)}`,
        phoneVerified: true,
        tradeSkill: 'Plumber',
        minSalary: 1800000,
        maxSalary: 2500000,
        preferredCallWindowStart: '09:00',
        preferredCallWindowEnd: '18:00',
        status: 'active',
        paymentReceivedAt: new Date(),
        referredById: referral.id,
      },
    });

    // 3. Create business & vacancy
    const business = await prisma.business.create({
      data: {
        code: `BZ-P6-${timestamp}-2`,
        name: 'Business Two',
        phone: `91004${String(timestamp).slice(-5)}`,
        phoneVerified: true,
        area: 'Indiranagar',
        city: 'Bengaluru',
      },
    });

    const vacancy = await prisma.vacancy.create({
      data: {
        code: `VC-P6-${timestamp}-2`,
        businessId: business.id,
        tradeSkill: 'Plumber',
        offeredSalary: 2000000,
        city: 'Bengaluru',
      },
    });

    // 4. Create placement via API
    const placeRes = await request(app.getHttpServer())
      .post(`/vacancies/${vacancy.id}/placements`)
      .set('Authorization', `Bearer ${caToken}`)
      .send({
        jobSeekerId: candidate.id,
        agreedSalary: 2000000,
      })
      .expect(201);

    const placementId = placeRes.body.id;

    // Respond / confirm placement
    await request(app.getHttpServer())
      .post(`/placements/${placementId}/respond`)
      .set('Authorization', `Bearer ${caToken}`)
      .send({ response: 'accepted' })
      .expect(201);

    // 5. Candidate joins: set joinedDate
    const joinedDateStr = '2026-10-22T09:00:00.000Z';
    const joinRes = await request(app.getHttpServer())
      .post(`/placements/${placementId}/joined`)
      .set('Authorization', `Bearer ${caToken}`)
      .send({ joinedDate: joinedDateStr })
      .expect(201);

    expect(joinRes.body.status).toBe('active');

    // 6. Assert: Referral payout payment was created!
    const payouts = await prisma.payment.findMany({
      where: {
        type: 'referral_payout',
        referralId: referral.id,
      },
    });

    expect(payouts).toHaveLength(1);
    const payout = payouts[0];
    expect(payout.amount).toBe(20000); // flat ₹200 = 20000 paise
    expect(payout.amount).toBe(REFERRAL_PAYOUT_AMOUNT_PAISE);
    expect(payout.status).toBe('pending');
    expect(payout.code).toMatch(/^PAY-\d{5}$/);
    expect(payout.placementId).toBe(placementId);
    expect(payout.jobSeekerId).toBe(candidate.id);
    expect(payout.subjectType).toBe('referral');
    expect(payout.subjectId).toBe(referral.id);

    // Assert: Audit log entry exists for referral payout creation
    const audit = await prisma.auditLog.findFirst({
      where: {
        entityCode: payout.code,
        action: 'referral_payout.created',
      },
    });
    expect(audit).toBeDefined();
    expect(audit?.entityType).toBe('Payment');

    // 7. Defensive Idempotency test:
    // If the hook / trigger is called again (e.g. at-least-once delivery or retry),
    // it never produces two payouts.
    const duplicateCallResult = await paymentService.createReferralPayout(
      placementId,
      caStaffId,
    );

    expect(duplicateCallResult?.id).toBe(payout.id);

    // Verify still exactly one payout in the database
    const payoutsAfter = await prisma.payment.findMany({
      where: {
        type: 'referral_payout',
        referralId: referral.id,
      },
    });
    expect(payoutsAfter).toHaveLength(1);
  });

  it('triggers no payout when candidate with no referredById joins', async () => {
    // 1. Create candidate without referral partner
    const candidate = await prisma.jobSeeker.create({
      data: {
        code: `JS-P6-${timestamp}-3`,
        name: 'Direct Candidate',
        phone: `91005${String(timestamp).slice(-5)}`,
        phoneVerified: true,
        tradeSkill: 'Carpenter',
        minSalary: 1600000,
        maxSalary: 2400000,
        preferredCallWindowStart: '09:00',
        preferredCallWindowEnd: '18:00',
        status: 'active',
        paymentReceivedAt: new Date(),
        referredById: null, // No referral
      },
    });

    // 2. Create business & vacancy
    const business = await prisma.business.create({
      data: {
        code: `BZ-P6-${timestamp}-3`,
        name: 'Business Three',
        phone: `91006${String(timestamp).slice(-5)}`,
        phoneVerified: true,
        area: 'Whitefield',
        city: 'Bengaluru',
      },
    });

    const vacancy = await prisma.vacancy.create({
      data: {
        code: `VC-P6-${timestamp}-3`,
        businessId: business.id,
        tradeSkill: 'Carpenter',
        offeredSalary: 1800000,
        city: 'Bengaluru',
      },
    });

    // 3. Create placement & accept
    const placeRes = await request(app.getHttpServer())
      .post(`/vacancies/${vacancy.id}/placements`)
      .set('Authorization', `Bearer ${caToken}`)
      .send({
        jobSeekerId: candidate.id,
        agreedSalary: 1800000,
      })
      .expect(201);

    const placementId = placeRes.body.id;

    await request(app.getHttpServer())
      .post(`/placements/${placementId}/respond`)
      .set('Authorization', `Bearer ${caToken}`)
      .send({ response: 'accepted' })
      .expect(201);

    // 4. Record joined
    await request(app.getHttpServer())
      .post(`/placements/${placementId}/joined`)
      .set('Authorization', `Bearer ${caToken}`)
      .send({ joinedDate: '2026-10-23T10:00:00.000Z' })
      .expect(201);

    // 5. Verify NO referral payout payment was created for this placement or candidate
    const payouts = await prisma.payment.findMany({
      where: {
        type: 'referral_payout',
        placementId,
      },
    });
    expect(payouts).toHaveLength(0);

    const candidatePayouts = await prisma.payment.findMany({
      where: {
        type: 'referral_payout',
        jobSeekerId: candidate.id,
      },
    });
    expect(candidatePayouts).toHaveLength(0);
  });
});
