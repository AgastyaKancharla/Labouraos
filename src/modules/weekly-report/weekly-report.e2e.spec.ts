import { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';
import * as bcrypt from 'bcrypt';
import * as request from 'supertest';
import { AppModule } from '../../app.module';
import { PrismaService } from '../../common/prisma/prisma.service';
import { JwtPayload } from '../../common/auth/jwt-payload.interface';
import { WeeklyReportJob } from '../../jobs/weekly-report.job';

/**
 * The Monday weekly report: built for each Manager's tree (counts only) and
 * for the CEO's whole company, kept as a snapshot, announced with a bell that
 * opens that week, never built or rung twice, and readable later.
 */
describe('Monday weekly report', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let jwt: JwtService;
  let job: WeeklyReportJob;

  const ts = Date.now();
  const ids: string[] = [];
  const seekerIds: string[] = [];
  const people: Record<string, { id: string; code: string; token: string }> = {};
  // Monday 9 AM IST, years ahead so no real week is touched: the report is for 3–9 Mar 2031.
  const RUN_AT = new Date('2031-03-10T03:30:00Z');
  const WEEK = '2031-03-03';

  async function mk(key: string, role: string, extra: Record<string, unknown> = {}) {
    const staff = await prisma.staff.create({
      data: {
        code: `WRP-${key}-${ts}`,
        name: `Weekly ${key}`,
        email: `wrp_${key}_${ts}@laboura.local`,
        role,
        passwordHash: await bcrypt.hash('Some-Password-123', 4),
        status: 'active',
        ...extra,
      },
    });
    ids.push(staff.id);
    const session = await prisma.staffSession.create({
      data: { staffId: staff.id, expiresAt: new Date(Date.now() + 15 * 60 * 1000), absoluteExpiresAt: new Date(Date.now() + 2 * 60 * 60 * 1000), lastActivityAt: new Date() },
    });
    const payload: JwtPayload = { sub: staff.id, role, email: staff.email, code: staff.code, teamLeadId: staff.teamLeadId, sid: session.id };
    people[key] = { id: staff.id, code: staff.code, token: jwt.sign(payload, { expiresIn: '15m' }) };
    return staff;
  }
  const get = (who: string, path: string) => request(app.getHttpServer()).get(path).set('Authorization', `Bearer ${people[who].token}`);

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);
    jwt = app.get(JwtService);
    job = app.get(WeeklyReportJob);

    const ceo = await mk('ceo', 'ceo');
    const mgrA = await mk('mgrA', 'manager', { reportsToId: ceo.id });
    const mgrB = await mk('mgrB', 'manager', { reportsToId: ceo.id });
    const tlA = await mk('tlA', 'team_lead', { reportsToId: mgrA.id, teamName: 'Team South' });
    await mk('tlB', 'team_lead', { reportsToId: mgrB.id, teamName: 'Team North' });
    await mk('caA', 'call_agent', { teamLeadId: tlA.id, reportsToId: tlA.id });
    // Two registrations in that week by caA, one paid.
    for (const i of [1, 2]) {
      const s = await prisma.jobSeeker.create({
        data: {
          code: `JS-WRP-${String(ts).slice(-6)}-${i}`,
          name: `Seeker ${i}`,
          phone: `9${String(ts).slice(-7)}${i}0`.slice(0, 10),
          registeredByStaffId: people.caA.id,
          minSalary: 1500000,
          maxSalary: 2000000,
          preferredCallWindowStart: '09:00',
          preferredCallWindowEnd: '21:00',
          status: i === 1 ? 'active' : 'lead',
          createdAt: new Date('2031-03-04T06:00:00Z'),
          paymentReceivedAt: i === 1 ? new Date('2031-03-05T06:00:00Z') : null,
        },
      });
      seekerIds.push(s.id);
    }
  });

  afterAll(async () => {
    const weekStart = new Date(`${WEEK}T00:00:00.000Z`);
    await prisma.notification.deleteMany({ where: { kind: 'weekly_report', subjectId: WEEK } });
    await prisma.weeklyReport.deleteMany({ where: { weekStart } });
    await prisma.jobSeeker.deleteMany({ where: { id: { in: seekerIds } } });
    await prisma.staffSession.deleteMany({ where: { staffId: { in: ids } } });
    await prisma.auditLog.deleteMany({ where: { actorId: { in: ids } } });
    await prisma.staff.updateMany({ where: { id: { in: ids } }, data: { teamLeadId: null, reportsToId: null } });
    await prisma.staff.deleteMany({ where: { id: { in: ids } } });
    await app.close();
  });

  it('builds last week for each Manager and the company, keeps it, rings once, and a second run does nothing', async () => {
    const first = await job.process(RUN_AT);
    expect(first.failed).toBe(0);
    expect(first.created).toBeGreaterThanOrEqual(3);

    const weekStart = new Date(`${WEEK}T00:00:00.000Z`);
    const mine = await prisma.weeklyReport.findUnique({ where: { scopeKey_weekStart: { scopeKey: `manager:${people.mgrA.id}`, weekStart } } });
    expect(mine).not.toBeNull();
    const content = mine!.content as { week: { label: string }; rows: Array<{ registered: number; paid: number }>; teams: Array<{ team: string }> };
    expect(content.week.label).toBe('3–9 Mar');
    expect(content.rows).toHaveLength(1);
    expect(content.rows[0]).toMatchObject({ registered: 2, paid: 1 });
    expect(content.teams.map((t) => t.team)).toEqual(['Team South']);
    // A Manager's report is counts only.
    expect(JSON.stringify(content)).not.toMatch(/paise|revenue|₹/i);

    const company = await prisma.weeklyReport.findUnique({ where: { scopeKey_weekStart: { scopeKey: 'company', weekStart } } });
    const companyContent = company!.content as { rows: Array<{ registered: number }>; reports: { kpis: Record<string, unknown> }; teams: Array<{ teamLeadId: string }> };
    expect(companyContent.rows[0].registered).toBeGreaterThanOrEqual(2);
    expect(companyContent.reports.kpis).toHaveProperty('netPaise');
    expect(companyContent.teams.map((t) => t.teamLeadId)).toEqual(expect.arrayContaining([people.tlA.id, people.tlB.id]));

    const bell = await prisma.notification.findFirst({ where: { recipientStaffId: people.mgrA.id, kind: 'weekly_report', subjectId: WEEK } });
    expect(bell?.link).toBe(`/manager/reports?week=${WEEK}`);
    const ceoBell = await prisma.notification.findFirst({ where: { recipientStaffId: people.ceo.id, kind: 'weekly_report', subjectId: WEEK } });
    expect(ceoBell?.link).toBe(`/ceo/reports?week=${WEEK}`);

    const second = await job.process(RUN_AT);
    expect(second.created).toBe(0);
    expect(second.bells).toBe(0);
    expect(await prisma.weeklyReport.count({ where: { scopeKey: `manager:${people.mgrA.id}` } })).toBe(1);
    expect(await prisma.notification.count({ where: { recipientStaffId: people.mgrA.id, kind: 'weekly_report' } })).toBe(1);
  }, 180_000);

  it('a Manager opens only their own kept reports; the CEO the company one; agents are refused', async () => {
    const list = await get('mgrA', '/weekly-reports');
    expect(list.status).toBe(200);
    expect(list.body).toEqual([expect.objectContaining({ week: WEEK, end: '2031-03-09', label: '3–9 Mar' })]);
    const one = await get('mgrA', `/weekly-reports/${WEEK}`);
    expect(one.status).toBe(200);
    expect(one.body.content.teams.map((t: { team: string }) => t.team)).toEqual(['Team South']);
    expect(JSON.stringify(one.body)).not.toMatch(/paise|revenue/i);
    // Manager B's report is about Team North only.
    const other = await get('mgrB', `/weekly-reports/${WEEK}`);
    expect(other.body.content.teams.map((t: { team: string }) => t.team)).toEqual(['Team North']);

    const ceo = await get('ceo', `/weekly-reports/${WEEK}`);
    expect(ceo.status).toBe(200);
    expect(ceo.body.content.reports).toBeDefined();

    expect((await get('mgrA', '/weekly-reports/2031-03-04')).status).toBe(400);
    expect((await get('mgrA', '/weekly-reports/2031-02-24')).status).toBe(404);
    expect((await get('tlA', '/weekly-reports')).status).toBe(403);
    expect((await get('caA', `/weekly-reports/${WEEK}`)).status).toBe(403);
  });
});
