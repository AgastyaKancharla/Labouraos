import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import * as request from 'supertest';
import { AppModule } from '../../app.module';
import { PrismaService } from '../prisma/prisma.service';
import { CustomerTokenService } from './customer-token.service';

jest.setTimeout(120000);

/**
 * Against the real application and database: customer tokens open only the
 * customer API, staff tokens open only staff routes (customer app proposal
 * 8.1: "A customer key is refused by every staff screen and the other way round").
 */
describe('Customer and staff realms never accept each other\'s tokens', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let staffJwt: JwtService;
  let customerTokens: CustomerTokenService;
  const stamp = `${Date.now()}`;
  const phone = `+9198${stamp.slice(-8)}`;
  let accountId: string;
  let sessionId: string;
  let ceoId: string;

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);
    staffJwt = app.get(JwtService);
    customerTokens = app.get(CustomerTokenService);

    const ceo = await prisma.staff.create({
      data: {
        code: `CEO-REALM-${stamp}`,
        name: 'Realm check CEO',
        email: `realm.${stamp}@laboura.local`,
        passwordHash: 'hash',
        role: 'ceo',
        status: 'active',
      },
    });
    ceoId = ceo.id;
    const account = await prisma.customerAccount.create({
      data: { phone, phoneVerifiedAt: new Date(), createdVia: 'phone', language: 'kn' },
    });
    accountId = account.id;
    const session = await prisma.customerSession.create({
      data: {
        accountId,
        refreshTokenHash: customerTokens.hashRefreshToken(`realm-${stamp}`),
        signedInWith: 'phone',
        expiresAt: new Date(Date.now() + 90 * 86_400_000),
      },
    });
    sessionId = session.id;
  });

  afterAll(async () => {
    await prisma.customerAccount.deleteMany({ where: { id: accountId } });
    await prisma.staff.deleteMany({ where: { id: ceoId } });
    await app.close();
  });

  const staffToken = () => staffJwt.sign({ sub: ceoId, email: `realm.${stamp}@laboura.local`, role: 'ceo', code: `CEO-REALM-${stamp}` });
  const customerToken = () => customerTokens.signAccess(accountId, sessionId).accessToken;

  it('a customer token opens the customer API and shows only that account', async () => {
    const res = await request(app.getHttpServer())
      .get('/customer-api/v1/me')
      .set('Accept', 'application/json')
      .set('Authorization', `Bearer ${customerToken()}`)
      .expect(200);
    expect(res.body).toEqual(expect.objectContaining({ id: accountId, phone, language: 'kn', profiles: [] }));
  });

  it('a customer token is refused by staff routes', async () => {
    await request(app.getHttpServer())
      .get('/notifications/bell')
      .set('Accept', 'application/json')
      .set('Authorization', `Bearer ${customerToken()}`)
      .expect(401);
  });

  it('a staff token works on staff routes but is refused by the customer API', async () => {
    await request(app.getHttpServer())
      .get('/notifications/bell')
      .set('Accept', 'application/json')
      .set('Authorization', `Bearer ${staffToken()}`)
      .expect(200);
    const res = await request(app.getHttpServer())
      .get('/customer-api/v1/me')
      .set('Accept', 'application/json')
      .set('Authorization', `Bearer ${staffToken()}`)
      .expect(401);
    expect(res.body.code).toBe('CUSTOMER_TOKEN_INVALID');
  });

  it('no token, or a signed-out session, is refused', async () => {
    const none = await request(app.getHttpServer()).get('/customer-api/v1/me').set('Accept', 'application/json').expect(401);
    expect(none.body.code).toBe('CUSTOMER_TOKEN_MISSING');
    const token = customerToken();
    await prisma.customerSession.update({ where: { id: sessionId }, data: { revokedAt: new Date(), endedReason: 'sign_out' } });
    const ended = await request(app.getHttpServer())
      .get('/customer-api/v1/me')
      .set('Accept', 'application/json')
      .set('Authorization', `Bearer ${token}`)
      .expect(401);
    expect(ended.body.code).toBe('CUSTOMER_SESSION_ENDED');
  });
});
