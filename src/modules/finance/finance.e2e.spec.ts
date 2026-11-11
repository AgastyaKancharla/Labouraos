import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import * as request from 'supertest';
import { AppModule } from '../../app.module';
import { PrismaService } from '../../common/prisma/prisma.service';
import { NotificationSourcesService } from '../notification/notification-sources.service';

/**
 * Phase 22 Part A against a real database: only Finance and the CEO reach the
 * Finance back office; expenses follow the approval limits ("no bill, no
 * payment"); payouts are paid only after the 48-hour wait and failed payouts
 * can be retried; unclaimed money is returned; a bank day closes only when it
 * agrees with the books.
 */
describe('Finance back office (Phase 22 Part A)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let jwt: JwtService;
  const stamp = `${Date.now()}`;
  const staffIds: string[] = [];
  const seekerIds: string[] = [];
  const paymentIds: string[] = [];
  const accountIds: string[] = [];
  const creditUtrs: string[] = [];
  let counter = 0;
  const tokens: Record<string, string> = {};
  let ceoId = '';
  let financeId = '';
  const limitsBefore = { business: 0, expense: 0 };

  type StaffRow = Awaited<ReturnType<PrismaService['staff']['create']>>;
  async function makeStaff(role: string): Promise<StaffRow> {
    counter += 1;
    const staff = await prisma.staff.create({
      data: {
        code: `W4F-${role.slice(0, 3).toUpperCase()}-${stamp}-${counter}`,
        name: `W4F ${role} ${counter}`,
        email: `w4f-${role}-${stamp}-${counter}@laboura.local`,
        passwordHash: await bcrypt.hash('W4F-Password-1', 4),
        role,
        city: 'Bengaluru',
        status: 'active',
        reportsToId: role === 'ceo' ? null : ceoId || null,
      },
    });
    staffIds.push(staff.id);
    tokens[role] = jwt.sign({ sub: staff.id, email: staff.email, role: staff.role, code: staff.code, teamLeadId: null });
    return staff;
  }

  const server = () => app.getHttpServer();
  const as = (role: string) => ({ Authorization: `Bearer ${tokens[role]}` });
  const pdf = Buffer.from('%PDF-1.4\n% W4F test bill\n');

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);
    jwt = app.get(JwtService);
    ceoId = (await makeStaff('ceo')).id;
    financeId = (await makeStaff('finance')).id;
    await makeStaff('manager');
    await makeStaff('team_lead');
    await makeStaff('call_agent');
    // Pin the launch limits for this suite (₹15,000 / ₹10,000).
    const before = await request(server()).get('/pricing/approval-limits').set(as('ceo'));
    limitsBefore.business = before.body.businessRefundLimitPaise;
    limitsBefore.expense = before.body.expenseLimitPaise;
    await request(server()).put('/pricing/approval-limits').set(as('ceo')).send({ businessRefundLimitPaise: 1500000, expenseLimitPaise: 1000000 }).expect(200);
  }, 120000);

  afterAll(async () => {
    if (!prisma) return;
    if (limitsBefore.expense) {
      await request(server()).put('/pricing/approval-limits').set(as('ceo')).send({ businessRefundLimitPaise: limitsBefore.business, expenseLimitPaise: limitsBefore.expense });
    }
    await prisma.notification.deleteMany({ where: { recipientStaffId: { in: staffIds } } });
    await prisma.expense.deleteMany({ where: { enteredByStaffId: { in: staffIds } } });
    await prisma.expenseBudget.deleteMany({ where: { setByStaffId: { in: staffIds } } });
    await prisma.bankDayClose.deleteMany({ where: { closedByStaffId: { in: staffIds } } });
    await prisma.reviewFlag.deleteMany({ where: { subjectType: 'bank_credit', subjectId: { in: (await prisma.bankCredit.findMany({ where: { bankUtr: { in: creditUtrs } }, select: { id: true } })).map((c) => c.id) } } });
    await prisma.bankCredit.deleteMany({ where: { bankUtr: { in: creditUtrs } } });
    await prisma.statusHistory.deleteMany({ where: { subjectType: 'payment', subjectId: { in: paymentIds } } });
    await prisma.payment.deleteMany({ where: { id: { in: paymentIds } } });
    await prisma.payoutAccount.deleteMany({ where: { id: { in: accountIds } } });
    await prisma.reviewFlag.deleteMany({ where: { subjectType: 'job_seeker', subjectId: { in: seekerIds } } });
    await prisma.jobSeeker.deleteMany({ where: { id: { in: seekerIds } } });
    await prisma.staffSession.deleteMany({ where: { staffId: { in: staffIds } } });
    await prisma.auditLog.deleteMany({ where: { actorId: { in: staffIds } } });
    await prisma.staff.updateMany({ where: { id: { in: staffIds } }, data: { reportsToId: null, teamLeadId: null } });
    await prisma.staff.deleteMany({ where: { id: { in: staffIds } } });
    await app.close();
  });

  const GET_ROUTES = ['/finance/home', '/finance/counts', '/finance/expenses', '/finance/profit', '/finance/payouts', '/finance/money-in', '/finance/bank', '/finance/invoices'];

  describe('who may use it', () => {
    it.each(GET_ROUTES)('%s answers Finance and the CEO', async (route) => {
      await request(server()).get(route).set(as('finance')).expect(200);
      await request(server()).get(route).set(as('ceo')).expect(200);
    });

    it.each(GET_ROUTES)('%s refuses Managers, Team Leads and agents', async (route) => {
      for (const role of ['manager', 'team_lead', 'call_agent']) {
        await request(server()).get(route).set(as(role)).expect(403);
      }
    });

    it('refuses money writes to Managers', async () => {
      await request(server()).post('/finance/expenses').set(as('manager')).field('category', 'office_other').expect(403);
      await request(server()).post('/finance/payouts/pay-all').set(as('manager')).send({ items: [] }).expect(403);
      await request(server()).post('/finance/bank/close-day').set(as('manager')).send({}).expect(403);
    });

    it('Finance reads the approval limits; only the CEO saves them', async () => {
      const res = await request(server()).get('/pricing/approval-limits').set(as('finance')).expect(200);
      expect(res.body).toEqual({ businessRefundLimitPaise: 1500000, expenseLimitPaise: 1000000 });
      await request(server()).put('/pricing/approval-limits').set(as('finance')).send({ businessRefundLimitPaise: 9999900, expenseLimitPaise: 9999900 }).expect(403);
      await request(server()).get('/pricing/approval-limits').set(as('manager')).expect(403);
    });
  });

  function addExpense(role: string, amountPaise: number, opts: { bill?: boolean; category?: string; adChannel?: string } = {}) {
    let req = request(server())
      .post('/finance/expenses')
      .set(as(role))
      .field('category', opts.category ?? 'field_travel')
      .field('supplier', `W4F Supplier ${stamp}`)
      .field('description', 'Petrol, 22 visits')
      .field('amountPaise', String(amountPaise))
      .field('billDate', new Date().toISOString());
    if (opts.adChannel) req = req.field('adChannel', opts.adChannel);
    if (opts.bill !== false) req = req.attach('bill', pdf, { filename: 'bill.pdf', contentType: 'application/pdf' });
    return req;
  }

  describe('expenses and bills', () => {
    it('Finance records and approves-and-pays a bill within its limit, all logged', async () => {
      const created = await addExpense('finance', 240000).expect(201);
      expect(created.body).toMatchObject({ status: 'waiting_finance', hasBill: true, withinFinanceLimit: true, amountPaise: 240000 });
      expect(created.body.code).toMatch(/^EXP-\d{5,}$/);
      const paid = await request(server())
        .post(`/finance/expenses/${created.body.id}/approve`)
        .set(as('finance'))
        .send({ pay: { paidFrom: 'upi', reference: `UPI${stamp}` } })
        .expect(200);
      expect(paid.body).toMatchObject({ status: 'paid', paidFrom: 'upi', paymentReference: `UPI${stamp}` });
      expect(paid.body.approvedBy.role).toBe('finance');
      const audit = await prisma.auditLog.findMany({ where: { entityType: 'Expense', entityCode: created.body.code }, orderBy: { createdAt: 'asc' } });
      expect(audit.map((a) => a.action)).toEqual(['expense.recorded', 'expense.approved_and_paid']);
      expect(audit[1].actorId).toBe(financeId);
      const bill = await request(server()).get(`/finance/expenses/${created.body.id}/bill`).set(as('finance')).expect(200);
      expect(bill.headers['content-type']).toContain('application/pdf');
      await request(server()).get(`/finance/expenses/${created.body.id}/bill`).set(as('manager')).expect(403);
    });

    it('above ₹10,000 Finance is sent to the CEO; the CEO approves and Finance pays', async () => {
      const created = await addExpense('finance', 1840000, { category: 'calling' }).expect(201);
      expect(created.body).toMatchObject({ status: 'waiting_ceo', needsCeo: true });
      const refused = await request(server()).post(`/finance/expenses/${created.body.id}/approve`).set(as('finance')).send({}).expect(403);
      expect(refused.body.message).toContain('the CEO approves it');
      await request(server()).post(`/finance/expenses/${created.body.id}/reject`).set(as('finance')).send({ reason: 'no' }).expect(403);
      const approved = await request(server()).post(`/finance/expenses/${created.body.id}/approve`).set(as('ceo')).send({}).expect(200);
      expect(approved.body).toMatchObject({ status: 'approved' });
      expect(approved.body.approvedBy.role).toBe('ceo');
      await request(server()).post(`/finance/expenses/${created.body.id}/pay`).set(as('finance')).send({ paidFrom: 'bank_transfer' }).expect(400);
      const paid = await request(server()).post(`/finance/expenses/${created.body.id}/pay`).set(as('finance')).send({ paidFrom: 'bank_transfer', reference: `NEFT${stamp}` }).expect(200);
      expect(paid.body.status).toBe('paid');
      await request(server()).post(`/finance/expenses/${created.body.id}/pay`).set(as('finance')).send({ paidFrom: 'bank_transfer', reference: `NEFT${stamp}` }).expect(400);
    });

    it("rings the CEO's bell for an expense above the limit and Finance's for a bill to pay; each clears when done", async () => {
      const sources = app.get(NotificationSourcesService);
      const big = await addExpense('finance', 1200000, { category: 'calling' }).expect(201);
      const small = await addExpense('finance', 90000, { category: 'office_other' }).expect(201);
      await sources.syncMoney(new Date());
      const open = async (kind: string, id: string, staff: string) =>
        prisma.notification.count({ where: { kind, subjectType: 'expense', subjectId: id, recipientStaffId: staff, clearedAt: null } });
      expect(await open('expense_needs_ceo', big.body.id, ceoId)).toBe(1);
      expect(await open('expense_to_pay', small.body.id, financeId)).toBe(1);
      const managers = await prisma.staff.findMany({ where: { id: { in: staffIds }, role: 'manager' }, select: { id: true } });
      expect(await prisma.notification.count({ where: { subjectType: 'expense', recipientStaffId: { in: managers.map((m) => m.id) } } })).toBe(0);
      await request(server()).post(`/finance/expenses/${big.body.id}/reject`).set(as('ceo')).send({ reason: 'Duplicate bill' }).expect(200);
      await request(server()).post(`/finance/expenses/${small.body.id}/approve`).set(as('finance')).send({ pay: { paidFrom: 'cash', reference: `V${stamp}` } }).expect(200);
      await sources.syncMoney(new Date());
      expect(await open('expense_needs_ceo', big.body.id, ceoId)).toBe(0);
      expect(await open('expense_to_pay', small.body.id, financeId)).toBe(0);
      const cleared = await prisma.notification.findFirst({ where: { kind: 'expense_to_pay', subjectId: small.body.id, recipientStaffId: financeId } });
      expect(cleared).toMatchObject({ clearedByStaffId: financeId, clearedReason: 'expense_paid' });
    });

    it('no bill, no approval: the bill can be attached afterwards', async () => {
      const created = await addExpense('finance', 180000, { bill: false, category: 'office_other' }).expect(201);
      expect(created.body.hasBill).toBe(false);
      const refused = await request(server()).post(`/finance/expenses/${created.body.id}/approve`).set(as('ceo')).send({}).expect(400);
      expect(refused.body.message).toContain('No bill, no payment');
      await request(server()).post(`/finance/expenses/${created.body.id}/bill`).set(as('finance')).attach('bill', pdf, { filename: 'b.pdf', contentType: 'application/pdf' }).expect(201);
      await request(server()).post(`/finance/expenses/${created.body.id}/approve`).set(as('finance')).send({}).expect(200);
    });

    it('refuses a bill that is not a photo or PDF, a float amount and an ad without a channel', async () => {
      await request(server())
        .post('/finance/expenses')
        .set(as('finance'))
        .field('category', 'office_other')
        .field('supplier', 'X')
        .field('description', 'Y')
        .field('amountPaise', '1000')
        .field('billDate', new Date().toISOString())
        .attach('bill', Buffer.from('MZ'), { filename: 'x.exe', contentType: 'application/x-msdownload' })
        .expect(400);
      await addExpense('finance', 1000.5 as number).expect(400);
      await addExpense('finance', 100000, { category: 'ads_marketing' }).expect(400);
      await addExpense('finance', 100000, { category: 'ads_marketing', adChannel: 'social_media' }).expect(201);
    });

    it('the CEO rejects an expense with a reason; the CEO entering one approves it', async () => {
      const created = await addExpense('finance', 1500000, { category: 'hosting' }).expect(201);
      await request(server()).post(`/finance/expenses/${created.body.id}/reject`).set(as('ceo')).send({}).expect(400);
      const rejected = await request(server()).post(`/finance/expenses/${created.body.id}/reject`).set(as('ceo')).send({ reason: 'Wrong month' }).expect(200);
      expect(rejected.body).toMatchObject({ status: 'rejected', rejectionReason: 'Wrong month' });
      const byCeo = await addExpense('ceo', 4500000, { category: 'rent' }).expect(201);
      expect(byCeo.body.status).toBe('approved');
    });

    it('lists the bills with what is still to pay, and the profit for the period', async () => {
      const list = await request(server()).get('/finance/expenses').query({ search: `W4F Supplier ${stamp}` }).set(as('finance')).expect(200);
      expect(list.body.rows.length).toBeGreaterThanOrEqual(5);
      expect(list.body.summary.limitPaise).toBe(1000000);
      const toPay = await request(server()).get('/finance/expenses').query({ status: 'to_pay', search: `W4F Supplier ${stamp}` }).set(as('finance')).expect(200);
      expect(toPay.body.rows.every((r: { status: string }) => ['waiting_finance', 'waiting_ceo', 'approved'].includes(r.status))).toBe(true);
      const profit = await request(server()).get('/finance/profit').set(as('ceo')).expect(200);
      expect(profit.body).toEqual(expect.objectContaining({ profitPaise: expect.any(Number), categories: expect.any(Array), channels: expect.any(Array) }));
      expect(profit.body.revenue.netRevenuePaise - profit.body.expenses.totalPaise).toBe(profit.body.profitPaise);
    });

    it('only the CEO sets budgets', async () => {
      await request(server()).put('/finance/expense-budgets').set(as('finance')).send({ month: '2026-11', budgets: { rent: 4500000 } }).expect(403);
      await request(server()).put('/finance/expense-budgets').set(as('ceo')).send({ month: '2026-11', budgets: { nonsense: 1 } }).expect(400);
      const res = await request(server()).put('/finance/expense-budgets').set(as('ceo')).send({ month: '2026-11', budgets: { rent: 4500000, salaries: 42000000 } }).expect(200);
      expect(res.body.find((b: { category: string }) => b.category === 'rent').amountPaise).toBe(4500000);
    });
  });

  async function seekerWithReward(name: string, accountActiveFrom: Date, status = 'pending') {
    counter += 1;
    const seeker = await prisma.jobSeeker.create({
      data: {
        code: `JS-W4F-${stamp}-${counter}`,
        name,
        phone: `+9198${stamp.slice(-6)}${String(counter).padStart(2, '0')}`,
        phoneVerified: true,
        minSalary: 1500000,
        maxSalary: 2000000,
        preferredCallWindowStart: '10:00',
        preferredCallWindowEnd: '18:00',
        status: 'placed',
      },
    });
    seekerIds.push(seeker.id);
    const account = await prisma.payoutAccount.create({
      data: {
        code: `PA-W4F-${stamp}-${counter}`,
        ownerType: 'job_seeker',
        ownerId: seeker.id,
        ownerNameAtEntry: name,
        method: 'upi',
        maskedValue: 'ar***@okaxis',
        valueHash: `w4f-${stamp}-${counter}`,
        status: 'verified',
        activeFrom: accountActiveFrom,
      },
    });
    accountIds.push(account.id);
    const payment = await prisma.payment.create({
      data: {
        code: `PAY-W4F-${stamp}-${counter}`,
        type: 'joining_reward',
        status,
        amount: 20000,
        subjectType: 'job_seeker',
        subjectId: seeker.id,
        jobSeekerId: seeker.id,
        ...(status === 'approved' ? { approvedAt: new Date(), approvedByStaffId: financeId } : {}),
      },
    });
    paymentIds.push(payment.id);
    return { seeker, account, payment };
  }

  describe('payouts paid daily', () => {
    it('waits out the 48 hours, then Finance pays and records the UTR', async () => {
      const waiting = await seekerWithReward('Arjun Dev', new Date(Date.now() + 47 * 3600 * 1000));
      const list = await request(server()).get('/finance/payouts').query({ search: waiting.seeker.code }).set(as('finance')).expect(200);
      expect(list.body.rows).toHaveLength(1);
      expect(list.body.rows[0]).toMatchObject({ state: 'waiting_48h', amountPaise: 20000 });
      await request(server()).post(`/finance/payouts/${waiting.payment.id}/pay`).set(as('finance')).send({ utr: `431${stamp}1`, receiverNameShown: 'Arjun Dev' }).expect(400);
      expect((await prisma.payment.findUniqueOrThrow({ where: { id: waiting.payment.id } })).status).toBe('pending');

      const ready = await seekerWithReward('Ramesh Kumar', new Date(Date.now() - 49 * 3600 * 1000));
      const readyList = await request(server()).get('/finance/payouts').query({ search: ready.seeker.code }).set(as('finance')).expect(200);
      expect(readyList.body.rows[0].state).toBe('ready');
      const paid = await request(server()).post(`/finance/payouts/${ready.payment.id}/pay`).set(as('finance')).send({ utr: `431${stamp}2`, receiverNameShown: 'Ramesh Kumar' }).expect(200);
      expect(paid.body).toMatchObject({ status: 'succeeded', bankUtr: `431${stamp}2` });
      const after = await request(server()).get('/finance/payouts').query({ search: ready.seeker.code }).set(as('finance')).expect(200);
      expect(after.body.rows).toHaveLength(0);
      // Paid once, so it is one automatic expense line, never entered again.
      const exp = await request(server()).get('/finance/expenses').set(as('finance')).expect(200);
      expect(exp.body.auto.filter((a: { id: string }) => a.id === ready.payment.id)).toHaveLength(1);
    });

    it('pays all ready payouts, each with its own UTR, and reports each result', async () => {
      const a = await seekerWithReward('Suma Rao', new Date(Date.now() - 72 * 3600 * 1000));
      const b = await seekerWithReward('Kavya Reddy', new Date(Date.now() - 72 * 3600 * 1000));
      const res = await request(server())
        .post('/finance/payouts/pay-all')
        .set(as('finance'))
        .send({
          items: [
            { id: a.payment.id, utr: `432${stamp}1`, receiverNameShown: 'Suma Rao' },
            { id: b.payment.id, utr: `432${stamp}2`, receiverNameShown: 'Somebody Else' },
          ],
        })
        .expect(200);
      expect(res.body.paid).toBe(1);
      expect(res.body.failed).toBe(1);
      expect(res.body.results.find((r: { id: string }) => r.id === b.payment.id).message).toContain('does not match');
      expect((await prisma.payment.findUniqueOrThrow({ where: { id: a.payment.id } })).status).toBe('succeeded');
    });

    it('records a bank failure with its reason and retries it', async () => {
      const p = await seekerWithReward('Meena Joshi', new Date(Date.now() - 72 * 3600 * 1000), 'approved');
      await request(server()).post(`/finance/payouts/${p.payment.id}/failed`).set(as('finance')).send({}).expect(400);
      const failed = await request(server()).post(`/finance/payouts/${p.payment.id}/failed`).set(as('finance')).send({ reason: 'Account closed' }).expect(200);
      expect(failed.body).toMatchObject({ status: 'failed', payoutFailureReason: 'Account closed' });
      const list = await request(server()).get('/finance/payouts').query({ status: 'failed', search: p.seeker.code }).set(as('finance')).expect(200);
      expect(list.body.rows[0]).toMatchObject({ state: 'failed', failureReason: 'Account closed' });
      await request(server()).post(`/finance/payouts/${p.payment.id}/pay`).set(as('finance')).send({ utr: `433${stamp}`, receiverNameShown: 'Meena Joshi' }).expect(400);
      const retried = await request(server()).post(`/finance/payouts/${p.payment.id}/retry`).set(as('finance')).expect(200);
      expect(retried.body.status).toBe('approved');
      await request(server()).post(`/finance/payouts/${p.payment.id}/retry`).set(as('finance')).expect(400);
      const audit = await prisma.auditLog.findMany({ where: { entityCode: p.payment.code, action: { in: ['payout.failed_at_bank', 'payout.retry'] } } });
      expect(audit).toHaveLength(2);
    });
  });

  describe('money in, match and return', () => {
    it('lists an unclaimed credit as needing Finance, offers the waiting payment, and returns the money', async () => {
      counter += 1;
      const utr = `W4F${stamp}${counter}`;
      creditUtrs.push(utr);
      const credit = await request(server())
        .post('/payments/bank-credits')
        .set(as('finance'))
        .send({ bankUtr: utr, amountPaise: 49901, receivedAt: new Date().toISOString(), payerName: 'Ravi K', payerVpaMasked: 'ra***@okicici' })
        .expect(201);
      const seeker = await prisma.jobSeeker.create({
        data: {
          code: `JS-W4F-${stamp}-m${counter}`,
          name: 'Ravi Kumar',
          phone: `+9197${stamp.slice(-6)}${String(counter).padStart(2, '0')}`,
          minSalary: 1500000,
          maxSalary: 2000000,
          preferredCallWindowStart: '10:00',
          preferredCallWindowEnd: '18:00',
        },
      });
      seekerIds.push(seeker.id);
      const pending = await prisma.payment.create({
        data: { code: `PAY-W4F-${stamp}-m${counter}`, type: 'activation', status: 'pending', amount: 49901, expectedAmountPaise: 49901, subjectType: 'job_seeker', subjectId: seeker.id, jobSeekerId: seeker.id, createdAt: new Date(Date.now() - 17 * 60000) },
      });
      paymentIds.push(pending.id);

      const moneyIn = await request(server()).get('/finance/money-in').query({ search: utr }).set(as('finance')).expect(200);
      expect(moneyIn.body.rows).toHaveLength(1);
      expect(moneyIn.body.rows[0]).toMatchObject({ status: 'not_matched', receivedPaise: 49901 });
      const needs = await request(server()).get('/finance/money-in').query({ status: 'needs', search: utr }).set(as('finance')).expect(200);
      expect(needs.body.rows).toHaveLength(1);

      const matches = await request(server()).get(`/finance/bank-credits/${credit.body.id}/matches`).set(as('finance')).expect(200);
      const candidate = matches.body.candidates.find((c: { paymentId: string }) => c.paymentId === pending.id);
      expect(candidate.reasons).toEqual(expect.arrayContaining(['Same amount', 'Same first name']));

      await request(server()).post(`/finance/bank-credits/${credit.body.id}/return`).set(as('finance')).send({}).expect(400);
      await request(server()).post(`/finance/bank-credits/${credit.body.id}/return`).set(as('manager')).send({ utr: 'X' }).expect(403);
      const returned = await request(server()).post(`/finance/bank-credits/${credit.body.id}/return`).set(as('finance')).send({ utr: `R${utr}` }).expect(200);
      expect(returned.body).toMatchObject({ status: 'returned', returnedUtr: `R${utr}` });
      await request(server()).post(`/finance/bank-credits/${credit.body.id}/return`).set(as('finance')).send({ utr: `R2${utr}` }).expect(400);
      const after = await request(server()).get('/finance/money-in').query({ search: utr }).set(as('finance')).expect(200);
      expect(after.body.rows[0].status).toBe('returned');
    });
  });

  describe('bank', () => {
    it('closes a day only when the bank agrees with the books, or with a reason, and in order', async () => {
      const view = await request(server()).get('/finance/bank').query({ fromDate: '2020-01-01T00:00:00+05:30', toDate: '2020-01-02T23:59:59+05:30' }).set(as('finance')).expect(200);
      const day1 = view.body.days.find((d: { day: string }) => d.day === '2020-01-01');
      expect(day1.booksClosingPaise).toBe(day1.openingPaise + day1.inPaise - day1.outPaise);
      await request(server()).post('/finance/bank/close-day').set(as('finance')).send({ day: '2020-01-01', bankClosingPaise: day1.booksClosingPaise + 118000 }).expect(400);
      const closed = await request(server()).post('/finance/bank/close-day').set(as('finance')).send({ day: '2020-01-01', bankClosingPaise: day1.booksClosingPaise }).expect(200);
      expect(closed.body).toMatchObject({ day: '2020-01-01', differencePaise: 0 });
      await request(server()).post('/finance/bank/close-day').set(as('finance')).send({ day: '2020-01-01', bankClosingPaise: day1.booksClosingPaise }).expect(409);
      await request(server()).post('/finance/bank/close-day').set(as('finance')).send({ day: '2020-01-02', bankClosingPaise: day1.booksClosingPaise + 50000 }).expect(400);
      const withNote = await request(server()).post('/finance/bank/close-day').set(as('finance')).send({ day: '2020-01-02', bankClosingPaise: day1.booksClosingPaise + 50000, note: 'Interest credited, to record' }).expect(200);
      expect(withNote.body.differencePaise).toBe(50000);
      await request(server()).post('/finance/bank/close-day').set(as('finance')).send({ day: '2019-12-31', bankClosingPaise: 0 }).expect(400);
      await request(server()).post('/finance/bank/close-day').set(as('finance')).send({ day: '2999-01-01', bankClosingPaise: 0 }).expect(400);
      const after = await request(server()).get('/finance/bank').query({ fromDate: '2020-01-01T00:00:00+05:30', toDate: '2020-01-03T23:59:59+05:30' }).set(as('ceo')).expect(200);
      const day3 = after.body.days.find((d: { day: string }) => d.day === '2020-01-03');
      // The bank's own closing balance is carried forward as the next opening.
      expect(day3.openingPaise).toBe(day1.booksClosingPaise + 50000);
    });
  });

  describe('invoices and Money today', () => {
    it('lists invoices and receipts, and refuses an unknown TDS record', async () => {
      const res = await request(server()).get('/finance/invoices').set(as('finance')).expect(200);
      expect(res.body.summary).toEqual(expect.objectContaining({ invoiceCount: expect.any(Number), unpaidCount: expect.any(Number) }));
      await request(server()).post('/finance/tds-receivables/00000000-0000-0000-0000-000000000000/certificate-received').set(as('finance')).expect(404);
    });

    it('Money today has the stats, the to-do list and the limits', async () => {
      const res = await request(server()).get('/finance/home').set(as('finance')).expect(200);
      expect(res.body.limits).toEqual({ businessRefundLimitPaise: 1500000, expenseLimitPaise: 1000000, referralTdsYearlyLimitPaise: expect.any(Number) });
      expect(res.body.todo.billsToPay.count).toBeGreaterThanOrEqual(1);
      expect(res.body.stats).toEqual(expect.objectContaining({ receivedThisMonthPaise: expect.any(Number), booksBalancePaise: expect.any(Number) }));
      const counts = await request(server()).get('/finance/counts').set(as('finance')).expect(200);
      expect(counts.body).toEqual({ bankCreditsUnmatched: expect.any(Number), invoicesUnpaid: expect.any(Number), payoutsDue: expect.any(Number), expensesToApprove: expect.any(Number) });
    });

    it('Finance can re-send an unpaid fee link (Send reminder) — the route accepts Finance', async () => {
      await request(server()).post('/payments/00000000-0000-0000-0000-000000000000/resend').set(as('finance')).expect(404);
    });
  });
});
