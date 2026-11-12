import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import * as request from 'supertest';
import { AppModule } from '../../app.module';
import { PrismaService } from '../../common/prisma/prisma.service';
import { PricingService } from '../pricing/pricing.service';
import { PayrollService } from './payroll.service';
import { AttendanceClock } from '../attendance/attendance-clock';
import { AttendanceDaysService } from '../attendance/attendance-days.service';
import { LeaveService } from '../attendance/leave.service';

jest.setTimeout(180000);

const shared = { at: new Date('2031-04-10T06:00:00.000Z') };
class FixedClock extends AttendanceClock {
  now(): Date {
    return new Date(shared.at.getTime());
  }
}

/**
 * Go-live (owner decision 12 Nov) against a real database: the CEO sets the date in
 * Settings; payroll counts only from the later of the joining date and go-live, so
 * days before go-live are not on staff, never absent and never loss of pay; leave
 * accrual starts from the later of the two. March 2031 is used (1 Mar is a Saturday;
 * Sundays 2, 9, 16, 23, 30; 26 working days), with go-live on Wednesday 12 March.
 */
describe('Go-live date in Settings', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let pricing: PricingService;
  let payroll: PayrollService;
  let days: AttendanceDaysService;
  let leave: LeaveService;
  let jwt: JwtService;
  const stamp = String(Date.now());
  const staffIds: string[] = [];
  const policyIds: string[] = [];
  let ceo = { id: '', role: 'ceo', code: '' };
  let finance = { id: '', role: 'finance', code: '' };
  const SALARY = 2_600_000; // ₹26,000: ₹1,000 a day

  const token = (s: { id: string; role: string; code: string }) =>
    jwt.sign({ sub: s.id, email: `${s.id}@laboura.local`, role: s.role, code: s.code, teamLeadId: null });

  const make = async (key: string, role: string, data: { createdAt?: Date; joinedOn?: Date | null } = {}) => {
    const row = await prisma.staff.create({
      data: {
        code: `GOL-${key}-${stamp}`,
        name: `Go-live ${key}`,
        email: `gol-${key.toLowerCase()}-${stamp}@laboura.local`,
        passwordHash: 'hash',
        role,
        status: 'active',
        city: 'Bengaluru',
        ...(data.createdAt ? { createdAt: data.createdAt } : {}),
        joinedOn: data.joinedOn ?? null,
      },
    });
    staffIds.push(row.id);
    return row;
  };

  /** Full days for every working day from `from` to `to` (March 2031). */
  const fullDays = async (staffId: string, from: number, to: number) => {
    for (let d = from; d <= to; d += 1) {
      const date = new Date(Date.UTC(2031, 2, d));
      if (date.getUTCDay() === 0) continue;
      await prisma.attendanceDay.create({
        data: { staffId, date, loginAt: new Date(date.getTime() + 4 * 3600_000), logoutAt: new Date(date.getTime() + 13 * 3600_000), dayType: 'full', productionSeconds: 8 * 3600 },
      });
    }
  };

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(AttendanceClock)
      .useClass(FixedClock)
      .compile();
    app = moduleRef.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);
    pricing = app.get(PricingService);
    payroll = app.get(PayrollService);
    days = app.get(AttendanceDaysService);
    leave = app.get(LeaveService);
    jwt = app.get(JwtService);
    ceo = await make('CEO', 'ceo');
    finance = await make('FIN', 'finance');
  });

  afterAll(async () => {
    try {
      await prisma.pricingPolicy.deleteMany({ where: { id: { in: policyIds } } });
      await prisma.staffSalary.deleteMany({ where: { staffId: { in: staffIds } } });
      await prisma.auditLog.deleteMany({ where: { actorId: { in: staffIds } } });
      await prisma.staff.deleteMany({ where: { id: { in: staffIds } } });
    } finally {
      await app.close();
    }
  });

  /** A day `days` from today, as IST "YYYY-MM-DD". */
  const fromToday = (days: number) => new Date(Date.now() + 330 * 60_000 + days * 24 * 3600_000).toISOString().slice(0, 10);
  const putGoLive = (who: { id: string; role: string; code: string }, goLiveDate: string | null) =>
    request(app.getHttpServer()).put('/pricing/go-live').set('Authorization', `Bearer ${token(who)}`).send({ goLiveDate });

  it('lets only the CEO set the go-live date, checks it, bounds it, and carries it into later Settings versions', async () => {
    const soon = fromToday(30);
    await putGoLive(finance, soon).expect(403);
    await putGoLive(ceo, '12/03/2027').expect(400);
    await putGoLive(ceo, '2027-02-30').expect(400);
    // A typo can't move it years away: at most a year ahead, never before the first records.
    expect((await putGoLive(ceo, fromToday(400)).expect(400)).body.message).toMatch(/at most a year ahead/);
    expect((await putGoLive(ceo, '1999-12-31').expect(400)).body.message).toMatch(/first records/);
    // A plain Settings save can't set it either.
    await request(app.getHttpServer()).put('/pricing').set('Authorization', `Bearer ${token(ceo)}`).send({ goLiveDate: '2030-01-01' }).expect(400);

    const set = await putGoLive(ceo, soon).expect(200);
    policyIds.push(set.body.id);
    expect(set.body.goLiveDate).toBe(`${soon}T00:00:00.000Z`);
    // Another Settings change keeps the go-live date.
    const other = await pricing.createVersion({ lateGraceMinutes: (await pricing.current()).lateGraceMinutes }, ceo.id);
    policyIds.push(other.id);
    expect(other.goLiveDate?.toISOString().slice(0, 10)).toBe(soon);
    expect(await pricing.goLiveDay()).toBe(soon);
  });

  it('refuses a go-live change once a month it touches has a frozen salary sheet or is closed', async () => {
    const current = await pricing.goLiveDay(); // set by the test above, about 30 days ahead
    const later = fromToday(60);
    const month = (current! < later ? current! : later).slice(0, 7);
    const run = await prisma.payrollRun.create({
      data: { month, status: 'approved', people: 0, grossPaise: 0, deductionsPaise: 0, netPaise: 0, preparedByStaffId: finance.id, preparedAt: new Date() },
    });
    try {
      const refused = await putGoLive(ceo, later).expect(409);
      expect(refused.body.code ?? refused.body.details?.code).toBe('go_live_payroll_frozen');
      await putGoLive(ceo, null).expect(409);
    } finally {
      await prisma.payrollRun.delete({ where: { id: run.id } });
    }
    const closed = await prisma.monthClose.create({
      data: { month, status: 'closed', closedByStaffId: ceo.id, closedAt: new Date(), checklist: {} },
    });
    try {
      const refused = await putGoLive(ceo, later).expect(409);
      expect(refused.body.code ?? refused.body.details?.code).toBe('month_closed');
    } finally {
      await prisma.monthClose.delete({ where: { id: closed.id } });
    }
    expect(await pricing.goLiveDay()).toBe(current);
    // With nothing frozen or closed it can change again.
    const moved = await putGoLive(ceo, later).expect(200);
    policyIds.push(moved.body.id);
  });

  it('works March 2031 with go-live on 12 March (set directly: the endpoint allows at most a year ahead)', async () => {
    const v = await pricing.createVersion({ goLiveDate: new Date('2031-03-12T00:00:00.000Z') }, ceo.id);
    policyIds.push(v.id);
    expect(await pricing.goLiveDay()).toBe('2031-03-12');
  });

  it('pays someone added after go-live with an earlier joining date only from go-live, with no loss of pay for the days before', async () => {
    // Joined 1 March, added to the software on 20 March, worked every day from go-live.
    const early = await make('EARLY', 'call_agent', { createdAt: new Date('2031-03-20T05:00:00.000Z'), joinedOn: new Date('2031-03-01T00:00:00.000Z') });
    await prisma.staffSalary.create({ data: { staffId: early.id, monthlyPaise: SALARY, effectiveFromMonth: '2031-03', setByStaffId: ceo.id } });
    await fullDays(early.id, 12, 31);
    // Joined 24 March, after go-live.
    const late = await make('LATE', 'call_agent', { createdAt: new Date('2031-03-22T05:00:00.000Z'), joinedOn: new Date('2031-03-24T00:00:00.000Z') });
    await prisma.staffSalary.create({ data: { staffId: late.id, monthlyPaise: SALARY, effectiveFromMonth: '2031-03', setByStaffId: ceo.id } });
    await fullDays(late.id, 24, 31);

    const { rows } = await payroll.draft('2031-03', new Date('2031-04-02T06:00:00.000Z'));
    const e = rows.find((r) => r.staffId === early.id)!;
    expect(e).toMatchObject({
      joinedOn: '2031-03-01',
      workingDays: 26,
      // 1–11 March (9 working days) are before go-live: not on staff, never absent.
      notEmployedDays: 9,
      unmarkedDays: 0,
      absentDays: 0,
      fullDays: 17,
      lossOfPayPaise: 0,
      netPaise: 1_700_000, // ₹26,000 ÷ 26 × 17
    });
    const l = rows.find((r) => r.staffId === late.id)!;
    expect(l).toMatchObject({ joinedOn: '2031-03-24', notEmployedDays: 19, unmarkedDays: 0, fullDays: 7, lossOfPayPaise: 0, netPaise: 700_000 });
  });

  it('never marks a day before go-live absent', async () => {
    const person = await make('ABS', 'call_agent', { createdAt: new Date('2031-01-05T05:00:00.000Z'), joinedOn: new Date('2031-01-05T00:00:00.000Z') });
    expect((await days.markAbsentDays(new Date('2031-03-11T00:00:00.000Z'), [person.id])).marked).toBe(0);
    expect((await days.markAbsentDays(new Date('2031-03-12T00:00:00.000Z'), [person.id])).marked).toBe(1);
  });

  it('starts leave from the later of joining and go-live', async () => {
    // Joined in January 2031, go-live 12 March: the first leaves come on 1 April.
    const before = await make('LVB', 'call_agent', { createdAt: new Date('2031-01-05T05:00:00.000Z'), joinedOn: new Date('2031-01-05T00:00:00.000Z') });
    await leave.ensureAccrued(before.id);
    expect((await prisma.leaveAccrual.findMany({ where: { staffId: before.id }, orderBy: { month: 'asc' } })).map((r) => r.month)).toEqual(['2031-04']);
    // Joined 24 March, after go-live: nothing in March, the first leaves on 1 April.
    const after = await make('LVA', 'call_agent', { createdAt: new Date('2031-03-22T05:00:00.000Z'), joinedOn: new Date('2031-03-24T00:00:00.000Z') });
    await leave.ensureAccrued(after.id);
    expect((await prisma.leaveAccrual.findMany({ where: { staffId: after.id } })).map((r) => r.month)).toEqual(['2031-04']);
  });

  it('works out a frozen month again with the go-live date kept on its sheet, never today\'s', async () => {
    // Worked every day of March, joined 1 March; the sheet was prepared with go-live 12 March,
    // so the 9 working days before it were "not on staff" (₹9,000 not earned).
    const full = await make('FULL', 'call_agent', { createdAt: new Date('2031-03-01T05:00:00.000Z'), joinedOn: new Date('2031-03-01T00:00:00.000Z') });
    await fullDays(full.id, 1, 31);
    const run = await prisma.payrollRun.create({
      data: {
        month: '2031-03', status: 'approved', people: 1, grossPaise: SALARY, deductionsPaise: 900_000, netPaise: 1_700_000,
        preparedByStaffId: finance.id, preparedAt: new Date('2031-04-01T06:00:00.000Z'), weeklyOffDays: [0], fullDayMinutes: 480, goLiveDay: '2031-03-12',
        lines: {
          create: {
            staffId: full.id, staffCode: full.code, name: full.name, role: full.role, monthlyPaise: SALARY, salaryDays: 26, calendarDays: 31,
            workingDays: 26, holidays: 0, fullDays: 17, halfDays: 0, paidLeaveDays: 0, unpaidLeaveDays: 0, absentDays: 0, notEmployedDays: 9,
            lossOfPayHalfDays: 0, paidHalfDays: 34, shortfallMinutes: 0, basicPaise: 1_300_000, hraPaise: 520_000, specialPaise: 780_000,
            grossPaise: SALARY, notEmployedPaise: 900_000, lossOfPayPaise: 0, shortfallPaise: 0, deductionsPaise: 900_000, netPaise: 1_700_000,
          },
        },
      },
    });
    try {
      // Today's Settings change the go-live date (directly, as an older or back-dated version could).
      const cleared = await pricing.createVersion({ goLiveDate: null }, ceo.id);
      policyIds.push(cleared.id);
      const kept = await payroll.draft('2031-04', new Date('2031-05-02T06:00:00.000Z'));
      expect(kept.corrections.filter((c) => c.staffId === full.id)).toEqual([]);
      // The recompute really reads the sheet's own value: without it the 9 days would be paid back.
      await prisma.payrollRun.update({ where: { id: run.id }, data: { goLiveDay: null } });
      const without = await payroll.draft('2031-04', new Date('2031-05-02T06:00:00.000Z'));
      expect(without.corrections.filter((c) => c.staffId === full.id).map((c) => c.amountPaise)).toEqual([900_000]);
    } finally {
      await prisma.payrollRun.delete({ where: { id: run.id } });
    }
  });
});
