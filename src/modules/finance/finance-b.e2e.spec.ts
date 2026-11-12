import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { createHmac } from 'crypto';
import * as request from 'supertest';
import { AppModule } from '../../app.module';
import { PrismaService } from '../../common/prisma/prisma.service';
import { NotificationSourcesService } from '../notification/notification-sources.service';
import { monthBounds } from './payroll-rules';

/**
 * Phase 22 Part B against a real database (with the owner decisions of 11 Nov).
 * A month long before anyone else's test data (March 2003: 31 days, Sundays
 * 2, 9, 16, 23, 30 → 26 working days, no holidays) keeps the salary sheet to
 * this suite's two people:
 * - Asha (call agent, joined 1 Dec 2002): full days except one absent day,
 *   one half day and 30 minutes of shortfall not made up;
 * - Bala (Manager, joined 10 Mar 2003): full days from his joining day.
 * Pay = monthly ÷ 26 a day. Finance prepares once the month is over, the CEO
 * approves the exact total he saw, Finance pays with a UTR; each person
 * (the Manager too) reads only their own payslip, once paid. The CEO closes
 * the month: its records never change, late money is booked in the open
 * month, and only the CEO reopens.
 */
describe('Finance back office (Phase 22 Part B)', () => {
  const MONTH = '2003-03';
  let app: INestApplication;
  let prisma: PrismaService;
  let jwt: JwtService;
  let sources: NotificationSourcesService;
  const stamp = `${Date.now()}`;
  const staffIds: string[] = [];
  const paymentIds: string[] = [];
  const creditUtrs: string[] = [];
  const tokens: Record<string, string> = {};
  let counter = 0;
  let ceoId = '';
  let financeId = '';
  let asha: { id: string; code: string };
  let bala: { id: string; code: string };

  async function makeStaff(role: string, key: string, extra: { createdAt?: Date; joinedOn?: Date } = {}) {
    counter += 1;
    const staff = await prisma.staff.create({
      data: {
        code: `W5B-${role.slice(0, 3).toUpperCase()}-${stamp}-${counter}`,
        name: `W5B ${key} ${counter}`,
        email: `w5b-${key}-${stamp}-${counter}@laboura.local`,
        passwordHash: await bcrypt.hash('W5B-Password-1', 4),
        role,
        city: 'Bengaluru',
        status: 'active',
        reportsToId: role === 'ceo' ? null : ceoId || null,
        ...extra,
      },
    });
    staffIds.push(staff.id);
    tokens[key] = jwt.sign({ sub: staff.id, email: staff.email, role: staff.role, code: staff.code, teamLeadId: null });
    return staff;
  }

  const server = () => app.getHttpServer();
  const as = (key: string) => ({ Authorization: `Bearer ${tokens[key]}` });
  const day = (d: string) => new Date(`${d}T00:00:00.000Z`);
  const marchWorkingDays = Array.from({ length: 31 }, (_, i) => `2003-03-${String(i + 1).padStart(2, '0')}`).filter((d) => day(d).getUTCDay() !== 0);
  const openBells = (kind: string, subjectId: string, recipientStaffId: string) =>
    prisma.notification.count({ where: { kind, subjectId, recipientStaffId, clearedAt: null } });
  const sheetOf = async (key = 'finance') => (await request(server()).get(`/finance/salaries?month=${MONTH}`).set(as(key)).expect(200)).body;
  const approveBody = (sheet: { totals: { netPaise: number }; run: { preparedAt: string } }) => ({ netPaise: sheet.totals.netPaise, preparedAt: sheet.run.preparedAt });

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication({ rawBody: true });
    await app.init();
    prisma = app.get(PrismaService);
    jwt = app.get(JwtService);
    sources = app.get(NotificationSourcesService);
    // Leftovers from an earlier failed run of this suite.
    await prisma.payrollRun.deleteMany({ where: { month: MONTH } });
    await prisma.monthClose.deleteMany({ where: { month: MONTH } });
    await prisma.monthReviewMark.deleteMany({ where: { month: MONTH } });
    ceoId = (await makeStaff('ceo', 'ceo')).id;
    financeId = (await makeStaff('finance', 'finance')).id;
    await makeStaff('manager', 'manager');
    await makeStaff('team_lead', 'team_lead');
    await makeStaff('call_agent', 'agent');
    asha = await makeStaff('call_agent', 'asha', { createdAt: new Date('2002-12-01T04:00:00.000Z'), joinedOn: day('2002-12-01') });
    bala = await makeStaff('manager', 'bala', { createdAt: new Date('2003-03-10T04:00:00.000Z'), joinedOn: day('2003-03-10') });
    const special: Record<string, { dayType: string; productionSeconds: number; shortfallSeconds?: number; closedReason: string }> = {
      '2003-03-04': { dayType: 'absent', productionSeconds: 0, closedReason: 'no_login' },
      '2003-03-05': { dayType: 'half', productionSeconds: 4 * 3600, closedReason: 'logout' },
      '2003-03-06': { dayType: 'full', productionSeconds: 7.5 * 3600, shortfallSeconds: 1800, closedReason: 'logout' },
    };
    await prisma.attendanceDay.createMany({
      data: [
        ...marchWorkingDays.map((d) => ({ staffId: asha.id, date: day(d), ...(special[d] ?? { dayType: 'full', productionSeconds: 8 * 3600, closedReason: 'logout' }) })),
        ...marchWorkingDays.filter((d) => d >= '2003-03-10').map((d) => ({ staffId: bala.id, date: day(d), dayType: 'full', productionSeconds: 8 * 3600, closedReason: 'logout' })),
      ],
    });
  }, 120000);

  afterAll(async () => {
    if (!prisma) return;
    await prisma.payrollRun.deleteMany({ where: { month: MONTH } });
    await prisma.monthClose.deleteMany({ where: { month: MONTH } });
    await prisma.monthReviewMark.deleteMany({ where: { month: MONTH } });
    await prisma.staffSalary.deleteMany({ where: { staffId: { in: staffIds } } });
    await prisma.staffAwayPeriod.deleteMany({ where: { staffId: { in: staffIds } } });
    await prisma.expense.deleteMany({ where: { enteredByStaffId: { in: staffIds } } });
    await prisma.attendanceDay.deleteMany({ where: { staffId: { in: staffIds } } });
    const credits = await prisma.bankCredit.findMany({ where: { bankUtr: { in: creditUtrs } }, select: { id: true } });
    await prisma.reviewFlag.deleteMany({ where: { subjectId: { in: [...credits.map((c) => c.id), ...paymentIds] } } });
    await prisma.bankCredit.deleteMany({ where: { bankUtr: { in: creditUtrs } } });
    await prisma.statusHistory.deleteMany({ where: { subjectType: 'payment', subjectId: { in: paymentIds } } });
    await prisma.payment.deleteMany({ where: { id: { in: paymentIds } } });
    await prisma.notification.deleteMany({ where: { OR: [{ recipientStaffId: { in: staffIds } }, { subjectType: 'payroll_month', subjectId: MONTH }, { subjectType: 'month', subjectId: MONTH }] } });
    await sources.syncPayroll(new Date()).catch(() => undefined);
    await prisma.staffSession.deleteMany({ where: { staffId: { in: staffIds } } });
    await prisma.auditLog.deleteMany({ where: { actorId: { in: staffIds } } });
    await prisma.staff.updateMany({ where: { id: { in: staffIds } }, data: { reportsToId: null, teamLeadId: null } });
    await prisma.staff.deleteMany({ where: { id: { in: staffIds } } });
    await app.close();
  });

  const GET_ROUTES = [
    `/finance/salaries?month=${MONTH}`,
    '/finance/staff-salaries',
    `/finance/tax?month=${MONTH}`,
    '/finance/reports',
    `/finance/month-end?month=${MONTH}`,
    '/finance/refunds',
    `/finance/reports/books.csv?month=${MONTH}`,
    `/finance/reports/gstr1.csv?month=${MONTH}`,
    `/finance/reports/tds.csv?month=${MONTH}`,
    `/finance/reports/tax.csv?month=${MONTH}`,
    `/finance/reports/salary-sheet.csv?month=${MONTH}`,
    `/finance/month-end/review.csv?month=${MONTH}`,
  ];

  describe('who may use it', () => {
    it.each(GET_ROUTES)('%s answers Finance and the CEO', async (route) => {
      await request(server()).get(route).set(as('finance')).expect(200);
      await request(server()).get(route).set(as('ceo')).expect(200);
    });

    it.each(GET_ROUTES)('%s refuses Managers, Team Leads and agents', async (route) => {
      for (const key of ['manager', 'team_lead', 'agent']) {
        await request(server()).get(route).set(as(key)).expect(403);
      }
    });

    it('lets only the CEO set salaries and do the CEO-only steps', async () => {
      await request(server()).put(`/finance/staff-salaries/${asha.id}`).set(as('manager')).send({ monthlyPaise: 100, effectiveFromMonth: MONTH }).expect(403);
      await request(server()).put(`/finance/staff-salaries/${asha.id}`).set(as('finance')).send({ monthlyPaise: 3100000, effectiveFromMonth: MONTH }).expect(403);
      await request(server()).post(`/finance/salaries/${MONTH}/prepare`).set(as('agent')).expect(403);
      await request(server()).post(`/finance/salaries/${MONTH}/approve`).set(as('finance')).send({}).expect(403);
      await request(server()).post(`/finance/month-end/${MONTH}/close`).set(as('finance')).send({ note: 'x' }).expect(403);
      await request(server()).post(`/finance/month-end/${MONTH}/reopen`).set(as('finance')).send({ reason: 'x' }).expect(403);
    });

    it('gives the CEO no payslip self-service, and nobody anything before they are paid', async () => {
      await request(server()).get('/payroll/my-payslips').set(as('ceo')).expect(403);
      expect((await request(server()).get('/payroll/my-payslips').set(as('asha')).expect(200)).body.months).toEqual([]);
      expect((await request(server()).get('/payroll/my-payslips').set(as('bala')).expect(200)).body.months).toEqual([]);
    });

    it('lets only the CEO enter a joining date', async () => {
      await request(server()).put(`/staff/${bala.id}/joined-on`).set(as('manager')).send({ joinedOn: '2003-03-10' }).expect(403);
      await request(server()).put(`/staff/${bala.id}/joined-on`).set(as('ceo')).send({ joinedOn: 'soon' }).expect(400);
      const res = await request(server()).put(`/staff/${bala.id}/joined-on`).set(as('ceo')).send({ joinedOn: '2003-03-10' }).expect(200);
      expect(res.body.joinedOn).toBe('2003-03-10T00:00:00.000Z');
    });
  });

  describe('salaries from attendance', () => {
    it('refuses to prepare a month that is not over, and while someone has no salary', async () => {
      const thisMonth = new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 7);
      await request(server()).post(`/finance/salaries/${thisMonth}/prepare`).set(as('finance')).expect(400);
      await request(server()).put(`/finance/staff-salaries/${asha.id}`).set(as('ceo')).send({ monthlyPaise: 2600000, effectiveFromMonth: '2003-01', note: 'Joining salary' }).expect(200);
      const res = await request(server()).post(`/finance/salaries/${MONTH}/prepare`).set(as('finance')).expect(400);
      expect(res.body.message).toContain(bala.code);
      await request(server()).put(`/finance/staff-salaries/${bala.id}`).set(as('ceo')).send({ monthlyPaise: 5200000, effectiveFromMonth: MONTH }).expect(200);
      await request(server()).put(`/finance/staff-salaries/${bala.id}`).set(as('ceo')).send({ monthlyPaise: 5200050, effectiveFromMonth: MONTH }).expect(400);
    });

    it('works out pay at monthly ÷ 26: loss of pay, half day, shortfall, working days before joining', async () => {
      const sheet = await sheetOf();
      expect(sheet.status).toBe('draft');
      expect(sheet.salaryDays).toBe(26);
      expect(sheet.statutory.note).toBe('Added after company registration');
      expect(sheet.rows).toHaveLength(2);
      const a = sheet.rows.find((r: { staffId: string }) => r.staffId === asha.id);
      const b = sheet.rows.find((r: { staffId: string }) => r.staffId === bala.id);
      // Asha: ₹26,000 ÷ 26 = ₹1,000 a day; 1 absent + half of a half day = ₹1,500.
      expect(a.workingDays).toBe(26);
      expect(a.lossOfPayDays).toBe(1.5);
      expect(a.paidDays).toBe(24.5);
      expect(a.lossOfPayPaise).toBe(150000);
      expect(a.shortfallMinutes).toBe(30);
      // 30 minutes of an 8-hour ₹1,000 day.
      expect(a.shortfallPaise).toBe(6250);
      expect(a.notEmployedDays).toBe(0);
      expect(a.pfPaise + a.esiPaise + a.professionalTaxPaise).toBe(0);
      expect(a.netPaise).toBe(2600000 - 150000 - 6250);
      // Bala joined Monday 10 March: 19 working days on the staff × ₹52,000 ÷ 26 = ₹38,000.
      expect(b.notEmployedDays).toBe(7);
      expect(b.notEmployedPaise).toBe(1400000);
      expect(b.netPaise).toBe(3800000);
    });

    it('goes Finance → CEO (send back, approve exactly what he saw) → Finance pays with a UTR', async () => {
      const prepared = await request(server()).post(`/finance/salaries/${MONTH}/prepare`).set(as('finance')).expect(200);
      expect(prepared.body.status).toBe('with_ceo');
      await sources.syncPayroll(new Date());
      expect(await openBells('salaries_need_ceo', MONTH, ceoId)).toBe(1);

      await request(server()).post(`/finance/salaries/${MONTH}/send-back`).set(as('ceo')).send({}).expect(400);
      const back = await request(server()).post(`/finance/salaries/${MONTH}/send-back`).set(as('ceo')).send({ reason: 'Check Asha’s half day' }).expect(200);
      expect(back.body.status).toBe('returned');
      expect(await openBells('salaries_need_ceo', MONTH, ceoId)).toBe(0);
      expect(await openBells('salaries_to_release', MONTH, financeId)).toBe(1);

      await request(server()).post(`/finance/salaries/${MONTH}/prepare`).set(as('finance')).expect(200);
      const seen = await sheetOf('ceo');
      // Finance works it out again after the CEO opened it: his approval of the old sheet is refused.
      await new Promise((r) => setTimeout(r, 5));
      await request(server()).post(`/finance/salaries/${MONTH}/prepare`).set(as('finance')).expect(200);
      await request(server()).post(`/finance/salaries/${MONTH}/approve`).set(as('ceo')).send({}).expect(400);
      await request(server()).post(`/finance/salaries/${MONTH}/approve`).set(as('ceo')).send(approveBody(seen)).expect(409);

      const fresh = await sheetOf('ceo');
      const lineA = fresh.rows.find((r: { staffId: string }) => r.staffId === asha.id).line;
      await request(server()).post(`/finance/salaries/${MONTH}/lines/${lineA.id}/pay`).set(as('finance')).send({ utr: `W5B${stamp}A` }).expect(400);

      const approved = await request(server()).post(`/finance/salaries/${MONTH}/approve`).set(as('ceo')).send(approveBody(fresh)).expect(200);
      expect(approved.body.status).toBe('approved');
      const audit = await prisma.auditLog.findFirst({ where: { action: 'payroll.approved', entityCode: MONTH, actorId: ceoId } });
      expect(audit?.after).toMatchObject({ netPaise: fresh.totals.netPaise, preparedAt: fresh.run.preparedAt });
      expect(await openBells('salaries_to_release', MONTH, financeId)).toBe(1);
      const bell = await prisma.notification.findFirst({ where: { kind: 'salaries_to_release', subjectId: MONTH, recipientStaffId: financeId, clearedAt: null } });
      expect(bell?.title).toContain('ready to release');

      // A salary approved by the CEO can't be changed for that month.
      await request(server()).put(`/finance/staff-salaries/${asha.id}`).set(as('ceo')).send({ monthlyPaise: 3200000, effectiveFromMonth: MONTH }).expect(400);

      await request(server()).post(`/finance/salaries/${MONTH}/lines/${lineA.id}/pay`).set(as('finance')).send({}).expect(400);
      const paid = await request(server()).post(`/finance/salaries/${MONTH}/lines/${lineA.id}/pay`).set(as('finance')).send({ utr: `W5B${stamp}A`, paidFrom: 'bank_transfer' }).expect(200);
      expect(paid.body.monthPaid).toBe(false);
      await request(server()).post(`/finance/salaries/${MONTH}/lines/${lineA.id}/pay`).set(as('finance')).send({ utr: `W5B${stamp}X` }).expect(409);
      expect(await prisma.notification.count({ where: { kind: 'payslip_ready', recipientStaffId: asha.id, clearedAt: null } })).toBe(1);
    });

    it('refuses a UTR already used anywhere in the books with 409', async () => {
      const sheet = await sheetOf();
      const lineB = sheet.rows.find((r: { staffId: string }) => r.staffId === bala.id).line;
      const res = await request(server()).post(`/finance/salaries/${MONTH}/lines/${lineB.id}/pay`).set(as('finance')).send({ utr: `W5B${stamp}A` }).expect(409);
      expect(res.body.message).toMatch(/already been used on the salary of/);
      const credit = await request(server()).post('/payments/bank-credits').set(as('finance')).send({ bankUtr: `W5B${stamp}A`, amountPaise: 100, receivedAt: new Date().toISOString() }).expect(409);
      expect(credit.body.message).toMatch(/already been used/);
    });

    it('refuses to pay a salary on a closed bank day', async () => {
      const sheet = await sheetOf();
      const lineB = sheet.rows.find((r: { staffId: string }) => r.staffId === bala.id).line;
      const tomorrow = new Date(Date.now() + (5.5 + 24) * 3600_000).toISOString().slice(0, 10);
      await prisma.bankDayClose.create({ data: { day: tomorrow, openingPaise: 0, inPaise: 0, outPaise: 0, booksClosingPaise: 0, bankClosingPaise: 0, differencePaise: 0, closedByStaffId: financeId, closedAt: new Date() } });
      try {
        const res = await request(server()).post(`/finance/salaries/${MONTH}/lines/${lineB.id}/pay`).set(as('finance')).send({ utr: `W5B${stamp}B` }).expect(400);
        expect(res.body.message).toMatch(/bank day .* is already closed/);
      } finally {
        await prisma.bankDayClose.deleteMany({ where: { day: tomorrow } });
      }
    });

    it('lets each person — the Manager too — read only their own payslip, once paid', async () => {
      const list = await request(server()).get('/payroll/my-payslips').set(as('asha')).expect(200);
      expect(list.body.months.map((m: { month: string }) => m.month)).toEqual([MONTH]);
      const slip = await request(server()).get(`/payroll/my-payslips/${MONTH}`).set(as('asha')).expect(200);
      expect(slip.body.employee.code).toBe(asha.code);
      expect(slip.body.days.salaryDays).toBe(26);
      expect(slip.body.days.lossOfPayDays).toBe(1.5);
      expect(slip.body.earnings.map((e: { key: string }) => e.key)).toEqual(['basic', 'hra', 'special']);
      expect(slip.body.earnings.some((e: { label: string }) => /incentive|commission/i.test(e.label))).toBe(false);
      expect(slip.body.deductions.find((d: { key: string }) => d.key === 'pf')).toEqual(expect.objectContaining({ paise: 0, note: 'Added after company registration' }));
      expect(slip.body.netPaise).toBe(2443750);
      expect(slip.body.netInWords).toBe('Twenty four thousand four hundred thirty seven rupees and fifty paise');
      // Bala (a Manager) is not paid yet: nothing to show.
      await request(server()).get(`/payroll/my-payslips/${MONTH}`).set(as('bala')).expect(404);
      await request(server()).get(`/finance/salaries/${MONTH}/payslips/${bala.id}`).set(as('finance')).expect(200);
      await request(server()).get(`/finance/salaries/${MONTH}/payslips/${bala.id}`).set(as('manager')).expect(403);
    });

    it('marks the month paid with the last payment; the Manager sees his own pay and no other money', async () => {
      const sheet = await sheetOf();
      const lineB = sheet.rows.find((r: { staffId: string }) => r.staffId === bala.id).line;
      const res = await request(server()).post(`/finance/salaries/${MONTH}/lines/${lineB.id}/pay`).set(as('ceo')).send({ utr: `W5B${stamp}B` }).expect(200);
      expect(res.body.monthPaid).toBe(true);
      const run = await prisma.payrollRun.findUniqueOrThrow({ where: { month: MONTH } });
      expect(run.status).toBe('paid');
      expect(run.paidAt).not.toBeNull();
      expect(await openBells('salaries_to_release', MONTH, financeId)).toBe(0);
      const bell = await prisma.notification.findFirst({ where: { kind: 'payslip_ready', recipientStaffId: bala.id, clearedAt: null } });
      expect(bell?.link).toBe('/manager/payslip');
      const own = await request(server()).get(`/payroll/my-payslips/${MONTH}`).set(as('bala')).expect(200);
      expect(own.body.netPaise).toBe(3800000);
      expect(own.body.deductions.find((d: { key: string }) => d.key === 'not_on_staff')).toEqual(expect.objectContaining({ paise: 1400000 }));
      // Every other answer to a Manager is still stripped of money.
      await request(server()).get('/finance/home').set(as('bala')).expect(403);
    });

    it('counts the salaries in profit and the salary sheet download', async () => {
      const sheet = await sheetOf();
      const { from, to } = monthBounds(MONTH);
      const profit = await request(server()).get('/finance/profit').query({ fromDate: from.toISOString(), toDate: to.toISOString() }).set(as('ceo')).expect(200);
      expect(profit.body.expenses.salariesFromPayroll).toBe(true);
      expect(profit.body.expenses.salariesPaise).toBe(sheet.totals.netPaise);
      const csv = await request(server()).get(`/finance/reports/salary-sheet.csv?month=${MONTH}`).set(as('finance')).expect(200);
      expect(csv.headers['content-type']).toContain('text/csv');
      expect(csv.text).toContain(asha.code);
      expect(csv.text).toContain('TOTAL');
      const resend = await request(server()).post(`/finance/salaries/${MONTH}/payslips/resend`).set(as('finance')).expect(200);
      expect(resend.body.sent).toBe(2);
    });
  });

  describe('month-end review and the closed month', () => {
    let lateCreditId = '';
    let pendingPaymentId = '';

    it('lists the checklist and every money action, and takes the CEO’s marks', async () => {
      const res = await request(server()).get(`/finance/month-end?month=${MONTH}`).set(as('finance')).expect(200);
      expect(res.body.status).toBe('open');
      expect(res.body.checklist.find((c: { key: string }) => c.key === 'salaries_released').ok).toBe(true);
      expect(res.body.checklist.find((c: { key: string }) => c.key === 'bank_days_closed').ok).toBe(false);
      // Salaries were paid today, so they are in today's month, not March 2003.
      expect(res.body.actions.filter((a: { type: string }) => a.type === 'salary')).toHaveLength(0);
      await request(server()).post(`/finance/month-end/${MONTH}/marks`).set(as('finance')).send({ subjectType: 'payment', subjectId: 'x', mark: 'ok' }).expect(403);
      await request(server()).post(`/finance/month-end/${MONTH}/marks`).set(as('ceo')).send({ subjectType: 'payment', subjectId: '00000000-0000-0000-0000-000000000000', mark: 'ok' }).expect(404);
    });

    it('lets only the CEO close (a note when something is not done)', async () => {
      // A credit dated in March 2003 that nobody matched before the close.
      creditUtrs.push(`W5B${stamp}LATE`);
      lateCreditId = (await prisma.bankCredit.create({ data: { bankUtr: `W5B${stamp}LATE`, amountPaise: 49900, receivedAt: new Date('2003-03-20T06:00:00.000Z'), source: 'finance_manual', status: 'unmatched', enteredByStaffId: financeId } })).id;
      const refused = await request(server()).post(`/finance/month-end/${MONTH}/close`).set(as('ceo')).send({}).expect(400);
      expect(refused.body.message).toContain('bank days');
      await request(server()).post(`/finance/month-end/${MONTH}/close`).set(as('ceo')).send({ note: 'Test month: no bank account yet' }).expect(200);
      const view = await request(server()).get(`/finance/month-end?month=${MONTH}`).set(as('finance')).expect(200);
      expect(view.body.status).toBe('closed');
      expect(view.body.close.note).toBe('Test month: no bank account yet');
      await request(server()).post(`/finance/month-end/${MONTH}/close`).set(as('ceo')).send({ note: 'again' }).expect(409);
    });

    it('keeps the closed month unchanged: Finance writes into it are refused', async () => {
      const lockedSalary = await request(server()).put(`/finance/staff-salaries/${asha.id}`).set(as('ceo')).send({ monthlyPaise: 3200000, effectiveFromMonth: MONTH }).expect(403);
      expect(lockedSalary.body.code).toBe('month_closed');
      await request(server()).post('/finance/bank/close-day').set(as('finance')).send({ day: '2003-03-05', bankClosingPaise: 0 }).expect(403);
      await request(server())
        .post('/finance/expenses')
        .set(as('finance'))
        .field('category', 'office_other')
        .field('supplier', `W5B ${stamp}`)
        .field('description', 'Back-dated bill')
        .field('amountPaise', '50000')
        .field('billDate', '2003-03-15')
        .expect(403);
      await request(server()).post(`/finance/salaries/${MONTH}/prepare`).set(as('finance')).expect(403);
    });

    it('refuses to ignore or return a closed month’s credit, but still shows its matches', async () => {
      await request(server()).post(`/payments/bank-credits/${lateCreditId}/ignore`).set(as('finance')).send({ reason: 'test' }).expect(403);
      const ret = await request(server()).post(`/finance/bank-credits/${lateCreditId}/return`).set(as('finance')).send({ utr: `W5B${stamp}RET` }).expect(403);
      expect(ret.body.code).toBe('month_closed');
      await request(server()).get(`/finance/bank-credits/${lateCreditId}/matches`).set(as('finance')).expect(200);
    });

    it('refuses a payout back-dated into the closed month', async () => {
      const res = await request(server())
        .post('/payments/00000000-0000-0000-0000-000000000000/record-payout')
        .set(as('finance'))
        .send({ bankUtr: `W5B${stamp}PO`, receiverNameShown: 'Someone', paidAt: '2003-03-20T06:00:00.000Z' })
        .expect(403);
      expect(res.body.code).toBe('month_closed');
    });

    it('books a match of the closed month’s credit in the open month, with a note', async () => {
      const payment = await prisma.payment.create({ data: { code: `W5B-PAY-${stamp}`, type: 'activation', amount: 49900, expectedAmountPaise: 49900, status: 'pending', subjectType: 'job_seeker', subjectId: 'w5b-none' } });
      paymentIds.push(payment.id);
      pendingPaymentId = payment.id;
      const before = Date.now();
      await request(server()).post(`/payments/${pendingPaymentId}/confirm`).set(as('finance')).send({ bankCreditId: lateCreditId }).expect(201);
      const confirmed = await prisma.payment.findUniqueOrThrow({ where: { id: pendingPaymentId } });
      expect(confirmed.status).toBe('succeeded');
      expect(confirmed.confirmedAt!.getTime()).toBeGreaterThanOrEqual(before - 1000);
      expect(confirmed.bookingNote).toMatch(/Bank date 2003-03-20: March 2003 is closed/);
      const credit = await prisma.bankCredit.findUniqueOrThrow({ where: { id: lateCreditId } });
      expect(credit.receivedAt.toISOString()).toBe('2003-03-20T06:00:00.000Z');
      expect(credit.bookingNote).toMatch(/booked in/);
    });

    it('books a late manual credit and a late bank-feed credit in the open month, with a note', async () => {
      const before = Date.now();
      creditUtrs.push(`W5B${stamp}MAN`);
      const manual = await request(server()).post('/payments/bank-credits').set(as('finance')).send({ bankUtr: `W5B${stamp}MAN`, amountPaise: 1000, receivedAt: '2003-03-25T06:00:00.000Z' }).expect(201);
      expect(new Date(manual.body.receivedAt).getTime()).toBeGreaterThanOrEqual(before - 1000);
      expect(manual.body.bookingNote).toMatch(/Bank date 2003-03-25/);

      const secret = process.env.BANK_FEED_WEBHOOK_SECRET as string;
      creditUtrs.push(`W5B${stamp}FEED`);
      const raw = JSON.stringify({ bankUtr: `W5B${stamp}FEED`, amountPaise: 1000, receivedAt: '2003-03-26T06:00:00.000Z' });
      const signature = createHmac('sha256', secret).update(raw).digest('hex');
      await request(server()).post('/payments/bank-feed/webhook').set('Content-Type', 'application/json').set('x-bank-signature', signature).send(raw).expect(200);
      const feed = await prisma.bankCredit.findUniqueOrThrow({ where: { bankUtr: `W5B${stamp}FEED` } });
      expect(feed.receivedAt.getTime()).toBeGreaterThanOrEqual(before - 1000);
      expect(feed.bookingNote).toMatch(/Bank date 2003-03-26/);
    });

    it('lets only the CEO reopen, with a reason, audited', async () => {
      await request(server()).post(`/finance/month-end/${MONTH}/reopen`).set(as('ceo')).send({}).expect(400);
      await request(server()).post(`/finance/month-end/${MONTH}/reopen`).set(as('ceo')).send({ reason: 'A bill came in late' }).expect(200);
      const reopened = await prisma.monthClose.findUniqueOrThrow({ where: { month: MONTH } });
      expect(reopened.status).toBe('reopened');
      expect(await prisma.auditLog.count({ where: { action: 'month.reopened', entityCode: MONTH, actorId: ceoId } })).toBe(1);
      expect(await openBells('month_not_closed', MONTH, ceoId)).toBe(1);
      expect(await openBells('month_not_closed', MONTH, financeId)).toBe(1);
      await request(server()).put(`/finance/staff-salaries/${asha.id}`).set(as('ceo')).send({ monthlyPaise: 3200000, effectiveFromMonth: '2003-04' }).expect(200);
    });
  });

  describe('tax, reports and refunds', () => {
    it('shows GST, TDS and the filing dates for a month', async () => {
      const res = await request(server()).get(`/finance/tax?month=${MONTH}`).set(as('finance')).expect(200);
      expect(res.body.gst).toEqual(expect.objectContaining({ payablePaise: 0 }));
      expect(res.body.gst.creditNotes.gstPaise).toBe(0);
      expect(res.body.dates.map((d: { key: string; due: string }) => `${d.key}:${d.due}`)).toEqual(['gstr1:2003-04-11', 'gstr3b:2003-04-20', 'tds_pay:2003-04-07', 'tds_return:2003-05-31']);
      const gst = await request(server()).get(`/finance/reports/gstr1.csv?month=${MONTH}`).set(as('ceo')).expect(200);
      expect(gst.text.split('\n')[0]).toContain('GSTIN of recipient');
    });

    it('gives the P&L with cash flow, and the refund queue', async () => {
      const { from, to } = monthBounds(MONTH);
      const res = await request(server()).get('/finance/reports').query({ fromDate: from.toISOString(), toDate: to.toISOString() }).set(as('finance')).expect(200);
      expect(res.body.profit.expenses.salariesFromPayroll).toBe(true);
      expect(res.body.cashFlow).toEqual(expect.objectContaining({ moneyInPaise: expect.any(Number), endPaise: expect.any(Number) }));
      const refunds = await request(server()).get('/finance/refunds').set(as('finance')).expect(200);
      expect(Array.isArray(refunds.body.rows)).toBe(true);
      await request(server()).get('/finance/refunds/nonsense').set(as('finance')).expect(400);
    });
  });

  describe('periods away', () => {
    it('records a period away on deactivate and closes it on reactivate, so the days away are not paid', async () => {
      const away = await makeStaff('call_agent', 'away', { joinedOn: day('2026-01-05') });
      await request(server()).post(`/staff/${away.id}/deactivate`).set(as('ceo')).expect(200);
      const open = await prisma.staffAwayPeriod.findFirstOrThrow({ where: { staffId: away.id } });
      expect(open.returnedAt).toBeNull();
      await request(server()).post(`/staff/${away.id}/reactivate`).set(as('ceo')).expect(200);
      const closed = await prisma.staffAwayPeriod.findFirstOrThrow({ where: { staffId: away.id } });
      expect(closed.returnedAt).not.toBeNull();
    });
  });
});
