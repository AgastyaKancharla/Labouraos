import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import * as request from 'supertest';
import { randomUUID } from 'crypto';
import { AppModule } from '../../app.module';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Proofs for routes in SERVICE_SCOPED_ROUTES that had no cross-team test:
 * the service refuses a Team Lead (or agent) acting on someone outside their
 * own team or list. Two teams: Team Lead A with agent A, Team Lead B with agent B.
 */
describe('Service-scoped routes refuse other teams', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let jwt: JwtService;
  const tag = randomUUID().replace(/-/g, '').slice(0, 8).toUpperCase();
  const staffIds: string[] = [];
  const ids: Record<string, string> = {};
  const tokens: Record<string, string> = {};
  const cleanup: Array<() => Promise<unknown>> = [];

  async function staff(key: string, role: string, lead?: string) {
    const row = await prisma.staff.create({
      data: {
        code: `SSR-${key}-${tag}`,
        name: `SSR ${key}`,
        email: `ssr_${key.toLowerCase()}_${tag.toLowerCase()}@laboura.local`,
        passwordHash: await bcrypt.hash('Scoped-Routes-123!', 4),
        role,
        status: 'active',
        teamLeadId: lead ?? null,
        reportsToId: lead ?? null,
      },
    });
    staffIds.push(row.id);
    ids[key] = row.id;
    tokens[key] = jwt.sign({ sub: row.id, role: row.role, code: row.code, email: row.email });
  }

  const as = (key: string) => ({ Authorization: `Bearer ${tokens[key]}` });

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);
    jwt = app.get(JwtService);
    await staff('TLA', 'team_lead');
    await staff('TLB', 'team_lead');
    await staff('CAA', 'call_agent', ids.TLA);
    await staff('CAB', 'call_agent', ids.TLB);
  });

  afterAll(async () => {
    for (const run of cleanup.reverse()) await run().catch(() => undefined);
    await prisma.auditLog.deleteMany({ where: { actorId: { in: staffIds } } }).catch(() => undefined);
    await prisma.staff.deleteMany({ where: { id: { in: staffIds } } }).catch(() => undefined);
    await app.close();
  });

  it("a Team Lead cannot open another team's audit row", async () => {
    const row = await prisma.auditLog.create({
      data: { code: `AL-SSR-${tag}`, actorId: ids.CAB, action: 'test.action', entityType: 'job_seeker', entityCode: `JS-SSR-${tag}` },
    });
    cleanup.push(() => prisma.auditLog.delete({ where: { id: row.id } }));
    expect((await request(app.getHttpServer()).get(`/audit-logs/${row.id}`).set(as('TLA'))).status).toBe(404);
    const own = await request(app.getHttpServer()).get(`/audit-logs/${row.id}`).set(as('TLB'));
    expect(own.status).toBe(200);
    expect(own.body.id).toBe(row.id);
  });

  it("another team's Team Lead cannot approve a system problem, or read a day's history", async () => {
    const day = await prisma.attendanceDay.create({ data: { staffId: ids.CAB, date: new Date('2027-01-04T00:00:00.000Z') } });
    const segment = await prisma.attendanceSegment.create({
      data: { staffId: ids.CAB, dayId: day.id, status: 'system_problem', startedAt: new Date('2027-01-04T05:00:00.000Z'), source: 'staff' },
    });
    cleanup.push(() => prisma.attendanceDay.delete({ where: { id: day.id } }));
    cleanup.push(() => prisma.attendanceSegment.delete({ where: { id: segment.id } }));
    // another team's Team Lead cannot approve a system problem
    expect((await request(app.getHttpServer()).post(`/attendance/system-problem/${segment.id}/approve`).set(as('TLA'))).status).toBe(403);
    // another team's Team Lead cannot read a day's history
    expect((await request(app.getHttpServer()).get(`/attendance/days/${day.id}/history`).set(as('TLA'))).status).toBe(403);
    expect((await request(app.getHttpServer()).get(`/attendance/days/${day.id}/history`).set(as('TLB'))).status).toBe(200);
    expect((await request(app.getHttpServer()).post(`/attendance/system-problem/${segment.id}/approve`).set(as('TLB'))).status).toBe(201);
  });

  it("another team's Team Lead cannot forward a leave request", async () => {
    const leave = await prisma.leaveRequest.create({
      data: {
        staffId: ids.CAB,
        kind: 'casual',
        fromDate: new Date('2027-02-10T00:00:00.000Z'),
        toDate: new Date('2027-02-10T00:00:00.000Z'),
        days: 1,
        reason: 'Family function',
        routedToRole: 'team_lead',
        routeReason: 'default',
      },
    });
    cleanup.push(() => prisma.leaveRequest.delete({ where: { id: leave.id } }));
    const res = await request(app.getHttpServer())
      .post(`/attendance/requests/leave/${leave.id}/forward`)
      .set(as('TLA'))
      .send({ note: 'Please decide' });
    expect(res.status).toBe(403);
  });

  it("another team's Team Lead cannot refuse a login code", async () => {
    const device = await prisma.staffDevice.create({
      data: { staffId: ids.CAB, deviceId: `dev-ssr-${tag}`, label: 'Phone', platform: 'web', status: 'approved' },
    });
    const code = await prisma.loginCodeRequest.create({
      data: { staffId: ids.CAB, staffDeviceId: device.id, ipAddress: '127.0.0.1', expiresAt: new Date(Date.now() + 5 * 60 * 1000) },
    });
    cleanup.push(() => prisma.staffDevice.delete({ where: { id: device.id } }));
    cleanup.push(() => prisma.loginCodeRequest.delete({ where: { id: code.id } }));
    const res = await request(app.getHttpServer())
      .post(`/login-codes/${code.id}/refuse`)
      .set(as('TLA'))
      .send({ reason: 'Not mine' });
    expect(res.status).toBe(403);
  });

  it('another call agent cannot open a follow-up that is not on their list', async () => {
    const task = await prisma.followUpTask.create({
      data: {
        code: `FU-SSR-${tag}`,
        kind: 'not_selected_day_7',
        subjectType: 'job_seeker',
        subjectId: randomUUID(),
        dueAt: new Date(),
        assignedStaffId: ids.CAB,
      },
    });
    cleanup.push(() => prisma.followUpTask.delete({ where: { id: task.id } }));
    expect((await request(app.getHttpServer()).get(`/call-work/follow-ups/${task.id}`).set(as('CAA'))).status).toBe(403);
  });
});
