import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import * as bcrypt from 'bcrypt';
import * as request from 'supertest';
import { AppModule } from '../../app.module';
import { PrismaService } from '../../common/prisma/prisma.service';
import { IdService } from '../../common/id/id.service';
import { enrolledLogin } from '../../test-support/enrolled-login-spec';
import { PaymentService } from './payment.service';
import { PlacementService } from '../placement/placement.service';
import { JobSeekerService } from '../job-seeker/job-seeker.service';
import { PayoutAccountService } from '../payout-account/payout-account.service';
import {
  encryptPayoutValue,
  hashPayoutValue,
  maskPayoutValue,
} from '../payout-account/payout-account-key';
import { recordRefundCheck } from '../../test-support/refund-check';

describe('Phase 18 Task 4: Collecting Payout Details and Paying', () => {
  let app: INestApplication;
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let idService: IdService;
  let paymentService: PaymentService;
  let placementService: PlacementService;
  let jobSeekerService: JobSeekerService;
  let payoutAccountService: PayoutAccountService;

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
  const callRecordIds: string[] = [];
  const tokens: Record<string, string> = {};
  const staffIds: Record<string, string> = {};

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);
    idService = app.get(IdService);
    paymentService = app.get(PaymentService);
    placementService = app.get(PlacementService);
    jobSeekerService = app.get(JobSeekerService);
    payoutAccountService = app.get(PayoutAccountService);

    const passwordHash = await bcrypt.hash(password, 10);
    const roles: Array<[string, string, string?]> = [
      ['ceo', 'ceo'],
      ['manager', 'manager'],
      ['finance', 'finance'],
      ['call_agent', 'call_agent'],
      ['field_agent', 'field_agent'],
      ['team_lead', 'team_lead'],
    ];
    for (const [key, role] of roles) {
      const email = `${key}_t4_${timestamp}@laboura.local`;
      staffEmails.push(email);
      const staff = await prisma.staff.create({
        data: {
          code: `T4-${key.toUpperCase()}-${timestamp}`,
          name: `Task4 ${key}`,
          email,
          passwordHash,
          role,
          city: 'Bengaluru',
        },
      });
      staffIds[key] = staff.id;
      const login = await enrolledLogin(app.getHttpServer(), { email, password }).expect(200);
      tokens[key] = login.body.accessToken;
    }
  }, 60000);

  afterAll(async () => {
    if (prisma) {
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
      await prisma.consent.deleteMany({
        where: {
          OR: [
            { subjectType: 'referral', subjectId: { in: referralIds } },
            { subjectType: 'job_seeker', subjectId: { in: jobSeekerIds } },
          ],
        },
      });
      await prisma.placement.deleteMany({ where: { id: { in: placementIds } } });
      await prisma.callRecord.deleteMany({ where: { id: { in: callRecordIds } } });
      await prisma.vacancy.deleteMany({ where: { id: { in: vacancyIds } } });
      await prisma.business.deleteMany({ where: { id: { in: businessIds } } });
      await prisma.followUpTask.deleteMany({ where: { subjectId: { in: jobSeekerIds } } });
      await prisma.jobSeeker.deleteMany({ where: { id: { in: jobSeekerIds } } });
      await prisma.referral.deleteMany({ where: { id: { in: referralIds } } });
      await prisma.staffSession.deleteMany({ where: { staffId: { in: staff.map((s) => s.id) } } });
      await prisma.staff.deleteMany({ where: { email: { in: staffEmails } } });
    }
    if (app) {
      await app.close();
    }
  });

  const nextPhone = () => {
    seq += 1;
    return `98${String(timestamp).slice(-4)}${String(seq).padStart(4, '0')}`;
  };

  const createTestReferral = async (name = 'Test Partner') => {
    seq += 1;
    const referral = await prisma.referral.create({
      data: {
        code: `RF-T4-${timestamp}-${seq}`,
        name,
        phone: nextPhone(),
        phoneVerified: true,
        type: 'individual',
        city: 'Bengaluru',
      },
    });
    referralIds.push(referral.id);
    return referral;
  };

  const createTestJobSeeker = async (name = 'Test Candidate', referredById?: string) => {
    seq += 1;
    const js = await prisma.jobSeeker.create({
      data: {
        code: `JS-T4-${timestamp}-${seq}`,
        name,
        phone: nextPhone(),
        city: 'Bengaluru',
        trades: { create: { trade: 'Electrician', isPrimary: true } },
        minSalary: 1800000,
        maxSalary: 2400000,
        preferredCallWindowStart: '09:00',
        preferredCallWindowEnd: '18:00',
        status: 'active',
        referredById: referredById ?? null,
      },
    });
    jobSeekerIds.push(js.id);
    return js;
  };

  const createTestBusiness = async (name = 'Test Business') => {
    seq += 1;
    const bz = await prisma.business.create({
      data: {
        code: `BZ-T4-${timestamp}-${seq}`,
        name,
        phone: nextPhone(),
        city: 'Bengaluru',
      },
    });
    businessIds.push(bz.id);
    return bz;
  };

  const createTestVacancy = async (businessId: string) => {
    seq += 1;
    const vc = await prisma.vacancy.create({
      data: {
        code: `VC-T4-${timestamp}-${seq}`,
        businessId,
        tradeSkill: 'Electrician',
        status: 'open',
        city: 'Bengaluru',
      },
    });
    vacancyIds.push(vc.id);
    return vc;
  };

  const createTestPlacement = async (jobSeekerId: string, businessId: string, vacancyId: string) => {
    seq += 1;
    const pl = await prisma.placement.create({
      data: {
        code: `PL-T4-${timestamp}-${seq}`,
        jobSeekerId,
        businessId,
        vacancyId,
        status: 'confirmed',
        joiningDate: new Date(Date.now() - 3600 * 1000),
        agreedSalary: 2000000,
        placementFee: 1000000,
        gstAmount: 180000,
        city: 'Bengaluru',
      },
    });
    placementIds.push(pl.id);
    return pl;
  };

  const createCallRecord = async (subjectType: string, subjectId: string) => {
    seq += 1;
    const rec = await prisma.callRecord.create({
      data: {
        code: `CR-T4-${timestamp}-${seq}`,
        provider: 'mock',
        providerCallId: `call-${timestamp}-${seq}`,
        direction: 'outbound',
        subjectType,
        subjectId,
        purpose: 'joining_confirmation',
        answered: true,
        startedAt: new Date(Date.now() - 1800 * 1000),
        answeredAt: new Date(Date.now() - 1700 * 1000),
        providerStatus: 'completed',
      },
    });
    callRecordIds.push(rec.id);
    return rec;
  };

  describe('Trigger 1: Worker Joining Confirmation', () => {
    it('automatically sends payout-details link to worker when joining is confirmed', async () => {
      const candidate = await createTestJobSeeker('Joining Worker');
      const business = await createTestBusiness('Joining Business');
      const vacancy = await createTestVacancy(business.id);
      const placement = await createTestPlacement(candidate.id, business.id, vacancy.id);

      await createCallRecord('job_seeker', candidate.id);
      await createCallRecord('business', business.id);

      const sendSpy = jest.spyOn(paymentService, 'sendPayoutDetailsLinkIfNoAccount');

      await placementService.recordJoined(
        placement.id,
        {},
        staffIds.call_agent,
      );

      expect(sendSpy).toHaveBeenCalledWith(
        'job_seeker',
        candidate.id,
        staffIds.call_agent,
        'call_agent',
      );

      // Verify active link exists for candidate
      expect(await payoutAccountService.hasActiveLink('job_seeker', candidate.id)).toBe(true);

      // If called again, does not send duplicate link
      const secondCallResult = await payoutAccountService.sendLinkIfNotOnRecord(
        'job_seeker',
        candidate.id,
        staffIds.call_agent,
      );
      expect(secondCallResult.linkSent).toBe(false);
      expect(secondCallResult.reason).toBe('link_already_active');

      sendSpy.mockRestore();
    });
  });

  describe('Trigger 2: Referral Payout Queued', () => {
    it('automatically sends payout-details link to referral partner when payout is queued', async () => {
      const partner = await createTestReferral('Queued Partner');
      const candidate = await createTestJobSeeker('Referred Candidate', partner.id);
      const business = await createTestBusiness('Biz Referral Test');
      const vacancy = await createTestVacancy(business.id);
      const placement = await createTestPlacement(candidate.id, business.id, vacancy.id);

      // When createReferralPayout runs, partner has no account
      const sendSpy = jest.spyOn(paymentService, 'sendPayoutDetailsLinkIfNoAccount');

      const payment = await paymentService.createReferralPayout(placement.id, staffIds.call_agent);
      if (payment) paymentIds.push(payment.id);

      expect(sendSpy).toHaveBeenCalledWith(
        'referral',
        partner.id,
        expect.any(String),
        'system',
      );

      expect(await payoutAccountService.hasActiveLink('referral', partner.id)).toBe(true);

      // If partner already had an account, link would not be sent
      await prisma.payoutAccount.create({
        data: {
          code: await idService.generateCode('payout_account'),
          ownerType: 'referral',
          ownerId: partner.id,
          method: 'upi',
          maskedValue: maskPayoutValue('upi', 'partner123@okaxis'),
          valueHash: hashPayoutValue('upi', 'partner123@okaxis'),
          upiIdEncrypted: encryptPayoutValue('partner123@okaxis'),
          ownerNameAtEntry: partner.name,
          status: 'pending_validation',
          activeFrom: new Date(),
        },
      });

      const nextResult = await payoutAccountService.sendLinkIfNotOnRecord(
        'referral',
        partner.id,
        staffIds.call_agent,
      );
      expect(nextResult.linkSent).toBe(false);
      expect(nextResult.reason).toBe('account_exists');

      sendSpy.mockRestore();
    });
  });

  describe('Trigger 3: Refund Owed / Approved', () => {
    it('automatically sends payout-details link when refund is approved if no account exists', async () => {
      const candidate = await createTestJobSeeker('Refund Candidate');

      // Create activation payment older than 30 days
      const thirtyOneDaysAgo = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000);
      const actPay = await prisma.payment.create({
        data: {
          code: await idService.generateCode('payment'),
          city: 'Bengaluru',
          type: 'activation',
          amount: 49900,
          status: 'completed',
          jobSeekerId: candidate.id,
          subjectType: 'job_seeker',
          subjectId: candidate.id,
          createdAt: thirtyOneDaysAgo,
        },
      });
      paymentIds.push(actPay.id);

      await prisma.jobSeeker.update({
        where: { id: candidate.id },
        data: { paymentReceivedAt: thirtyOneDaysAgo },
      });

      const sendSpy = jest.spyOn(paymentService, 'sendPayoutDetailsLinkIfNoAccount');
      await recordRefundCheck(prisma, candidate.id);

      const refundPayment = await jobSeekerService.approveRefund(
        candidate.id,
        { reason: 'Candidate 30-day guarantee refund' },
        staffIds.ceo,
      );
      paymentIds.push(refundPayment.id);

      expect(sendSpy).toHaveBeenCalledWith(
        'job_seeker',
        candidate.id,
        staffIds.ceo,
        'ceo',
        expect.any(Date),
      );

      expect(await payoutAccountService.hasActiveLink('job_seeker', candidate.id)).toBe(true);

      sendSpy.mockRestore();
    });
  });

  describe('Reveal Endpoint: POST /payments/:id/reveal-payout-details', () => {
    it('allows CEO and Finance to reveal full decrypted details on an approved payment', async () => {
      const partner = await createTestReferral('Reveal Partner');
      const fullUpi = 'reveal.partner@okaxis';

      await prisma.payoutAccount.create({
        data: {
          code: await idService.generateCode('payout_account'),
          ownerType: 'referral',
          ownerId: partner.id,
          method: 'upi',
          maskedValue: maskPayoutValue('upi', fullUpi),
          valueHash: hashPayoutValue('upi', fullUpi),
          upiIdEncrypted: encryptPayoutValue(fullUpi),
          ownerNameAtEntry: partner.name,
          status: 'pending_validation',
          activeFrom: new Date(Date.now() - 1000), // active
        },
      });

      // Terms signed
      await prisma.consent.create({
        data: {
          subjectType: 'referral',
          subjectId: partner.id,
          purpose: 'agreement_terms',
          granted: true,
          grantedAt: new Date(),
          method: 'sms_link',
          noticeVersion: '1.0',
          language: 'en',
        },
      });

      const payment = await prisma.payment.create({
        data: {
          code: await idService.generateCode('payment'),
          city: 'Bengaluru',
          type: 'referral_payout',
          amount: 20000,
          status: 'approved',
          approvedByStaffId: staffIds.finance,
          approvedAt: new Date(),
          referralId: partner.id,
          subjectType: 'referral',
          subjectId: partner.id,
        },
      });
      paymentIds.push(payment.id);

      // 1. Finance can reveal
      const financeRes = await request(app.getHttpServer())
        .post(`/payments/${payment.id}/reveal-payout-details`)
        .set('Authorization', `Bearer ${tokens.finance}`)
        .expect(201);

      expect(financeRes.body.upiId).toBe(fullUpi);
      expect(financeRes.body.maskedValue).toBe(maskPayoutValue('upi', fullUpi));
      expect(financeRes.body.ownerName).toBe(partner.name);

      // 2. CEO can reveal
      const ceoRes = await request(app.getHttpServer())
        .post(`/payments/${payment.id}/reveal-payout-details`)
        .set('Authorization', `Bearer ${tokens.ceo}`)
        .expect(201);

      expect(ceoRes.body.upiId).toBe(fullUpi);

      // 3. Verify reveal was audited, and audit log does NOT contain decrypted upiId
      const auditRows = await prisma.auditLog.findMany({
        where: {
          entityCode: payment.code,
          action: 'payout_details_revealed',
        },
      });
      expect(auditRows.length).toBeGreaterThanOrEqual(2);
      for (const row of auditRows) {
        const afterJson = JSON.stringify(row.after);
        expect(afterJson).not.toContain(fullUpi);
        expect(afterJson).toContain('maskedValue');
      }
    });

    it('returns bank account number and IFSC when payout account method is bank_transfer', async () => {
      const business = await createTestBusiness('Bank Reveal Business');
      const fullAcc = '12345678901234';
      const ifsc = 'HDFC0001234';

      await prisma.payoutAccount.create({
        data: {
          code: await idService.generateCode('payout_account'),
          ownerType: 'business',
          ownerId: business.id,
          method: 'bank_transfer',
          maskedValue: maskPayoutValue('bank', fullAcc),
          valueHash: hashPayoutValue('bank', fullAcc),
          bankAccountEncrypted: encryptPayoutValue(fullAcc),
          ifsc,
          ownerNameAtEntry: 'Biz Owner',
          status: 'pending_validation',
          activeFrom: new Date(Date.now() - 1000),
        },
      });

      const payment = await prisma.payment.create({
        data: {
          code: await idService.generateCode('payment'),
          city: 'Bengaluru',
          type: 'refund',
          amount: 500000,
          status: 'approved',
          approvedByStaffId: staffIds.ceo,
          approvedAt: new Date(),
          businessId: business.id,
          subjectType: 'business',
          subjectId: business.id,
        },
      });
      paymentIds.push(payment.id);

      const res = await request(app.getHttpServer())
        .post(`/payments/${payment.id}/reveal-payout-details`)
        .set('Authorization', `Bearer ${tokens.finance}`)
        .expect(201);

      expect(res.body.accountNumber).toBe(fullAcc);
      expect(res.body.ifsc).toBe(ifsc);
      expect(res.body.maskedValue).toBe(maskPayoutValue('bank', fullAcc));
    });

    it('denies reveal for Manager, Call Agent, Field Agent, Team Lead (403) and unauthenticated (401)', async () => {
      const partner = await createTestReferral('Deny Partner');
      const payment = await prisma.payment.create({
        data: {
          code: await idService.generateCode('payment'),
          city: 'Bengaluru',
          type: 'referral_payout',
          amount: 20000,
          status: 'approved',
          referralId: partner.id,
          subjectType: 'referral',
          subjectId: partner.id,
        },
      });
      paymentIds.push(payment.id);

      // Unauthenticated -> 401
      await request(app.getHttpServer())
        .post(`/payments/${payment.id}/reveal-payout-details`)
        .expect(401);

      // Manager -> 403
      await request(app.getHttpServer())
        .post(`/payments/${payment.id}/reveal-payout-details`)
        .set('Authorization', `Bearer ${tokens.manager}`)
        .expect(403);

      // Call Agent -> 403
      await request(app.getHttpServer())
        .post(`/payments/${payment.id}/reveal-payout-details`)
        .set('Authorization', `Bearer ${tokens.call_agent}`)
        .expect(403);

      // Field Agent -> 403
      await request(app.getHttpServer())
        .post(`/payments/${payment.id}/reveal-payout-details`)
        .set('Authorization', `Bearer ${tokens.field_agent}`)
        .expect(403);

      // Team Lead -> 403
      await request(app.getHttpServer())
        .post(`/payments/${payment.id}/reveal-payout-details`)
        .set('Authorization', `Bearer ${tokens.team_lead}`)
        .expect(403);
    });

    it('refuses reveal (400) if payment is not approved (e.g. pending or succeeded)', async () => {
      const partner = await createTestReferral('Pending Partner');
      const pendingPayment = await prisma.payment.create({
        data: {
          code: await idService.generateCode('payment'),
          city: 'Bengaluru',
          type: 'referral_payout',
          amount: 20000,
          status: 'pending',
          referralId: partner.id,
          subjectType: 'referral',
          subjectId: partner.id,
        },
      });
      paymentIds.push(pendingPayment.id);

      const res = await request(app.getHttpServer())
        .post(`/payments/${pendingPayment.id}/reveal-payout-details`)
        .set('Authorization', `Bearer ${tokens.finance}`)
        .expect(400);

      expect(res.body.message).toContain('only be revealed for approved payments');
    });

    it('refuses reveal (400) if payout account is in 48-hour cooling period, flagged, or superseded', async () => {
      const partner = await createTestReferral('Cooling Partner');
      const fullUpi = 'cooling.partner@okaxis';

      // 1. Cooling period
      const coolingAccount = await prisma.payoutAccount.create({
        data: {
          code: await idService.generateCode('payout_account'),
          ownerType: 'referral',
          ownerId: partner.id,
          method: 'upi',
          maskedValue: maskPayoutValue('upi', fullUpi),
          valueHash: hashPayoutValue('upi', fullUpi),
          upiIdEncrypted: encryptPayoutValue(fullUpi),
          ownerNameAtEntry: partner.name,
          status: 'pending_validation',
          activeFrom: new Date(Date.now() + 48 * 3600 * 1000), // in the future
        },
      });

      const payment = await prisma.payment.create({
        data: {
          code: await idService.generateCode('payment'),
          city: 'Bengaluru',
          type: 'referral_payout',
          amount: 20000,
          status: 'approved',
          referralId: partner.id,
          subjectType: 'referral',
          subjectId: partner.id,
        },
      });
      paymentIds.push(payment.id);

      const coolingRes = await request(app.getHttpServer())
        .post(`/payments/${payment.id}/reveal-payout-details`)
        .set('Authorization', `Bearer ${tokens.finance}`)
        .expect(400);
      expect(coolingRes.body.message).toContain('cooling period');

      // 2. Flagged
      await prisma.payoutAccount.update({
        where: { id: coolingAccount.id },
        data: {
          activeFrom: new Date(Date.now() - 1000),
          status: 'flagged',
        },
      });

      const flaggedRes = await request(app.getHttpServer())
        .post(`/payments/${payment.id}/reveal-payout-details`)
        .set('Authorization', `Bearer ${tokens.finance}`)
        .expect(400);
      expect(flaggedRes.body.message).toContain('flagged and cannot be paid');

      // 3. Superseded
      await prisma.payoutAccount.update({
        where: { id: coolingAccount.id },
        data: {
          status: 'superseded',
        },
      });

      const supersededRes = await request(app.getHttpServer())
        .post(`/payments/${payment.id}/reveal-payout-details`)
        .set('Authorization', `Bearer ${tokens.finance}`)
        .expect(400);
      expect(supersededRes.body.message).toContain('No payout account found');
    });

    it('verifies GET /payments/:id never returns decrypted UPI ID or bank account', async () => {
      const partner = await createTestReferral('No Decrypt Partner');
      const fullUpi = 'secret.partner@okaxis';

      await prisma.payoutAccount.create({
        data: {
          code: await idService.generateCode('payout_account'),
          ownerType: 'referral',
          ownerId: partner.id,
          method: 'upi',
          maskedValue: maskPayoutValue('upi', fullUpi),
          valueHash: hashPayoutValue('upi', fullUpi),
          upiIdEncrypted: encryptPayoutValue(fullUpi),
          ownerNameAtEntry: partner.name,
          status: 'pending_validation',
          activeFrom: new Date(Date.now() - 1000),
        },
      });

      const payment = await prisma.payment.create({
        data: {
          code: await idService.generateCode('payment'),
          city: 'Bengaluru',
          type: 'referral_payout',
          amount: 20000,
          status: 'approved',
          referralId: partner.id,
          subjectType: 'referral',
          subjectId: partner.id,
        },
      });
      paymentIds.push(payment.id);

      const getRes = await request(app.getHttpServer())
        .get(`/payments/${payment.id}`)
        .set('Authorization', `Bearer ${tokens.finance}`)
        .expect(200);

      const responseBody = JSON.stringify(getRes.body);
      expect(responseBody).not.toContain(fullUpi);
    });
  });
});
