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

  it('renders the staff-code login on every console, with approver screens only on the admin dashboard', async () => {
    const admin = await request(app.getHttpServer()).get('/admin').expect(200);
    const callAgent = await request(app.getHttpServer()).get('/call-agent').expect(200);
    const fieldAgent = await request(app.getHttpServer()).get('/field-agent').expect(200);

    for (const page of [admin, callAgent, fieldAgent]) {
      expect(page.text).toContain('id="login-staff-code"');
      expect(page.text).toContain('id="login-password"');
      expect(page.text).toContain('Ask your Team Lead for your code');
      expect(page.text).toContain('id="login-code"');
      expect(page.text).toContain('id="login-code-countdown"');
      expect(page.text).toContain('laboura_device_id');
      expect(page.text).toContain('localStorage.setItem');
      expect(page.text).toContain("sessionStorage.setItem('laboura_token'");
      expect(page.text).toContain('/auth/refresh');
      expect(page.text).toContain('/auth/logout');
    }

    expect(admin.text).toContain('id="view-login-codes"');
    expect(admin.text).toContain('id="view-devices"');
    expect(admin.text).toContain('id="view-staff"');
    expect(admin.text).toContain('id="view-login-report"');
    expect(admin.text).toContain('Show code');
    expect(admin.text).toContain('Approve');
    expect(admin.text).toContain('>Unlock<');
    expect(admin.text).toContain('>Lock<');
    expect(admin.text).toContain('10000');
    expect(callAgent.text).not.toContain('id="view-login-codes"');
    expect(fieldAgent.text).not.toContain('id="view-login-codes"');
    expect(callAgent.text).not.toContain('id="view-devices"');
    expect(fieldAgent.text).not.toContain('id="view-staff"');
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
