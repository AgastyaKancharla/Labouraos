import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import * as request from 'supertest';
import { randomUUID } from 'crypto';
import { AppModule } from '../../app.module';
import { PrismaService } from '../../common/prisma/prisma.service';
import { ROLES_METADATA_KEY } from '../../common/rbac/roles.decorator';
import { PayoutAccountController } from './payout-account.controller';

/**
 * Payout details (masked UPI or account, IFSC, verified holder name) and the
 * link that asks for them are for the CEO and Finance only (Master Guide,
 * Bank and UPI details, 11 Nov; Managers see no money).
 */
describe('Payout account endpoints: CEO and Finance only', () => {
  it('the routes declare exactly CEO and Finance', () => {
    for (const handler of ['createPayoutLink', 'listAccountsForOwner'] as const) {
      const roles = Reflect.getMetadata(ROLES_METADATA_KEY, PayoutAccountController.prototype[handler]);
      expect([...roles].sort()).toEqual(['ceo', 'finance']);
    }
  });

  describe('over HTTP', () => {
    let app: INestApplication;
    let prisma: PrismaService;
    let jwt: JwtService;
    const staffIds: string[] = [];
    const tokens: Record<string, string> = {};
    let seekerId = '';

    beforeAll(async () => {
      const moduleRef: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
      app = moduleRef.createNestApplication();
      await app.init();
      prisma = app.get(PrismaService);
      jwt = app.get(JwtService);
      for (const role of ['ceo', 'finance', 'manager', 'team_lead', 'call_agent', 'field_agent']) {
        const suffix = randomUUID().replace(/-/g, '').slice(0, 8).toUpperCase();
        const row = await prisma.staff.create({
          data: {
            code: `PAR-${role}-${suffix}`,
            name: `Payout roles ${role}`,
            email: `par_${role}_${suffix}@laboura.local`.toLowerCase(),
            passwordHash: await bcrypt.hash('Payout-Roles-123!', 4),
            role,
            status: 'active',
          },
        });
        staffIds.push(row.id);
        tokens[role] = jwt.sign({ sub: row.id, role: row.role, code: row.code, email: row.email });
      }
      const digits = String(Math.floor(Math.random() * 1e8)).padStart(8, '0');
      const seeker = await prisma.jobSeeker.create({
        data: {
          code: `JS-PAR-${randomUUID().replace(/-/g, '').slice(0, 8).toUpperCase()}`,
          name: 'Payout roles seeker',
          phone: `+9194${digits}`,
          minSalary: 1600000,
          maxSalary: 2600000,
          preferredCallWindowStart: '09:00',
          preferredCallWindowEnd: '18:00',
          status: 'active',
          registeredByStaffId: staffIds[4],
        },
      });
      seekerId = seeker.id;
    });

    afterAll(async () => {
      await prisma.publicLink.deleteMany({ where: { subjectId: seekerId } }).catch(() => {});
      await prisma.jobSeeker.deleteMany({ where: { id: seekerId } });
      await prisma.auditLog.deleteMany({ where: { actorId: { in: staffIds } } });
      await prisma.staff.deleteMany({ where: { id: { in: staffIds } } });
      await app.close();
    });

    it.each(['manager', 'team_lead', 'call_agent', 'field_agent'])('%s is refused both routes', async (role) => {
      const list = await request(app.getHttpServer())
        .get(`/payout-accounts/job_seeker/${seekerId}`)
        .set('Authorization', `Bearer ${tokens[role]}`);
      expect(list.status).toBe(403);
      const link = await request(app.getHttpServer())
        .post('/payout-accounts/links')
        .set('Authorization', `Bearer ${tokens[role]}`)
        .send({ ownerType: 'job_seeker', ownerId: seekerId });
      expect(link.status).toBe(403);
    });

    it.each(['ceo', 'finance'])('%s reads payout accounts', async (role) => {
      const list = await request(app.getHttpServer())
        .get(`/payout-accounts/job_seeker/${seekerId}`)
        .set('Authorization', `Bearer ${tokens[role]}`);
      expect(list.status).toBe(200);
      expect(Array.isArray(list.body)).toBe(true);
    });

    it('Finance sends a payout details link', async () => {
      const link = await request(app.getHttpServer())
        .post('/payout-accounts/links')
        .set('Authorization', `Bearer ${tokens.finance}`)
        .send({ ownerType: 'job_seeker', ownerId: seekerId });
      expect(link.status).toBe(201);
    });
  });
});
