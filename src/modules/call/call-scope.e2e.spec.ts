import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import * as request from 'supertest';
import { randomUUID } from 'crypto';
import { AppModule } from '../../app.module';
import { PrismaService } from '../../common/prisma/prisma.service';

/**
 * Owner rule (Master Guide, 14 Nov), over HTTP: calls, missed calls and
 * follow-ups are each person's own (agents) or their own team's (Team Leads).
 */
describe('Calls, missed calls and follow-ups: own and own team only', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let jwt: JwtService;
  const tag = randomUUID().replace(/-/g, '').slice(0, 8).toUpperCase();
  const staffIds: string[] = [];
  const ids: Record<string, string> = {};
  const tokens: Record<string, string> = {};
  const callIds: string[] = [];
  const callbackIds: string[] = [];
  const taskIds: string[] = [];

  async function staff(key: string, role: string, teamLeadId?: string) {
    const row = await prisma.staff.create({
      data: {
        code: `CS-${key}-${tag}`,
        name: `CS ${key}`,
        email: `cs_${key.toLowerCase()}_${tag.toLowerCase()}@laboura.local`,
        passwordHash: await bcrypt.hash('Call-Scope-123!', 4),
        role,
        status: 'active',
        teamLeadId: teamLeadId ?? null,
      },
    });
    staffIds.push(row.id);
    ids[key] = row.id;
    tokens[key] = jwt.sign({ sub: row.id, role: row.role, code: row.code, email: row.email });
  }

  async function call(key: string, staffId: string) {
    const row = await prisma.callRecord.create({
      data: {
        code: `CR-CS-${key}-${tag}`,
        provider: 'mock_telephony',
        providerCallId: `cs_${key}_${tag}`,
        providerStatus: 'completed',
        answered: true,
        staffId,
      },
    });
    callIds.push(row.id);
    ids[key] = row.id;
  }

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
    await call('callA', ids.CAA);
    await call('callB', ids.CAB);
    const callback = await prisma.callbackTask.create({
      data: { callId: `CS-CB-${tag}`, phone: '+919800012345', status: 'assigned', assignedToStaffId: ids.CAB },
    });
    callbackIds.push(callback.id);
    ids.callbackB = callback.id;
    const task = await prisma.followUpTask.create({
      data: {
        code: `FU-CS-${tag}`,
        kind: 'not_selected_day_7',
        subjectType: 'job_seeker',
        subjectId: randomUUID(),
        dueAt: new Date(),
        assignedStaffId: ids.CAB,
      },
    });
    taskIds.push(task.id);
    ids.taskB = task.id;
  });

  afterAll(async () => {
    await prisma.followUpTask.deleteMany({ where: { id: { in: taskIds } } });
    await prisma.callbackTask.deleteMany({ where: { id: { in: callbackIds } } });
    await prisma.callRecord.deleteMany({ where: { id: { in: callIds } } });
    await prisma.auditLog.deleteMany({ where: { actorId: { in: staffIds } } });
    await prisma.staff.deleteMany({ where: { id: { in: staffIds } } });
    await app.close();
  });

  const get = (path: string, token: string) =>
    request(app.getHttpServer()).get(path).set('Authorization', `Bearer ${token}`);
  const post = (path: string, token: string, body: object = {}) =>
    request(app.getHttpServer()).post(path).set('Authorization', `Bearer ${token}`).send(body);

  it('GET /calls/:id: an agent opens only their own call; a Team Lead only their team\'s', async () => {
    expect((await get(`/calls/${ids.callA}`, tokens.CAA)).status).toBe(200);
    expect((await get(`/calls/${ids.callB}`, tokens.CAA)).status).toBe(403);
    expect((await get(`/calls/${ids.callA}`, tokens.TLA)).status).toBe(200);
    expect((await get(`/calls/${ids.callB}`, tokens.TLA)).status).toBe(403);
  });

  it('PATCH /calls/:id and its outcome: another agent or another team is refused before the route runs', async () => {
    const patch = await request(app.getHttpServer())
      .patch(`/calls/${ids.callB}`)
      .set('Authorization', `Bearer ${tokens.CAA}`)
      .send({ notes: 'x', reason: 'y' });
    expect(patch.status).toBe(403);
    expect((await post(`/calls/${ids.callB}/outcome`, tokens.TLA, { agentOutcome: 'interested' })).status).toBe(403);
    expect((await get(`/calls/${ids.callB}/recording`, tokens.TLA)).status).toBe(403);
  });

  it('missed calls: another team\'s is refused to a Team Lead; another agent\'s to an agent', async () => {
    expect((await post(`/telephony/callbacks/${ids.callbackB}/assign`, tokens.TLA, { staffId: ids.CAA })).status).toBe(403);
    expect((await post(`/telephony/callbacks/${ids.callbackB}/complete`, tokens.TLA)).status).toBe(403);
    expect((await post(`/telephony/callbacks/${ids.callbackB}/complete`, tokens.CAA)).status).toBe(403);
    const own = await post(`/telephony/callbacks/${ids.callbackB}/complete`, tokens.CAB);
    expect(own.status).toBe(201);
    expect(own.body.status).toBe('completed');
  });

  it('follow-ups: another agent cannot complete one assigned to someone else', async () => {
    const res = await post(`/follow-up-tasks/${ids.taskB}/complete`, tokens.CAA, { callRecordId: ids.callA, answer: 'not_working' });
    expect(res.status).toBe(403);
    const lead = await post(`/follow-up-tasks/${ids.taskB}/complete`, tokens.TLA, { callRecordId: ids.callA, answer: 'not_working' });
    expect(lead.status).toBe(403);
    // Its own agent passes the check (the call does not match the task, so the route then answers 400).
    const own = await post(`/follow-up-tasks/${ids.taskB}/complete`, tokens.CAB, { callRecordId: ids.callB, answer: 'not_working' });
    expect(own.status).toBe(400);
  });
});
