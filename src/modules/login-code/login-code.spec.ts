import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { JwtService } from '@nestjs/jwt';
import { AppModule } from '../../app.module';
import { PrismaService } from '../../common/prisma/prisma.service';
import { getLoginCodeSecret } from './login-code.secret';
import { LoginCodeModule } from './login-code.module';
import { LoginCodeService } from './login-code.service';

describe('Phase 10 Task 3: Login codes', () => {
  const originalSecret = process.env.LOGIN_CODE_SECRET;
  const secretForTests =
    originalSecret && originalSecret.trim().length >= 32
      ? originalSecret
      : 'dev_login_code_secret_change_in_production_32';

  function restoreSecret() {
    process.env.LOGIN_CODE_SECRET = secretForTests;
  }

  describe('LOGIN_CODE_SECRET', () => {
    afterEach(() => {
      restoreSecret();
    });

    it('refuses to start when the secret is missing or shorter than 32 characters', async () => {
      process.env.LOGIN_CODE_SECRET = '';
      expect(() => getLoginCodeSecret()).toThrow(/LOGIN_CODE_SECRET environment variable is missing/);
      await expect(
        Test.createTestingModule({ imports: [LoginCodeModule] }).compile(),
      ).rejects.toThrow(/LOGIN_CODE_SECRET/);

      process.env.LOGIN_CODE_SECRET = '1234567890';
      expect(() => getLoginCodeSecret()).toThrow(/at least 32 characters/);
      expect(
        () =>
          new LoginCodeService(
            {} as never,
            {} as never,
            {} as never,
            { now: () => new Date() },
          ),
      ).toThrow(/at least 32 characters/);
      await expect(
        Test.createTestingModule({ imports: [LoginCodeModule] }).compile(),
      ).rejects.toThrow(/LOGIN_CODE_SECRET/);
    });
  });

  describe('codes, reveal, verify and the report', () => {
    let app: INestApplication;
    let prisma: PrismaService;
    let jwtService: JwtService;
    let codes: LoginCodeService;
    let ceoToken: string;
    let managerToken: string;
    let teamLead1Token: string;
    let teamLead2Token: string;
    let callAgentToken: string;
    let financeToken: string;
    let teamLead1Id: string;
    let managerId: string;
    let agent1Id: string;
    let agent2Id: string;
    let device1Id: string;
    let device2Id: string;
    let leadDeviceId: string;
    let wrongLimit: number;

    function token(staff: { id: string; role: string; code: string }) {
      return jwtService.sign({
        sub: staff.id,
        email: `${staff.id}@laboura.local`,
        role: staff.role,
        code: staff.code,
      });
    }

    beforeAll(async () => {
      process.env.LOGIN_CODE_SECRET = secretForTests;
      const moduleFixture: TestingModule = await Test.createTestingModule({
        imports: [AppModule],
      }).compile();
      app = moduleFixture.createNestApplication();
      await app.init();
      prisma = app.get(PrismaService);
      jwtService = app.get(JwtService);
      codes = app.get(LoginCodeService);
      const policy = await prisma.pricingPolicy.findFirst({
        orderBy: { effectiveFrom: 'desc' },
      });
      wrongLimit = policy!.failedLoginLimit;
      expect(wrongLimit).toBe(5);

      const stamp = Date.now();
      const make = async (role: string, prefix: string, teamLeadId?: string) =>
        prisma.staff.create({
          data: {
            code: `${prefix}-LC-${stamp}`,
            name: `${prefix} codes`,
            email: `${prefix.toLowerCase()}.lc.${stamp}@laboura.local`,
            passwordHash: 'dummyhash',
            role,
            status: 'active',
            teamLeadId: teamLeadId ?? null,
          },
        });
      const ceo = await make('ceo', 'CEO');
      const manager = await make('manager', 'MGR');
      const tl1 = await make('team_lead', 'TL1');
      const tl2 = await make('team_lead', 'TL2');
      const agent1 = await make('call_agent', 'CA1', tl1.id);
      const agent2 = await make('field_agent', 'FA2', tl2.id);
      const finance = await make('finance', 'FIN');
      const deviceFor = (staffId: string, deviceId: string) =>
        prisma.staffDevice.create({
          data: {
            staffId,
            deviceId,
            label: deviceId,
            platform: 'web',
            status: 'approved',
            approvedAt: new Date(),
          },
        });
      const d1 = await deviceFor(agent1.id, `dev-${stamp}-1`);
      const d2 = await deviceFor(agent2.id, `dev-${stamp}-2`);
      const dLead = await deviceFor(tl1.id, `dev-${stamp}-lead`);
      teamLead1Id = tl1.id;
      managerId = manager.id;
      agent1Id = agent1.id;
      agent2Id = agent2.id;
      device1Id = d1.id;
      device2Id = d2.id;
      leadDeviceId = dLead.id;
      ceoToken = token(ceo);
      managerToken = token(manager);
      teamLead1Token = token(tl1);
      teamLead2Token = token(tl2);
      callAgentToken = token(agent1);
      financeToken = token(finance);
    });

    afterAll(async () => {
      await app.close();
    });

    it('stores no code, and reveal and verify agree', async () => {
      const created = await codes.create(agent1Id, device1Id, '203.0.113.10', true);
      const stored = await prisma.loginCodeRequest.findUniqueOrThrow({
        where: { id: created.id },
      });
      const policy = await prisma.pricingPolicy.findFirst({
        orderBy: { effectiveFrom: 'desc' },
      });
      expect(stored.expiresAt.getTime() - stored.createdAt.getTime()).toBe(
        policy!.loginCodeValidMinutes * 60 * 1000,
      );
      expect(JSON.stringify(stored)).not.toMatch(/code/i);

      const revealed = await request(app.getHttpServer())
        .post(`/login-codes/${created.id}/reveal`)
        .set('Authorization', `Bearer ${teamLead1Token}`)
        .expect(200);
      expect(revealed.body.code).toMatch(/^\d{6}$/);
      for (const value of Object.values(stored)) {
        expect(value).not.toBe(revealed.body.code);
      }

      const used = await codes.verify(created.id, revealed.body.code);
      expect(used.status).toBe('used');
      await expect(codes.verify(created.id, revealed.body.code)).rejects.toThrow(/already been used/);

      const audits = await prisma.auditLog.count({
        where: { entityCode: created.id, action: 'login_code.revealed' },
      });
      expect(audits).toBe(1);
    });

    it('refuses an expired code, a refused code, and the fifth wrong code', async () => {
      const expired = await codes.create(agent1Id, device1Id, '203.0.113.11', false);
      await prisma.loginCodeRequest.update({
        where: { id: expired.id },
        data: { expiresAt: new Date(Date.now() - 60_000) },
      });
      await expect(codes.verify(expired.id, '000000')).rejects.toThrow(/expired/);
      expect(
        (await prisma.loginCodeRequest.findUnique({ where: { id: expired.id } }))?.status,
      ).toBe('expired');

      const wrong = await codes.create(agent1Id, device1Id, '203.0.113.12', false);
      for (let attempt = 0; attempt < wrongLimit; attempt += 1) {
        await expect(codes.verify(wrong.id, '000000')).rejects.toThrow(/not valid/);
      }
      const refused = await prisma.loginCodeRequest.findUnique({ where: { id: wrong.id } });
      expect(refused?.status).toBe('refused');
      expect(refused?.refusedReason).toBe('too_many_wrong_codes');
      await expect(codes.verify(wrong.id, '000000')).rejects.toThrow(/refused/);

      const manual = await codes.create(agent1Id, device1Id, '203.0.113.13', false);
      await request(app.getHttpServer())
        .post(`/login-codes/${manual.id}/refuse`)
        .set('Authorization', `Bearer ${teamLead1Token}`)
        .send({ reason: 'Not the agent' })
        .expect(200);
      await expect(codes.verify(manual.id, '000000')).rejects.toThrow(/refused/);
    });

    it('hides an approver from their own request and limits a Team Lead to their team', async () => {
      const other = await codes.create(agent2Id, device2Id, '203.0.113.20', false);
      const own = await codes.create(teamLead1Id, leadDeviceId, '203.0.113.21', true);

      const leadList = await request(app.getHttpServer())
        .get('/login-codes/pending')
        .set('Authorization', `Bearer ${teamLead1Token}`)
        .expect(200);
      const leadStaff = leadList.body.map((row: { staffId: string }) => row.staffId);
      expect(leadStaff).not.toContain(teamLead1Id);
      expect(leadStaff).not.toContain(agent2Id);

      await request(app.getHttpServer())
        .post(`/login-codes/${other.id}/reveal`)
        .set('Authorization', `Bearer ${teamLead1Token}`)
        .expect(403);
      await request(app.getHttpServer())
        .post(`/login-codes/${own.id}/reveal`)
        .set('Authorization', `Bearer ${teamLead1Token}`)
        .expect(403);

      const managerList = await request(app.getHttpServer())
        .get('/login-codes/pending')
        .set('Authorization', `Bearer ${managerToken}`)
        .expect(200);
      expect(managerList.body.map((row: { staffId: string }) => row.staffId)).toContain(
        teamLead1Id,
      );
      expect(managerList.body.map((row: { id: string }) => row.id)).not.toContain(managerId);

      const shown = await request(app.getHttpServer())
        .post(`/login-codes/${own.id}/reveal`)
        .set('Authorization', `Bearer ${managerToken}`)
        .expect(200);
      expect(shown.body.code).toMatch(/^\d{6}$/);
      expect(shown.body.revealedByStaffId).toBe(managerId);

      const again = await request(app.getHttpServer())
        .post(`/login-codes/${own.id}/reveal`)
        .set('Authorization', `Bearer ${ceoToken}`)
        .expect(200);
      expect(again.body.code).toBe(shown.body.code);
      expect(again.body.revealedAt).toBe(shown.body.revealedAt);

      await request(app.getHttpServer())
        .get('/login-codes/pending')
        .set('Authorization', `Bearer ${callAgentToken}`)
        .expect(403);
      await request(app.getHttpServer())
        .get('/login-codes/pending')
        .set('Authorization', `Bearer ${financeToken}`)
        .expect(403);
      await request(app.getHttpServer())
        .post(`/login-codes/${other.id}/reveal`)
        .set('Authorization', `Bearer ${teamLead2Token}`)
        .expect(200);
    });

    it('reports counts, the average wait, and odd-hour requests', async () => {
      const odd = await codes.create(agent1Id, device1Id, '203.0.113.30', false);
      const day = await codes.create(agent1Id, device1Id, '203.0.113.31', false);
      await request(app.getHttpServer())
        .post(`/login-codes/${odd.id}/reveal`)
        .set('Authorization', `Bearer ${teamLead1Token}`)
        .expect(200);
      await prisma.loginCodeRequest.update({
        where: { id: odd.id },
        data: {
          createdAt: new Date('2030-01-01T17:30:00.000Z'),
          revealedAt: new Date('2030-01-01T17:32:00.000Z'),
        },
      });
      await prisma.loginCodeRequest.update({
        where: { id: day.id },
        data: {
          createdAt: new Date('2030-01-01T05:30:00.000Z'),
          status: 'expired',
        },
      });
      const refused = await codes.create(agent1Id, device1Id, '203.0.113.32', false);
      await prisma.loginCodeRequest.update({
        where: { id: refused.id },
        data: {
          createdAt: new Date('2030-01-01T18:00:00.000Z'),
          status: 'refused',
          refusedReason: 'too_many_wrong_codes',
        },
      });

      const report = await request(app.getHttpServer())
        .get('/login-codes/report')
        .query({ from: '2030-01-01T00:00:00.000Z', to: '2030-01-01T23:59:59.000Z' })
        .set('Authorization', `Bearer ${teamLead1Token}`)
        .expect(200);
      const mine = report.body.requestsPerStaff.find(
        (row: { staffId: string }) => row.staffId === agent1Id,
      );
      expect(mine.count).toBe(3);
      expect(report.body.revealedPerApprover).toEqual([
        expect.objectContaining({ staffId: teamLead1Id, count: 1 }),
      ]);
      expect(report.body.averageWaitMs).toBe(2 * 60 * 1000);
      expect(report.body.expiredCount).toBe(1);
      expect(report.body.refusedCount).toBe(1);
      expect(report.body.oddHourCount).toBe(2);

      const otherTeam = await request(app.getHttpServer())
        .get('/login-codes/report')
        .query({ from: '2030-01-01T00:00:00.000Z', to: '2030-01-01T23:59:59.000Z' })
        .set('Authorization', `Bearer ${teamLead2Token}`)
        .expect(200);
      expect(
        otherTeam.body.requestsPerStaff.some(
          (row: { staffId: string }) => row.staffId === agent1Id,
        ),
      ).toBe(false);
    });
  });
});
