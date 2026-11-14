import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import * as request from 'supertest';
import { AppModule } from '../../app.module';
import { PrismaService } from '../../common/prisma/prisma.service';

describe('Phase 10 Task 6: login and approval screens', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let jwt: JwtService;
  const createdIds: string[] = [];
  let counter = 0;

  async function makeStaff(role: string, teamLeadId?: string) {
    counter += 1;
    const staff = await prisma.staff.create({
      data: {
        code: `UI-${role.slice(0, 3).toUpperCase()}-${Date.now()}-${counter}`,
        name: `Screen ${role} ${counter}`,
        email: `ui-${role}-${counter}-${Date.now()}@laboura.local`,
        passwordHash: await bcrypt.hash('Screen-Password-1', 4),
        role,
        status: 'active',
        teamLeadId: teamLeadId ?? null,
      },
    });
    createdIds.push(staff.id);
    return staff;
  }

  function tokenFor(staff: { id: string; role: string; code: string; email: string | null }) {
    return jwt.sign({
      sub: staff.id,
      email: staff.email,
      role: staff.role,
      code: staff.code,
    });
  }

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);
    jwt = app.get(JwtService);
  });

  afterAll(async () => {
    await prisma.staff.updateMany({
      where: { id: { in: createdIds } },
      data: { lockedByStaffId: null },
    });
    await prisma.auditLog.deleteMany({ where: { actorId: { in: createdIds } } });
    await prisma.staff.deleteMany({ where: { id: { in: createdIds } } });
    await app.close();
  });

  it('serves the approval screens to Team Leads, Managers and the CEO, and refuses everyone else', async () => {
    const lead = await makeStaff('team_lead');
    const manager = await makeStaff('manager');
    const ceo = await makeStaff('ceo');
    // A Manager locks only people in their own tree.
    await prisma.staff.update({ where: { id: lead.id }, data: { reportsToId: manager.id } });
    const agent = await makeStaff('call_agent', lead.id);
    const field = await makeStaff('field_agent');
    const finance = await makeStaff('finance');
    const server = app.getHttpServer();

    for (const allowed of [lead, manager, ceo]) {
      const auth = { Authorization: `Bearer ${tokenFor(allowed)}` };
      expect((await request(server).get('/login-codes/pending').set(auth)).status).toBe(200);
      expect((await request(server).get('/staff/devices/pending').set(auth)).status).toBe(200);
      expect((await request(server).get('/login-codes/report').set(auth)).status).toBe(200);
    }

    for (const refused of [agent, field, finance]) {
      const auth = { Authorization: `Bearer ${tokenFor(refused)}` };
      expect((await request(server).get('/login-codes/pending').set(auth)).status).toBe(403);
      expect((await request(server).get('/staff/devices/pending').set(auth)).status).toBe(403);
      expect((await request(server).get('/login-codes/report').set(auth)).status).toBe(403);
      expect((await request(server).post(`/staff/${agent.id}/unlock`).set(auth)).status).toBe(403);
      expect((await request(server).post(`/staff/${agent.id}/lock`).set(auth).send({ reason: 'no' })).status).toBe(403);
    }

    expect(
      (await request(server).post(`/staff/${agent.id}/lock`).set('Authorization', `Bearer ${tokenFor(lead)}`).send({ reason: 'a team lead cannot lock' })).status,
    ).toBe(403);

    const locked = await request(server)
      .post(`/staff/${agent.id}/lock`)
      .set('Authorization', `Bearer ${tokenFor(manager)}`)
      .send({ reason: 'screen check' });
    expect(locked.status).toBe(200);

    const unlocked = await request(server)
      .post(`/staff/${agent.id}/unlock`)
      .set('Authorization', `Bearer ${tokenFor(lead)}`);
    expect(unlocked.status).toBe(200);
  });
});
