import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import * as request from 'supertest';
import * as bcrypt from 'bcrypt';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/common/prisma/prisma.service';
import { enrolledLogin } from '../src/test-support/enrolled-login-spec';

describe('End-to-End Walking Skeleton (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let callAgentId: string;

  const agentEmail = `walking_skeleton_e2e_${Date.now()}@laboura.local`;
  const plainPassword = 'Password123!Secure';

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();

    prisma = app.get<PrismaService>(PrismaService);

    // Seed call agent
    const passwordHash = await bcrypt.hash(plainPassword, 10);
    const agent = await prisma.staff.create({
      data: {
        code: `CA-E2E-${Date.now()}`,
        name: 'Seeded Call Agent E2E',
        email: agentEmail,
        passwordHash,
        role: 'call_agent',
        area: 'Indiranagar',
        city: 'Bengaluru',
      },
    });
    callAgentId = agent.id;

    // Ensure job seeker table is clear
    await prisma.jobSeeker.deleteMany({});
  });

  beforeEach(async () => {
    await prisma.jobSeeker.deleteMany({});
  });

  afterAll(async () => {
    if (callAgentId) {
      await prisma.staff.delete({ where: { id: callAgentId } });
    }
    if (app) {
      await app.close();
    }
  });

  it('login -> GET /job-seekers -> empty list -> GET /payments -> 403', async () => {
    const server = app.getHttpServer();

    // 1. Seeded call agent logs in via POST /auth/login
    const loginRes = await enrolledLogin(server, {
        email: agentEmail,
        password: plainPassword,
      });

    expect(loginRes.status).toBe(200);
    expect(loginRes.body.accessToken).toBeDefined();
    const token = loginRes.body.accessToken;

    // 2. Calls GET /job-seekers with token -> receives empty list
    const jobSeekersRes = await request(server)
      .get('/job-seekers')
      .set('Authorization', `Bearer ${token}`);

    expect(jobSeekersRes.status).toBe(200);
    expect(Array.isArray(jobSeekersRes.body)).toBe(true);
    expect(jobSeekersRes.body).toHaveLength(0);

    // 3. The exact same call to GET /payments with that token returns 403 Forbidden
    const paymentsRes = await request(server)
      .get('/payments')
      .set('Authorization', `Bearer ${token}`);

    expect(paymentsRes.status).toBe(403);
  });
});
