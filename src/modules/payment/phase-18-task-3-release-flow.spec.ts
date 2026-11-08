import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import * as bcrypt from 'bcrypt';
import * as request from 'supertest';
import { AppModule } from '../../app.module';
import { PrismaService } from '../../common/prisma/prisma.service';
import { IdService } from '../../common/id/id.service';
import { enrolledLogin } from '../../test-support/enrolled-login-spec';
import { PaymentService } from './payment.service';
import { RefundService } from '../refund/refund.service';
import {
  encryptPayoutValue,
  hashPayoutValue,
  maskPayoutValue,
} from '../payout-account/payout-account-key';

describe('Phase 18 Task 3: Owed -> Approved -> Paid Release Flow', () => {
  let app: INestApplication;
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let idService: IdService;
  let paymentService: PaymentService;
  let refundService: RefundService;

  const timestamp = Date.now();
  const password = 'Password123!';
  let seq = 0;
  const paymentIds: string[] = [];
  const referralIds: string[] = [];
  const jobSeekerIds: string[] = [];
  const businessIds: string[] = [];
  const vacancyIds: string[] = [];
  const placementIds: string[] = [];
  const staffEmails: string[] = [];
  const tokens: Record<string, string> = {};
  const staffIds: Record<string, string> = {};

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);
    idService = app.get(IdService);
    paymentService = app.get(PaymentService);
    refundService = app.get(RefundService);

    const passwordHash = await bcrypt.hash(password, 10);
    const roles: Array<[string, string, string?]> = [
      ['ceo', 'ceo'],
      ['manager', 'manager'],
      ['finance', 'finance'],
      ['call_agent', 'call_agent'],
      ['field_agent', 'field_agent', 'Indiranagar'],
      ['team_lead', 'team_lead'],
    ];
    for (const [key, role, area] of roles) {
      const email = `${key}_rf_${timestamp}@laboura.local`;
      staffEmails.push(email);
      const staff = await prisma.staff.create({
        data: {
          code: `RF-${key.toUpperCase()}-${timestamp}`,
          name: `ReleaseFlow ${key}`,
          email,
          passwordHash,
          role,
          area: area ?? null,
          city: 'Bengaluru',
        },
      });
      staffIds[key] = staff.id;
      const login = await enrolledLogin(app.getHttpServer(), { email, password }).expect(200);
      tokens[key] = login.body.accessToken;
    }
  }, 60000);

  afterAll(async () => {
    const payments = await prisma.payment.findMany({
      where: { id: { in: paymentIds } },
      select: { code: true },
    });
    const staff = await prisma.staff.findMany({
      where: { email: { in: staffEmails } },
      select: { id: true },
    });
    await prisma.auditLog.deleteMany({
      where: {
        OR: [
          { entityCode: { in: payments.map((p) => p.code) } },
          { actorId: { in: staff.map((s) => s.id) } },
        ],
      },
    });
    await prisma.payment.deleteMany({ where: { id: { in: paymentIds } } });
    await prisma.payoutAccount.deleteMany({
      where: {
        OR: [
          { ownerType: 'referral', ownerId: { in: referralIds } },
          { ownerType: 'job_seeker', ownerId: { in: jobSeekerIds } },
          { ownerType: 'business', ownerId: { in: businessIds } },
        ],
      },
    });
    await prisma.reviewFlag.deleteMany({
      where: {
        OR: [
          { subjectType: 'referral', subjectId: { in: referralIds } },
          { subjectType: 'job_seeker', subjectId: { in: jobSeekerIds } },
          { subjectType: 'business', subjectId: { in: businessIds } },
        ],
      },
    });
    await prisma.consent.deleteMany({
      where: {
        OR: [
          { subjectType: 'referral', subjectId: { in: referralIds } },
          { subjectType: 'job_seeker', subjectId: { in: jobSeekerIds } },
        ],
      },
    });
    await prisma.placement.deleteMany({ where: { id: { in: placementIds } } });
    await prisma.vacancy.deleteMany({ where: { id: { in: vacancyIds } } });
    await prisma.business.deleteMany({ where: { id: { in: businessIds } } });
    await prisma.jobSeeker.deleteMany({ where: { id: { in: jobSeekerIds } } });
    await prisma.referral.deleteMany({ where: { id: { in: referralIds } } });
    await prisma.staffSession.deleteMany({ where: { staffId: { in: staff.map((s) => s.id) } } });
    await prisma.staff.deleteMany({ where: { email: { in: staffEmails } } });
    await app.close();
  });

  const as = (who: string) => ({ Authorization: `Bearer ${tokens[who]}` });

  const createTestPayoutAccount = async (opts: {
    ownerType: string;
    ownerId: string;
    ownerNameAtEntry: string;
    upiId?: string;
    status?: string;
    activeFrom?: Date;
  }) => {
    seq += 1;
    const upiId = opts.upiId ?? `upi.${timestamp}.${seq}@okaxis`;
    return prisma.payoutAccount.create({
      data: {
        code: await idService.generateCode('payout_account'),
        ownerType: opts.ownerType,
        ownerId: opts.ownerId,
        ownerNameAtEntry: opts.ownerNameAtEntry,
        method: 'upi',
        maskedValue: maskPayoutValue('upi', upiId),
        valueHash: hashPayoutValue('upi', upiId),
        upiIdEncrypted: encryptPayoutValue(upiId),
        status: opts.status ?? 'pending_validation',
        activeFrom: opts.activeFrom ?? new Date(),
      },
    });
  };

  const createReferralWithTerms = async (signed = true) => {
    seq += 1;
    const referral = await prisma.referral.create({
      data: {
        code: `RF-TEST-${timestamp}-${seq}`,
        name: 'Arun Kumar',
        phone: `93${String(timestamp).slice(-6)}${String(seq).padStart(2, '0')}`,
        phoneVerified: true,
        type: 'individual',
        city: 'Bengaluru',
      },
    });
    referralIds.push(referral.id);

    if (signed) {
      await prisma.consent.create({
        data: {
          subjectType: 'referral',
          subjectId: referral.id,
          purpose: 'agreement_terms',
          granted: true,
          grantedAt: new Date(),
          method: 'sms_link',
          noticeVersion: '1.0',
          language: 'en',
        },
      });
      await prisma.consent.create({
        data: {
          subjectType: 'referral',
          subjectId: referral.id,
          purpose: 'call_recording',
          granted: true,
          grantedAt: new Date(),
          method: 'sms_link',
          noticeVersion: '1.0',
          language: 'en',
        },
      });
    }

    return referral;
  };

  const createReferralPayment = async (status = 'pending', signedTerms = true) => {
    const referral = await createReferralWithTerms(signedTerms);
    const payment = await prisma.payment.create({
      data: {
        code: await idService.generateCode('payment'),
        type: 'referral_payout',
        amount: 20000,
        status,
        subjectType: 'referral',
        subjectId: referral.id,
        referralId: referral.id,
        city: 'Bengaluru',
      },
    });
    paymentIds.push(payment.id);
    return { referral, payment };
  };

  describe('1. RBAC on /approve and /record-payout', () => {
    it.each(['manager', 'call_agent', 'field_agent', 'team_lead'])(
      '%s is denied POST /payments/:id/approve (403)',
      async (who) => {
        const { payment } = await createReferralPayment('pending', true);
        const res = await request(app.getHttpServer())
          .post(`/payments/${payment.id}/approve`)
          .set(as(who));
        expect(res.status).toBe(403);
      },
    );

    it.each(['manager', 'call_agent', 'field_agent', 'team_lead'])(
      '%s is denied POST /payments/:id/record-payout (403)',
      async (who) => {
        const { payment } = await createReferralPayment('approved', true);
        const res = await request(app.getHttpServer())
          .post(`/payments/${payment.id}/record-payout`)
          .set(as(who))
          .send({ bankUtr: `UTR${timestamp}RBAC`, receiverNameShown: 'Arun Kumar' });
        expect(res.status).toBe(403);
      },
    );

    it('CEO and Finance can approve a pending payment (201)', async () => {
      const { payment: p1 } = await createReferralPayment('pending', true);
      const res1 = await request(app.getHttpServer())
        .post(`/payments/${p1.id}/approve`)
        .set(as('ceo'));
      expect(res1.status).toBe(201);
      expect(res1.body.status).toBe('approved');
      expect(res1.body.approvedByStaffId).toBe(staffIds['ceo']);

      const { payment: p2 } = await createReferralPayment('pending', true);
      const res2 = await request(app.getHttpServer())
        .post(`/payments/${p2.id}/approve`)
        .set(as('finance'));
      expect(res2.status).toBe(201);
      expect(res2.body.status).toBe('approved');
      expect(res2.body.approvedByStaffId).toBe(staffIds['finance']);
    });
  });

  describe('2. A payment cannot be marked paid without being approved first (400)', () => {
    it('refuses to record payout on a pending payment', async () => {
      const { referral, payment } = await createReferralPayment('pending', true);
      await createTestPayoutAccount({
        ownerType: 'referral',
        ownerId: referral.id,
        ownerNameAtEntry: 'Arun Kumar',
      });

      const res = await request(app.getHttpServer())
        .post(`/payments/${payment.id}/record-payout`)
        .set(as('finance'))
        .send({ bankUtr: `UTR${timestamp}NOTAPP`, receiverNameShown: 'Arun Kumar' });

      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/approved/i);
    });
  });

  describe('3. Payout account restrictions (cooling period, flagged, superseded)', () => {
    it('refuses payout to an account in its 48-hour wait (cooling period)', async () => {
      const { referral, payment } = await createReferralPayment('pending', true);
      // Approve it
      await request(app.getHttpServer())
        .post(`/payments/${payment.id}/approve`)
        .set(as('finance'))
        .expect(201);

      // Create an account with activeFrom in the future (cooling period)
      await createTestPayoutAccount({
        ownerType: 'referral',
        ownerId: referral.id,
        ownerNameAtEntry: 'Arun Kumar',
        activeFrom: new Date(Date.now() + 48 * 3600 * 1000), // 48h in future
      });

      const res = await request(app.getHttpServer())
        .post(`/payments/${payment.id}/record-payout`)
        .set(as('finance'))
        .send({ bankUtr: `UTR${timestamp}COOLING`, receiverNameShown: 'Arun Kumar' });

      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/cooling period|48-hour/i);
    });

    it('refuses payout to a flagged account', async () => {
      const { referral, payment } = await createReferralPayment('pending', true);
      await request(app.getHttpServer())
        .post(`/payments/${payment.id}/approve`)
        .set(as('finance'))
        .expect(201);

      await createTestPayoutAccount({
        ownerType: 'referral',
        ownerId: referral.id,
        ownerNameAtEntry: 'Arun Kumar',
        status: 'flagged',
        activeFrom: new Date(Date.now() - 3600 * 1000),
      });

      const res = await request(app.getHttpServer())
        .post(`/payments/${payment.id}/record-payout`)
        .set(as('finance'))
        .send({ bankUtr: `UTR${timestamp}FLAGGED`, receiverNameShown: 'Arun Kumar' });

      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/flagged/i);
    });

    it('refuses payout to a superseded account', async () => {
      const { referral, payment } = await createReferralPayment('pending', true);
      await request(app.getHttpServer())
        .post(`/payments/${payment.id}/approve`)
        .set(as('finance'))
        .expect(201);

      await createTestPayoutAccount({
        ownerType: 'referral',
        ownerId: referral.id,
        ownerNameAtEntry: 'Arun Kumar',
        status: 'superseded',
        activeFrom: new Date(Date.now() - 3600 * 1000),
      });

      const res = await request(app.getHttpServer())
        .post(`/payments/${payment.id}/record-payout`)
        .set(as('finance'))
        .send({ bankUtr: `UTR${timestamp}SUPER`, receiverNameShown: 'Arun Kumar' });

      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/superseded|no payout account/i);
    });
  });

  describe('4. Name verification, mismatch flag, and matching payment', () => {
    it('name mismatch is refused (400), nothing marked paid, raises payout_name_mismatch ReviewFlag to CEO', async () => {
      const { referral, payment } = await createReferralPayment('pending', true);
      await request(app.getHttpServer())
        .post(`/payments/${payment.id}/approve`)
        .set(as('finance'))
        .expect(201);

      await createTestPayoutAccount({
        ownerType: 'referral',
        ownerId: referral.id,
        ownerNameAtEntry: 'Arun Kumar',
      });

      const res = await request(app.getHttpServer())
        .post(`/payments/${payment.id}/record-payout`)
        .set(as('finance'))
        .send({ bankUtr: `UTR${timestamp}MISMATCH`, receiverNameShown: 'Suresh Patel' });

      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/does not match/i);

      // Verify payment is NOT paid
      const reloaded = await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } });
      expect(reloaded.status).toBe('approved');
      expect(reloaded.bankUtr).toBeNull();

      // Verify ReviewFlag was raised
      const flag = await prisma.reviewFlag.findFirst({
        where: {
          kind: 'payout_name_mismatch',
          subjectType: 'referral',
          subjectId: referral.id,
        },
      });
      expect(flag).toBeDefined();
      expect((flag?.details as Record<string, unknown>)?.reason).toContain('does not match');
    });

    it('matching name records the UTR, marks payment succeeded, verifies account, audits action', async () => {
      const { referral, payment } = await createReferralPayment('pending', true);
      await request(app.getHttpServer())
        .post(`/payments/${payment.id}/approve`)
        .set(as('finance'))
        .expect(201);

      const account = await createTestPayoutAccount({
        ownerType: 'referral',
        ownerId: referral.id,
        ownerNameAtEntry: 'Arun Kumar',
      });

      const utr = `UTR${timestamp}MATCHOK`;
      const res = await request(app.getHttpServer())
        .post(`/payments/${payment.id}/record-payout`)
        .set(as('finance'))
        .send({ bankUtr: utr, receiverNameShown: 'ARUN KUMAR' });

      expect(res.status).toBe(201);
      expect(res.body.status).toBe('succeeded');
      expect(res.body.bankUtr).toBe(utr);
      expect(res.body.payoutAccountId).toBe(account.id);
      expect(res.body.paidByStaffId).toBe(staffIds['finance']);

      // Account verified
      const reloadedAccount = await prisma.payoutAccount.findUniqueOrThrow({ where: { id: account.id } });
      expect(reloadedAccount.status).toBe('verified');
      expect(reloadedAccount.nameMatches).toBe(true);
      expect(reloadedAccount.verifiedName).toBe('ARUN KUMAR');

      // Audit row
      const audit = await prisma.auditLog.findFirst({
        where: {
          entityCode: payment.code,
          action: 'payout_recorded',
        },
      });
      expect(audit).toBeDefined();
      expect(audit?.after).toMatchObject({ bankUtr: utr });
    });

    it('a UTR cannot be reused across payments (400)', async () => {
      const { referral: r1, payment: p1 } = await createReferralPayment('pending', true);
      await request(app.getHttpServer()).post(`/payments/${p1.id}/approve`).set(as('finance')).expect(201);
      await createTestPayoutAccount({
        ownerType: 'referral',
        ownerId: r1.id,
        ownerNameAtEntry: 'Arun Kumar',
      });

      const sharedUtr = `UTR${timestamp}DUP`;
      await request(app.getHttpServer())
        .post(`/payments/${p1.id}/record-payout`)
        .set(as('finance'))
        .send({ bankUtr: sharedUtr, receiverNameShown: 'Arun Kumar' })
        .expect(201);

      const { referral: r2, payment: p2 } = await createReferralPayment('pending', true);
      await request(app.getHttpServer()).post(`/payments/${p2.id}/approve`).set(as('finance')).expect(201);
      await createTestPayoutAccount({
        ownerType: 'referral',
        ownerId: r2.id,
        ownerNameAtEntry: 'Arun Kumar',
      });

      const res = await request(app.getHttpServer())
        .post(`/payments/${p2.id}/record-payout`)
        .set(as('finance'))
        .send({ bankUtr: sharedUtr, receiverNameShown: 'Arun Kumar' });

      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/already been used/i);
    });
  });

  describe('5. Referral partner agreement terms check at approval', () => {
    it('refuses approval if referral partner has not signed agreement terms', async () => {
      const { payment } = await createReferralPayment('pending', false);
      const res = await request(app.getHttpServer())
        .post(`/payments/${payment.id}/approve`)
        .set(as('finance'));

      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/agreement terms/i);
    });
  });

  describe('6. Re-checking eligibility at approval', () => {
    it('refuses refund approval if candidate became placed in between', async () => {
      seq += 1;
      const candidate = await prisma.jobSeeker.create({
        data: {
          code: `JS-TEST-${timestamp}-${seq}`,
          name: 'Placed Candidate',
          phone: `91${String(timestamp).slice(-6)}${String(seq).padStart(2, '0')}`,
          phoneVerified: true,
          status: 'placed', // became placed
          city: 'Bengaluru',
          paymentReceivedAt: new Date(Date.now() - 40 * 86400000),
          minSalary: 1500000,
          maxSalary: 2500000,
          preferredCallWindowStart: '09:00',
          preferredCallWindowEnd: '18:00',
        },
      });
      jobSeekerIds.push(candidate.id);

      const refundPayment = await prisma.payment.create({
        data: {
          code: await idService.generateCode('payment'),
          type: 'refund',
          amount: 49900,
          status: 'pending',
          subjectType: 'job_seeker',
          subjectId: candidate.id,
          jobSeekerId: candidate.id,
          city: 'Bengaluru',
        },
      });
      paymentIds.push(refundPayment.id);

      const res = await request(app.getHttpServer())
        .post(`/payments/${refundPayment.id}/approve`)
        .set(as('finance'));

      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/placed/i);
    });
  });

  describe('7. Removed payout routes return 404', () => {
    it.each(['/payments/some-id/disburse', '/payments/some-id/retry-payout', '/payments/some-id/resolve-payout', '/payments/payout-webhook'])(
      '%s returns 404',
      async (route) => {
        const res = await request(app.getHttpServer())
          .post(route)
          .set(as('ceo'))
          .send({});
        expect(res.status).toBe(404);
      },
    );
  });

  describe('8. Business refund agreement between refunds-due list and approval', () => {
    it('agrees on day 15 and day 16 after claim acceptance', async () => {
      seq += 1;
      const business = await prisma.business.create({
        data: {
          code: `BZ-RF-${timestamp}-${seq}`,
          name: 'Agreed Hotel',
          phone: `92${String(timestamp).slice(-6)}${String(seq).padStart(2, '0')}`,
          city: 'Bengaluru',
          verificationStatus: 'verified',
        },
      });
      businessIds.push(business.id);

      const candidate = await prisma.jobSeeker.create({
        data: {
          code: `JS-RF-${timestamp}-${seq}`,
          name: 'Candidate Hotel',
          phone: `90${String(timestamp).slice(-6)}${String(seq).padStart(2, '0')}`,
          phoneVerified: true,
          status: 'active',
          city: 'Bengaluru',
          minSalary: 1500000,
          maxSalary: 2500000,
          preferredCallWindowStart: '09:00',
          preferredCallWindowEnd: '18:00',
        },
      });
      jobSeekerIds.push(candidate.id);

      const vacancy = await prisma.vacancy.create({
        data: {
          code: await idService.generateCode('vacancy'),
          businessId: business.id,
          tradeSkill: 'cook',
          city: 'Bengaluru',
        },
      });
      vacancyIds.push(vacancy.id);

      const claimDecidedAt = new Date('2026-06-01T12:00:00.000Z');
      const rootPlacement = await prisma.placement.create({
        data: {
          code: await idService.generateCode('placement'),
          vacancyId: vacancy.id,
          businessId: business.id,
          jobSeekerId: candidate.id,
          status: 'dropped_out',
          placementFee: 3000000,
          gstAmount: 540000,
          city: 'Bengaluru',
          dropoutReportedAt: claimDecidedAt,
        },
      });
      placementIds.push(rootPlacement.id);

      const refundPayment = await prisma.payment.create({
        data: {
          code: await idService.generateCode('payment'),
          type: 'refund',
          amount: 3000000,
          status: 'pending',
          subjectType: 'placement',
          subjectId: rootPlacement.id,
          placementId: rootPlacement.id,
          businessId: business.id,
          city: 'Bengaluru',
        },
      });
      paymentIds.push(refundPayment.id);

      const day14 = new Date('2026-06-15T12:00:00.000Z');
      const day15 = new Date('2026-06-16T12:00:00.000Z');
      const day16 = new Date('2026-06-17T12:00:00.000Z');

      // 1. On Day 14: absent from list AND refused for approval
      const rowsDay14 = await refundService.getRefundsDue(staffIds['finance'], day14);
      const matchDay14 = rowsDay14.find((r) => r.code === rootPlacement.code);
      expect(matchDay14).toBeUndefined();

      await expect(
        paymentService.approvePayment(refundPayment.id, staffIds['finance'], day14),
      ).rejects.toThrow(/not payable before 15 days/i);

      // 2. On Day 15: present in list AND allowed for approval
      const rowsDay15 = await refundService.getRefundsDue(staffIds['finance'], day15);
      const matchDay15 = rowsDay15.find((r) => r.code === rootPlacement.code);
      expect(matchDay15).toBeDefined();
      expect(matchDay15?.amount).toBe(3000000);

      const approvedDay15 = await paymentService.approvePayment(
        refundPayment.id,
        staffIds['finance'],
        day15,
      );
      expect(approvedDay15.status).toBe('approved');

      // 3. On Day 16: create a second placement/refund to verify day 16 agreement
      const rootPlacement2 = await prisma.placement.create({
        data: {
          code: await idService.generateCode('placement'),
          vacancyId: vacancy.id,
          businessId: business.id,
          jobSeekerId: candidate.id,
          status: 'dropped_out',
          placementFee: 3000000,
          gstAmount: 540000,
          city: 'Bengaluru',
          dropoutReportedAt: claimDecidedAt,
        },
      });
      placementIds.push(rootPlacement2.id);

      const refundPayment2 = await prisma.payment.create({
        data: {
          code: await idService.generateCode('payment'),
          type: 'refund',
          amount: 3000000,
          status: 'pending',
          subjectType: 'placement',
          subjectId: rootPlacement2.id,
          placementId: rootPlacement2.id,
          businessId: business.id,
          city: 'Bengaluru',
        },
      });
      paymentIds.push(refundPayment2.id);

      const rowsDay16 = await refundService.getRefundsDue(staffIds['finance'], day16);
      const matchDay16 = rowsDay16.find((r) => r.code === rootPlacement2.code);
      expect(matchDay16).toBeDefined();
      expect(matchDay16?.amount).toBe(3000000);

      const approvedDay16 = await paymentService.approvePayment(
        refundPayment2.id,
        staffIds['finance'],
        day16,
      );
      expect(approvedDay16.status).toBe('approved');
    });
  });
});
