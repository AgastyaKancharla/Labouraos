import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import * as bcrypt from 'bcrypt';
import * as request from 'supertest';
import { AppModule } from '../../app.module';
import { PrismaService } from '../../common/prisma/prisma.service';
import { IdService } from '../../common/id/id.service';
import { enrolledLogin } from '../../test-support/enrolled-login-spec';

/**
 * Money rules end to end (guide: Money rules at a glance, How money is collected,
 * Finance portal and approval limits):
 * - approval limits kept in Settings, changed only by the CEO;
 * - business refunds above Finance's limit, goodwill refunds, and anything Finance
 *   sends go to the CEO, with a clear message and a record of who did what;
 * - a placement fee short by TDS is confirmed as "TDS deducted";
 * - invoices take the company details from Settings and are dated on payment.
 */
describe('Money rules: approval limits, TDS, invoices', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let idService: IdService;

  const timestamp = Date.now();
  const password = 'Password123!';
  let seq = 0;
  const staffEmails: string[] = [];
  const staffIds: Record<string, string> = {};
  const tokens: Record<string, string> = {};
  const businessIds: string[] = [];
  const jobSeekerIds: string[] = [];
  const vacancyIds: string[] = [];
  const placementIds: string[] = [];
  const bankCreditIds: string[] = [];
  const policyIds: string[] = [];

  const DAY = 24 * 60 * 60 * 1000;
  const as = (who: string) => ({ Authorization: `Bearer ${tokens[who]}` });
  const errorCode = (body: { code?: string; details?: { code?: string } }) => body.code ?? body.details?.code;

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);
    idService = app.get(IdService);

    const passwordHash = await bcrypt.hash(password, 10);
    for (const role of ['ceo', 'manager', 'finance']) {
      const email = `${role}_money_${timestamp}@laboura.local`;
      staffEmails.push(email);
      const staff = await prisma.staff.create({
        data: {
          code: `MNY-${role.toUpperCase()}-${timestamp}`,
          name: `Money ${role}`,
          email,
          passwordHash,
          role,
          city: 'Bengaluru',
        },
      });
      staffIds[role] = staff.id;
      const login = await enrolledLogin(app.getHttpServer(), { email, password }).expect(200);
      tokens[role] = login.body.accessToken;
    }
  }, 60000);

  afterAll(async () => {
    if (policyIds.length > 0) {
      await prisma.pricingPolicy.deleteMany({ where: { id: { in: policyIds } } });
    }
    const staff = await prisma.staff.findMany({ where: { email: { in: staffEmails } }, select: { id: true } });
    const staffIdList = staff.map((s) => s.id);
    await prisma.auditLog.deleteMany({ where: { actorId: { in: staffIdList } } });
    await prisma.tdsReceivable.deleteMany({ where: { placementId: { in: placementIds } } });
    await prisma.bankCredit.deleteMany({ where: { id: { in: bankCreditIds } } });
    await prisma.payment.deleteMany({ where: { placementId: { in: placementIds } } });
    await prisma.payment.deleteMany({ where: { businessId: { in: businessIds } } });
    await prisma.reviewFlag.deleteMany({ where: { subjectId: { in: [...placementIds, ...businessIds] } } });
    await prisma.placement.deleteMany({ where: { id: { in: placementIds } } });
    await prisma.vacancy.deleteMany({ where: { id: { in: vacancyIds } } });
    await prisma.payoutAccount.deleteMany({ where: { ownerType: 'business', ownerId: { in: businessIds } } });
    await prisma.business.deleteMany({ where: { id: { in: businessIds } } });
    await prisma.jobSeeker.deleteMany({ where: { id: { in: jobSeekerIds } } });
    await prisma.staffSession.deleteMany({ where: { staffId: { in: staffIdList } } });
    await prisma.staff.deleteMany({ where: { email: { in: staffEmails } } });
    await app.close();
  });

  /** A business, a vacancy, a candidate and a placement in the given state. */
  const createPlacement = async (opts: {
    placementFee: number;
    status: string;
    dropoutReportedAt?: Date;
    paidAt?: Date | null;
    joinedDate?: Date;
  }) => {
    seq += 1;
    const tail = `${String(timestamp).slice(-6)}${String(seq).padStart(2, '0')}`;
    const business = await prisma.business.create({
      data: {
        code: `BZ-MNY-${timestamp}-${seq}`,
        name: `Money Hotel ${seq}`,
        phone: `93${tail}`,
        city: 'Bengaluru',
        verificationStatus: 'verified',
      },
    });
    businessIds.push(business.id);
    const candidate = await prisma.jobSeeker.create({
      data: {
        code: `JS-MNY-${timestamp}-${seq}`,
        name: `Money Candidate ${seq}`,
        phone: `94${tail}`,
        phoneVerified: true,
        status: 'placed',
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
    const placement = await prisma.placement.create({
      data: {
        code: await idService.generateCode('placement'),
        vacancyId: vacancy.id,
        businessId: business.id,
        jobSeekerId: candidate.id,
        status: opts.status,
        agreedSalary: opts.placementFee * 2,
        placementFee: opts.placementFee,
        gstAmount: Math.round((opts.placementFee * 18) / 100),
        city: 'Bengaluru',
        dropoutReportedAt: opts.dropoutReportedAt ?? null,
        paidAt: opts.paidAt === undefined ? new Date(Date.now() - 40 * DAY) : opts.paidAt,
        joinedDate: opts.joinedDate ?? null,
        feePercentAtCreation: 50,
        gstPercentAtCreation: 18,
      },
    });
    placementIds.push(placement.id);
    return { business, candidate, vacancy, placement };
  };

  describe('Approval limits in Settings', () => {
    it('lets Finance read its limits, starting at ₹15,000 for business refunds and ₹10,000 for expenses', async () => {
      const res = await request(app.getHttpServer()).get('/pricing/approval-limits').set(as('finance')).expect(200);
      expect(res.body).toEqual({ businessRefundLimitPaise: 1500000, expenseLimitPaise: 1000000 });
    });

    it('lets only the CEO change them, and every change is a new audited version', async () => {
      for (const who of ['finance', 'manager']) {
        await request(app.getHttpServer())
          .put('/pricing/approval-limits')
          .set(as(who))
          .send({ businessRefundLimitPaise: 99999999, expenseLimitPaise: 99999999 })
          .expect(403);
      }

      await request(app.getHttpServer())
        .put('/pricing/approval-limits')
        .set(as('ceo'))
        .send({ businessRefundLimitPaise: 12.5, expenseLimitPaise: 1000000 })
        .expect(400);

      const res = await request(app.getHttpServer())
        .put('/pricing/approval-limits')
        .set(as('ceo'))
        .send({ businessRefundLimitPaise: 2000000, expenseLimitPaise: 1200000 })
        .expect(200);
      policyIds.push(res.body.id);
      expect(res.body.financeBusinessRefundLimitPaise).toBe(2000000);
      expect(res.body.financeExpenseLimitPaise).toBe(1200000);

      const audit = await prisma.auditLog.findFirst({
        where: { action: 'pricing_change', entityCode: res.body.id, actorId: staffIds.ceo },
      });
      expect(audit).not.toBeNull();

      // Put the launch values back for the rest of the suite.
      await prisma.pricingPolicy.deleteMany({ where: { id: { in: policyIds.splice(0) } } });
      const after = await request(app.getHttpServer()).get('/pricing/approval-limits').set(as('ceo')).expect(200);
      expect(after.body.businessRefundLimitPaise).toBe(1500000);
    });
  });

  describe('Business refund approval', () => {
    it('lets Finance approve and pay an eligible refund within the limit directly', async () => {
      const { placement } = await createPlacement({
        placementFee: 944000,
        status: 'dropped_out',
        dropoutReportedAt: new Date(Date.now() - 20 * DAY),
      });
      const res = await request(app.getHttpServer())
        .post(`/placements/${placement.id}/refund`)
        .set(as('finance'))
        .send({})
        .expect(201);
      expect(res.body.status).toBe('approved');
      expect(res.body.approvedByStaffId).toBe(staffIds.finance);
      expect(res.body.ceoApprovalReason).toBeNull();
    });

    it('sends a refund above ₹15,000 to the CEO with a clear message, and the CEO approves it', async () => {
      const { placement } = await createPlacement({
        placementFee: 1770000,
        status: 'dropped_out',
        dropoutReportedAt: new Date(Date.now() - 20 * DAY),
      });

      const finance = await request(app.getHttpServer())
        .post(`/placements/${placement.id}/refund`)
        .set(as('finance'))
        .send({ reason: 'No replacement in 15 days' })
        .expect(403);
      expect(errorCode(finance.body)).toBe('refund_sent_to_ceo');
      expect(finance.body.message).toMatch(/above Finance's approval limit of ₹15,000/);
      expect(finance.body.message).toMatch(/has been sent to the CEO/);

      const pending = await prisma.payment.findFirstOrThrow({ where: { placementId: placement.id, type: 'refund' } });
      expect(pending.status).toBe('pending');
      expect(pending.amount).toBe(1770000);
      expect(pending.ceoApprovalReason).toBe('above_finance_limit');
      expect(pending.sentToCeoByStaffId).toBe(staffIds.finance);
      expect(pending.approvedByStaffId).toBeNull();

      // Finance trying again, by either route, is refused: it is with the CEO.
      const again = await request(app.getHttpServer())
        .post(`/placements/${placement.id}/refund`)
        .set(as('finance'))
        .send({})
        .expect(403);
      expect(errorCode(again.body)).toBe('refund_with_ceo');
      await request(app.getHttpServer()).post(`/payments/${pending.id}/approve`).set(as('finance')).expect(403);

      const withCeo = await request(app.getHttpServer()).get('/payments/refunds/with-ceo').set(as('ceo')).expect(200);
      expect(withCeo.body.map((p: { id: string }) => p.id)).toContain(pending.id);

      const ceo = await request(app.getHttpServer())
        .post(`/placements/${placement.id}/refund`)
        .set(as('ceo'))
        .send({})
        .expect(201);
      expect(ceo.body.id).toBe(pending.id);
      expect(ceo.body.status).toBe('approved');
      expect(ceo.body.approvedByStaffId).toBe(staffIds.ceo);

      const ended = await prisma.placement.findUniqueOrThrow({ where: { id: placement.id } });
      expect(ended.status).toBe('guarantee_ended');
      expect(ended.guaranteeEndedReason).toBe('refunded');

      const sentAudit = await prisma.auditLog.findFirst({
        where: { action: 'refund_sent_to_ceo', entityCode: placement.code, actorId: staffIds.finance },
      });
      expect(sentAudit).not.toBeNull();
      const approvedAudit = await prisma.auditLog.findFirst({
        where: { action: 'refund_approved', entityCode: placement.code, actorId: staffIds.ceo },
      });
      expect(approvedAudit?.after).toEqual(
        expect.objectContaining({ ceoApprovalReason: 'above_finance_limit', sentToCeoByStaffId: staffIds.finance }),
      );
    });

    it('always sends a goodwill refund to the CEO, who can approve it outside the rules', async () => {
      // Reported 3 days ago: the rules say no refund yet.
      const { placement } = await createPlacement({
        placementFee: 944000,
        status: 'dropped_out',
        dropoutReportedAt: new Date(Date.now() - 3 * DAY),
      });

      await request(app.getHttpServer())
        .post(`/placements/${placement.id}/refund`)
        .set(as('finance'))
        .send({ goodwill: true })
        .expect(400);

      const finance = await request(app.getHttpServer())
        .post(`/placements/${placement.id}/refund`)
        .set(as('finance'))
        .send({ goodwill: true, amountPaise: 300000, reason: 'Owner was promised a part refund on the visit' })
        .expect(403);
      expect(errorCode(finance.body)).toBe('refund_sent_to_ceo');
      expect(finance.body.message).toMatch(/always needs the CEO/);

      const pending = await prisma.payment.findFirstOrThrow({ where: { placementId: placement.id, type: 'refund' } });
      expect(pending.outsideRules).toBe(true);
      expect(pending.ceoApprovalReason).toBe('goodwill');
      expect(pending.amount).toBe(300000);
      expect(pending.approvalNote).toBe('Owner was promised a part refund on the visit');

      const ceo = await request(app.getHttpServer()).post(`/payments/${pending.id}/approve`).set(as('ceo')).expect(201);
      expect(ceo.body.status).toBe('approved');
      expect(ceo.body.approvedByStaffId).toBe(staffIds.ceo);

      // A goodwill refund does not change the placement.
      const after = await prisma.placement.findUniqueOrThrow({ where: { id: placement.id } });
      expect(after.status).toBe('dropped_out');
    });

    it('refuses a goodwill refund above the fee paid', async () => {
      const { placement } = await createPlacement({
        placementFee: 944000,
        status: 'dropped_out',
        dropoutReportedAt: new Date(Date.now() - 3 * DAY),
      });
      await request(app.getHttpServer())
        .post(`/placements/${placement.id}/refund`)
        .set(as('ceo'))
        .send({ goodwill: true, amountPaise: 944001, reason: 'too much' })
        .expect(400);
    });

    it('lets Finance send a refund to the CEO, and lets only the CEO reject it with a reason', async () => {
      const { placement } = await createPlacement({
        placementFee: 944000,
        status: 'dropped_out',
        dropoutReportedAt: new Date(Date.now() - 20 * DAY),
      });
      const sent = await request(app.getHttpServer())
        .post(`/placements/${placement.id}/refund`)
        .set(as('finance'))
        .send({ sendToCeo: true, reason: 'One replacement was refused; please check the reason' })
        .expect(201);
      expect(sent.body.status).toBe('pending');
      expect(sent.body.ceoApprovalReason).toBe('sent_by_finance');
      expect(sent.body.message).toMatch(/sent to the CEO/);

      await request(app.getHttpServer())
        .post(`/payments/${sent.body.id}/reject-refund`)
        .set(as('finance'))
        .send({ reason: 'no' })
        .expect(403);
      await request(app.getHttpServer())
        .post(`/payments/${sent.body.id}/reject-refund`)
        .set(as('ceo'))
        .send({ reason: ' ' })
        .expect(400);
      const rejected = await request(app.getHttpServer())
        .post(`/payments/${sent.body.id}/reject-refund`)
        .set(as('ceo'))
        .send({ reason: 'The owner refused a suitable replacement' })
        .expect(201);
      expect(rejected.body.status).toBe('rejected');

      // After the CEO says no, Finance cannot approve a refund for it on its own.
      const finance = await request(app.getHttpServer())
        .post(`/placements/${placement.id}/refund`)
        .set(as('finance'))
        .send({})
        .expect(403);
      expect(errorCode(finance.body)).toBe('refund_rejected_by_ceo');
    });
  });

  describe('Placement fee short by TDS', () => {
    it('confirms the placement and records the TDS receivable when Finance records the short amount as TDS', async () => {
      const { placement } = await createPlacement({ placementFee: 750000, status: 'awaiting_payment', paidAt: null });
      const fee = await prisma.payment.create({
        data: {
          code: await idService.generateCode('payment'),
          type: 'placement_fee',
          amount: 885000,
          expectedAmountPaise: 885000,
          status: 'pending',
          subjectType: 'placement',
          subjectId: placement.id,
          placementId: placement.id,
          businessId: placement.businessId,
          city: 'Bengaluru',
        },
      });

      const credit = await request(app.getHttpServer())
        .post('/payments/bank-credits')
        .set(as('finance'))
        .send({ bankUtr: `TDS${timestamp}`, amountPaise: 810000, receivedAt: new Date().toISOString() })
        .expect(201);
      bankCreditIds.push(credit.body.id);

      const refused = await request(app.getHttpServer())
        .post(`/payments/${fee.id}/confirm`)
        .set(as('finance'))
        .send({ bankCreditId: credit.body.id })
        .expect(400);
      expect(refused.body.message).toMatch(/TDS deducted/);

      const confirmed = await request(app.getHttpServer())
        .post(`/payments/${fee.id}/confirm`)
        .set(as('finance'))
        .send({ bankCreditId: credit.body.id, tdsDeductedPaise: 75000, tdsNote: 'Section to be confirmed by the CA' })
        .expect(201);
      expect(confirmed.body.tdsDeductedPaise).toBe(75000);

      const after = await prisma.placement.findUniqueOrThrow({ where: { id: placement.id } });
      expect(after.status).toBe('confirmed');

      await request(app.getHttpServer()).get('/payments/tds-receivables').set(as('manager')).expect(403);
      const list = await request(app.getHttpServer())
        .get(`/payments/tds-receivables?placementId=${placement.id}`)
        .set(as('finance'))
        .expect(200);
      expect(list.body).toHaveLength(1);
      expect(list.body[0]).toEqual(
        expect.objectContaining({
          amountPaise: 75000,
          status: 'certificate_due',
          sectionNote: 'Section to be confirmed by the CA',
          recordedByStaffId: staffIds.finance,
        }),
      );
    });
  });

  describe('GST invoice details', () => {
    it('uses Laboura Private Limited by default, takes company details from Settings, and is dated on payment', async () => {
      const paidAt = new Date('2026-11-02T06:30:00.000Z');
      const joinedDate = new Date('2026-11-05T04:30:00.000Z');
      const { placement } = await createPlacement({
        placementFee: 750000,
        status: 'confirmed',
        paidAt,
        joinedDate,
      });
      await prisma.payment.create({
        data: {
          code: await idService.generateCode('payment'),
          type: 'placement_fee',
          amount: 885000,
          status: 'succeeded',
          confirmedAt: paidAt,
          subjectType: 'placement',
          subjectId: placement.id,
          placementId: placement.id,
          businessId: placement.businessId,
          city: 'Bengaluru',
        },
      });

      const before = await request(app.getHttpServer())
        .get(`/placements/${placement.id}/invoice`)
        .set(as('ceo'))
        .expect(200);
      expect(before.body.supplier.legalName).toBe('Laboura Private Limited');
      expect(before.body.invoiceDate).toBe(paidAt.toISOString());

      await request(app.getHttpServer())
        .put('/pricing/company-details')
        .set(as('finance'))
        .send({ legalName: 'Someone Else Pvt Ltd' })
        .expect(403);
      await request(app.getHttpServer())
        .put('/pricing/company-details')
        .set(as('ceo'))
        .send({ legalName: 'Laboura Private Limited', gstin: 'not-a-gstin' })
        .expect(400);

      const saved = await request(app.getHttpServer())
        .put('/pricing/company-details')
        .set(as('ceo'))
        .send({ legalName: 'Laboura Private Limited', gstin: '29aabcl1234f1zq', address: '12 Test Road, Bengaluru 560076' })
        .expect(200);
      policyIds.push(saved.body.id);

      try {
        const after = await request(app.getHttpServer())
          .get(`/placements/${placement.id}/invoice`)
          .set(as('ceo'))
          .expect(200);
        expect(after.body.supplier.legalName).toBe('Laboura Private Limited');
        expect(after.body.supplier.gstin).toBe('29AABCL1234F1ZQ');
        expect(after.body.supplier.address).toBe('12 Test Road, Bengaluru 560076');
      } finally {
        await prisma.pricingPolicy.deleteMany({ where: { id: { in: policyIds.splice(0) } } });
      }
    });
  });
});
