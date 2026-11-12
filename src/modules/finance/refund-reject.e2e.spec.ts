import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import * as request from 'supertest';
import { AppModule } from '../../app.module';
import { PrismaService } from '../../common/prisma/prisma.service';

jest.setTimeout(180000);

const DAY = 24 * 3600 * 1000;

/**
 * FN-Refund "Reject" (POST /finance/refunds/:ref/reject): Finance rejects a
 * refund within its limits with a reason; a business refund above ₹15,000
 * (or outside the rules) is the CEO's; a rejected refund leaves the due list
 * for that guarantee, and paying again starts a new one. Audited.
 */
describe('Finance rejects a refund within its limits', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let jwt: JwtService;
  const stamp = `${Date.now()}`;
  const tail = stamp.slice(-7);
  const staffIds: string[] = [];
  const seekerIds: string[] = [];
  const businessIds: string[] = [];
  const paymentIds: string[] = [];
  const tokens: Record<string, string> = {};

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

  async function paidSeeker(n: number, daysAgo: number) {
    const paidAt = new Date(Date.now() - daysAgo * DAY);
    const seeker = await prisma.jobSeeker.create({
      data: {
        code: `JS-RRJ-${tail}-${n}`,
        name: `Refund Seeker ${n}`,
        phone: `+9196${tail}${n}`.slice(0, 13),
        phoneVerified: true,
        minSalary: 1500000,
        maxSalary: 2000000,
        preferredCallWindowStart: '09:00',
        preferredCallWindowEnd: '21:00',
        status: 'active',
        paymentReceivedAt: paidAt,
      },
    });
    seekerIds.push(seeker.id);
    const payment = await prisma.payment.create({
      data: { code: `PAY-RRJ-${tail}-${n}`, type: 'activation', status: 'succeeded', amount: 49900, subjectType: 'job_seeker', subjectId: seeker.id, jobSeekerId: seeker.id, confirmedAt: paidAt, paidAt },
    });
    paymentIds.push(payment.id);
    return seeker;
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
  }, 120000);

  afterAll(async () => {
    if (!prisma) return;
    await prisma.refundRejection.deleteMany({ where: { rejectedByStaffId: { in: staffIds } } });
    await prisma.statusHistory.deleteMany({ where: { subjectType: 'payment', subjectId: { in: paymentIds } } });
    await prisma.payment.deleteMany({ where: { id: { in: paymentIds } } });
    await prisma.jobSeeker.deleteMany({ where: { id: { in: seekerIds } } });
    await prisma.business.deleteMany({ where: { id: { in: businessIds } } });
    await prisma.auditLog.deleteMany({ where: { actorId: { in: staffIds } } });
    await prisma.staff.deleteMany({ where: { id: { in: staffIds } } });
    await app.close();
  });

  it('needs a reason, takes a ₹499 refund off the due list, is audited, and a new payment starts a new guarantee', async () => {
    const seeker = await paidSeeker(1, 40);
    const ref = `js-${seeker.id}`;
    const before = await request(server()).get('/finance/refunds').set(as('finance')).expect(200);
    expect(before.body.rows.map((r: { ref: string }) => r.ref)).toContain(ref);

    await request(server()).post(`/finance/refunds/${ref}/reject`).set(as('finance')).send({}).expect(400);
    await request(server()).post(`/finance/refunds/${ref}/reject`).set(as('manager')).send({ reason: 'x' }).expect(403);
    await request(server()).post(`/finance/refunds/${ref}/reject`).set(as('team_lead')).send({ reason: 'x' }).expect(403);

    const res = await request(server()).post(`/finance/refunds/${ref}/reject`).set(as('finance')).send({ reason: 'Working at a business we introduced (refund check call)' }).expect(200);
    expect(res.body).toMatchObject({ ref, status: 'rejected', amountPaise: 49900 });
    const after = await request(server()).get('/finance/refunds').set(as('finance')).expect(200);
    expect(after.body.rows.map((r: { ref: string }) => r.ref)).not.toContain(ref);
    const audit = await prisma.auditLog.findFirst({ where: { actorId: staffIds[1], action: 'refund_rejected', entityCode: seeker.code } });
    expect(audit?.reason).toMatch(/Working at a business/);
    // Rejecting again: nothing waiting.
    await request(server()).post(`/finance/refunds/${ref}/reject`).set(as('finance')).send({ reason: 'again' }).expect(404);

    // He pays again (a new guarantee) and its 30 days run out too: a new refund falls due.
    const repaid = new Date(Date.now() - 35 * DAY);
    await prisma.jobSeeker.update({ where: { id: seeker.id }, data: { paymentReceivedAt: repaid } });
    const later = await request(server()).get('/finance/refunds').set(as('finance')).expect(200);
    expect(later.body.rows.map((r: { ref: string }) => r.ref)).toContain(ref);
  });

  it('refuses Finance a business refund above its limit; the CEO rejects it, and the raised refund becomes "rejected"', async () => {
    const business = await prisma.business.create({ data: { code: `BZ-RRJ-${tail}`, name: 'Refund Biz', phone: `+9195${tail}11`.slice(0, 13) } });
    businessIds.push(business.id);
    const big = await prisma.payment.create({
      data: { code: `PAY-RRJ-${tail}-B`, type: 'refund', status: 'pending', amount: 2000000, subjectType: 'business', subjectId: business.id, businessId: business.id },
    });
    paymentIds.push(big.id);
    const ref = `pay-${big.id}`;
    const row = (await request(server()).get('/finance/refunds').set(as('finance')).expect(200)).body.rows.find((r: { ref: string }) => r.ref === ref);
    expect(row).toMatchObject({ approval: 'with_ceo' });

    const refused = await request(server()).post(`/finance/refunds/${ref}/reject`).set(as('finance')).send({ reason: 'Replacement was offered' }).expect(403);
    expect(refused.body.message).toMatch(/CEO/);
    expect((await prisma.payment.findUniqueOrThrow({ where: { id: big.id } })).status).toBe('pending');

    await request(server()).post(`/finance/refunds/${ref}/reject`).set(as('ceo')).send({ reason: 'Replacement was offered and refused' }).expect(200);
    expect((await prisma.payment.findUniqueOrThrow({ where: { id: big.id } })).status).toBe('rejected');
    expect(await prisma.refundRejection.findFirst({ where: { paymentId: big.id } })).toMatchObject({ kind: 'business', rejectedByRole: 'ceo', amountPaise: 2000000 });

    // A business refund within the limit is Finance's to reject.
    const small = await prisma.payment.create({
      data: { code: `PAY-RRJ-${tail}-S`, type: 'refund', status: 'pending', amount: 900000, subjectType: 'business', subjectId: business.id, businessId: business.id },
    });
    paymentIds.push(small.id);
    await request(server()).post(`/finance/refunds/pay-${small.id}/reject`).set(as('finance')).send({ reason: 'Owner hired the worker back' }).expect(200);
    expect((await prisma.payment.findUniqueOrThrow({ where: { id: small.id } })).status).toBe('rejected');
  });
});
