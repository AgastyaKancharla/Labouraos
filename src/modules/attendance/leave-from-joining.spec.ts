import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { AppModule } from '../../app.module';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AttendanceClock } from './attendance-clock';
import { LeaveService } from './leave.service';

jest.setTimeout(120000);

const shared = { at: new Date('2028-02-10T06:00:00.000Z') };

class FixedClock extends AttendanceClock {
  now(): Date {
    return new Date(shared.at.getTime());
  }
}

/**
 * Paid leave counts from the joining date (guide check 12 Nov, finding 2):
 * Staff.joinedOn, else the first login, else the day the account was created.
 * No paid leave in the joining month; the first leaves come on the 1st of the
 * following month (Master Guide, decided 11 Nov).
 */
describe('Paid leave is earned from the joining date', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let leave: LeaveService;
  const stamp = String(Date.now());
  const staffIds: string[] = [];

  const make = async (key: string, data: { createdAt: Date; joinedOn?: Date }) => {
    const row = await prisma.staff.create({
      data: {
        code: `LVJ-${key}-${stamp}`,
        name: `Leave ${key}`,
        email: `lvj-${key.toLowerCase()}-${stamp}@laboura.local`,
        passwordHash: 'hash',
        role: 'call_agent',
        status: 'active',
        city: 'Bengaluru',
        createdAt: data.createdAt,
        joinedOn: data.joinedOn ?? null,
      },
    });
    staffIds.push(row.id);
    return row;
  };
  /** Months with an accrual row in the table (rows before the first earning month are kept but not counted). */
  const months = async (staffId: string) =>
    (await prisma.leaveAccrual.findMany({ where: { staffId }, orderBy: { month: 'asc' } })).map((r) => r.month);

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(AttendanceClock)
      .useClass(FixedClock)
      .compile();
    app = moduleRef.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);
    leave = app.get(LeaveService);
  });

  afterAll(async () => {
    await prisma.staff.deleteMany({ where: { id: { in: staffIds } } });
    await app.close();
  });

  it('added on 28 Nov with a joining date of 1 Dec: nothing in December, the first leaves on 1 January', async () => {
    const person = await make('A', { createdAt: new Date('2027-11-28T06:00:00.000Z'), joinedOn: new Date('2027-12-01T00:00:00.000Z') });
    await leave.ensureAccrued(person.id);
    expect(await months(person.id)).toEqual(['2028-01', '2028-02']);
  });

  it('joined 15 Oct but added on 20 Nov: leave from 1 November, not from the month after the account was made', async () => {
    const person = await make('B', { createdAt: new Date('2027-11-20T06:00:00.000Z'), joinedOn: new Date('2027-10-15T00:00:00.000Z') });
    await leave.ensureAccrued(person.id);
    expect(await months(person.id)).toEqual(['2027-11', '2027-12', '2028-01', '2028-02']);
  });

  it('with no joining date, counts from the first login, then from the day the account was made', async () => {
    const loggedIn = await make('C', { createdAt: new Date('2027-10-01T06:00:00.000Z') });
    await prisma.attendanceDay.create({
      data: { staffId: loggedIn.id, date: new Date('2027-11-15T00:00:00.000Z'), loginAt: new Date('2027-11-15T04:00:00.000Z'), dayType: 'full' },
    });
    await leave.ensureAccrued(loggedIn.id);
    expect(await months(loggedIn.id)).toEqual(['2027-12', '2028-01', '2028-02']);

    const never = await make('D', { createdAt: new Date('2027-10-15T06:00:00.000Z') });
    await leave.ensureAccrued(never.id);
    expect(await months(never.id)).toEqual(['2027-11', '2027-12', '2028-01', '2028-02']);
  });

  it('joining on the 1st still earns nothing that month', async () => {
    const person = await make('E', { createdAt: new Date('2027-12-20T06:00:00.000Z'), joinedOn: new Date('2028-01-01T00:00:00.000Z') });
    await leave.ensureAccrued(person.id);
    expect(await months(person.id)).toEqual(['2028-02']);
    const balance = await leave.balance(person.id);
    expect(balance.casual.earned + balance.emergency.earned).toBeGreaterThan(0);
  });

  it('stops counting leave written for a month before the joining date, and never deletes it', async () => {
    const person = await make('F', { createdAt: new Date('2027-10-20T06:00:00.000Z') });
    await leave.ensureAccrued(person.id);
    expect(await months(person.id)).toEqual(['2027-11', '2027-12', '2028-01', '2028-02']);
    const before = await leave.balance(person.id);
    // The CEO enters the real joining date: 3 December. Nov and Dec stop counting.
    await prisma.staff.update({ where: { id: person.id }, data: { joinedOn: new Date('2027-12-03T00:00:00.000Z') } });
    const after = await leave.balance(person.id);
    expect(after.casual.earned).toBe(before.casual.earned / 2);
    expect(await months(person.id)).toEqual(['2027-11', '2027-12', '2028-01', '2028-02']);
    // A typo corrected later brings the leave back.
    await prisma.staff.update({ where: { id: person.id }, data: { joinedOn: new Date('2027-10-20T00:00:00.000Z') } });
    expect((await leave.balance(person.id)).casual.earned).toBe(before.casual.earned);
  });
});
