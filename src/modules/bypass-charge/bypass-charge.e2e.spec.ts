import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import * as request from 'supertest';
import { AppModule } from '../../app.module';
import { PrismaService } from '../../common/prisma/prisma.service';
import { BypassChargeService } from './bypass-charge.service';

jest.setTimeout(180000);

const DAY = 86_400_000;

/**
 * The no-bypass charge: only the CEO raises it, with a reason, for someone
 * introduced within the no-bypass months of the business's signed agreement
 * (its fee, penalty and GST, not today's Settings); collected by the usual UPI
 * payment request, saved together with it under a lock (one open charge per
 * person); GST invoice number from the same series; shown on FN-Invoices, in
 * the GST data and the books once paid; the CEO can cancel it; refused in a
 * closed month; audited.
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
  let chargeId = '';
  let invoiceCode = '';
  const month = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit' }).format(new Date());
  const daysAgo = (n: number) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date(Date.now() - n * DAY));

  async function makeStaff(role: string) {
    const staff = await prisma.staff.create({
      data: { code: `BYP-${role}-${stamp}`, name: `BYP ${role}`, email: `byp-${role}-${stamp}@laboura.local`, passwordHash: 'hash', role, status: 'active' },
    });
    staffIds.push(staff.id);
    tokens[role] = jwt.sign({ sub: staff.id, email: staff.email, role, code: staff.code, teamLeadId: null });
    return staff;
  }
  const as = (role: string) => ({ Authorization: `Bearer ${tokens[role]}` });
  const server = () => app.getHttpServer();

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
    await prisma.candidateIntroduction.create({ data: { ...intro, jobSeekerId: seekerId, shownAt: new Date(Date.now() - 40 * DAY) } });
    await prisma.candidateIntroduction.create({ data: { ...intro, jobSeekerId: lateSeekerId, shownAt: new Date(Date.now() - 400 * DAY) } });
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
    await prisma.businessAgreement.deleteMany({ where: { businessId } });
    await prisma.vacancy.deleteMany({ where: { id: vacancyId } });
    await prisma.jobSeeker.deleteMany({ where: { id: { in: [seekerId, lateSeekerId] } } });
    await prisma.business.deleteMany({ where: { id: businessId } });
    await prisma.monthClose.deleteMany({ where: { month, closedByStaffId: ceoId } }).catch(() => undefined);
    await prisma.auditLog.deleteMany({ where: { actorId: { in: staffIds } } });
    await prisma.staff.deleteMany({ where: { id: { in: staffIds } } });
    await app.close();
  });

  const path = () => `/bypass-charges/business/${businessId}`;
  const body = (extra: Record<string, unknown> = {}) => ({ jobSeekerId: seekerId, monthlySalaryPaise: 1500000, hiredOn: daysAgo(10), reason: 'Seen working there on a revisit', ...extra });

  it('only the CEO raises it, needs a reason, and refuses a business with no signed agreement (B2)', async () => {
    for (const role of ['finance', 'manager', 'field_agent']) {
      await request(server()).post(path()).set(as(role)).send(body()).expect(403);
    }
    await request(server()).get(`${path()}/candidates`).set(as('manager')).expect(403);
    await request(server()).post(path()).set(as('ceo')).send(body({ reason: '' })).expect(400);
    await request(server()).post(path()).set(as('ceo')).send(body({ monthlySalaryPaise: 15000.5 })).expect(400);

    const unsigned = await request(server()).post(path()).set(as('ceo')).send(body()).expect(400);
    expect(unsigned.body.message).toMatch(/no signed agreement/);
    expect((await request(server()).get(`${path()}/candidates`).set(as('ceo')).expect(200)).body.agreementSigned).toBe(false);
    expect(await prisma.bypassCharge.count({ where: { businessId } })).toBe(0);

    // The agreement signed before the introductions: 40% fee, 50% penalty, 18% GST, 12 months.
    await prisma.businessAgreement.create({
      data: {
        businessId, version: 'byp-test', termsHash: `byp-${stamp}`, noBypassMonths: 12, noBypassPenaltyPercent: 50, feePercent: 40, gstPercent: 18,
        signedName: 'Owner', signedPhone: `+9191${tail}33`.slice(0, 13), otpRequestId: `byp-${stamp}`, signedAt: new Date(Date.now() - 500 * DAY), documentStoragePath: `byp/${stamp}.html`,
      },
    });
    await request(server()).post(path()).set(as('ceo')).send(body({ jobSeekerId: lateSeekerId })).expect(400);
    const candidates = await request(server()).get(`${path()}/candidates`).set(as('ceo')).expect(200);
    expect(candidates.body).toMatchObject({ agreementSigned: true, feePercent: 40, penaltyPercent: 50, noBypassMonths: 12 });
    expect(candidates.body.rows.map((r: { jobSeeker: { id: string } }) => r.jobSeeker.id)).toEqual([seekerId]);
  });

  it('refuses a hire date before the first introduction (B6), and saves nothing when UPI is not set up (B5)', async () => {
    const early = await request(server()).post(path()).set(as('ceo')).send(body({ hiredOn: daysAgo(60) })).expect(400);
    expect(early.body.message).toMatch(/before Laboura first introduced/);

    const vpa = process.env.COMPANY_UPI_VPA;
    delete process.env.COMPANY_UPI_VPA;
    try {
      await request(server()).post(path()).set(as('ceo')).send(body()).expect(400);
    } finally {
      process.env.COMPANY_UPI_VPA = vpa;
    }
    expect(await prisma.bypassCharge.count({ where: { businessId } })).toBe(0);
  });

  it('charges the agreement fee + penalty + GST in paise, saves charge and payment request together once (B4), numbers the invoice, shows on FN-Invoices, audited', async () => {
    const [a, b] = await Promise.all([
      request(server()).post(path()).set(as('ceo')).send(body()),
      request(server()).post(path()).set(as('ceo')).send(body()),
    ]);
    expect([a.status, b.status].sort()).toEqual([201, 409]);
    const res = a.status === 201 ? a : b;
    // 40% of ₹15,000 = ₹6,000; + 50% = ₹3,000; GST 18% of ₹9,000 = ₹1,620.
    expect(res.body).toMatchObject({ feePaise: 600000, penaltyPaise: 300000, gstPaise: 162000, totalPaise: 1062000, penaltyPercent: 50, status: 'waiting' });
    expect(await prisma.bypassCharge.count({ where: { businessId, status: 'raised' } })).toBe(1);
    chargeId = res.body.id;
    invoiceCode = res.body.invoiceCode;
    expect(invoiceCode).toMatch(/^INV-\d+$/);
    const charge = await prisma.bypassCharge.findUniqueOrThrow({ where: { id: chargeId } });
    expect(charge.feePercent).toBe(40);
    const payment = await prisma.payment.findUniqueOrThrow({ where: { id: charge.paymentId! } });
    expect(payment).toMatchObject({ type: 'bypass_charge', status: 'pending', amount: 1062000, expectedAmountPaise: 1062000, businessId, subjectId: chargeId });

    const invoice = await request(server()).get(`/bypass-charges/${chargeId}/invoice`).set(as('finance')).expect(200);
    expect(invoice.body.invoiceNumber).toBe(invoiceCode);
    expect(invoice.body.summary).toMatchObject({ subtotalPaise: 900000, totalTaxPaise: 162000, totalAmountPaise: 1062000 });
    await request(server()).get(`/bypass-charges/${chargeId}/invoice`).set(as('manager')).expect(403);

    const invoices = await request(server()).get('/finance/invoices').set(as('finance')).expect(200);
    const row = invoices.body.rows.find((r: { id: string }) => r.id === chargeId);
    expect(row).toMatchObject({ number: invoiceCode, totalPaise: 1062000, forWhat: { type: 'bypass_charge' } });
    const audit = await prisma.auditLog.findFirst({ where: { actorId: ceoId, action: 'business.bypass_charge_raised', entityCode: `BZ-BYP-${tail}` } });
    expect(audit?.reason).toBe('Seen working there on a revisit');
  });

  it('the CEO cancels a waiting charge with a reason; its payment request closes (B5)', async () => {
    const cancel = `/bypass-charges/${chargeId}/cancel`;
    for (const role of ['finance', 'manager']) await request(server()).post(cancel).set(as(role)).send({ reason: 'x' }).expect(403);
    await request(server()).post(cancel).set(as('ceo')).send({}).expect(400);
    const res = await request(server()).post(cancel).set(as('ceo')).send({ reason: 'Owner proved the worker left on day 2' }).expect(201);
    expect(res.body).toMatchObject({ status: 'cancelled', paymentClosed: true });
    const charge = await prisma.bypassCharge.findUniqueOrThrow({ where: { id: chargeId } });
    expect(charge).toMatchObject({ status: 'cancelled', cancelReason: 'Owner proved the worker left on day 2' });
    expect((await prisma.payment.findUniqueOrThrow({ where: { id: charge.paymentId! } })).status).toBe('cancelled');
    expect(await prisma.statusHistory.count({ where: { subjectType: 'payment', subjectId: charge.paymentId!, toStatus: 'cancelled' } })).toBe(1);
    await request(server()).post(cancel).set(as('ceo')).send({ reason: 'again' }).expect(409);
    expect(await prisma.auditLog.count({ where: { actorId: ceoId, action: 'business.bypass_charge_cancelled' } })).toBeGreaterThanOrEqual(1);
  });

  it('N5: a raised charge is audited even when sending the payment link fails', async () => {
    const upi = (app.get(BypassChargeService) as unknown as { upi: { deliverRequest: (...args: unknown[]) => Promise<unknown> } }).upi;
    const spy = jest.spyOn(upi, 'deliverRequest').mockRejectedValueOnce(new Error('SMS vendor down'));
    try {
      const res = await request(server()).post(path()).set(as('ceo')).send(body({ reason: 'Raised while SMS was down' })).expect(201);
      expect(res.body).toMatchObject({ linkSent: false, status: 'waiting' });
      expect(await prisma.auditLog.findFirst({ where: { actorId: ceoId, action: 'business.bypass_charge_raised', reason: 'Raised while SMS was down' } })).not.toBeNull();
      expect(await prisma.auditLog.findFirst({ where: { actorId: ceoId, action: 'business.bypass_charge_link_not_sent' } })).not.toBeNull();
      await request(server()).post(`/bypass-charges/${res.body.id}/cancel`).set(as('ceo')).send({ reason: 'Raise again once SMS works' }).expect(201);
    } finally {
      spy.mockRestore();
    }
  });

  it('a paid charge is in the GST invoices, the GSTR-1 data and the books (B3), and cannot be cancelled', async () => {
    const res = await request(server()).post(path()).set(as('ceo')).send(body({ reason: 'Raised again after the check' })).expect(201);
    const charge = await prisma.bypassCharge.findUniqueOrThrow({ where: { id: res.body.id } });
    await prisma.payment.update({ where: { id: charge.paymentId! }, data: { status: 'succeeded', confirmedAt: new Date(), paidAt: new Date(), bankUtr: `UTRBYP${tail}` } });

    const tax = await request(server()).get(`/finance/tax?month=${month}`).set(as('finance')).expect(200);
    expect(tax.body.gst.bypassCharges.count).toBeGreaterThanOrEqual(1);
    expect(tax.body.gst.bypassCharges.gstPaise).toBeGreaterThanOrEqual(162000);
    expect(tax.body.gst.invoices.gstPaise).toBe(tax.body.gst.placementFees.gstPaise + tax.body.gst.bypassCharges.gstPaise);
    expect(tax.body.gst.payablePaise).toBe(tax.body.gst.invoices.gstPaise);
    const gstr1 = await request(server()).get(`/finance/reports/gstr1.csv?month=${month}`).set(as('ceo')).expect(200);
    expect(gstr1.text).toContain(charge.invoiceCode);
    expect(gstr1.text).toContain(`No-bypass charge ${charge.code}`);
    const books = await request(server()).get(`/finance/reports/books.csv?month=${month}`).set(as('finance')).expect(200);
    const line = books.text.split('\n').find((l) => l.includes(charge.invoiceCode))!;
    expect(line).toContain('No-bypass charge');
    expect(line).toContain('10620.00');
    expect(line).toContain('1620.00');

    await request(server()).post(`/bypass-charges/${charge.id}/cancel`).set(as('ceo')).send({ reason: 'x' }).expect(409);
  });

  it('a paid charge is in Finance home "Received this month", the CEO money tiles and the profit and loss, like the books', async () => {
    const charge = await prisma.bypassCharge.findFirstOrThrow({ where: { businessId, status: 'raised' }, orderBy: { raisedAt: 'desc' } });
    const payment = await prisma.payment.findUniqueOrThrow({ where: { id: charge.paymentId! } });
    expect(payment.status).toBe('succeeded');
    const read = async () => {
      const [home, money, profit] = await Promise.all([
        request(server()).get('/finance/home').set(as('finance')).expect(200),
        request(server()).get('/ceo/command-center/money').set(as('ceo')).expect(200),
        request(server()).get('/finance/profit').set(as('ceo')).expect(200),
      ]);
      return { home: home.body.stats, money: money.body, profit: profit.body.revenue };
    };
    await prisma.payment.update({ where: { id: payment.id }, data: { status: 'pending' } });
    const before = await read();
    await prisma.payment.update({ where: { id: payment.id }, data: { status: 'succeeded' } });
    const after = await read();
    // The books count the whole amount received (fee + penalty + GST).
    expect(after.home.receivedThisMonthPaise - before.home.receivedThisMonthPaise).toBe(payment.amount);
    expect(payment.amount).toBe(charge.totalPaise);
    // Revenue counts fee + penalty without GST; the GST sits with the GST.
    expect(after.money.bypassChargePaise - before.money.bypassChargePaise).toBe(charge.feePaise + charge.penaltyPaise);
    expect(after.money.bypassChargeCount - before.money.bypassChargeCount).toBe(1);
    expect(after.money.grossPaise - before.money.grossPaise).toBe(charge.feePaise + charge.penaltyPaise);
    expect(after.money.gstPaise - before.money.gstPaise).toBe(charge.gstPaise);
    expect(after.money.receivedInclGstPaise - before.money.receivedInclGstPaise).toBe(charge.totalPaise);
    expect(after.profit.bypassChargePaise - before.profit.bypassChargePaise).toBe(charge.feePaise + charge.penaltyPaise);
    expect(after.profit.netRevenuePaise - before.profit.netRevenuePaise).toBe(charge.feePaise + charge.penaltyPaise);
    expect(after.profit.gstCollectedPaise - before.profit.gstCollectedPaise).toBe(charge.gstPaise);
  });

  it("N4: last month's paid charge GST is in the Finance home GST figure, the same as FN-Tax", async () => {
    const charge = await prisma.bypassCharge.findFirstOrThrow({ where: { businessId, status: 'raised' }, orderBy: { raisedAt: 'desc' } });
    const firstOfMonth = new Date(`${month}-01T00:00:00+05:30`);
    const lastMonthDay = new Date(firstOfMonth.getTime() - 10 * DAY);
    await prisma.payment.update({ where: { id: charge.paymentId! }, data: { confirmedAt: lastMonthDay, paidAt: lastMonthDay } });
    const lastMonth = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit' }).format(lastMonthDay);
    const [home, tax] = await Promise.all([
      request(server()).get('/finance/home').set(as('finance')).expect(200),
      request(server()).get(`/finance/tax?month=${lastMonth}`).set(as('finance')).expect(200),
    ]);
    expect(tax.body.gst.bypassCharges.gstPaise).toBeGreaterThanOrEqual(charge.gstPaise);
    expect(home.body.stats.gstLastMonthPaise).toBe(tax.body.gst.payablePaise);
  });

  it('is refused while the current month is closed', async () => {
    await prisma.bypassCharge.updateMany({ where: { businessId }, data: { status: 'cancelled' } });
    const existing = await prisma.monthClose.findUnique({ where: { month } });
    if (existing) return; // Another suite owns this month's close; the lock itself is tested in month-lock specs.
    await prisma.monthClose.create({ data: { month, status: 'closed', closedByStaffId: ceoId, closedAt: new Date(), checklist: {} } });
    try {
      const res = await request(server()).post(path()).set(as('ceo')).send(body({ reason: 'Seen again' }));
      expect(res.status).toBe(403);
    } finally {
      await prisma.monthClose.deleteMany({ where: { month, closedByStaffId: ceoId } });
    }
  });
});
