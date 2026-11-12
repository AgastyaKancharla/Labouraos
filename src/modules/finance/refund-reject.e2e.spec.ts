import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import * as request from 'supertest';
import { AppModule } from '../../app.module';
import { PrismaService } from '../../common/prisma/prisma.service';

jest.setTimeout(180000);

const DAY = 24 * 3600 * 1000;

/**
 * FN-Refund "Reject" (POST /finance/refunds/:ref/reject) and the CEO's reject:
 * - R1: whether it is the CEO's comes from the payment itself (outside the
 *   rules, with the CEO, or a business refund above ₹15,000), whatever its status;
 * - R2: Finance rejects only a due row or a pending refund; the CEO cancels an
 *   approved one, which puts the job seeker or placement back, with history;
 * - R3: only a rule-based refund leaves a RefundRejection;
 * - R4: a rejected refund is raised again only by the CEO, overriding with a reason;
 * - R5: the CEO's POST /payments/:id/reject-refund writes the same RefundRejection.
 */
describe('Rejecting a refund: limits, approved refunds, rule-based rejections', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let jwt: JwtService;
  const stamp = `${Date.now()}`;
  const tail = stamp.slice(-7);
  const staffIds: string[] = [];
  const seekerIds: string[] = [];
  const businessIds: string[] = [];
  const vacancyIds: string[] = [];
  const placementIds: string[] = [];
  const paymentIds: string[] = [];
  const tokens: Record<string, string> = {};
  let businessId = '';
  let vacancyId = '';
  let n = 0;

  async function makeStaff(role: string) {
    const staff = await prisma.staff.create({
      data: { code: `RRJ-${role}-${stamp}`, name: `RRJ ${role}`, email: `rrj-${role}-${stamp}@laboura.local`, passwordHash: 'hash', role, status: 'active' },
    });
    staffIds.push(staff.id);
    tokens[role] = jwt.sign({ sub: staff.id, email: staff.email, role, code: staff.code, teamLeadId: null });
    return staff;
  }
  const as = (role: string) => ({ Authorization: `Bearer ${tokens[role]}` });
  const server = () => app.getHttpServer();
  const reject = (ref: string, role: string, reason?: string) =>
    request(server()).post(`/finance/refunds/${ref}/reject`).set(as(role)).send(reason === undefined ? {} : { reason });

  async function paidSeeker(daysAgo: number, status = 'active') {
    n += 1;
    const paidAt = new Date(Date.now() - daysAgo * DAY);
    const seeker = await prisma.jobSeeker.create({
      data: {
        code: `JS-RRJ-${tail}-${n}`,
        name: `Refund Seeker ${n}`,
        phone: `+9196${tail.slice(-5)}${String(n).padStart(3, '0')}`,
        phoneVerified: true,
        minSalary: 1500000,
        maxSalary: 2000000,
        preferredCallWindowStart: '09:00',
        preferredCallWindowEnd: '21:00',
        status,
        paymentReceivedAt: paidAt,
      },
    });
    seekerIds.push(seeker.id);
    const payment = await prisma.payment.create({
      data: { code: `PAY-RRJ-${tail}-A${n}`, type: 'activation', status: 'succeeded', amount: 49900, subjectType: 'job_seeker', subjectId: seeker.id, jobSeekerId: seeker.id, confirmedAt: paidAt, paidAt },
    });
    paymentIds.push(payment.id);
    return seeker;
  }

  async function placement(status = 'dropped_out') {
    const seeker = await paidSeeker(90, 'placed');
    const row = await prisma.placement.create({
      data: { code: `PL-RRJ-${tail}-${n}`, vacancyId, jobSeekerId: seeker.id, businessId, placementFee: 750000, gstAmount: 135000, agreedSalary: 1500000, status, paidAt: new Date(Date.now() - 60 * DAY), joinedDate: new Date(Date.now() - 55 * DAY) },
    });
    placementIds.push(row.id);
    return row;
  }

  async function refundPayment(data: Record<string, unknown>) {
    n += 1;
    const p = await prisma.payment.create({ data: { code: `PAY-RRJ-${tail}-R${n}`, type: 'refund', status: 'pending', amount: 900000, subjectType: 'placement', subjectId: 'x', ...data } as never });
    paymentIds.push(p.id);
    return p;
  }

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);
    jwt = app.get(JwtService);
    await makeStaff('ceo');
    await makeStaff('finance');
    await makeStaff('manager');
    await makeStaff('team_lead');
    const business = await prisma.business.create({ data: { code: `BZ-RRJ-${tail}`, name: 'Refund Biz', phone: `+9195${tail}11`.slice(0, 13) } });
    businessId = business.id;
    businessIds.push(business.id);
    const vacancy = await prisma.vacancy.create({
      data: { code: `VC-RRJ-${tail}`, businessId, tradeSkill: 'cook', headcount: 3, status: 'open', salaryMinPaise: 1500000, salaryMaxPaise: 2000000, salaryPeriod: 'monthly', shift: 'day', latitude: 12.93, longitude: 77.62 },
    });
    vacancyId = vacancy.id;
    vacancyIds.push(vacancy.id);
  }, 120000);

  afterAll(async () => {
    if (!prisma) return;
    await prisma.refundRejection.deleteMany({ where: { OR: [{ rejectedByStaffId: { in: staffIds } }, { jobSeekerId: { in: seekerIds } }, { placementId: { in: placementIds } }] } });
    await prisma.statusHistory.deleteMany({ where: { OR: [{ subjectId: { in: [...paymentIds, ...placementIds, ...seekerIds] } }] } });
    await prisma.payment.deleteMany({ where: { OR: [{ id: { in: paymentIds } }, { jobSeekerId: { in: seekerIds } }, { placementId: { in: placementIds } }] } });
    await prisma.placement.deleteMany({ where: { id: { in: placementIds } } });
    await prisma.vacancy.deleteMany({ where: { id: { in: vacancyIds } } });
    await prisma.jobSeeker.deleteMany({ where: { id: { in: seekerIds } } });
    await prisma.business.deleteMany({ where: { id: { in: businessIds } } });
    await prisma.auditLog.deleteMany({ where: { actorId: { in: staffIds } } });
    await prisma.staff.deleteMany({ where: { id: { in: staffIds } } });
    await app.close();
  });

  it('a due ₹499 refund: needs a reason, leaves the due list, is audited; raising it again is the CEO\'s with an override (R4); a new payment starts a new guarantee', async () => {
    const seeker = await paidSeeker(40);
    const ref = `js-${seeker.id}`;
    const before = await request(server()).get('/finance/refunds').set(as('finance')).expect(200);
    expect(before.body.rows.map((r: { ref: string }) => r.ref)).toContain(ref);

    await reject(ref, 'finance').expect(400);
    await reject(ref, 'manager', 'x').expect(403);
    await reject(ref, 'team_lead', 'x').expect(403);

    const res = await reject(ref, 'finance', 'Working at a business we introduced (refund check call)').expect(200);
    expect(res.body).toMatchObject({ ref, status: 'rejected', amountPaise: 49900 });
    const after = await request(server()).get('/finance/refunds').set(as('finance')).expect(200);
    expect(after.body.rows.map((r: { ref: string }) => r.ref)).not.toContain(ref);
    const audit = await prisma.auditLog.findFirst({ where: { actorId: staffIds[1], action: 'refund_rejected', entityCode: seeker.code } });
    expect(audit?.reason).toMatch(/Working at a business/);
    await reject(ref, 'finance', 'again').expect(404);
    expect(await prisma.refundRejection.count({ where: { jobSeekerId: seeker.id } })).toBe(1);

    // R4: Finance cannot raise it again; the CEO only by overriding with a reason.
    const fin = await request(server()).post(`/job-seekers/${seeker.id}/refund`).set(as('finance')).send({}).expect(403);
    expect(fin.body.code).toBe('refund_rejected');
    const noOverride = await request(server()).post(`/job-seekers/${seeker.id}/refund`).set(as('ceo')).send({ goodwill: true, reason: 'He asked again' }).expect(409);
    expect(noOverride.body.code).toBe('refund_rejected');
    const overridden = await request(server()).post(`/job-seekers/${seeker.id}/refund`).set(as('ceo')).send({ goodwill: true, overrideRejection: true, reason: 'The refund check call was a mix-up' });
    expect(overridden.status).toBe(201);
    paymentIds.push(overridden.body.id);

    // He pays again (a new guarantee) and its 30 days run out too: a new refund falls due.
    await prisma.payment.updateMany({ where: { id: overridden.body.id }, data: { status: 'rejected' } });
    await prisma.jobSeeker.update({ where: { id: seeker.id }, data: { paymentReceivedAt: new Date(Date.now() - 35 * DAY), status: 'active' } });
    const later = await request(server()).get('/finance/refunds').set(as('finance')).expect(200);
    expect(later.body.rows.map((r: { ref: string }) => r.ref)).toContain(ref);
  });

  it('N1: a refund in a second guarantee can be rejected though the first guarantee was refunded', async () => {
    const seeker = await paidSeeker(80);
    const first = await prisma.payment.findFirstOrThrow({ where: { jobSeekerId: seeker.id, type: 'activation' } });
    await prisma.payment.update({ where: { id: first.id }, data: { createdAt: new Date(Date.now() - 80 * DAY) } });
    const oldRefund = await prisma.payment.create({
      data: { code: `PAY-RRJ-${tail}-OLD`, type: 'refund', status: 'completed', amount: 49900, subjectType: 'job_seeker', subjectId: seeker.id, jobSeekerId: seeker.id, refundsPaymentId: first.id, paidAt: new Date(Date.now() - 45 * DAY), createdAt: new Date(Date.now() - 46 * DAY) },
    });
    paymentIds.push(oldRefund.id);
    // He pays ₹499 again: a new guarantee, which also runs out.
    const repaidAt = new Date(Date.now() - 35 * DAY);
    const second = await prisma.payment.create({
      data: { code: `PAY-RRJ-${tail}-A2`, type: 'activation', status: 'succeeded', amount: 49900, subjectType: 'job_seeker', subjectId: seeker.id, jobSeekerId: seeker.id, confirmedAt: repaidAt, paidAt: repaidAt, createdAt: repaidAt },
    });
    paymentIds.push(second.id);
    await prisma.jobSeeker.update({ where: { id: seeker.id }, data: { paymentReceivedAt: repaidAt, status: 'active' } });
    const ref = `js-${seeker.id}`;
    const due = await request(server()).get('/finance/refunds').set(as('finance')).expect(200);
    expect(due.body.rows.map((r: { ref: string }) => r.ref)).toContain(ref);
    await reject(ref, 'finance', 'Refund check: working at a business we introduced').expect(200);
    expect(await prisma.refundRejection.findFirst({ where: { jobSeekerId: seeker.id } })).toMatchObject({ guaranteeStartedAt: repaidAt });
  });

  it('R1: a business refund above the limit is the CEO\'s whatever its status; the CEO rejects it and the chain gets one rejection', async () => {
    const pl = await placement();
    const big = await refundPayment({ amount: 2000000, subjectId: pl.id, placementId: pl.id, businessId });
    const refused = await reject(`pay-${big.id}`, 'finance', 'Replacement was offered').expect(403);
    expect(refused.body.message).toMatch(/CEO/);
    expect((await prisma.payment.findUniqueOrThrow({ where: { id: big.id } })).status).toBe('pending');
    await reject(`pay-${big.id}`, 'ceo', 'Replacement was offered and refused').expect(200);
    expect((await prisma.payment.findUniqueOrThrow({ where: { id: big.id } })).status).toBe('rejected');
    expect(await prisma.refundRejection.findFirst({ where: { placementId: pl.id } })).toMatchObject({ kind: 'business', rejectedByRole: 'ceo', amountPaise: 2000000, paymentId: big.id });

    // Approved and above the limit: still the CEO's.
    const pl2 = await placement();
    const approvedBig = await refundPayment({ amount: 2000000, status: 'approved', subjectId: pl2.id, placementId: pl2.id, businessId });
    expect((await reject(`pay-${approvedBig.id}`, 'finance', 'x').expect(403)).body.message).toMatch(/CEO/);
  });

  it('R2: Finance cannot reject an approved refund; the CEO cancels it and the placement goes back as it was', async () => {
    const pl = await placement('guarantee_ended');
    await prisma.placement.update({ where: { id: pl.id }, data: { guaranteeEndedReason: 'refunded' } });
    await prisma.statusHistory.create({ data: { subjectType: 'placement', subjectId: pl.id, fromStatus: 'dropped_out', toStatus: 'guarantee_ended', reason: 'refunded', changedAt: new Date(Date.now() - DAY) } });
    const approved = await refundPayment({ amount: 900000, status: 'approved', subjectId: pl.id, placementId: pl.id, businessId });
    const fin = await reject(`pay-${approved.id}`, 'finance', 'Not owed').expect(403);
    expect(fin.body.message).toMatch(/only the CEO can cancel/);

    const res = await reject(`pay-${approved.id}`, 'ceo', 'Owner hired the worker back').expect(200);
    expect(res.body).toMatchObject({ status: 'rejected', cancelled: true });
    expect((await prisma.payment.findUniqueOrThrow({ where: { id: approved.id } })).status).toBe('rejected');
    expect(await prisma.placement.findUniqueOrThrow({ where: { id: pl.id } })).toMatchObject({ status: 'dropped_out', guaranteeEndedReason: null });
    expect(await prisma.statusHistory.count({ where: { subjectType: 'placement', subjectId: pl.id, reason: 'refund_cancelled_by_ceo' } })).toBe(1);
    expect(await prisma.statusHistory.count({ where: { subjectType: 'payment', subjectId: approved.id, fromStatus: 'approved', toStatus: 'rejected' } })).toBe(1);
    expect(await prisma.auditLog.count({ where: { actorId: staffIds[0], action: 'refund_cancelled' } })).toBeGreaterThanOrEqual(1);

    // R4: a new refund for that placement is refused for Finance.
    const again = await request(server()).post(`/placements/${pl.id}/refund`).set(as('finance')).send({});
    expect(again.status).toBe(403);
    expect(['refund_rejected', 'refund_rejected_by_ceo']).toContain(again.body.code);
  });

  it('N2: cancelling an approved ₹499 refund puts the job seeker back; with no approval history he goes back to active, and the history says so', async () => {
    const seeker = await paidSeeker(40, 'refunded');
    const activation = await prisma.payment.findFirstOrThrow({ where: { jobSeekerId: seeker.id, type: 'activation' } });
    const approved = await prisma.payment.create({
      data: { code: `PAY-RRJ-${tail}-N2`, type: 'refund', status: 'approved', amount: 49900, subjectType: 'job_seeker', subjectId: seeker.id, jobSeekerId: seeker.id, refundsPaymentId: activation.id },
    });
    paymentIds.push(approved.id);
    await reject(`pay-${approved.id}`, 'finance', 'x').expect(403);
    const res = await reject(`pay-${approved.id}`, 'ceo', 'The refund check was wrong: he is still looking').expect(200);
    expect(res.body).toMatchObject({ cancelled: true, restored: [{ subject: 'job_seeker', from: 'refunded', to: 'active' }] });
    expect((await prisma.jobSeeker.findUniqueOrThrow({ where: { id: seeker.id } })).status).toBe('active');
    expect(await prisma.statusHistory.findFirst({ where: { subjectType: 'job_seeker', subjectId: seeker.id, toStatus: 'active' } })).toMatchObject({ fromStatus: 'refunded', reason: 'refund_cancelled_by_ceo_no_history_back_to_active' });
  });

  it('R3: a duplicate ₹499 refund or a goodwill refund turned down leaves no rejection', async () => {
    const seeker = await paidSeeker(5);
    const dup = await prisma.payment.create({ data: { code: `PAY-RRJ-${tail}-D`, type: 'duplicate_refund', status: 'pending', amount: 49900, subjectType: 'job_seeker', subjectId: seeker.id, jobSeekerId: seeker.id } });
    paymentIds.push(dup.id);
    await reject(`pay-${dup.id}`, 'finance', 'He paid once only: the bank shows one credit').expect(200);
    expect((await prisma.payment.findUniqueOrThrow({ where: { id: dup.id } })).status).toBe('rejected');

    const pl = await placement();
    const goodwill = await refundPayment({ amount: 300000, outsideRules: true, ceoApprovalReason: 'goodwill', subjectId: pl.id, placementId: pl.id, businessId });
    await reject(`pay-${goodwill.id}`, 'finance', 'x').expect(403);
    await reject(`pay-${goodwill.id}`, 'ceo', 'No goodwill this time').expect(200);
    expect(await prisma.refundRejection.count({ where: { OR: [{ jobSeekerId: seeker.id }, { placementId: pl.id }] } })).toBe(0);
  });

  it('R5: the CEO\'s reject-refund records the same rejection, so the refund does not come back as due', async () => {
    const pl = await placement();
    const sent = await refundPayment({ amount: 1600000, ceoApprovalReason: 'above_finance_limit', sentToCeoAt: new Date(), subjectId: pl.id, placementId: pl.id, businessId });
    await request(server()).post(`/payments/${sent.id}/reject-refund`).set(as('ceo')).send({ reason: 'A replacement joined on day 12' }).expect(201);
    expect((await prisma.payment.findUniqueOrThrow({ where: { id: sent.id } })).status).toBe('rejected');
    expect(await prisma.refundRejection.findFirst({ where: { placementId: pl.id } })).toMatchObject({ kind: 'business', rejectedByRole: 'ceo', paymentId: sent.id, reason: 'A replacement joined on day 12' });
    const due = await request(server()).get('/finance/refunds').set(as('finance')).expect(200);
    expect(due.body.rows.map((r: { ref: string }) => r.ref)).not.toContain(`pl-${pl.id}`);
  });
});
