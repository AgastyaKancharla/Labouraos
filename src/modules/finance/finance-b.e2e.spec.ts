import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { createHmac } from 'crypto';
import * as request from 'supertest';
import { AppModule } from '../../app.module';
import { PrismaService } from '../../common/prisma/prisma.service';
import { NotificationSourcesService } from '../notification/notification-sources.service';
import { Prisma } from '@prisma/client';
import { monthBounds } from './payroll-rules';
import { CORRECTIONS_TAKEN, PayrollService } from './payroll.service';
import { monthsBetween } from './payroll-window';

/**
 * Phase 22 Part B against a real database (with the owner decisions of 11 Nov).
 * A month long before anyone else's test data (March 2003: 31 days, Sundays
 * 2, 9, 16, 23, 30 → 26 working days, no holidays) keeps the salary sheet to
 * this suite's two people:
 * - Asha (call agent, joined 1 Dec 2002): full days except one absent day,
 *   one half day and 30 minutes of shortfall not made up;
 * - Bala (Manager, joined 10 Mar 2003): full days from his joining day.
 * Pay = monthly ÷ 26 a day: on staff the whole month, the monthly salary less
 * absences; part of the month, ÷ 26 × working days on staff (never more than
 * the monthly salary), then absences (Master Guide, 12 Nov). Finance prepares once the month is over, the CEO
 * approves the exact total he saw, Finance pays with a UTR; each person
 * (the Manager too) reads only their own payslip, once paid. The CEO closes
 * the month: its records never change, late money is booked in the open
 * month, and only the CEO reopens.
 */
describe('Finance back office (Phase 22 Part B)', () => {
  const MONTH = '2003-03';
  // April 2003: 30 days, Sundays 6, 13, 20, 27 → 26 working days. May 2003 is only ever a draft.
  const APRIL = '2003-04';
  const MAY = '2003-05';
  const LATE_HOLIDAY = '2003-03-04';
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
    await prisma.payrollRun.deleteMany({ where: { month: { in: [MONTH, APRIL] } } });
    await prisma.monthClose.deleteMany({ where: { month: MONTH } });
    await prisma.monthReviewMark.deleteMany({ where: { month: MONTH } });
    await prisma.holiday.deleteMany({ where: { date: day(LATE_HOLIDAY) } });
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
    await prisma.payrollRun.deleteMany({ where: { month: { in: [MONTH, APRIL] } } });
    await prisma.payrollCorrection.deleteMany({ where: { staffId: { in: staffIds } } });
    await prisma.staffRequest.deleteMany({ where: { staffId: { in: staffIds } } });
    await prisma.statusHistory.deleteMany({ where: { subjectType: 'attendance_day', changedByStaffId: { in: staffIds } } });
    await prisma.holiday.deleteMany({ where: { date: day(LATE_HOLIDAY) } });
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
    await prisma.notification.deleteMany({ where: { OR: [{ recipientStaffId: { in: staffIds } }, { subjectType: 'payroll_month', subjectId: { in: [MONTH, APRIL] } }, { subjectType: 'month', subjectId: MONTH }] } });
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
      // Bala joined Monday 10 March: paid for the days on staff, 19 working days × ₹52,000 ÷ 26 = ₹38,000
      // (the 7 working days before joining are the ₹14,000 not earned).
      expect(b.notEmployedDays).toBe(7);
      expect(b.notEmployedPaise).toBe(1400000);
      expect(b.paidDays).toBe(19);
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

    it('still shows the closed month’s bank credit in its books download once it was matched later, marked where it was booked', async () => {
      const booked = new Date(Date.now() + 5.5 * 3600_000);
      const bookedLabel = `${booked.toLocaleString('en-US', { month: 'long', timeZone: 'UTC' })} ${booked.getUTCFullYear()}`;
      const csv = await request(server()).get(`/finance/reports/books.csv?month=${MONTH}`).set(as('finance')).expect(200);
      const line = csv.text.split('\n').find((l) => l.includes(`W5B${stamp}LATE`));
      expect(line).toBeDefined();
      expect(line).toContain('2003-03-20');
      expect(line).toContain(`Matched later, booked in ${bookedLabel}`);
      expect(line).toContain('499.00');
      expect(line).not.toContain('Not matched yet');
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

  describe('corrections carried to a later sheet', () => {
    let gone: { id: string; code: string };
    let tempPolicyId = '';
    const sheetFor = async (month: string, key = 'finance') => (await request(server()).get(`/finance/salaries?month=${month}`).set(as(key)).expect(200)).body;
    const rowOf = (sheet: { rows: Array<{ staffId: string }> }, staffId: string) => sheet.rows.find((r) => r.staffId === staffId) as Record<string, number | string | boolean | null> | undefined;
    const aprilWorkingDays = Array.from({ length: 30 }, (_, i) => `2003-04-${String(i + 1).padStart(2, '0')}`).filter((d) => day(d).getUTCDay() !== 0);

    /** Settings change after the months were approved: another divisor, other full-day hours, Saturdays off. */
    async function changeSettings() {
      const current = await prisma.pricingPolicy.findFirstOrThrow({ where: { effectiveFrom: { lte: new Date() } }, orderBy: [{ effectiveFrom: 'desc' }, { createdAt: 'desc' }] });
      const copy: Record<string, unknown> = { ...current };
      delete copy.id;
      delete copy.createdAt;
      const policy = await prisma.pricingPolicy.create({
        data: {
          ...(copy as Omit<Prisma.PricingPolicyUncheckedCreateInput, 'matchingWeights'>),
          matchingWeights: current.matchingWeights as Prisma.InputJsonValue,
          payrollSalaryDays: 30,
          productionHoursFullDay: current.productionHoursFullDay + 1,
          weeklyOffDays: [0, 6],
          effectiveFrom: new Date(),
        },
      });
      tempPolicyId = policy.id;
    }
    async function undoSettings() {
      if (tempPolicyId) await prisma.pricingPolicy.deleteMany({ where: { id: tempPolicyId } });
      tempPolicyId = '';
    }

    beforeAll(async () => {
      await prisma.attendanceDay.createMany({
        data: [asha, bala].flatMap((p) => aprilWorkingDays.map((d) => ({ staffId: p.id, date: day(d), dayType: 'full', productionSeconds: 8 * 3600, closedReason: 'logout' }))),
      });
      // Left in February, still owed ₹500 from then.
      gone = await makeStaff('call_agent', 'gone', { joinedOn: day('2003-01-01') });
      await prisma.staff.update({ where: { id: gone.id }, data: { status: 'deactivated', deactivatedAt: new Date('2003-02-28T06:00:00.000Z') } });
    });

    afterAll(async () => {
      await undoSettings();
    });

    it('works out an approved month with its own salary days and Settings: a Settings change makes no correction', async () => {
      await changeSettings();
      try {
        const april = await sheetFor(APRIL);
        expect(april.salaryDays).toBe(30);
        expect(rowOf(april, asha.id)?.correctionPaise).toBe(0);
        expect(rowOf(april, bala.id)?.correctionPaise).toBe(0);
        expect(rowOf(april, gone.id)).toBeUndefined();
        expect(await prisma.payrollCorrection.count({ where: { staffId: { in: staffIds } } })).toBe(0);
      } finally {
        await undoSettings();
      }
    });

    it('treats a day change approved after the month (a Team Lead portal request) like any attendance change: a correction on the next sheet', async () => {
      // Asha's half day on 5 March becomes a full day, decided by the CEO, after March pay was approved and paid.
      const halfDay = await prisma.attendanceDay.findUniqueOrThrow({ where: { staffId_date: { staffId: asha.id, date: day('2003-03-05') } } });
      const res = await request(server()).post('/requests').set(as('ceo')).send({ kind: 'day_change', dayId: halfDay.id, dayType: 'full', reason: 'Was on a client visit in the afternoon' });
      expect(res.status).toBeLessThan(300);
      expect((await prisma.attendanceDay.findUniqueOrThrow({ where: { id: halfDay.id } })).dayType).toBe('full');
      expect(await prisma.staffRequest.count({ where: { kind: 'day_change', subjectId: halfDay.id, status: 'approved' } })).toBe(1);
      // Half of ₹1,000 back on April's sheet; March's approved sheet is unchanged.
      const april = await sheetFor(APRIL);
      expect(rowOf(april, asha.id)?.correctionPaise).toBe(50000);
      expect(String(rowOf(april, asha.id)?.correctionNote)).toContain('Paid back ₹500 for March 2003');
      const march = await prisma.payrollLine.findFirstOrThrow({ where: { staffId: asha.id, run: { month: MONTH } } });
      expect(march.lossOfPayPaise).toBe(150000);
      expect(march.netPaise).toBe(2443750);
    });

    it('refuses (409) to apply a waiting correction another sheet claimed while this one was being prepared', async () => {
      const payroll = app.get(PayrollService);
      const marchRun = await prisma.payrollRun.findUniqueOrThrow({ where: { month: MONTH } });
      const temp = await prisma.payrollCorrection.create({ data: { staffId: asha.id, relatesToMonth: MONTH, amountPaise: 10000, reason: 'W5B race check', source: 'recompute' } });
      const realDraft = payroll.draft.bind(payroll);
      // Another sheet (here: March's run) applies the row between reading it and saving April.
      const spy = jest.spyOn(payroll, 'draft').mockImplementationOnce(async (...args: Parameters<PayrollService['draft']>) => {
        const out = await realDraft(...args);
        await prisma.payrollCorrection.update({ where: { id: temp.id }, data: { appliedRunId: marchRun.id, appliedMonth: MONTH } });
        return out;
      });
      try {
        const res = await request(server()).post(`/finance/salaries/${APRIL}/prepare`).set(as('finance')).expect(409);
        expect(res.body.message).toBe(CORRECTIONS_TAKEN);
        // Nothing was saved: no April sheet, and the row stays on the sheet that claimed it.
        expect(await prisma.payrollRun.count({ where: { month: APRIL } })).toBe(0);
        expect((await prisma.payrollCorrection.findUniqueOrThrow({ where: { id: temp.id } })).appliedRunId).toBe(marchRun.id);
      } finally {
        spy.mockRestore();
        await prisma.payrollCorrection.deleteMany({ where: { id: temp.id } });
      }
    });

    it('carries a holiday added to an approved month as correction rows, pays a leaver through Finance, and carries a take-back larger than pay', async () => {
      await prisma.holiday.create({ data: { date: day(LATE_HOLIDAY), name: 'W5B late holiday' } });
      // Pay is for the days on staff: 4 March was before Bala joined, so the new holiday leaves his
      // 19 working days on staff — and his March pay — unchanged. Asha was on staff and absent that day.
      const draft = await sheetFor(APRIL);
      expect(rowOf(draft, bala.id)?.correctionPaise).toBe(0);
      expect(rowOf(draft, asha.id)?.correctionPaise).toBe(150000);
      // The CEO corrects Bala's joining date to Saturday 8 March, a day he worked: one more working
      // day on staff in the approved month (20 × ₹2,000 = ₹40,000), so ₹2,000 comes back.
      await prisma.attendanceDay.create({ data: { staffId: bala.id, date: day('2003-03-08'), dayType: 'full', productionSeconds: 8 * 3600, closedReason: 'logout' } });
      await request(server()).put(`/staff/${bala.id}/joined-on`).set(as('ceo')).send({ joinedOn: '2003-03-08' }).expect(200);
      await prisma.payrollCorrection.createMany({
        data: [
          { staffId: gone.id, relatesToMonth: '2003-02', amountPaise: 50000, reason: 'Owed for February 2003', source: 'recompute' },
          { staffId: bala.id, relatesToMonth: MONTH, amountPaise: -6000000, reason: 'Taken back on the next sheet: larger than March 2003 pay', source: 'carry_forward' },
        ],
      });
      const prepared = (await request(server()).post(`/finance/salaries/${APRIL}/prepare`).set(as('finance')).expect(200)).body;
      // Asha: 4 March was an absent day, now a holiday: ₹1,000 back (₹26,000 ÷ 26 frozen, not today's divisor),
      // plus ₹500 for the half day changed to a full day — one row for March.
      const a = rowOf(prepared, asha.id)!;
      expect(a.correctionPaise).toBe(150000);
      expect(a.netPaise).toBe(3200000 + 150000);
      expect(String(a.correctionNote)).toContain('Paid back ₹1,500 for March 2003');
      // Bala: ₹2,000 back for his corrected joining date, less the ₹60,000 take-back carried from March:
      // −₹58,000 against ₹52,000 of April pay → ₹52,000 taken now, ₹6,000 carried to May, net ₹0.
      const b = rowOf(prepared, bala.id)!;
      expect(b.correctionPaise).toBe(-5200000);
      expect(b.carryForwardPaise).toBe(-600000);
      expect(b.netPaise).toBe(0);
      // The leaver: a line of their own for what they are owed.
      const g = rowOf(prepared, gone.id)!;
      expect(g.correctionOnly).toBe(true);
      expect(g.netPaise).toBe(50000);
      expect(g.grossPaise).toBe(0);

      const ashaRows = await prisma.payrollCorrection.findMany({ where: { staffId: asha.id } });
      expect(ashaRows).toEqual([expect.objectContaining({ relatesToMonth: MONTH, amountPaise: 150000, source: 'recompute', appliedMonth: APRIL })]);
      expect(await prisma.payrollCorrection.count({ where: { staffId: { in: [bala.id, gone.id] }, appliedMonth: null } })).toBe(0);

      // Worked out again: the same rows, applied once, nothing doubled.
      await new Promise((r) => setTimeout(r, 5));
      await request(server()).post(`/finance/salaries/${APRIL}/prepare`).set(as('finance')).expect(200);
      expect(await prisma.payrollCorrection.count({ where: { staffId: asha.id } })).toBe(1);
      expect(await prisma.payrollCorrection.count({ where: { staffId: bala.id, source: 'recompute' } })).toBe(1);
      const sheet = await sheetFor(APRIL, 'ceo');
      expect(sheet.totals.correctionsPaise).toBe(150000 - 5200000 + 50000);
      expect(sheet.totals.carryForwardPaise).toBe(-600000);

      await request(server()).post(`/finance/salaries/${APRIL}/approve`).set(as('ceo')).send({ netPaise: sheet.totals.netPaise, preparedAt: sheet.run.preparedAt }).expect(200);
      const carried = await prisma.payrollCorrection.findMany({ where: { staffId: bala.id, source: 'carry_forward', relatesToMonth: APRIL } });
      expect(carried).toEqual([expect.objectContaining({ amountPaise: -600000, appliedRunId: null })]);
      const csv = await request(server()).get(`/finance/reports/salary-sheet.csv?month=${APRIL}`).set(as('finance')).expect(200);
      expect(csv.text.split('\n')[0]).toContain('Carried to next sheet (Rs)');
      expect(csv.text).toContain(gone.code);
    });

    it('puts the carried take-back on the next sheet, and a Settings change still finds nothing new', async () => {
      await changeSettings();
      try {
        const may = await sheetFor(MAY);
        expect(rowOf(may, asha.id)?.correctionPaise).toBe(0);
        const b = rowOf(may, bala.id)!;
        expect(Number(b.correctionPaise) + Number(b.carryForwardPaise)).toBe(-600000);
        expect(rowOf(may, gone.id)).toBeUndefined();
        expect(await prisma.payrollCorrection.count({ where: { staffId: { in: staffIds }, source: 'recompute' } })).toBe(3);
      } finally {
        await undoSettings();
      }
    });
  });

  describe('changes in a month payroll no longer works out again', () => {
    // January 2002 has a paid sheet and so does each of the 12 months after it (to January 2003):
    // no sheet still to be prepared works January 2002 out again, so a change there is refused
    // (it would be silently ignored). February 2002 is still reached by the February 2003 sheet.
    const months = monthsBetween('2002-01', '2003-01');
    const holidayDays = ['2002-01-10', '2002-01-14', '2002-01-15', '2002-02-14', '2002-02-15'];
    let oldie: { id: string; code: string };
    let oldDayId = '';
    let oldHolidayId = '';
    let reachableHolidayId = '';

    beforeAll(async () => {
      await prisma.payrollRun.deleteMany({ where: { month: { in: months } } });
      await prisma.holiday.deleteMany({ where: { date: { in: holidayDays.map(day) } } });
      await prisma.payrollRun.createMany({
        data: months.map((month) => ({ month, status: 'paid', people: 0, grossPaise: 0, deductionsPaise: 0, netPaise: 0, preparedByStaffId: financeId, preparedAt: new Date('2003-02-01T04:00:00.000Z') })),
      });
      oldie = await makeStaff('call_agent', 'oldie', { createdAt: new Date('2002-01-07T04:00:00.000Z'), joinedOn: day('2002-01-07') });
      oldDayId = (await prisma.attendanceDay.create({ data: { staffId: oldie.id, date: day('2002-01-15'), dayType: 'absent', productionSeconds: 0, closedReason: 'no_login' } })).id;
      oldHolidayId = (await prisma.holiday.create({ data: { date: day('2002-01-10'), name: 'W5B old holiday' } })).id;
      reachableHolidayId = (await prisma.holiday.create({ data: { date: day('2002-02-14'), name: 'W5B reachable holiday' } })).id;
    });

    afterAll(async () => {
      await prisma.payrollRun.deleteMany({ where: { month: { in: months } } });
      await prisma.holiday.deleteMany({ where: { date: { in: holidayDays.map(day) } } });
    });

    it('refuses a holiday added, moved into or removed from such a month, and still allows one a later sheet reaches', async () => {
      const added = await request(server()).post('/attendance/holidays').set(as('ceo')).send({ date: '2002-01-15', name: 'W5B too late' }).expect(400);
      expect(added.body.message).toMatch(/January 2002 pay.*manual correction/);
      const moved = await request(server()).patch(`/attendance/holidays/${reachableHolidayId}`).set(as('ceo')).send({ date: '2002-01-14' }).expect(400);
      expect(moved.body.message).toMatch(/manual correction/);
      const removed = await request(server()).delete(`/attendance/holidays/${oldHolidayId}`).set(as('ceo')).expect(400);
      expect(removed.body.message).toMatch(/manual correction/);
      expect(await prisma.holiday.count({ where: { id: { in: [oldHolidayId, reachableHolidayId] } } })).toBe(2);
      expect((await prisma.holiday.findUniqueOrThrow({ where: { id: reachableHolidayId } })).date.toISOString()).toBe('2002-02-14T00:00:00.000Z');
      expect(await prisma.holiday.count({ where: { date: day('2002-01-15') } })).toBe(0);
      // February 2002 is still worked out again by the February 2003 sheet: allowed.
      const ok = await request(server()).post('/attendance/holidays').set(as('ceo')).send({ date: '2002-02-15', name: 'W5B in time' });
      expect(ok.status).toBeLessThan(300);
      const gone = await request(server()).delete(`/attendance/holidays/${ok.body.id}`).set(as('ceo'));
      expect(gone.status).toBeLessThan(300);
    });

    it('refuses a day change there, directly or as a request', async () => {
      const direct = await request(server()).post(`/attendance/days/${oldDayId}/day-type`).set(as('ceo')).send({ dayType: 'full', reason: 'W5B late change' }).expect(400);
      expect(direct.body.message).toMatch(/day change.*manual correction/);
      const asked = await request(server()).post('/requests').set(as('ceo')).send({ kind: 'day_change', dayId: oldDayId, dayType: 'full', reason: 'W5B late change' }).expect(400);
      expect(asked.body.message).toMatch(/manual correction/);
      expect((await prisma.attendanceDay.findUniqueOrThrow({ where: { id: oldDayId } })).dayType).toBe('absent');
    });

    it('refuses a joining-date change that moves pay in such a month', async () => {
      const res = await request(server()).put(`/staff/${oldie.id}/joined-on`).set(as('ceo')).send({ joinedOn: '2002-01-14' }).expect(400);
      expect(res.body.message).toMatch(/joining date.*January 2002.*manual correction/);
      expect((await prisma.staff.findUniqueOrThrow({ where: { id: oldie.id } })).joinedOn?.toISOString()).toBe('2002-01-07T00:00:00.000Z');
      // The same date again changes nothing, so it is allowed.
      await request(server()).put(`/staff/${oldie.id}/joined-on`).set(as('ceo')).send({ joinedOn: '2002-01-07' }).expect(200);
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
