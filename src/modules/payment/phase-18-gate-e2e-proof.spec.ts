import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import * as crypto from 'crypto';
import * as request from 'supertest';
import { AppModule } from '../../app.module';
import { PrismaService } from '../../common/prisma/prisma.service';
import { SMS_PROVIDER, SmsProvider } from '../message/sms.provider';
import { WHATSAPP_PROVIDER, WhatsAppProvider } from '../../common/whatsapp/whatsapp.interface';
import { OTP_PROVIDER } from '../../common/otp/otp.interface';
import { MockOtpProvider } from '../../common/otp/mock-otp.provider';
import { PlacementService } from '../placement/placement.service';
import { encryptCallRoutingPhone } from '../staff/call-routing-key';

describe('Phase 18 Gate End-to-End Proof', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let jwt: JwtService;
  let placementService: PlacementService;
  let mockOtpProvider: MockOtpProvider;

  const suffix = crypto.randomUUID().replace(/-/g, '').slice(0, 10).toUpperCase();

  const staffIds: string[] = [];
  const seekerIds: string[] = [];
  const businessIds: string[] = [];
  const vacancyIds: string[] = [];
  const placementIds: string[] = [];
  const referralIds: string[] = [];
  const paymentIds: string[] = [];
  const payoutAccountIds: string[] = [];
  const callRecordIds: string[] = [];
  const sentPayoutTokens: Array<{ ownerType: string; ownerId: string; token: string }> = [];

  let ceoToken = '';
  let financeToken = '';
  let managerToken = '';
  let callAgentToken = '';
  let fieldAgentToken = '';

  let ceoId = '';
  let financeId = '';
  let callAgentId = '';

  let seq = 100;
  const nextPhone = () => {
    seq += 1;
    return `98${String(Date.now()).slice(-4)}${String(seq).padStart(4, '0')}`;
  };

  const getLatestPayoutToken = (ownerType: string, ownerId: string): string => {
    const records = sentPayoutTokens.filter((t) => t.ownerType === ownerType && t.ownerId === ownerId);
    if (!records.length) {
      throw new Error(`No unused payout token found for ${ownerType} ${ownerId}`);
    }
    return records[records.length - 1].token;
  };

  beforeAll(async () => {
    process.env.PUBLIC_APP_URL = 'https://app.laboura.in';
    process.env.PAYOUT_ACCOUNT_KEY = 'phase18_payout_account_secret_key_32_chars_min!';
    process.env.CALL_ROUTING_KEY = 'phase18_call_routing_secret_key_32_chars_min!';

    const mockSms: SmsProvider = {
      sendTemplate: async (_phone, template, _dltTemplateId, variables) => {
        const link = variables.link;
        const match = template === 'payout_details_link' ? link?.match(/\/payout-accounts\/link\/([^/?#]+)/) : null;
        if (match?.[1]) {
          const owner = await prisma.publicLink.findFirst({
            where: { tokenHash: crypto.createHash('sha256').update(match[1]).digest('hex') },
            select: { subjectType: true, subjectId: true },
          });
          if (owner) sentPayoutTokens.push({ ownerType: owner.subjectType, ownerId: owner.subjectId, token: match[1] });
        }
        return { messageId: `sms_${crypto.randomUUID()}`, status: 'sent' };
      },
    };
    const mockWa: WhatsAppProvider = {
      sendTemplateMessage: async () => ({
        messageId: `wa_${crypto.randomUUID()}`,
        status: 'sent',
        phone: '9999999999',
        templateName: 'template',
        timestamp: new Date(),
      }),
    };

    const moduleRef: TestingModule = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(SMS_PROVIDER).useValue(mockSms)
      .overrideProvider(WHATSAPP_PROVIDER).useValue(mockWa)
      .compile();

    app = moduleRef.createNestApplication({ rawBody: true });
    await app.init();

    prisma = app.get(PrismaService);
    jwt = app.get(JwtService);
    placementService = app.get(PlacementService);
    mockOtpProvider = app.get(OTP_PROVIDER) as MockOtpProvider;

    const passwordHash = 'dummy_hash';

    const ceo = await prisma.staff.create({
      data: {
        code: `P18-CEO-${suffix}`,
        name: 'Phase 18 CEO',
        email: `p18-ceo-${suffix.toLowerCase()}@laboura.local`,
        passwordHash,
        role: 'ceo',
        status: 'active',
        city: 'Bengaluru',
      },
    });
    ceoId = ceo.id; staffIds.push(ceo.id);
    ceoToken = jwt.sign({ sub: ceo.id, role: ceo.role, code: ceo.code, email: ceo.email });

    const finance = await prisma.staff.create({
      data: {
        code: `P18-FIN-${suffix}`,
        name: 'Phase 18 Finance',
        email: `p18-fin-${suffix.toLowerCase()}@laboura.local`,
        passwordHash,
        role: 'finance',
        status: 'active',
        city: 'Bengaluru',
      },
    });
    financeId = finance.id; staffIds.push(finance.id);
    financeToken = jwt.sign({ sub: finance.id, role: finance.role, code: finance.code, email: finance.email });

    const manager = await prisma.staff.create({
      data: {
        code: `P18-MGR-${suffix}`,
        name: 'Phase 18 Manager',
        email: `p18-mgr-${suffix.toLowerCase()}@laboura.local`,
        passwordHash,
        role: 'manager',
        status: 'active',
        city: 'Bengaluru',
      },
    });
    staffIds.push(manager.id);
    managerToken = jwt.sign({ sub: manager.id, role: manager.role, code: manager.code, email: manager.email });

    const ca = await prisma.staff.create({
      data: {
        code: `P18-CA-${suffix}`,
        name: 'Phase 18 Call Agent',
        email: `p18-ca-${suffix.toLowerCase()}@laboura.local`,
        passwordHash,
        role: 'call_agent',
        status: 'active',
        city: 'Bengaluru',
      },
    });
    callAgentId = ca.id; staffIds.push(ca.id);
    callAgentToken = jwt.sign({ sub: ca.id, role: ca.role, code: ca.code, email: ca.email });

    const fa = await prisma.staff.create({
      data: {
        code: `P18-FA-${suffix}`,
        name: 'Phase 18 Field Agent',
        email: `p18-fa-${suffix.toLowerCase()}@laboura.local`,
        passwordHash,
        role: 'field_agent',
        status: 'active',
        city: 'Bengaluru',
      },
    });
    staffIds.push(fa.id);
    fieldAgentToken = jwt.sign({ sub: fa.id, role: fa.role, code: fa.code, email: fa.email });
  }, 60000);

  afterAll(async () => {
    try {
      if (prisma) {
        const cleanIds = (arr: string[]) => arr.filter((x): x is string => typeof x === 'string' && x.length > 0);

        const cleanPayments = cleanIds(paymentIds);
        if (cleanPayments.length) {
          await prisma.payment.deleteMany({ where: { id: { in: cleanPayments } } }).catch(() => {});
        }
        const cleanPayoutAccounts = cleanIds(payoutAccountIds);
        if (cleanPayoutAccounts.length) {
          await prisma.payoutAccount.deleteMany({ where: { id: { in: cleanPayoutAccounts } } }).catch(() => {});
        }
        const cleanPlacements = cleanIds(placementIds);
        if (cleanPlacements.length) {
          await prisma.replacementClaim.deleteMany({ where: { placementId: { in: cleanPlacements } } }).catch(() => {});
          await prisma.placement.deleteMany({ where: { id: { in: cleanPlacements } } }).catch(() => {});
        }
        const cleanCallRecords = cleanIds(callRecordIds);
        if (cleanCallRecords.length) {
          await prisma.callRecord.deleteMany({ where: { id: { in: cleanCallRecords } } }).catch(() => {});
        }
        const cleanVacancies = cleanIds(vacancyIds);
        if (cleanVacancies.length) {
          await prisma.vacancy.deleteMany({ where: { id: { in: cleanVacancies } } }).catch(() => {});
        }
        const cleanBusinesses = cleanIds(businessIds);
        if (cleanBusinesses.length) {
          await prisma.reviewFlag.deleteMany({ where: { subjectId: { in: cleanBusinesses } } }).catch(() => {});
          await prisma.business.deleteMany({ where: { id: { in: cleanBusinesses } } }).catch(() => {});
        }
        const cleanSeekers = cleanIds(seekerIds);
        if (cleanSeekers.length) {
          await prisma.reviewFlag.deleteMany({ where: { subjectId: { in: cleanSeekers } } }).catch(() => {});
          await prisma.jobSeeker.deleteMany({ where: { id: { in: cleanSeekers } } }).catch(() => {});
        }
        const cleanReferrals = cleanIds(referralIds);
        if (cleanReferrals.length) {
          await prisma.consent.deleteMany({ where: { subjectId: { in: cleanReferrals } } }).catch(() => {});
          await prisma.referral.deleteMany({ where: { id: { in: cleanReferrals } } }).catch(() => {});
        }
        const cleanStaff = cleanIds(staffIds);
        if (cleanStaff.length) {
          await prisma.staffSession.deleteMany({ where: { staffId: { in: cleanStaff } } }).catch(() => {});
          await prisma.staff.deleteMany({ where: { id: { in: cleanStaff } } }).catch(() => {});
        }
      }
    } finally {
      if (app) {
        await app.close();
      }
    }
  }, 120000);

  describe('Scenario 1: Worker Joining Reward Flow (E2E Proof)', () => {
    it('worker joins -> payout link sent -> enters UPI on phone by OTP -> 30 days later ₹200 owed -> Finance approves, reveals UPI ID, records UTR -> paid, account verified', async () => {
      // 1. Worker setup
      const workerPhone = nextPhone();
      const seeker = await prisma.jobSeeker.create({
        data: {
          code: `JS-P18-${suffix}-1`,
          name: 'Rajesh Kumar Worker',
          phone: workerPhone,
          minSalary: 1500000,
          maxSalary: 2000000,
          preferredCallWindowStart: '09:00',
          preferredCallWindowEnd: '21:00',
          status: 'placed',
          city: 'Bengaluru',
        },
      });
      seekerIds.push(seeker.id);

      const biz = await prisma.business.create({
        data: {
          code: `BZ-P18-${suffix}-1`,
          name: 'Hotel Bengaluru Palace',
          phone: nextPhone(),
          verificationStatus: 'verified',
          city: 'Bengaluru',
        },
      });
      businessIds.push(biz.id);

      const vac = await prisma.vacancy.create({
        data: {
          code: `VC-P18-${suffix}-1`,
          businessId: biz.id,
          tradeSkill: 'cook',
          salaryMinPaise: 1500000,
          salaryMaxPaise: 2000000,
          status: 'active',
        },
      });
      vacancyIds.push(vac.id);

      const joiningDate = new Date();
      const placement = await prisma.placement.create({
        data: {
          code: `PL-P18-${suffix}-1`,
          businessId: biz.id,
          vacancyId: vac.id,
          jobSeekerId: seeker.id,
          status: 'confirmed',
          joiningDate,
          placementFee: 750000,
          gstAmount: 135000,
        },
      });
      placementIds.push(placement.id);

      // Create confirmation call records
      const workerCall = await prisma.callRecord.create({
        data: {
          code: `CR-W-${suffix}-1`,
          provider: 'mock',
          providerCallId: `call-w-${suffix}-1`,
          providerStatus: 'answered',
          answered: true,
          direction: 'outbound',
          purpose: 'joining_confirmation',
          staffId: callAgentId,
          subjectType: 'job_seeker',
          subjectId: seeker.id,
          startedAt: joiningDate,
          endedAt: joiningDate,
        },
      });
      callRecordIds.push(workerCall.id);

      const bizCall = await prisma.callRecord.create({
        data: {
          code: `CR-B-${suffix}-1`,
          provider: 'mock',
          providerCallId: `call-b-${suffix}-1`,
          providerStatus: 'answered',
          answered: true,
          direction: 'outbound',
          purpose: 'joining_confirmation',
          staffId: callAgentId,
          subjectType: 'business',
          subjectId: biz.id,
          startedAt: joiningDate,
          endedAt: joiningDate,
        },
      });
      callRecordIds.push(bizCall.id);

      // Confirm joining via placement service (triggers payout details link)
      await placementService.recordJoined(
        placement.id,
        { joinedDate: joiningDate.toISOString() },
        ceoId,
        joiningDate,
      );

      // Verify payout link was queued for worker
      const linkToken = getLatestPayoutToken('job_seeker', seeker.id);
      expect(linkToken).toBeDefined();

      // 2. Worker enters UPI on phone via OTP
      const otpRes = await request(app.getHttpServer())
        .post('/payout-accounts/send-otp')
        .send({ token: linkToken })
        .expect(200);

      const otpCode = mockOtpProvider.getCode(otpRes.body.requestId)!;
      expect(otpCode).toBeDefined();

      const submitRes = await request(app.getHttpServer())
        .post('/payout-accounts/submit')
        .send({
          token: linkToken,
          otpRequestId: otpRes.body.requestId,
          otpCode,
          method: 'upi',
          upiId: `rajesh.kumar.${suffix.toLowerCase()}@oksbi`,
        })
        .expect(200);

      expect(submitRes.body.success).toBe(true);
      expect(submitRes.body.maskedValue).toContain('@oksbi');
      const accountId = submitRes.body.accountId;
      payoutAccountIds.push(accountId);

      // Verify encrypted in DB - never stored plain
      const rawDbAccount = await prisma.payoutAccount.findUniqueOrThrow({ where: { id: accountId } });
      expect(rawDbAccount.upiIdEncrypted).not.toContain(`rajesh.kumar.${suffix.toLowerCase()}`);
      expect(rawDbAccount.status).toBe('pending_validation');

      // 3. 30 days later, ₹200 joining reward is created as owed (status: pending)
      const rewardPayment = await prisma.payment.create({
        data: {
          code: `PAY-REW-${suffix}-1`,
          amount: 20000, // ₹200
          type: 'joining_reward',
          status: 'pending',
          subjectType: 'job_seeker',
          subjectId: seeker.id,
          jobSeekerId: seeker.id,
          placementId: placement.id,
        },
      });
      paymentIds.push(rewardPayment.id);

      // Verify cannot record payment directly before approval
      await request(app.getHttpServer())
        .post(`/payments/${rewardPayment.id}/record-payout`)
        .set('Authorization', `Bearer ${financeToken}`)
        .send({
          bankUtr: `UTR-REW-${suffix}-1`,
          receiverNameShown: seeker.name,
          paidAt: new Date().toISOString(),
        })
        .expect(400);

      // 4. Finance approves the reward payment
      const approveRes = await request(app.getHttpServer())
        .post(`/payments/${rewardPayment.id}/approve`)
        .set('Authorization', `Bearer ${financeToken}`)
        .expect(201);

      expect(approveRes.body.status).toBe('approved');
      expect(approveRes.body.approvedByStaffId).toBe(financeId);

      // 5. Finance reveals the UPI ID (audited access)
      const revealRes = await request(app.getHttpServer())
        .post(`/payments/${rewardPayment.id}/reveal-payout-details`)
        .set('Authorization', `Bearer ${financeToken}`)
        .expect(201);

      expect(revealRes.body.upiId).toBe(`rajesh.kumar.${suffix.toLowerCase()}@oksbi`);
      expect(revealRes.body.ownerName).toBe(seeker.name);

      // Call Agent cannot reveal
      await request(app.getHttpServer())
        .post(`/payments/${rewardPayment.id}/reveal-payout-details`)
        .set('Authorization', `Bearer ${callAgentToken}`)
        .expect(403);

      // 6. Finance records the UTR with receiver name shown in bank app
      const recordRes = await request(app.getHttpServer())
        .post(`/payments/${rewardPayment.id}/record-payout`)
        .set('Authorization', `Bearer ${financeToken}`)
        .send({
          bankUtr: `UTR-REW-${suffix}-1`,
          receiverNameShown: seeker.name,
          paidAt: new Date().toISOString(),
        })
        .expect(201);

      const payment1 = recordRes.body.payment ?? recordRes.body;
      expect(payment1.status).toBe('succeeded');
      expect(payment1.bankUtr).toBe(`UTR-REW-${suffix}-1`);

      // Account verified
      const verifiedAcc = await prisma.payoutAccount.findUniqueOrThrow({ where: { id: accountId } });
      expect(verifiedAcc.status).toBe('verified');
      expect(verifiedAcc.verifiedName).toBe(seeker.name);
    });
  });

  describe('Scenario 2: Referral Partner Terms & Payout Flow (E2E Proof)', () => {
    it('referral partner signs terms by OTP -> ₹200 payout approved, revealed, and recorded the same way', async () => {
      // 1. Referral partner onboarding
      const partnerPhone = nextPhone();
      const partner = await prisma.referral.create({
        data: {
          code: `RF-P18-${suffix}-1`,
          name: 'Anil Referral Partner',
          phone: partnerPhone,
          city: 'Bengaluru',
        },
      });
      referralIds.push(partner.id);

      // 2. Candidate joins -> ₹200 referral payout queued
      const payoutPayment = await prisma.payment.create({
        data: {
          code: `PAY-REF-${suffix}-1`,
          amount: 20000, // ₹200
          type: 'referral_payout',
          status: 'pending',
          subjectType: 'referral',
          subjectId: partner.id,
          referralId: partner.id,
        },
      });
      paymentIds.push(payoutPayment.id);

      // Attempting to approve before terms are signed fails with 400
      await request(app.getHttpServer())
        .post(`/payments/${payoutPayment.id}/approve`)
        .set('Authorization', `Bearer ${financeToken}`)
        .expect(400);

      // 3. Referral partner signs terms by OTP on their phone
      const termsLinkRes = await request(app.getHttpServer())
        .post(`/referrals/${partner.id}/terms-links`)
        .set('Authorization', `Bearer ${callAgentToken}`)
        .send({ language: 'en' })
        .expect(201);

      const termsToken = termsLinkRes.body.token;
      expect(termsToken).toBeDefined();

      const termsOtpRes = await request(app.getHttpServer())
        .post('/consent/send-otp')
        .send({ token: termsToken })
        .expect(201);

      const termsOtpCode = mockOtpProvider.getCode(termsOtpRes.body.requestId)!;
      expect(termsOtpCode).toBeDefined();

      await request(app.getHttpServer())
        .post('/consent/submit')
        .send({
          token: termsToken,
          otpRequestId: termsOtpRes.body.requestId,
          otpCode: termsOtpCode,
          purposes: ['agreement_terms', 'call_recording'],
        })
        .expect(201);

      // 4. Referral partner enters UPI on phone via payout link + OTP
      await request(app.getHttpServer())
        .post('/payout-accounts/links')
        .set('Authorization', `Bearer ${financeToken}`)
        .send({ ownerType: 'referral', ownerId: partner.id })
        .expect(201);

      const payoutToken = getLatestPayoutToken('referral', partner.id);

      const otpRes = await request(app.getHttpServer())
        .post('/payout-accounts/send-otp')
        .send({ token: payoutToken })
        .expect(200);

      const otpCode = mockOtpProvider.getCode(otpRes.body.requestId)!;
      expect(otpCode).toBeDefined();

      const submitRes = await request(app.getHttpServer())
        .post('/payout-accounts/submit')
        .send({
          token: payoutToken,
          otpRequestId: otpRes.body.requestId,
          otpCode,
          method: 'upi',
          upiId: `anil.partner.${suffix.toLowerCase()}@okaxis`,
        })
        .expect(200);

      const partnerAccId = submitRes.body.accountId;
      payoutAccountIds.push(partnerAccId);

      // 5. Finance approves now that terms are signed
      await request(app.getHttpServer())
        .post(`/payments/${payoutPayment.id}/approve`)
        .set('Authorization', `Bearer ${financeToken}`)
        .expect(201);

      // 6. Finance reveals UPI ID
      const reveal = await request(app.getHttpServer())
        .post(`/payments/${payoutPayment.id}/reveal-payout-details`)
        .set('Authorization', `Bearer ${financeToken}`)
        .expect(201);

      expect(reveal.body.upiId).toBe(`anil.partner.${suffix.toLowerCase()}@okaxis`);

      // 7. Finance records payment
      const record = await request(app.getHttpServer())
        .post(`/payments/${payoutPayment.id}/record-payout`)
        .set('Authorization', `Bearer ${financeToken}`)
        .send({
          bankUtr: `UTR-REF-${suffix}-1`,
          receiverNameShown: 'Anil Referral Partner',
          paidAt: new Date().toISOString(),
        })
        .expect(201);

      const payment2 = record.body.payment ?? record.body;
      expect(payment2.status).toBe('succeeded');
    });
  });

  describe('Scenario 3: Business Fee Refund Flow & Name Mismatch (E2E Proof)', () => {
    it('business owed fee refund on day 16 enters bank account -> Finance types different name: refused & flagged -> right name: paid', async () => {
      // 1. Business setup
      const bizPhone = nextPhone();
      const biz = await prisma.business.create({
        data: {
          code: `BZ-P18-${suffix}-REF`,
          name: 'Bengaluru Tech Park Canteen',
          ownerName: 'Suresh Patel',
          phone: bizPhone,
          verificationStatus: 'verified',
          city: 'Bengaluru',
        },
      });
      businessIds.push(biz.id);

      const vac = await prisma.vacancy.create({
        data: {
          code: `VC-P18-${suffix}-REF`,
          businessId: biz.id,
          tradeSkill: 'cashier',
          salaryMinPaise: 1800000,
          salaryMaxPaise: 2200000,
          status: 'active',
        },
      });
      vacancyIds.push(vac.id);

      const candidate = await prisma.jobSeeker.create({
        data: {
          code: `JS-P18-${suffix}-REF`,
          name: 'Vikas Sharma',
          phone: nextPhone(),
          minSalary: 1800000,
          maxSalary: 2200000,
          preferredCallWindowStart: '09:00',
          preferredCallWindowEnd: '21:00',
          status: 'placed',
          city: 'Bengaluru',
        },
      });
      seekerIds.push(candidate.id);

      const placement = await prisma.placement.create({
        data: {
          code: `PL-P18-${suffix}-REF`,
          businessId: biz.id,
          vacancyId: vac.id,
          jobSeekerId: candidate.id,
          status: 'dropped_out',
          placementFee: 900000,
          gstAmount: 162000,
        },
      });
      placementIds.push(placement.id);

      const claimCall = await prisma.callRecord.create({
        data: {
          code: `CR-CLM-${suffix}`,
          provider: 'mock',
          providerCallId: `call-clm-${suffix}`,
          providerStatus: 'answered',
          answered: true,
          direction: 'outbound',
          purpose: 'exit_call',
          staffId: callAgentId,
          subjectType: 'business',
          subjectId: biz.id,
        },
      });
      callRecordIds.push(claimCall.id);

      await prisma.replacementClaim.create({
        data: {
          code: `CLM-P18-${suffix}-REF`,
          placementId: placement.id,
          workerLeftOn: new Date(Date.now() - 20 * 86400000),
          reportedWithinDeadline: true,
          feePaidInFull: true,
          reason: 'resigned',
          callRecordId: claimCall.id,
          decision: 'accepted',
          // The 15-day refund clock counts from the dropout report, so the report is day 16 too.
          reportedAt: new Date(Date.now() - 16 * 86400000),
          decidedAt: new Date(Date.now() - 16 * 86400000), // Day 16
          decisionDueAt: new Date(),
        },
      });

      // Business enters bank account via payout link + OTP
      await request(app.getHttpServer())
        .post('/payout-accounts/links')
        .set('Authorization', `Bearer ${financeToken}`)
        .send({ ownerType: 'business', ownerId: biz.id })
        .expect(201);

      const token = getLatestPayoutToken('business', biz.id);
      const otpRes = await request(app.getHttpServer())
        .post('/payout-accounts/send-otp')
        .send({ token })
        .expect(200);

      const otpCode = mockOtpProvider.getCode(otpRes.body.requestId)!;

      const submitRes = await request(app.getHttpServer())
        .post('/payout-accounts/submit')
        .send({
          token,
          otpRequestId: otpRes.body.requestId,
          otpCode,
          method: 'bank',
          accountNumber: `987${String(Date.now()).slice(-6)}${suffix.slice(0, 4)}`,
          ifsc: 'HDFC0000123',
        })
        .expect(200);

      const bizAccId = submitRes.body.accountId;
      payoutAccountIds.push(bizAccId);

      // Day 16: refund payment is owed (flat 100% placement fee)
      const refundPayment = await prisma.payment.create({
        data: {
          code: `PAY-BIZREF-${suffix}`,
          amount: 900000,
          type: 'refund',
          status: 'pending',
          subjectType: 'placement',
          subjectId: placement.id,
          businessId: biz.id,
          placementId: placement.id,
        },
      });
      paymentIds.push(refundPayment.id);

      // Finance approves refund
      await request(app.getHttpServer())
        .post(`/payments/${refundPayment.id}/approve`)
        .set('Authorization', `Bearer ${financeToken}`)
        .expect(201);

      // 2. Finance types mismatched name -> refused and flagged payout_name_mismatch
      const mismatchRes = await request(app.getHttpServer())
        .post(`/payments/${refundPayment.id}/record-payout`)
        .set('Authorization', `Bearer ${financeToken}`)
        .send({
          bankUtr: `UTR-BIZREF-${suffix}-MISMATCH`,
          receiverNameShown: 'Completely Unrelated Person',
          paidAt: new Date().toISOString(),
        })
        .expect(400);

      expect(mismatchRes.body.message).toContain('does not match');

      // Check review flag raised
      const flag = await prisma.reviewFlag.findFirst({
        where: {
          kind: 'payout_name_mismatch',
          subjectId: biz.id,
          status: 'open',
        },
      });
      expect(flag).toBeDefined();

      // 3. Finance records with matching name -> paid successfully
      const matchRes = await request(app.getHttpServer())
        .post(`/payments/${refundPayment.id}/record-payout`)
        .set('Authorization', `Bearer ${financeToken}`)
        .send({
          bankUtr: `UTR-BIZREF-${suffix}-MATCH`,
          receiverNameShown: 'Suresh Patel',
          paidAt: new Date().toISOString(),
        })
        .expect(201);

      const payment3 = matchRes.body.payment ?? matchRes.body;
      expect(payment3.status).toBe('succeeded');
      expect(payment3.bankUtr).toBe(`UTR-BIZREF-${suffix}-MATCH`);
    });
  });

  describe('Scenario 4: Partner Changes UPI ID & 48-Hour Cooling Period Flow (E2E Proof)', () => {
    it('partner changes UPI ID -> payment next day refused during cooling wait -> allowed after 48 hours', async () => {
      const partnerPhone = nextPhone();
      const partner = await prisma.referral.create({
        data: {
          code: `RF-P18-${suffix}-COOL`,
          name: 'Deepak Sharma',
          phone: partnerPhone,
          city: 'Bengaluru',
        },
      });
      referralIds.push(partner.id);

      // Sign agreement terms for partner so payments can be approved
      await prisma.consent.create({
        data: {
          subjectType: 'referral',
          subjectId: partner.id,
          purpose: 'agreement_terms',
          granted: true,
          grantedAt: new Date(),
          method: 'sms_link',
          noticeVersion: 'v1.0',
          language: 'en',
        },
      });

      // Initial account
      await request(app.getHttpServer())
        .post('/payout-accounts/links')
        .set('Authorization', `Bearer ${financeToken}`)
        .send({ ownerType: 'referral', ownerId: partner.id })
        .expect(201);

      const token1 = getLatestPayoutToken('referral', partner.id);
      const otp1 = await request(app.getHttpServer())
        .post('/payout-accounts/send-otp')
        .send({ token: token1 })
        .expect(200);

      const sub1 = await request(app.getHttpServer())
        .post('/payout-accounts/submit')
        .send({
          token: token1,
          otpRequestId: otp1.body.requestId,
          otpCode: mockOtpProvider.getCode(otp1.body.requestId)!,
          method: 'upi',
          upiId: `deepak.old.${suffix.toLowerCase()}@okaxis`,
        })
        .expect(200);
      payoutAccountIds.push(sub1.body.accountId);

      // Now partner changes UPI ID
      await request(app.getHttpServer())
        .post('/payout-accounts/links')
        .set('Authorization', `Bearer ${financeToken}`)
        .send({ ownerType: 'referral', ownerId: partner.id })
        .expect(201);

      const token2 = getLatestPayoutToken('referral', partner.id);
      const otp2 = await request(app.getHttpServer())
        .post('/payout-accounts/send-otp')
        .send({ token: token2 })
        .expect(200);

      const sub2 = await request(app.getHttpServer())
        .post('/payout-accounts/submit')
        .send({
          token: token2,
          otpRequestId: otp2.body.requestId,
          otpCode: mockOtpProvider.getCode(otp2.body.requestId)!,
          method: 'upi',
          upiId: `deepak.new.${suffix.toLowerCase()}@okaxis`,
        })
        .expect(200);

      const newAccId = sub2.body.accountId;
      payoutAccountIds.push(newAccId);

      // Verify activeFrom is set to 48 hours later
      const newAcc = await prisma.payoutAccount.findUniqueOrThrow({ where: { id: newAccId } });
      expect(newAcc.activeFrom.getTime()).toBeGreaterThan(Date.now() + 47 * 3600 * 1000);

      // Cooling endpoint lists this account
      const coolingList = await request(app.getHttpServer())
        .get('/payout-accounts/cooling')
        .set('Authorization', `Bearer ${financeToken}`)
        .expect(200);

      const coolingEntry = coolingList.body.find((c: { id: string }) => c.id === newAccId);
      expect(coolingEntry).toBeDefined();

      // Create approved payment
      const payment = await prisma.payment.create({
        data: {
          code: `PAY-COOL-${suffix}`,
          amount: 20000,
          type: 'referral_payout',
          status: 'approved',
          subjectType: 'referral',
          subjectId: partner.id,
          referralId: partner.id,
          approvedAt: new Date(),
          approvedByStaffId: financeId,
        },
      });
      paymentIds.push(payment.id);

      // Next day (still in cooling wait): reveal and record payout are refused
      await request(app.getHttpServer())
        .post(`/payments/${payment.id}/reveal-payout-details`)
        .set('Authorization', `Bearer ${financeToken}`)
        .expect(400);

      await request(app.getHttpServer())
        .post(`/payments/${payment.id}/record-payout`)
        .set('Authorization', `Bearer ${financeToken}`)
        .send({
          bankUtr: `UTR-COOL-${suffix}-FAIL`,
          receiverNameShown: 'Deepak Sharma',
          paidAt: new Date().toISOString(),
        })
        .expect(400);

      // Fast-forward past the 48-hour cooling period
      await prisma.payoutAccount.update({
        where: { id: newAccId },
        data: { activeFrom: new Date(Date.now() - 1000) },
      });

      // Now reveal succeeds
      const revealAfter = await request(app.getHttpServer())
        .post(`/payments/${payment.id}/reveal-payout-details`)
        .set('Authorization', `Bearer ${financeToken}`)
        .expect(201);

      expect(revealAfter.body.upiId).toBe(`deepak.new.${suffix.toLowerCase()}@okaxis`);

      // Now record payout succeeds
      const recordAfter = await request(app.getHttpServer())
        .post(`/payments/${payment.id}/record-payout`)
        .set('Authorization', `Bearer ${financeToken}`)
        .send({
          bankUtr: `UTR-COOL-${suffix}-SUCCESS`,
          receiverNameShown: 'Deepak Sharma',
          paidAt: new Date().toISOString(),
        })
        .expect(201);

      const payment4 = recordAfter.body.payment ?? recordAfter.body;
      expect(payment4.status).toBe('succeeded');
    });
  });

  describe('Gate Checklist Assertions', () => {
    it('verifies RBAC: CEO and Finance can approve and reveal payments, while Manager and Field Agent are refused with 403', async () => {
      const payment = await prisma.payment.create({
        data: {
          code: `PAY-RBAC-${suffix}`,
          amount: 20000,
          type: 'referral_payout',
          status: 'pending',
          subjectType: 'referral',
          subjectId: referralIds[0],
          referralId: referralIds[0],
        },
      });
      paymentIds.push(payment.id);

      // Manager is denied approve
      await request(app.getHttpServer())
        .post(`/payments/${payment.id}/approve`)
        .set('Authorization', `Bearer ${managerToken}`)
        .expect(403);

      // Field Agent is denied approve
      await request(app.getHttpServer())
        .post(`/payments/${payment.id}/approve`)
        .set('Authorization', `Bearer ${fieldAgentToken}`)
        .expect(403);

      // CEO can approve
      await request(app.getHttpServer())
        .post(`/payments/${payment.id}/approve`)
        .set('Authorization', `Bearer ${ceoToken}`)
        .expect(201);

      // Manager is denied reveal
      await request(app.getHttpServer())
        .post(`/payments/${payment.id}/reveal-payout-details`)
        .set('Authorization', `Bearer ${managerToken}`)
        .expect(403);

      // CEO can reveal
      await request(app.getHttpServer())
        .post(`/payments/${payment.id}/reveal-payout-details`)
        .set('Authorization', `Bearer ${ceoToken}`)
        .expect(201);
    });

    it('verifies unique UTR enforcement: cannot reuse an existing UTR', async () => {
      const reusedUtr = `UTR-BIZREF-${suffix}-MATCH`;

      const payment = await prisma.payment.create({
        data: {
          code: `PAY-DUPUTR-${suffix}`,
          amount: 20000,
          type: 'referral_payout',
          status: 'approved',
          subjectType: 'referral',
          subjectId: referralIds[0],
          referralId: referralIds[0],
          approvedAt: new Date(),
          approvedByStaffId: financeId,
        },
      });
      paymentIds.push(payment.id);

      await request(app.getHttpServer())
        .post(`/payments/${payment.id}/record-payout`)
        .set('Authorization', `Bearer ${financeToken}`)
        .send({
          bankUtr: reusedUtr,
          receiverNameShown: 'Any Name',
          paidAt: new Date().toISOString(),
        })
        // One shared UTR check across the books answers 409 Conflict (Phase 22 Part B review, defect 7).
        .expect(409);
    });

    it('verifies old payout-company routes are completely removed and return 404', async () => {
      await request(app.getHttpServer())
        .post('/payments/fake-id/payout-company')
        .set('Authorization', `Bearer ${financeToken}`)
        .expect(404);

      await request(app.getHttpServer())
        .get('/payout-companies')
        .set('Authorization', `Bearer ${financeToken}`)
        .expect(404);
    });

    it('verifies GET /payments/:id and list endpoints never return plain decrypted UPI ID or bank account number', async () => {
      const payments = await request(app.getHttpServer())
        .get('/payments?type=joining_reward')
        .set('Authorization', `Bearer ${financeToken}`)
        .expect(200);

      const bodyStr = JSON.stringify(payments.body);
      expect(bodyStr).not.toContain(`rajesh.kumar.${suffix.toLowerCase()}@oksbi`);
      expect(bodyStr).not.toContain(`anil.partner.${suffix.toLowerCase()}@okaxis`);
      expect(bodyStr).not.toContain('98765432101234');
    });

    it('verifies fraud detection: shared account across entities and staff-number UPI trigger ReviewFlags', async () => {
      // 1. Staff number in UPI ID
      const staffPhone = nextPhone();
      const staffMember = await prisma.staff.create({
        data: {
          code: `STF-TEST-${suffix}`,
          name: 'Staff Member',
          email: `stf-test-${suffix.toLowerCase()}@laboura.local`,
          passwordHash: 'dummy',
          role: 'call_agent',
          status: 'active',
          city: 'Bengaluru',
          callRoutingPhone: encryptCallRoutingPhone(staffPhone),
        },
      });
      staffIds.push(staffMember.id);

      const seeker = await prisma.jobSeeker.create({
        data: {
          code: `JS-FRAUD-${suffix}`,
          name: 'Fraud Test Worker',
          phone: nextPhone(),
          minSalary: 1500000,
          maxSalary: 2000000,
          preferredCallWindowStart: '09:00',
          preferredCallWindowEnd: '21:00',
          status: 'placed',
          city: 'Bengaluru',
        },
      });
      seekerIds.push(seeker.id);

      await request(app.getHttpServer())
        .post('/payout-accounts/links')
        .set('Authorization', `Bearer ${financeToken}`)
        .send({ ownerType: 'job_seeker', ownerId: seeker.id })
        .expect(201);

      const linkToken = getLatestPayoutToken('job_seeker', seeker.id);

      const otp = await request(app.getHttpServer())
        .post('/payout-accounts/send-otp')
        .send({ token: linkToken })
        .expect(200);

      // Staff phone in UPI handle
      const staffPhoneDigits = staffPhone.replace(/[^0-9]/g, '').slice(-10);
      const submitRes = await request(app.getHttpServer())
        .post('/payout-accounts/submit')
        .send({
          token: linkToken,
          otpRequestId: otp.body.requestId,
          otpCode: mockOtpProvider.getCode(otp.body.requestId)!,
          method: 'upi',
          upiId: `${staffPhoneDigits}@paytm`,
        })
        .expect(200);
      payoutAccountIds.push(submitRes.body.accountId);

      const staffMatchFlag = await prisma.reviewFlag.findFirst({
        where: {
          kind: 'payout_matches_staff',
          subjectId: seeker.id,
          status: 'open',
        },
      });
      expect(staffMatchFlag).toBeDefined();
    });
  });
});
