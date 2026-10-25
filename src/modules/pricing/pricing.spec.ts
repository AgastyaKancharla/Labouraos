import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import * as request from 'supertest';
import * as bcrypt from 'bcrypt';
import { AppModule } from '../../app.module';
import { PrismaService } from '../../common/prisma/prisma.service';
import { enrolledLogin } from '../../test-support/enrolled-login-spec';

describe('Pricing & Policy Module (Phase 6 Task 4)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let ceoToken: string;
  let managerToken: string;
  let caToken: string;

  const timestamp = Date.now();
  const password = 'Password123!';

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
        code: `CEO-PR-${timestamp}`,
        name: 'CEO Pricing',
        email: `ceo_pr_${timestamp}@laboura.local`,
        passwordHash,
        role: 'ceo',
        city: 'Bengaluru',
      },
    });

    const manager = await prisma.staff.create({
      data: {
        code: `MGR-PR-${timestamp}`,
        name: 'Manager Pricing',
        email: `mgr_pr_${timestamp}@laboura.local`,
        passwordHash,
        role: 'manager',
        city: 'Bengaluru',
      },
    });

    const ca = await prisma.staff.create({
      data: {
        code: `CA-PR-${timestamp}`,
        name: 'Call Agent Pricing',
        email: `ca_pr_${timestamp}@laboura.local`,
        passwordHash,
        role: 'call_agent',
        city: 'Bengaluru',
      },
    });

    const ceoLogin = await enrolledLogin(app.getHttpServer(), { email: ceo.email, password })
      .expect(200);
    ceoToken = ceoLogin.body.accessToken;

    const mgrLogin = await enrolledLogin(app.getHttpServer(), { email: manager.email, password })
      .expect(200);
    managerToken = mgrLogin.body.accessToken;

    const caLogin = await enrolledLogin(app.getHttpServer(), { email: ca.email, password })
      .expect(200);
    caToken = caLogin.body.accessToken;
  });

  afterAll(async () => {
    if (app) {
      await app.close();
    }
  });

  it('allows CEO and Manager to read pricing & policy (GET /pricing)', async () => {
    const resCeo = await request(app.getHttpServer())
      .get('/pricing')
      .set('Authorization', `Bearer ${ceoToken}`)
      .expect(200);

    expect(resCeo.body.activationFeePaise).toBe(49900);
    expect(resCeo.body.placementFeePercent).toBe(50);
    expect(resCeo.body.gstPercent).toBe(18);
    expect(resCeo.body.referralPayoutPaise).toBe(20000);

    const resMgr = await request(app.getHttpServer())
      .get('/pricing')
      .set('Authorization', `Bearer ${managerToken}`)
      .expect(200);

    expect(resMgr.body.activationFeePaise).toBe(49900);
  });

  it('denies Call Agent reading pricing (GET /pricing -> 403 Forbidden)', async () => {
    await request(app.getHttpServer())
      .get('/pricing')
      .set('Authorization', `Bearer ${caToken}`)
      .expect(403);
  });

  it('allows CEO to update pricing & policy (POST /pricing), audit logging pricing_change', async () => {
    const updateRes = await request(app.getHttpServer())
      .post('/pricing')
      .set('Authorization', `Bearer ${ceoToken}`)
      .send({
        referralPayoutPaise: 20000,
        replacementSearchDays: 15,
      })
      .expect(201);

    expect(updateRes.body.referralPayoutPaise).toBe(20000);
    expect(updateRes.body.replacementSearchDays).toBe(15);

    const audit = await prisma.auditLog.findFirst({
      where: {
        entityType: 'pricing',
        action: 'pricing_change',
      },
      orderBy: { createdAt: 'desc' },
    });
    expect(audit).toBeDefined();
    expect(audit?.action).toBe('pricing_change');
  });

  it('denies Manager updating pricing (POST /pricing -> 403 Forbidden)', async () => {
    await request(app.getHttpServer())
      .post('/pricing')
      .set('Authorization', `Bearer ${managerToken}`)
      .send({
        referralPayoutPaise: 25000,
      })
      .expect(403);
  });
});
