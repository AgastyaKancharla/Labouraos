import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import * as request from 'supertest';
import { AppModule } from '../../app.module';
import { PrismaService } from '../../common/prisma/prisma.service';

jest.setTimeout(180000);

/** FN-Invoices "Tell the account agent": a bell to the business's account agent, with no rupee amount. */
describe('Finance tells the account agent about an unpaid placement fee', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let jwt: JwtService;
  const stamp = `${Date.now()}`;
  const tail = stamp.slice(-7);
  const staffIds: string[] = [];
  const paymentIds: string[] = [];
  const businessIds: string[] = [];
  const tokens: Record<string, string> = {};
  const ids: Record<string, string> = {};

  async function makeStaff(role: string, key = role) {
    const staff = await prisma.staff.create({
      data: { code: `FIA-${key}-${stamp}`, name: `FIA ${key}`, email: `fia-${key}-${stamp}@laboura.local`, passwordHash: 'hash', role, status: 'active' },
    });
    staffIds.push(staff.id);
    ids[key] = staff.id;
    tokens[key] = jwt.sign({ sub: staff.id, email: staff.email, role, code: staff.code, teamLeadId: null });
    return staff;
  }
  const as = (key: string) => ({ Authorization: `Bearer ${tokens[key]}` });

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);
    jwt = app.get(JwtService);
    await makeStaff('ceo');
    await makeStaff('finance');
    await makeStaff('manager');
    await makeStaff('field_agent', 'fielder');
  }, 120000);

  afterAll(async () => {
    if (!prisma) return;
    await prisma.notification.deleteMany({ where: { recipientStaffId: { in: staffIds } } });
    await prisma.payment.deleteMany({ where: { id: { in: paymentIds } } });
    await prisma.business.deleteMany({ where: { id: { in: businessIds } } });
    await prisma.auditLog.deleteMany({ where: { actorId: { in: staffIds } } });
    await prisma.staff.deleteMany({ where: { id: { in: staffIds } } });
    await app.close();
  });

  it('rings the account agent once per fee, names no amount, is audited; Managers are refused; a paid fee is refused', async () => {
    const business = await prisma.business.create({ data: { code: `BZ-FIA-${tail}`, name: 'Metro Mart', phone: `+9194${tail}22`.slice(0, 13), accountAgentId: ids.fielder } });
    businessIds.push(business.id);
    const fee = await prisma.payment.create({
      data: { code: `PAY-FIA-${tail}-1`, type: 'placement_fee', status: 'pending', amount: 944000, subjectType: 'business', subjectId: business.id, businessId: business.id, createdAt: new Date(Date.now() - 4 * 86_400_000) },
    });
    paymentIds.push(fee.id);

    await request(app.getHttpServer()).post(`/finance/invoices/${fee.id}/tell-account-agent`).set(as('manager')).expect(403);
    await request(app.getHttpServer()).post(`/finance/invoices/${fee.id}/tell-account-agent`).set(as('fielder')).expect(403);
    const res = await request(app.getHttpServer()).post(`/finance/invoices/${fee.id}/tell-account-agent`).set(as('finance')).expect(200);
    expect(res.body.told.id).toBe(ids.fielder);
    await request(app.getHttpServer()).post(`/finance/invoices/${fee.id}/tell-account-agent`).set(as('ceo')).expect(200);

    const bells = await prisma.notification.findMany({ where: { recipientStaffId: ids.fielder, kind: 'fee_unpaid_reminder', subjectId: fee.id } });
    expect(bells).toHaveLength(1);
    expect(bells[0].title).toContain('Metro Mart');
    expect(`${bells[0].title} ${bells[0].body}`).not.toMatch(/₹|9,440|944000/);
    expect(bells[0].body).toMatch(/4 days/);
    expect(await prisma.auditLog.findFirst({ where: { actorId: ids.finance, action: 'finance.account_agent_told', entityCode: fee.code } })).not.toBeNull();

    const paid = await prisma.payment.create({
      data: { code: `PAY-FIA-${tail}-2`, type: 'placement_fee', status: 'succeeded', amount: 944000, subjectType: 'business', subjectId: business.id, businessId: business.id },
    });
    paymentIds.push(paid.id);
    await request(app.getHttpServer()).post(`/finance/invoices/${paid.id}/tell-account-agent`).set(as('finance')).expect(400);
    await request(app.getHttpServer()).post(`/finance/invoices/00000000-0000-0000-0000-000000000000/tell-account-agent`).set(as('finance')).expect(404);
  });
});
