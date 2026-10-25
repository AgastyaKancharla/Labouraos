import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import * as request from 'supertest';
import * as bcrypt from 'bcrypt';
import { AppModule } from '../../app.module';
import { PrismaService } from '../../common/prisma/prisma.service';
import { enrolledLogin } from '../../test-support/enrolled-login-spec';

describe('Phase 5 Task 9: RBAC and Seed Data', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  let ceoToken: string;
  let managerToken: string;
  let financeToken: string;

  let staffIds: string[] = [];
  const timestamp = Date.now();
  const password = 'Password123!Secure';

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();

    prisma = app.get<PrismaService>(PrismaService);
    const passwordHash = await bcrypt.hash(password, 10);

    const ceo = await prisma.staff.create({
      data: {
        code: `CEO-P5S-${timestamp}`,
        name: 'CEO Seed User',
        email: `ceo_p5s_${timestamp}@laboura.local`,
        passwordHash,
        role: 'ceo',
        city: 'Bengaluru',
      },
    });

    const manager = await prisma.staff.create({
      data: {
        code: `MGR-P5S-${timestamp}`,
        name: 'Manager Seed User',
        email: `mgr_p5s_${timestamp}@laboura.local`,
        passwordHash,
        role: 'manager',
        city: 'Bengaluru',
      },
    });

    const finance = await prisma.staff.create({
      data: {
        code: `FI-P5S-${timestamp}`,
        name: 'Finance Seed User',
        email: `fi_p5s_${timestamp}@laboura.local`,
        passwordHash,
        role: 'finance',
        city: 'Bengaluru',
      },
    });

    staffIds = [ceo.id, manager.id, finance.id];

    const getTok = async (email: string) => {
      const res = await enrolledLogin(app.getHttpServer(), { email, password })
        .expect(200);
      return res.body.accessToken;
    };

    ceoToken = await getTok(ceo.email);
    managerToken = await getTok(manager.email);
    financeToken = await getTok(finance.email);
  });

  afterAll(async () => {
    await prisma.auditLog.deleteMany({
      where: { actorId: { in: staffIds } },
    });
    await prisma.staff.deleteMany({
      where: { id: { in: staffIds } },
    });
    await app.close();
  });

  describe('Finance reads placements with PII masked', () => {
    it('allows Finance to read placements list and single placement, masking phone and kyc details', async () => {
      // Fetch list as Finance
      const res = await request(app.getHttpServer())
        .get('/placements')
        .set('Authorization', `Bearer ${financeToken}`)
        .expect(200);

      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBeGreaterThan(0);

      // Verify PII is masked for Finance
      const first = res.body[0];
      if (first.jobSeeker) {
        expect(first.jobSeeker.phone).toBe('********');
        if (first.jobSeeker.kycReference) {
          expect(first.jobSeeker.kycReference).toBe('********');
        }
      }
      if (first.business && first.business.contactPhone) {
        expect(first.business.contactPhone).toBe('********');
      }

      // Codes and money amounts are NOT masked
      expect(first.code).toMatch(/^PL-\d{5}$/);
      expect(typeof first.agreedSalary).toBe('number');
      expect(typeof first.placementFee).toBe('number');

      // Fetch single placement
      const singleRes = await request(app.getHttpServer())
        .get(`/placements/${first.id}`)
        .set('Authorization', `Bearer ${financeToken}`)
        .expect(200);

      expect(singleRes.body.id).toBe(first.id);
      if (singleRes.body.jobSeeker) {
        expect(singleRes.body.jobSeeker.phone).toBe('********');
      }
    });

    it('allows CEO and Manager to read placements with unmasked PII', async () => {
      const res = await request(app.getHttpServer())
        .get('/placements')
        .set('Authorization', `Bearer ${ceoToken}`)
        .expect(200);

      const first = res.body[0];
      if (first.jobSeeker) {
        expect(first.jobSeeker.phone).not.toBe('********');
      }

      const mgrRes = await request(app.getHttpServer())
        .get('/placements')
        .set('Authorization', `Bearer ${managerToken}`)
        .expect(200);

      const mgrFirst = mgrRes.body[0];
      if (mgrFirst.jobSeeker) {
        expect(mgrFirst.jobSeeker.phone).not.toBe('********');
      }
    });
  });

  describe('Finance reads payment ledger with PII masked', () => {
    it('allows Finance to read payment ledger, masking job seeker and business phones', async () => {
      const res = await request(app.getHttpServer())
        .get('/payments')
        .set('Authorization', `Bearer ${financeToken}`)
        .expect(200);

      expect(Array.isArray(res.body)).toBe(true);
      for (const payment of res.body) {
        if (payment.jobSeeker) {
          expect(payment.jobSeeker.phone).toBe('********');
        }
        if (payment.business && payment.business.contactPhone) {
          expect(payment.business.contactPhone).toBe('********');
        }
        expect(payment.code).toMatch(/^PAY-\d{5}$/);
        expect(typeof payment.amount).toBe('number');
      }
    });
  });

  describe('Finance cannot approve refunds', () => {
    it('denies Finance attempting to approve job seeker refund (403)', async () => {
      const candidate = await prisma.jobSeeker.findFirst({
        where: { status: 'active' },
      });
      if (candidate) {
        await request(app.getHttpServer())
          .post(`/job-seekers/${candidate.id}/refund`)
          .set('Authorization', `Bearer ${financeToken}`)
          .send({})
          .expect(403);
      }
    });
  });
});
