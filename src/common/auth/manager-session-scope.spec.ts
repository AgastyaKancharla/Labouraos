import { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';
import * as bcrypt from 'bcrypt';
import * as request from 'supertest';
import { AppModule } from '../../app.module';
import { PrismaService } from '../prisma/prisma.service';
import { JwtPayload } from './jwt-payload.interface';

/**
 * A Manager lists and revokes sessions only for staff in their own reporting
 * tree (ReportingScopeService); the CEO for anyone; everyone else only their
 * own (Master Guide: a Manager acts only inside their own tree).
 */
describe('Sessions: a Manager is scoped to their own reporting tree', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let jwt: JwtService;
  const ids: string[] = [];
  const ts = Date.now();
  let n = 0;

  type Person = { id: string; code: string; role: string; token: string };
  let ceo: Person;
  let managerA: Person;
  let managerB: Person;
  let tlA: Person;
  let agentA: Person;
  let agentB: Person;

  async function person(role: string, line: { reportsToId?: string; teamLeadId?: string } = {}): Promise<Person> {
    n += 1;
    const staff = await prisma.staff.create({
      data: {
        code: `MSS-${role.slice(0, 3).toUpperCase()}-${ts}-${n}`,
        name: `Scope ${role} ${n}`,
        role,
        passwordHash: await bcrypt.hash('Scope-Test-Password-1', 4),
        reportsToId: line.reportsToId ?? line.teamLeadId ?? null,
        teamLeadId: line.teamLeadId ?? null,
      },
    });
    ids.push(staff.id);
    const session = await openSession(staff.id);
    const payload: JwtPayload = { sub: staff.id, role, email: null, code: staff.code, teamLeadId: staff.teamLeadId, sid: session };
    return { id: staff.id, code: staff.code, role, token: jwt.sign(payload, { expiresIn: '15m' }) };
  }

  async function openSession(staffId: string): Promise<string> {
    const session = await prisma.staffSession.create({
      data: {
        staffId,
        deviceId: `dev-${staffId}`,
        expiresAt: new Date(Date.now() + 15 * 60 * 1000),
        absoluteExpiresAt: new Date(Date.now() + 2 * 60 * 60 * 1000),
        lastActivityAt: new Date(),
      },
    });
    return session.id;
  }

  /** A second session on someone's account, for the revoke tests. */
  async function extraSession(staffId: string): Promise<string> {
    return openSession(staffId);
  }

  const list = (actor: Person, staffId: string) =>
    request(app.getHttpServer()).get('/staff/sessions').query({ staffId }).set('Authorization', `Bearer ${actor.token}`);
  const revoke = (actor: Person, sessionId: string) =>
    request(app.getHttpServer()).post(`/staff/sessions/${sessionId}/revoke`).set('Authorization', `Bearer ${actor.token}`);

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);
    jwt = app.get(JwtService);

    ceo = await person('ceo');
    managerA = await person('manager', { reportsToId: ceo.id });
    managerB = await person('manager', { reportsToId: ceo.id });
    tlA = await person('team_lead', { reportsToId: managerA.id });
    const tlB = await person('team_lead', { reportsToId: managerB.id });
    agentA = await person('call_agent', { teamLeadId: tlA.id });
    agentB = await person('field_agent', { teamLeadId: tlB.id });
  });

  afterAll(async () => {
    await prisma.auditLog.deleteMany({ where: { actorId: { in: ids } } });
    await prisma.staffSession.deleteMany({ where: { staffId: { in: ids } } });
    await prisma.staff.updateMany({ where: { id: { in: ids } }, data: { reportsToId: null, teamLeadId: null } });
    await prisma.staff.deleteMany({ where: { id: { in: ids } } });
    await app.close();
  });

  it('in scope: a Manager lists and revokes sessions of an agent in their tree (and of their Team Lead)', async () => {
    const extra = await extraSession(agentA.id);
    const listed = await list(managerA, agentA.id);
    expect(listed.status).toBe(200);
    expect(listed.body.map((s: { id: string }) => s.id)).toContain(extra);
    expect((await list(managerA, tlA.id)).status).toBe(200);

    const res = await revoke(managerA, extra);
    expect(res.status).toBe(200);
    const row = await prisma.staffSession.findUniqueOrThrow({ where: { id: extra } });
    expect(row.revokedAt).not.toBeNull();
    expect(row.endedReason).toBe('revoked');
  });

  it('out of scope: 403 for an agent in another Manager’s tree, another Manager, and the CEO', async () => {
    const extra = await extraSession(agentB.id);
    for (const target of [agentB, managerB, ceo]) {
      const res = await list(managerA, target.id);
      expect(res.status).toBe(403);
    }
    const res = await revoke(managerA, extra);
    expect(res.status).toBe(403);
    expect(res.body.message).toContain('own reporting tree');
    expect((await prisma.staffSession.findUniqueOrThrow({ where: { id: extra } })).revokedAt).toBeNull();

    const ceoExtra = await extraSession(ceo.id);
    expect((await revoke(managerA, ceoExtra)).status).toBe(403);
  });

  it('CEO: lists and revokes anyone’s sessions', async () => {
    const extra = await extraSession(agentB.id);
    const listed = await list(ceo, agentB.id);
    expect(listed.status).toBe(200);
    expect(listed.body.map((s: { id: string }) => s.id)).toContain(extra);
    expect((await list(ceo, managerB.id)).status).toBe(200);
    expect((await revoke(ceo, extra)).status).toBe(200);
    expect((await prisma.staffSession.findUniqueOrThrow({ where: { id: extra } })).revokedAt).not.toBeNull();
  });

  it('below Manager: only their own sessions; another person’s session is 403', async () => {
    const extra = await extraSession(agentA.id);
    const res = await revoke(tlA, extra);
    expect(res.status).toBe(403);
    // A staffId from a Team Lead is ignored: they get their own list.
    const own = await list(tlA, agentA.id);
    expect(own.status).toBe(200);
    expect(own.body.map((s: { id: string }) => s.id)).not.toContain(extra);
  });

  it('everyone may still list and revoke their own', async () => {
    const extra = await extraSession(managerA.id);
    expect((await list(managerA, managerA.id)).status).toBe(200);
    expect((await revoke(managerA, extra)).status).toBe(200);
  });
});
