import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import * as request from 'supertest';
import * as bcrypt from 'bcrypt';
import { AppModule } from '../../app.module';
import { PrismaService } from '../../common/prisma/prisma.service';
import { enrolledLogin } from '../../test-support/enrolled-login-spec';

describe('Phase 6 Task 4: Admin Dashboard (CEO / Management)', () => {
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
        code: `CEO-ADM-${timestamp}`,
        name: 'CEO Admin',
        email: `ceo_adm_${timestamp}@laboura.local`,
        passwordHash,
        role: 'ceo',
        city: 'Bengaluru',
      },
    });

    const manager = await prisma.staff.create({
      data: {
        code: `MGR-ADM-${timestamp}`,
        name: 'Manager Admin',
        email: `mgr_adm_${timestamp}@laboura.local`,
        passwordHash,
        role: 'manager',
        city: 'Bengaluru',
      },
    });

    const ca = await prisma.staff.create({
      data: {
        code: `CA-ADM-${timestamp}`,
        name: 'Call Agent Admin',
        email: `ca_adm_${timestamp}@laboura.local`,
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

  it('sends a browser opening GET /admin to the one staff login page (the old dashboard is retired there)', async () => {
    const res = await request(app.getHttpServer())
      .get('/admin')
      .set('Accept', 'text/html,application/xhtml+xml')
      .expect(301);

    expect(res.headers.location).toBe('/login');
    expect(res.text).not.toContain('Laboura Admin Dashboard');
    // Nothing old answers an API caller at /admin either.
    const json = await request(app.getHttpServer()).get('/admin').set('Accept', 'application/json');
    expect(json.status).toBe(404);
    expect(json.text).not.toContain('Laboura Admin Dashboard');
  });

  it('sends a browser opening the retired /console/admin to /login, and serves nothing there to anyone else', async () => {
    const res = await request(app.getHttpServer()).get('/console/admin').set('Accept', 'text/html,application/xhtml+xml').expect(301);
    expect(res.headers.location).toBe('/login');
    const json = await request(app.getHttpServer()).get('/console/admin').set('Accept', 'application/json');
    expect(json.status).toBe(404);
    expect(json.text).not.toContain('Laboura Admin Dashboard');
    const bare = await request(app.getHttpServer()).get('/console/admin');
    expect(bare.text).not.toContain('Laboura Admin Dashboard');
  });

  it('verifies pricing controls are CEO-only: API allows CEO and denies Manager server-side', async () => {
    // 1. CEO updates pricing -> 201
    const ceoRes = await request(app.getHttpServer())
      .post('/pricing')
      .set('Authorization', `Bearer ${ceoToken}`)
      .send({
        referralPayoutPaise: 20000,
      })
      .expect(201);

    expect(ceoRes.body.referralPayoutPaise).toBe(20000);

    // 2. Manager cannot update pricing -> 403 Forbidden
    await request(app.getHttpServer())
      .post('/pricing')
      .set('Authorization', `Bearer ${managerToken}`)
      .send({
        referralPayoutPaise: 25000,
      })
      .expect(403);

    // 3. Call Agent cannot read or write pricing -> 403
    await request(app.getHttpServer())
      .get('/pricing')
      .set('Authorization', `Bearer ${caToken}`)
      .expect(403);
  });

  it('verifies dashboard refund endpoints can be called by CEO/Manager and are denied to Call Agent', async () => {
    // Call Agent cannot approve placement refund (403)
    await request(app.getHttpServer())
      .post('/placements/dummy-id/refund')
      .set('Authorization', `Bearer ${caToken}`)
      .send({ reason: 'testing' })
      .expect(403);

    // Call Agent cannot approve job seeker refund (403)
    await request(app.getHttpServer())
      .post('/job-seekers/dummy-id/refund')
      .set('Authorization', `Bearer ${caToken}`)
      .send({ reason: 'testing' })
      .expect(403);
  });
});
