import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import * as request from 'supertest';
import * as bcrypt from 'bcrypt';
import { AppModule } from '../../app.module';
import { PrismaService } from '../../common/prisma/prisma.service';
import { seed } from '../../../prisma/seed';
import { enrolledLogin } from '../../test-support/enrolled-login-spec';

describe('Phase 3 Task 6: RBAC and Seed Data', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  let ceoToken: string;
  let managerToken: string;
  let callAgentToken: string;
  let fieldAgentToken: string;
  let financeToken: string;

  let testJobSeekerId: string;
  let deactivatedJobSeekerId: string;

  const timestamp = Date.now();
  const password = 'Password123!Secure';

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();

    prisma = app.get<PrismaService>(PrismaService);

    // Run seed to populate database with Phase 3 seed records
    await seed(prisma);

    const passwordHash = await bcrypt.hash(password, 10);

    const ceo = await prisma.staff.create({
      data: {
        code: `CEO-R6-${timestamp}`,
        name: 'CEO R6',
        email: `ceo_r6_${timestamp}@laboura.local`,
        passwordHash,
        role: 'ceo',
        city: 'Bengaluru',
      },
    });

    const manager = await prisma.staff.create({
      data: {
        code: `MGR-R6-${timestamp}`,
        name: 'Manager R6',
        email: `mgr_r6_${timestamp}@laboura.local`,
        passwordHash,
        role: 'manager',
        city: 'Bengaluru',
      },
    });

    const callAgent = await prisma.staff.create({
      data: {
        code: `CA-R6-${timestamp}`,
        name: 'Call Agent R6',
        email: `ca_r6_${timestamp}@laboura.local`,
        passwordHash,
        role: 'call_agent',
        city: 'Bengaluru',
      },
    });

    const fieldAgent = await prisma.staff.create({
      data: {
        code: `FA-R6-${timestamp}`,
        name: 'Field Agent R6',
        email: `fa_r6_${timestamp}@laboura.local`,
        passwordHash,
        role: 'field_agent',
        city: 'Bengaluru',
      },
    });

    const finance = await prisma.staff.create({
      data: {
        code: `FI-R6-${timestamp}`,
        name: 'Finance R6',
        email: `fi_r6_${timestamp}@laboura.local`,
        passwordHash,
        role: 'finance',
        city: 'Bengaluru',
      },
    });

    const server = app.getHttpServer();
    const login = async (email: string) => {
      const res = await enrolledLogin(server, { email, password });
      return res.body.accessToken;
    };

    ceoToken = await login(ceo.email);
    managerToken = await login(manager.email);
    callAgentToken = await login(callAgent.email);
    fieldAgentToken = await login(fieldAgent.email);
    financeToken = await login(finance.email);

    const jsActive = await prisma.jobSeeker.create({
      data: {
        code: `JS-RBAC-${timestamp}`,
        name: 'RBAC Active Worker',
        phone: `98${timestamp.toString().slice(-8)}`,
        phoneVerified: true,
        tradeSkill: 'Electrician',
        minSalary: 1800000,
        maxSalary: 2500000,
        preferredCallWindowStart: '09:00',
        preferredCallWindowEnd: '18:00',
        status: 'active',
        hitCount: 0,
        city: 'Bengaluru',
      },
    });
    testJobSeekerId = jsActive.id;

    const jsDeact = await prisma.jobSeeker.create({
      data: {
        code: `JS-RBAC-D-${timestamp}`,
        name: 'RBAC Deactivated Worker',
        phone: `99${timestamp.toString().slice(-8)}`,
        phoneVerified: true,
        tradeSkill: 'Plumber',
        minSalary: 1500000,
        maxSalary: 2200000,
        preferredCallWindowStart: '09:00',
        preferredCallWindowEnd: '18:00',
        status: 'deactivated',
        hitCount: 3,
        city: 'Bengaluru',
      },
    });
    deactivatedJobSeekerId = jsDeact.id;
  });

  afterAll(async () => {
    if (prisma) {
      await prisma.contactAttempt.deleteMany({
        where: { jobSeekerId: testJobSeekerId },
      });
      await prisma.jobSeekerHit.deleteMany({
        where: { jobSeekerId: { in: [testJobSeekerId, deactivatedJobSeekerId] } },
      });
      await prisma.payment.deleteMany({
        where: { jobSeekerId: { in: [testJobSeekerId, deactivatedJobSeekerId] } },
      });
      await prisma.auditLog.deleteMany({
        where: {
          entityCode: { in: [`JS-RBAC-${timestamp}`, `JS-RBAC-D-${timestamp}`] },
        },
      });
      await prisma.jobSeeker.deleteMany({
        where: { id: { in: [testJobSeekerId, deactivatedJobSeekerId] } },
      });
      await prisma.staff.deleteMany({
        where: {
          code: {
            in: [
              `CEO-R6-${timestamp}`,
              `MGR-R6-${timestamp}`,
              `CA-R6-${timestamp}`,
              `FA-R6-${timestamp}`,
              `FI-R6-${timestamp}`,
            ],
          },
        },
      });
    }
    if (app) {
      await app.close();
    }
  });

  describe('Field Agent and Finance Access Denial', () => {
    it('Field agent is denied POST contact attempts, hits, and reactivate (403)', async () => {
      const attRes = await request(app.getHttpServer())
        .post(`/job-seekers/${testJobSeekerId}/contact-attempts`)
        .set('Authorization', `Bearer ${fieldAgentToken}`)
        .send({
          channel: 'call',
          outcome: 'no_pickup',
          timeOfDay: 'am',
        });
      expect(attRes.status).toBe(403);

      const hitRes = await request(app.getHttpServer())
        .post(`/job-seekers/${testJobSeekerId}/hits`)
        .set('Authorization', `Bearer ${fieldAgentToken}`)
        .send({
          reason: 'offer_rejected',
        });
      expect(hitRes.status).toBe(403);

      const reactRes = await request(app.getHttpServer())
        .post(`/job-seekers/${deactivatedJobSeekerId}/reactivate`)
        .set('Authorization', `Bearer ${fieldAgentToken}`);
      expect(reactRes.status).toBe(403);
    });

    it('Finance is denied POST contact attempts, hits, and reactivate (403)', async () => {
      const attRes = await request(app.getHttpServer())
        .post(`/job-seekers/${testJobSeekerId}/contact-attempts`)
        .set('Authorization', `Bearer ${financeToken}`)
        .send({
          channel: 'call',
          outcome: 'no_pickup',
          timeOfDay: 'am',
        });
      expect(attRes.status).toBe(403);

      const hitRes = await request(app.getHttpServer())
        .post(`/job-seekers/${testJobSeekerId}/hits`)
        .set('Authorization', `Bearer ${financeToken}`)
        .send({
          reason: 'offer_rejected',
        });
      expect(hitRes.status).toBe(403);

      const reactRes = await request(app.getHttpServer())
        .post(`/job-seekers/${deactivatedJobSeekerId}/reactivate`)
        .set('Authorization', `Bearer ${financeToken}`);
      expect(reactRes.status).toBe(403);
    });

    it('Call Agent, Manager, and CEO are permitted to record contact attempts and hits', async () => {
      // Call agent logs attempt
      const caAtt = await request(app.getHttpServer())
        .post(`/job-seekers/${testJobSeekerId}/contact-attempts`)
        .set('Authorization', `Bearer ${callAgentToken}`)
        .send({
          channel: 'call',
          outcome: 'picked_up',
          timeOfDay: 'am',
        });
      expect(caAtt.status).toBe(201);

      // Manager logs hit
      const mgrHit = await request(app.getHttpServer())
        .post(`/job-seekers/${testJobSeekerId}/hits`)
        .set('Authorization', `Bearer ${managerToken}`)
        .send({
          reason: 'offer_rejected',
          note: 'Rejected offer verified by manager',
        });
      expect(mgrHit.status).toBe(201);

      // CEO reactivates
      const ceoReact = await request(app.getHttpServer())
        .post(`/job-seekers/${deactivatedJobSeekerId}/reactivate`)
        .set('Authorization', `Bearer ${ceoToken}`);
      expect(ceoReact.status).toBe(201);
    });
  });

  describe('Phase 3 Extended Seed Data Verification', () => {
    it('verifies seeded job seeker with 1 hit (JS-00004)', async () => {
      const js = await prisma.jobSeeker.findUnique({
        where: { code: 'JS-00004' },
        include: { hits: true },
      });
      expect(js).toBeDefined();
      expect(js?.hitCount).toBe(1);
      expect(js?.status).toBe('active');
      expect(js?.hits).toHaveLength(1);
    });

    it('verifies seeded job seeker with 2 hits (JS-00005)', async () => {
      const js = await prisma.jobSeeker.findUnique({
        where: { code: 'JS-00005' },
        include: { hits: true },
      });
      expect(js).toBeDefined();
      expect(js?.hitCount).toBe(2);
      expect(js?.status).toBe('active');
      expect(js?.hits).toHaveLength(2);
    });

    it('verifies seeded deactivated job seeker with 3 hits (JS-00006)', async () => {
      const js = await prisma.jobSeeker.findUnique({
        where: { code: 'JS-00006' },
        include: { hits: true },
      });
      expect(js).toBeDefined();
      expect(js?.hitCount).toBe(3);
      expect(js?.status).toBe('deactivated');
      expect(js?.hits).toHaveLength(3);
    });

    it('verifies seeded reactivated job seeker (JS-00007)', async () => {
      const js = await prisma.jobSeeker.findUnique({
        where: { code: 'JS-00007' },
        include: { payments: true },
      });
      expect(js).toBeDefined();
      expect(js?.hitCount).toBe(0);
      expect(js?.status).toBe('active');
      const reactPayment = js?.payments.find((p) => p.reactivation);
      expect(reactPayment).toBeDefined();
      expect(reactPayment?.status).toBe('succeeded');
      expect(reactPayment?.amount).toBe(49900);
    });
  });
});
