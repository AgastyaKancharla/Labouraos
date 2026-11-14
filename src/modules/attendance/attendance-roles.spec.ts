import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import * as request from 'supertest';
import { randomUUID } from 'crypto';
import { AppModule } from '../../app.module';
import { PrismaService } from '../../common/prisma/prisma.service';
import { ROLES_METADATA_KEY } from '../../common/rbac/roles.decorator';
import { AttendanceController } from './attendance.controller';

/**
 * Each app accepts only its own roles (Master Guide, 14 Nov). The CEO marks no
 * attendance, so the day's actions refuse the CEO; and the old consoles'
 * priority and map endpoints, which no current screen calls, are gone.
 */
describe('Role trims: attendance actions and retired console endpoints', () => {
  it('Start/End my day, status and heartbeat are for the staff who mark attendance, not the CEO', () => {
    for (const handler of ['login', 'logout', 'setStatus', 'heartbeat'] as const) {
      const roles: string[] = Reflect.getMetadata(ROLES_METADATA_KEY, AttendanceController.prototype[handler]);
      expect([...roles].sort()).toEqual(['call_agent', 'field_agent', 'finance', 'manager', 'team_lead']);
    }
  });

  describe('over HTTP', () => {
    let app: INestApplication;
    let prisma: PrismaService;
    let jwt: JwtService;
    const staffIds: string[] = [];
    const tokens: Record<string, string> = {};

    beforeAll(async () => {
      const moduleRef: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
      app = moduleRef.createNestApplication();
      await app.init();
      prisma = app.get(PrismaService);
      jwt = app.get(JwtService);
      for (const role of ['ceo', 'call_agent', 'field_agent']) {
        const suffix = randomUUID().replace(/-/g, '').slice(0, 8).toUpperCase();
        const row = await prisma.staff.create({
          data: {
            code: `TRIM-${role}-${suffix}`,
            name: `Trim ${role}`,
            email: `trim_${role}_${suffix}@laboura.local`.toLowerCase(),
            passwordHash: await bcrypt.hash('Trim-Roles-123!', 4),
            role,
            status: 'active',
          },
        });
        staffIds.push(row.id);
        tokens[role] = jwt.sign({ sub: row.id, role: row.role, code: row.code, email: row.email });
      }
    });

    afterAll(async () => {
      await prisma.auditLog.deleteMany({ where: { actorId: { in: staffIds } } });
      await prisma.staff.deleteMany({ where: { id: { in: staffIds } } });
      await app.close();
    });

    it.each(['login', 'logout', 'status', 'heartbeat'])('POST /attendance/%s refuses the CEO', async (action) => {
      const res = await request(app.getHttpServer())
        .post(`/attendance/${action}`)
        .set('Authorization', `Bearer ${tokens.ceo}`)
        .send({});
      expect(res.status).toBe(403);
    });

    it.each([
      '/field-agent/priority-dashboard',
      '/priority/candidates',
      '/priority/vacancies',
      '/priority/trades',
      '/map/points?bbox=77.5,12.9,77.7,13.1',
    ])('GET %s no longer exists', async (url) => {
      for (const role of ['ceo', 'call_agent', 'field_agent']) {
        const res = await request(app.getHttpServer())
          .get(url)
          .set('Authorization', `Bearer ${tokens[role]}`)
          .set('Accept', 'application/json');
        expect(res.status).toBe(404);
      }
    });
  });
});
