import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import * as request from 'supertest';
import { AppModule } from '../../app.module';
import { PrismaService } from '../../common/prisma/prisma.service';
import { NotificationClock } from '../notification/notification-clock';
import { RefundPriorityService } from './refund-priority.service';

jest.setTimeout(180000);

const DAY = 24 * 3600 * 1000;
const shared = { at: new Date('2027-07-20T06:30:00.000Z') };

class SharedClock extends NotificationClock {
  now(): Date {
    return new Date(shared.at.getTime());
  }
}

type Person = { id: string; role: string; code: string };
type Row = {
  kind: string;
  id: string;
  code: string;
  name: string | null;
  daysLeft: number;
  bucket: string;
  priority: boolean;
  agent: { id: string } | null;
  atStakePaise?: number;
};

describe('Phase 21 Task 7: close to a refund, the 15-day priority', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let jwt: JwtService;
  let priority: RefundPriorityService;
  const stamp = `${Date.now()}`;
  const staffIds: string[] = [];
  const seekerIds: string[] = [];

  let ceo: Person;
  let finance: Person;
  let managerA: Person;
  let managerB: Person;
  let leadA: Person;
  let leadB: Person;
  let agentA: Person;
  let agentB: Person;
  const seekers: Record<string, { id: string; code: string }> = {};

  function tokenFor(staff: Person) {
    return jwt.sign({ sub: staff.id, email: `${staff.id}@laboura.local`, role: staff.role, code: staff.code });
  }

  function get(person: Person, path: string) {
    return request(app.getHttpServer()).get(path).set('Authorization', `Bearer ${tokenFor(person)}`);
  }

  async function make(role: string, prefix: string, reportsToId: string | null = null): Promise<Person> {
    const agent = role === 'call_agent' || role === 'field_agent';
    const row = await prisma.staff.create({
      data: {
        code: `${prefix}-${stamp}-${staffIds.length}`,
        name: `${prefix} priority`,
        email: `${prefix.toLowerCase()}.${staffIds.length}.${stamp}@laboura.local`,
        passwordHash: 'hash',
        role,
        status: 'active',
        city: 'Bengaluru',
        teamLeadId: agent ? reportsToId : null,
        reportsToId,
      },
    });
    staffIds.push(row.id);
    return row;
  }

  async function seeker(key: string, paidDaysAgo: number, registeredBy: Person) {
    const n = seekerIds.length;
    const row = await prisma.jobSeeker.create({
      data: {
        code: `JS-T7${stamp.slice(-6)}${n}`,
        name: `Seeker ${key}`,
        phone: `+9196${stamp.slice(-7)}${n}`,
        minSalary: 1_500_000,
        maxSalary: 2_000_000,
        preferredCallWindowStart: '09:00',
        preferredCallWindowEnd: '21:00',
        status: 'active',
        paymentReceivedAt: new Date(shared.at.getTime() - paidDaysAgo * DAY),
        registeredByStaffId: registeredBy.id,
      },
    });
    seekerIds.push(row.id);
    seekers[key] = { id: row.id, code: row.code };
    return row;
  }

  async function list(person: Person, query = '') {
    const res = await get(person, `/close-to-refund${query}`);
    return res;
  }

  function mine(rows: Row[]): Row[] {
    const ids = new Set(seekerIds);
    return rows.filter((row) => ids.has(row.id));
  }

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(NotificationClock)
      .useClass(SharedClock)
      .compile();
    app = moduleRef.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);
    jwt = app.get(JwtService);
    priority = app.get(RefundPriorityService);

    ceo = await make('ceo', 'CEO7');
    finance = await make('finance', 'FIN7', ceo.id);
    managerA = await make('manager', 'MGA7', ceo.id);
    managerB = await make('manager', 'MGB7', ceo.id);
    leadA = await make('team_lead', 'TLA7', managerA.id);
    leadB = await make('team_lead', 'TLB7', managerB.id);
    agentA = await make('call_agent', 'CAA7', leadA.id);
    agentB = await make('call_agent', 'CAB7', leadB.id);

    await seeker('three', 27, agentA); // 3 days left → 0–5
    await seeker('twelve', 18, agentA); // 12 days left → 11–15
    await seeker('sixteen', 14, agentA); // 16 days left → not yet
    await seeker('ten', 20, agentB); // 10 days left → 6–10
  });

  afterAll(async () => {
    try {
      await prisma.notification.deleteMany({ where: { recipientStaffId: { in: staffIds } } });
      await prisma.jobSeeker.deleteMany({ where: { id: { in: seekerIds } } });
      await prisma.auditLog.deleteMany({ where: { actorId: { in: staffIds } } });
      await prisma.staff.deleteMany({ where: { id: { in: staffIds } } });
    } finally {
      await app.close();
    }
  });

  it('lists paid job seekers within 15 days of a refund, in buckets, with the money at stake for the CEO', async () => {
    const res = await list(ceo);
    expect(res.status).toBe(200);
    expect(res.body.windowDays).toBe(15);
    const rows = mine(res.body.rows as Row[]);
    expect(rows.map((r) => [r.code, r.daysLeft, r.bucket])).toEqual([
      [seekers.three.code, 3, '0-5'],
      [seekers.ten.code, 10, '6-10'],
      [seekers.twelve.code, 12, '11-15'],
    ]);
    for (const row of rows) {
      expect(row.priority).toBe(true);
      expect(row.atStakePaise).toBeGreaterThan(0);
    }

    const forA = await list(ceo, `?agentId=${agentA.id}`);
    expect((forA.body.rows as Row[]).map((r) => r.code)).toEqual([seekers.three.code, seekers.twelve.code]);
    const buckets = forA.body.buckets as Array<{ bucket: string; count: number; atStakePaise: number }>;
    expect(buckets.map((b) => [b.bucket, b.count])).toEqual([['0-5', 1], ['6-10', 0], ['11-15', 1]]);
    expect(forA.body.totals.atStakePaise).toBe(
      (forA.body.rows as Row[]).reduce((sum, row) => sum + (row.atStakePaise ?? 0), 0),
    );

    const urgent = await list(ceo, `?agentId=${agentA.id}&bucket=0-5`);
    expect((urgent.body.rows as Row[]).map((r) => r.code)).toEqual([seekers.three.code]);
    const businesses = await list(ceo, `?agentId=${agentA.id}&who=businesses`);
    expect(businesses.body.rows).toEqual([]);
    expect((await list(ceo, '?bucket=1-2')).status).toBe(400);
    expect((await list(ceo, '?who=everyone')).status).toBe(400);
  });

  it('puts someone on the list the day he enters the window (16 → 15 days left)', async () => {
    const before = mine((await list(ceo, `?agentId=${agentA.id}`)).body.rows as Row[]);
    expect(before.some((r) => r.id === seekers.sixteen.id)).toBe(false);
    const saved = shared.at;
    shared.at = new Date(saved.getTime() + DAY);
    try {
      const after = mine((await list(ceo, `?agentId=${agentA.id}`)).body.rows as Row[]);
      expect(after.find((r) => r.id === seekers.sixteen.id)).toMatchObject({ daysLeft: 15, bucket: '11-15' });
      // 3 → 2 days left; still 0–5.
      expect(after.find((r) => r.id === seekers.three.id)).toMatchObject({ daysLeft: 2, bucket: '0-5' });
    } finally {
      shared.at = saved;
    }
  });

  it('shows Managers their tree, Team Leads their team and agents their own people — never with rupees', async () => {
    const manager = await list(managerA);
    expect(manager.status).toBe(200);
    const managerRows = mine(manager.body.rows as Row[]);
    expect(managerRows.map((r) => r.code)).toEqual([seekers.three.code, seekers.twelve.code]);
    expect(JSON.stringify(manager.body)).not.toContain('atStakePaise');
    expect(manager.body.totals).toEqual(expect.objectContaining({ count: expect.any(Number) }));
    expect((await list(managerB, `?agentId=${agentA.id}`)).status).toBe(403);

    const lead = await list(leadA);
    expect(mine(lead.body.rows as Row[]).map((r) => r.code)).toEqual([seekers.three.code, seekers.twelve.code]);
    expect(JSON.stringify(lead.body)).not.toContain('atStakePaise');
    expect((await list(leadA, `?teamLeadId=${leadB.id}`)).status).toBe(403);
    expect(mine((await list(leadB)).body.rows as Row[]).map((r) => r.code)).toEqual([seekers.ten.code]);

    const agent = await list(agentB);
    expect(mine(agent.body.rows as Row[]).map((r) => r.code)).toEqual([seekers.ten.code]);
    expect(JSON.stringify(agent.body)).not.toContain('atStakePaise');
    expect((await list(agentB, `?agentId=${agentA.id}`)).status).toBe(403);

    const money = await list(finance, `?agentId=${agentA.id}`);
    const financeRows = money.body.rows as Row[];
    expect(financeRows).toHaveLength(2);
    expect(financeRows.every((r) => r.name === null && (r.atStakePaise ?? 0) > 0)).toBe(true);
  });

  it('downloads as CSV for the CEO, Finance and Managers (no rupees for Managers); nobody below Manager', async () => {
    const ceoCsv = await list(ceo, `?agentId=${agentA.id}&format=csv`);
    expect(ceoCsv.status).toBe(200);
    expect(ceoCsv.headers['content-type']).toContain('text/csv');
    const lines = ceoCsv.text.trim().split('\n');
    expect(lines[0]).toContain('At stake (Rs)');
    expect(lines.slice(1).map((line) => line.split(',')[1])).toEqual([seekers.three.code, seekers.twelve.code]);

    const managerCsv = await list(managerA, `?agentId=${agentA.id}&format=csv`);
    expect(managerCsv.status).toBe(200);
    expect(managerCsv.text).not.toContain('At stake');
    expect((await list(leadA, '?format=csv')).status).toBe(403);
    expect((await list(agentA, '?format=csv')).status).toBe(403);
  });

  // Owner decision 12 Nov: the CEO also gets the bell (with rupees); this test listed only the
  // agent, Team Lead and Manager before, so its recipient list and counts now include the CEO.
  it('rings the agent, their Team Lead, Manager and the CEO when someone is in the window, and clears it when he leaves', async () => {
    await priority.syncBells(shared.at);
    const open = await prisma.notification.findMany({
      where: { kind: 'refund_priority', subjectId: seekers.twelve.id, clearedAt: null },
    });
    expect(open.map((n) => n.recipientStaffId).sort()).toEqual([agentA.id, leadA.id, managerA.id, ceo.id].sort());
    const forAgent = open.find((n) => n.recipientStaffId === agentA.id)!;
    expect(forAgent.link).toBe(`/call-agent/people/${encodeURIComponent(seekers.twelve.code)}`);
    // Managers, Team Leads and agents: counts only. The CEO's bell says the rupees at stake.
    const notCeo = open.filter((n) => n.recipientStaffId !== ceo.id);
    expect(notCeo.every((n) => !n.title.includes('₹') && !(n.body ?? '').includes('₹'))).toBe(true);
    const forCeo = open.find((n) => n.recipientStaffId === ceo.id)!;
    expect(forCeo.body).toMatch(/₹[\d,]+ at stake/);
    expect(forCeo.link).toBe('/ceo/job-seekers/near-refund');
    expect(
      await prisma.notification.count({
        where: { kind: 'refund_priority', subjectId: seekers.twelve.id, recipientStaffId: { in: [leadB.id, managerB.id, agentB.id] } },
      }),
    ).toBe(0);
    // Not in the window yet: no bell.
    expect(await prisma.notification.count({ where: { kind: 'refund_priority', subjectId: seekers.sixteen.id } })).toBe(0);

    // Running again adds nothing.
    await priority.syncBells(shared.at);
    expect(await prisma.notification.count({ where: { kind: 'refund_priority', subjectId: seekers.twelve.id } })).toBe(4);

    // He leaves the window (placed): every bell about him clears.
    await prisma.jobSeeker.update({ where: { id: seekers.twelve.id }, data: { status: 'placed' } });
    await priority.syncBells(shared.at);
    const cleared = await prisma.notification.findMany({
      where: { kind: 'refund_priority', subjectId: seekers.twelve.id },
    });
    expect(cleared).toHaveLength(4);
    expect(cleared.every((n) => n.clearedAt && n.clearedReason === 'left_window')).toBe(true);
    expect(mine((await list(ceo)).body.rows as Row[]).some((r) => r.id === seekers.twelve.id)).toBe(false);
  });
});
