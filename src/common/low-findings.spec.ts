import { ForbiddenException, INestApplication, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import * as request from 'supertest';
import { randomUUID } from 'crypto';
import { safeRoutePath } from './observability/global-exception.filter';
import { UpiCollectionService } from '../modules/payment/upi-collection.service';
import { RecordingCopyJob } from '../modules/call/recording-copy.job';
import { PrismaService } from './prisma/prisma.service';
import { AppModule } from '../app.module';
import { STAFF_PHOTO_MAX_BYTES } from './upload-limits';

describe('L2: a crash is logged with the route pattern, never the link token', () => {
  it('uses the matched route pattern', () => {
    expect(safeRoutePath({ route: { path: '/registration/:token/id-check' }, path: '/registration/abcDEF0123456789xyz/id-check' })).toBe(
      '/registration/:token/id-check',
    );
  });

  it('without a matched route, drops the query and blanks long id-like parts', () => {
    expect(safeRoutePath({ url: '/app/p/r/9f8e7d6c5b4a39281706f5e4d3c2b1a0?x=1' })).toBe('/app/p/r/:value');
    expect(safeRoutePath({ path: '/health' })).toBe('/health');
  });
});

describe('L8: re-sending a payment link — only Finance, the CEO or the agent who holds the account', () => {
  function service(payment: unknown) {
    const prisma = { payment: { findUnique: jest.fn().mockResolvedValue(payment) } };
    return new UpiCollectionService(prisma as unknown as PrismaService, {} as never, {} as never);
  }

  it('lets the business\'s account agent and the agent who registered the job seeker through', async () => {
    await expect(service({ business: { accountAgentId: 'fa-1', leadCreatedByStaffId: null }, jobSeeker: null }).assertAccountAgentForPayment('p1', 'fa-1')).resolves.toBeUndefined();
    await expect(service({ business: null, jobSeeker: { registeredByStaffId: 'ca-1' } }).assertAccountAgentForPayment('p1', 'ca-1')).resolves.toBeUndefined();
  });

  it('refuses any other agent, and answers 404 for an unknown payment', async () => {
    await expect(service({ business: { accountAgentId: 'fa-1', leadCreatedByStaffId: 'ca-9' }, jobSeeker: null }).assertAccountAgentForPayment('p1', 'fa-2')).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service(null).assertAccountAgentForPayment('p1', 'fa-1')).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('L14: queueing a recording copy gives up instead of hanging when Redis is down', () => {
  const saved = { port: process.env.REDIS_PORT, timeout: process.env.REDIS_CONNECT_TIMEOUT_MS };
  afterAll(() => {
    if (saved.port === undefined) delete process.env.REDIS_PORT;
    else process.env.REDIS_PORT = saved.port;
    if (saved.timeout === undefined) delete process.env.REDIS_CONNECT_TIMEOUT_MS;
    else process.env.REDIS_CONNECT_TIMEOUT_MS = saved.timeout;
  });

  it('rejects within a few seconds', async () => {
    process.env.REDIS_PORT = '1';
    process.env.REDIS_CONNECT_TIMEOUT_MS = '300';
    const job = new RecordingCopyJob({} as PrismaService, {} as never, {} as never);
    const started = Date.now();
    await expect(job.schedule('call-1', 'https://vendor/rec.mp3')).rejects.toThrow(/did not answer/);
    expect(Date.now() - started).toBeLessThan(9000);
  }, 15000);
});

describe('L1 and L10 over HTTP', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let jwt: JwtService;
  const staffIds: string[] = [];
  const seekerIds: string[] = [];

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);
    jwt = app.get(JwtService);
  });

  afterAll(async () => {
    await prisma.jobSeeker.deleteMany({ where: { id: { in: seekerIds } } });
    await prisma.staff.deleteMany({ where: { id: { in: staffIds } } });
    await app.close();
  });

  it('L10: a login with a wrong type answers 401, not a 500 and an alert', async () => {
    const res = await request(app.getHttpServer()).post('/auth/login').set('X-Forwarded-For', '198.51.100.201').send({ staffCode: 5, password: ['x'], deviceId: 7 });
    expect(res.status).toBe(401);
    const code = await request(app.getHttpServer()).post('/auth/login/verify-code').set('X-Forwarded-For', '198.51.100.202').send({ loginRequestId: 5, code: 123456 });
    expect(code.status).toBe(401);
  });

  it('L1: a staff photo upload above 5 MB is refused before it is kept', async () => {
    const suffix = randomUUID().replace(/-/g, '').slice(0, 8).toUpperCase();
    const agent = await prisma.staff.create({
      data: { code: `L1-CA-${suffix}`, name: 'L1 agent', email: `l1_${suffix}@laboura.local`, passwordHash: await bcrypt.hash('L1-Password-123!', 4), role: 'call_agent', status: 'active' },
    });
    staffIds.push(agent.id);
    const seeker = await prisma.jobSeeker.create({
      data: {
        code: `JS-L1-${suffix}`,
        name: 'L1 seeker',
        phone: `+9191${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`,
        minSalary: 1600000,
        maxSalary: 2600000,
        preferredCallWindowStart: '09:00',
        preferredCallWindowEnd: '18:00',
        status: 'active',
        registeredByStaffId: agent.id,
      },
    });
    seekerIds.push(seeker.id);
    const token = jwt.sign({ sub: agent.id, role: agent.role, code: agent.code, email: agent.email });
    const res = await request(app.getHttpServer())
      .post(`/job-seekers/${seeker.id}/photo`)
      .set('Authorization', `Bearer ${token}`)
      .attach('photo', Buffer.alloc(STAFF_PHOTO_MAX_BYTES + 1024, 1), 'big.jpg');
    expect(res.status).toBe(413);
  });
});
