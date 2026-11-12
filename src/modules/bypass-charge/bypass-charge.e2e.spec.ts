import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import * as request from 'supertest';
import { AppModule } from '../../app.module';
import { PrismaService } from '../../common/prisma/prisma.service';

jest.setTimeout(180000);

/**
 * The no-bypass charge: only the CEO raises it, with a reason, for someone
 * introduced within the no-bypass months; fee + penalty + GST in paise;
 * collected by the usual UPI payment request; GST invoice number from the same
 * series; shown on FN-Invoices; refused in a closed month; audited.
 */
describe('No-bypass charge (CEO)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let jwt: JwtService;
  const stamp = `${Date.now()}`;
  const tail = stamp.slice(-7);
  const staffIds: string[] = [];
  const tokens: Record<string, string> = {};
  let businessId = '';
  let vacancyId = '';
  let seekerId = '';
  let lateSeekerId = '';
  let ceoId = '';
  const month = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit' }).format(new Date());

  async function makeStaff(role: string) {
    const staff = await prisma.staff.create({
      data: { code: `BYP-${role}-${stamp}`, name: `BYP ${role}`, email: `byp-${role}-${stamp}@laboura.local`, passwordHash: 'hash', role, status: 'active' },
    });
    staffIds.push(staff.id);
    tokens[role] = jwt.sign({ sub: staff.id, email: staff.email, role, code: staff.code, teamLeadId: null });
    return staff;
  }
  const as = (role: string) => ({ Authorization: `Bearer ${tokens[role]}` });

  async function seeker(n: number) {
    const s = await prisma.jobSeeker.create({
      data: {
        code: `JS-BYP-${tail}-${n}`,
        name: `Bypass Seeker ${n}`,
        phone: `+9192${tail}${n}`.slice(0, 13),
        minSalary: 1500000,
        maxSalary: 2000000,
        preferredCallWindowStart: '09:00',
        preferredCallWindowEnd: '21:00',
        status: 'active',
      },
    });
    return s.id;
  }

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);
    jwt = app.get(JwtService);
    ceoId = (await makeStaff('ceo')).id;
    await makeStaff('finance');
    await makeStaff('manager');
    await makeStaff('field_agent');
    const business = await prisma.business.create({ data: { code: `BZ-BYP-${tail}`, name: 'Quiet Hirer', phone: `+9191${tail}33`.slice(0, 13) } });
    businessId = business.id;
    const vacancy = await prisma.vacancy.create({
      data: { code: `VC-BYP-${tail}`, businessId, tradeSkill: 'cook', headcount: 1, status: 'open', salaryMinPaise: 1500000, salaryMaxPaise: 2000000, salaryPeriod: 'monthly', shift: 'day', latitude: 12.93, longitude: 77.62 },
    });
    vacancyId = vacancy.id;
    seekerId = await seeker(1);
    lateSeekerId = await seeker(2);
    const intro = { businessId, vacancyId, shownByStaffId: ceoId, rank: 1, score: 1, matchReasons: [], channel: 'in_person' };
    await prisma.candidateIntroduction.create({ data: { ...intro, jobSeekerId: seekerId, shownAt: new Date(Date.now() - 40 * 86_400_000) } });
    await prisma.candidateIntroduction.create({ data: { ...intro, jobSeekerId: lateSeekerId, shownAt: new Date(Date.now() - 400 * 86_400_000) } });
  }, 120000);

  afterAll(async () => {
    if (!prisma) return;
    const charges = await prisma.bypassCharge.findMany({ where: { businessId }, select: { paymentId: true } });
    await prisma.bypassCharge.deleteMany({ where: { businessId } });
    const paymentIds = charges.map((c) => c.paymentId).filter((x): x is string => Boolean(x));
    await prisma.messageLog.deleteMany({ where: { relatedType: 'payment', relatedId: { in: paymentIds } } }).catch(() => undefined);
    await prisma.statusHistory.deleteMany({ where: { subjectType: 'payment', subjectId: { in: paymentIds } } });
    await prisma.payment.deleteMany({ where: { id: { in: paymentIds } } });
    await prisma.candidateIntroduction.deleteMany({ where: { businessId } });
    await prisma.vacancy.deleteMany({ where: { id: vacancyId } });
    await prisma.jobSeeker.deleteMany({ where: { id: { in: [seekerId, lateSeekerId] } } });
    await prisma.business.deleteMany({ where: { id: businessId } });
    await prisma.monthClose.deleteMany({ where: { month, closedByStaffId: ceoId } }).catch(() => undefined);
    await prisma.auditLog.deleteMany({ where: { actorId: { in: staffIds } } });
    await prisma.staff.deleteMany({ where: { id: { in: staffIds } } });
    await app.close();
  });

  it('only the CEO raises it, needs a reason, and only for someone introduced within the no-bypass months', async () => {
    const path = `/bypass-charges/business/${businessId}`;
    const body = { jobSeekerId: seekerId, monthlySalaryPaise: 1500000, reason: 'Seen working there on a revisit; owner said not selected' };
    for (const role of ['finance', 'manager', 'field_agent']) {
      await request(app.getHttpServer()).post(path).set(as(role)).send(body).expect(403);
    }
    await request(app.getHttpServer()).get(`${path}/candidates`).set(as('manager')).expect(403);
    await request(app.getHttpServer()).post(path).set(as('ceo')).send({ ...body, reason: '' }).expect(400);
    await request(app.getHttpServer()).post(path).set(as('ceo')).send({ ...body, monthlySalaryPaise: 15000.5 }).expect(400);
    await request(app.getHttpServer()).post(path).set(as('ceo')).send({ ...body, jobSeekerId: lateSeekerId }).expect(400);

    const candidates = await request(app.getHttpServer()).get(`${path}/candidates`).set(as('ceo')).expect(200);
    expect(candidates.body.rows.map((r: { jobSeeker: { id: string } }) => r.jobSeeker.id)).toEqual([seekerId]);
  });

  it('charges fee + 50% + GST in paise, opens a UPI payment request, numbers the invoice, shows on FN-Invoices, and is audited', async () => {
    const res = await request(app.getHttpServer())
      .post(`/bypass-charges/business/${businessId}`)
      .set(as('ceo'))
      .send({ jobSeekerId: seekerId, monthlySalaryPaise: 1500000, reason: 'Seen working there on a revisit' })
      .expect(201);
    expect(res.body).toMatchObject({ feePaise: 750000, penaltyPaise: 375000, gstPaise: 202500, totalPaise: 1327500, status: 'waiting' });
    expect(res.body.invoiceCode).toBeTruthy();
    const payment = await prisma.payment.findUniqueOrThrow({ where: { id: res.body.payment.id } });
    expect(payment).toMatchObject({ type: 'bypass_charge', status: 'pending', amount: 1327500, expectedAmountPaise: 1327500, businessId });
    expect(payment.upiReference).toBeTruthy();

    // A second charge for the same person while one is open is refused.
    await request(app.getHttpServer()).post(`/bypass-charges/business/${businessId}`).set(as('ceo')).send({ jobSeekerId: seekerId, monthlySalaryPaise: 1500000, reason: 'again' }).expect(409);

    const invoice = await request(app.getHttpServer()).get(`/bypass-charges/${res.body.id}/invoice`).set(as('finance')).expect(200);
    expect(invoice.body.invoiceNumber).toBe(res.body.invoiceCode);
    expect(invoice.body.summary).toMatchObject({ subtotalPaise: 1125000, totalTaxPaise: 202500, totalAmountPaise: 1327500 });
    await request(app.getHttpServer()).get(`/bypass-charges/${res.body.id}/invoice`).set(as('manager')).expect(403);

    const invoices = await request(app.getHttpServer()).get('/finance/invoices').set(as('finance')).expect(200);
    const row = invoices.body.rows.find((r: { id: string }) => r.id === res.body.id);
    expect(row).toMatchObject({ number: res.body.invoiceCode, totalPaise: 1327500, forWhat: { type: 'bypass_charge' } });

    const list = await request(app.getHttpServer()).get(`/bypass-charges/business/${businessId}`).set(as('finance')).expect(200);
    expect(list.body).toHaveLength(1);
    const audit = await prisma.auditLog.findFirst({ where: { actorId: ceoId, action: 'business.bypass_charge_raised', entityCode: `BZ-BYP-${tail}` } });
    expect(audit?.reason).toBe('Seen working there on a revisit');
  });

  it('is refused while the current month is closed', async () => {
    await prisma.bypassCharge.updateMany({ where: { businessId }, data: { status: 'cancelled' } });
    const existing = await prisma.monthClose.findUnique({ where: { month } });
    if (existing) return; // Another suite owns this month's close; the lock itself is tested in month-lock specs.
    await prisma.monthClose.create({ data: { month, status: 'closed', closedByStaffId: ceoId, closedAt: new Date(), checklist: {} } });
    try {
      const res = await request(app.getHttpServer()).post(`/bypass-charges/business/${businessId}`).set(as('ceo')).send({ jobSeekerId: seekerId, monthlySalaryPaise: 1500000, reason: 'Seen again' });
      expect(res.status).toBe(403);
    } finally {
      await prisma.monthClose.deleteMany({ where: { month, closedByStaffId: ceoId } });
    }
  });
});
