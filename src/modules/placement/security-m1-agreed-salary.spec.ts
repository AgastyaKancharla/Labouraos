import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import * as request from 'supertest';
import { randomUUID } from 'node:crypto';
import { AppModule } from '../../app.module';
import { PrismaService } from '../../common/prisma/prisma.service';
import { UpiCollectionService } from '../payment/upi-collection.service';
import { payPageTokenFor } from '../payment/pay-page-token';
import { PaymentService } from '../payment/payment.service';
import { MessagingService } from '../message/messaging.service';

/**
 * Security follow-up M1 (proved): the agent who created an unpaid placement
 * could change its agreed salary without the fee following — skewing the
 * invoice and the base of a later replacement's salary-difference fee.
 * The agreed salary is CEO only; before payment the fee, GST and the pending
 * UPI request are worked out again in the same transaction.
 */
describe('Security M1: a placement’s agreed salary is CEO only and the unpaid fee follows it', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const suffix = Date.now().toString().slice(-7);
  const digits = suffix.slice(-5);
  const tokens = { ceo: '', agent: '' };
  const ids = { staff: [] as string[], business: '', vacancy: '', branch: '', branchVacancy: '', seekers: [] as string[], placements: [] as string[], payments: [] as string[] };

  const patch = (token: string, id: string, body: object) =>
    request(app.getHttpServer()).patch(`/placements/${id}`).set('Authorization', `Bearer ${token}`).send(body);

  async function placement(overrides: Record<string, unknown> = {}) {
    const n = ids.placements.length + 1;
    const seeker = await prisma.jobSeeker.create({
      data: { code: `JS-M1-${suffix}-${n}`, name: `M1 Worker ${n}`, phone: `+9195${digits}00${n}`, city: 'Bengaluru', minSalary: 1, maxSalary: 2, preferredCallWindowStart: '09:00', preferredCallWindowEnd: '21:00' },
    });
    ids.seekers.push(seeker.id);
    const id = randomUUID();
    const pl = await prisma.placement.create({
      data: {
        id, code: `PL-M1-${suffix}-${n}`, businessId: ids.business, vacancyId: ids.vacancy, jobSeekerId: seeker.id,
        agreedSalary: 1600000, placementFee: 800000, gstAmount: 144000, feePercentAtCreation: 50, gstPercentAtCreation: 18,
        status: 'awaiting_payment', rootPlacementId: id, createdByStaffId: ids.staff[1], city: 'Bengaluru', ...overrides,
      },
    });
    ids.placements.push(pl.id);
    return pl;
  }

  async function pendingRequest(placementId: string, amountPaise = 944000) {
    const req = await app.get(UpiCollectionService).createRequest({
      type: 'placement_fee', subjectType: 'placement', subjectId: placementId, placementId, businessId: ids.business, amountPaise,
    });
    ids.payments.push(req.paymentId);
    return req;
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);
    const jwt = app.get(JwtService);
    for (const [key, role] of [['ceo', 'ceo'], ['agent', 'call_agent']] as const) {
      const s = await prisma.staff.create({ data: { code: `M1${key}-${suffix}`, name: `M1 ${key}`, email: `m1${key}_${suffix}@laboura.local`, passwordHash: 'h', role, city: 'Bengaluru' } });
      ids.staff.push(s.id);
      tokens[key] = await jwt.signAsync({ sub: s.id, role, email: s.email, code: s.code });
    }
    const business = await prisma.business.create({ data: { code: `BZ-M1-${suffix}`, name: `M1 Shop ${suffix}`, phone: `+9194${digits}110`, city: 'Bengaluru' } });
    ids.business = business.id;
    const vacancy = await prisma.vacancy.create({ data: { code: `VC-M1-${suffix}`, businessId: business.id, tradeSkill: 'Cook', city: 'Bengaluru' } });
    ids.vacancy = vacancy.id;
    const branch = await prisma.businessBranch.create({
      data: { businessId: business.id, name: 'M1 Branch', contactPersonName: 'Branch Boss', contactPersonRole: 'manager', contactPersonPhone: `+9194${digits}220` },
    });
    ids.branch = branch.id;
    ids.branchVacancy = (await prisma.vacancy.create({ data: { code: `VC-M1B-${suffix}`, businessId: business.id, branchId: branch.id, tradeSkill: 'Cook', city: 'Bengaluru' } })).id;
  });

  afterAll(async () => {
    try {
      await prisma.statusHistory.deleteMany({ where: { subjectId: { in: ids.payments } } }).catch(() => undefined);
      await prisma.payment.deleteMany({ where: { id: { in: ids.payments } } }).catch(() => undefined);
      await prisma.placement.deleteMany({ where: { id: { in: ids.placements } } }).catch(() => undefined);
      await prisma.reviewFlag.deleteMany({ where: { subjectId: { in: ids.payments } } }).catch(() => undefined);
      await prisma.messageLog.deleteMany({ where: { subjectId: ids.business } }).catch(() => undefined);
      await prisma.vacancy.deleteMany({ where: { id: { in: [ids.vacancy, ids.branchVacancy] } } }).catch(() => undefined);
      await prisma.businessBranch.deleteMany({ where: { id: ids.branch } }).catch(() => undefined);
      await prisma.business.deleteMany({ where: { id: ids.business } }).catch(() => undefined);
      await prisma.jobSeeker.deleteMany({ where: { id: { in: ids.seekers } } }).catch(() => undefined);
      await prisma.auditLog.deleteMany({ where: { actorId: { in: ids.staff } } }).catch(() => undefined);
      await prisma.staff.deleteMany({ where: { id: { in: ids.staff } } }).catch(() => undefined);
    } finally {
      await app?.close();
    }
  });

  it('the creating agent cannot change the salary of an unpaid placement', async () => {
    const pl = await placement();
    const res = await patch(tokens.agent, pl.id, { agreedSalary: 2000000, reason: 'owner said' });
    expect(res.status).toBe(403);
    expect((await prisma.placement.findUniqueOrThrow({ where: { id: pl.id } })).agreedSalary).toBe(1600000);
  });

  it('the CEO changes it before payment: fee, GST and the pending request (and its page) follow, in one go', async () => {
    const pl = await placement();
    const req = await pendingRequest(pl.id);
    const res = await patch(tokens.ceo, pl.id, { agreedSalary: 2000000, reason: 'Owner agreed ₹20,000' });
    expect(res.status).toBe(200);
    const saved = await prisma.placement.findUniqueOrThrow({ where: { id: pl.id } });
    expect([saved.agreedSalary, saved.placementFee, saved.gstAmount]).toEqual([2000000, 1000000, 180000]);
    const payment = await prisma.payment.findUniqueOrThrow({ where: { id: req.paymentId } });
    expect([payment.amount, payment.expectedAmountPaise, payment.status]).toEqual([1180000, 1180000, 'pending']);
    const page = await request(app.getHttpServer()).get(`/payments/request/${payPageTokenFor(req.paymentId)}/summary`).expect(200);
    expect(page.body.amountPaise).toBe(1180000);
    expect(page.body.pay.upiUri).toContain('am=11800.00');
    expect(await prisma.auditLog.count({ where: { action: 'placement.fee_recomputed', entityCode: pl.code } })).toBe(1);
  });

  it('refused while the owner is already paying the old amount (UPI reference sent or card started)', async () => {
    const pl = await placement();
    const req = await pendingRequest(pl.id);
    await prisma.payment.update({ where: { id: req.paymentId }, data: { payerUtrHint: '123456789012' } });
    expect((await patch(tokens.ceo, pl.id, { agreedSalary: 2000000, reason: 'x' })).status).toBe(409);
    const saved = await prisma.placement.findUniqueOrThrow({ where: { id: pl.id } });
    expect([saved.agreedSalary, saved.placementFee]).toEqual([1600000, 800000]);
    expect((await prisma.payment.findUniqueOrThrow({ where: { id: req.paymentId } })).expectedAmountPaise).toBe(944000);
  });

  it('refused for an unpaid replacement (its fee is the salary difference in the chain)', async () => {
    const root = await placement({ status: 'confirmed', paidAt: new Date() });
    const replacement = await placement({ rootPlacementId: root.id, replacementNumber: 1, placementFee: 100000, gstAmount: 18000 });
    expect((await patch(tokens.ceo, replacement.id, { agreedSalary: 2500000, reason: 'x' })).status).toBe(409);
  });

  it('after payment the CEO can still correct the salary; the paid fee is left as it was', async () => {
    const pl = await placement({ status: 'confirmed', paidAt: new Date() });
    expect((await patch(tokens.ceo, pl.id, { agreedSalary: 1700000, reason: 'typo' })).status).toBe(200);
    const saved = await prisma.placement.findUniqueOrThrow({ where: { id: pl.id } });
    expect([saved.agreedSalary, saved.placementFee, saved.gstAmount]).toEqual([1700000, 800000, 144000]);
  });

  it('M1-R1: money checked against the old amount is not confirmed once the amount changed; Finance is flagged', async () => {
    const pl = await placement();
    const req = await pendingRequest(pl.id);
    // A CEO correction lands between the bank match (checked against 944000) and the confirm.
    await prisma.payment.update({ where: { id: req.paymentId }, data: { amount: 1180000, expectedAmountPaise: 1180000 } });
    const result = await app.get(PaymentService).onPaymentSucceeded(req.paymentId, { confirmedAt: new Date(), confirmedBy: 'bank_feed', expectedAmountPaise: 944000 });
    expect(result).toMatchObject({ confirmed: false, amountMismatch: true });
    expect((await prisma.payment.findUniqueOrThrow({ where: { id: req.paymentId } })).status).toBe('pending');
    expect((await prisma.placement.findUniqueOrThrow({ where: { id: pl.id } })).paidAt).toBeNull();
    const flag = await prisma.reviewFlag.findFirstOrThrow({ where: { subjectId: req.paymentId, kind: 'payment_mismatch' } });
    expect(JSON.stringify(flag.details)).toContain('amount_changed_before_confirm');
  });

  it('M1-R3: after a recompute the new request goes to the branch contact, as when it was made', async () => {
    const pl = await placement({ vacancyId: ids.branchVacancy });
    const req = await pendingRequest(pl.id);
    const send = jest.spyOn(app.get(MessagingService), 'send');
    try {
      expect((await patch(tokens.ceo, pl.id, { agreedSalary: 2000000, reason: 'Owner agreed' })).status).toBe(200);
      const requests = send.mock.calls.map(([input]) => input).filter((input) => input.template === 'payment_request');
      expect(requests.length).toBeGreaterThan(0);
      for (const input of requests) expect(input.recipientPhone).toBe(`+9194${digits}220`);
      void req;
    } finally {
      send.mockRestore();
    }
  });
});
