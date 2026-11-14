import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import * as request from 'supertest';
import { AppModule } from '../../app.module';
import { PrismaService } from '../../common/prisma/prisma.service';
import { CustomerTokenService } from '../../common/customer-auth/customer-token.service';
import { CustomerNotificationService } from './customer-notification.service';
import { CustomerPushSenderService } from './customer-push-sender.service';
import { CustomerNotificationClock } from './customer-notification.clock';
import { CUSTOMER_PUSH_PROVIDER, MockCustomerPushProvider } from './push-provider';

jest.setTimeout(120000);

/**
 * Against the real application and database (CI): the inbox, push token and
 * settings routes work only on the caller's own account, staff tokens are
 * refused, and a notification goes from the inbox through the mock push
 * provider without ever becoming a contact attempt.
 */
describe('Customer app notifications (API and database)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let tokens: CustomerTokenService;
  const stamp = `${Date.now()}`;
  const accounts: { id: string; session: string }[] = [];
  let ceoId: string;
  // 11:00 IST: outside quiet hours whatever day CI runs.
  const at = new Date('2026-11-20T05:30:00.000Z');

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(CustomerNotificationClock)
      .useValue({ now: () => at })
      .compile();
    app = moduleRef.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);
    tokens = app.get(CustomerTokenService);
    for (const n of [1, 2]) {
      const account = await prisma.customerAccount.create({
        data: { phone: `+9197${stamp.slice(-7)}${n}`, phoneVerifiedAt: new Date(), createdVia: 'phone', language: n === 1 ? 'kn' : 'en' },
      });
      const session = await prisma.customerSession.create({
        data: {
          accountId: account.id,
          refreshTokenHash: tokens.hashRefreshToken(`notify-${stamp}-${n}`),
          signedInWith: 'phone',
          expiresAt: new Date(Date.now() + 90 * 86_400_000),
        },
      });
      accounts.push({ id: account.id, session: session.id });
    }
    const ceo = await prisma.staff.create({
      data: { code: `CEO-NTF-${stamp}`, name: 'Notify check CEO', email: `notify.${stamp}@laboura.local`, passwordHash: 'hash', role: 'ceo', status: 'active' },
    });
    ceoId = ceo.id;
  });

  afterAll(async () => {
    const ids = accounts.map((a) => a.id);
    await prisma.messageLog.deleteMany({ where: { subjectType: 'customer_account', subjectId: { in: ids } } });
    await prisma.customerAccount.deleteMany({ where: { id: { in: ids } } });
    await prisma.staff.deleteMany({ where: { id: ceoId } });
    await app.close();
  });

  const bearer = (n: 0 | 1) => `Bearer ${tokens.signAccess(accounts[n].id, accounts[n].session).accessToken}`;
  const api = () => request(app.getHttpServer());

  it('saves my phone\'s push token, and refuses one that is not an Expo token', async () => {
    await api()
      .put('/customer-api/v1/me/device')
      .set('Authorization', bearer(0))
      .send({ installationId: `inst-${stamp}-a`, platform: 'android', appVersion: '1.0.0', pushToken: `ExponentPushToken[e2e-${stamp}-aaaa]`, pushPermission: 'granted' })
      .expect(204);
    const device = await prisma.customerDevice.findFirst({ where: { accountId: accounts[0].id } });
    expect(device).toMatchObject({ pushToken: `ExponentPushToken[e2e-${stamp}-aaaa]`, pushPermission: 'granted', platform: 'android' });
    const bad = await api()
      .put('/customer-api/v1/me/device')
      .set('Authorization', bearer(0))
      .send({ installationId: `inst-${stamp}-a`, platform: 'android', pushToken: 'not-a-token' })
      .expect(400);
    expect(bad.body).toMatchObject({ code: 'VALIDATION_FAILED', field: 'pushToken' });
  });

  it('a notification lands in my inbox in my language, and goes out through the mock push service', async () => {
    const notifications = app.get(CustomerNotificationService);
    const first = await notifications.notify({ accountId: accounts[0].id }, 'refund_approved', {}, { dedupeKey: `e2e-${stamp}` });
    expect(first).toMatchObject({ inbox: 1, queued: 1 });
    await notifications.notify({ accountId: accounts[1].id }, 'payout_paid');

    const provider = app.get<MockCustomerPushProvider>(CUSTOMER_PUSH_PROVIDER);
    expect(provider).toBeInstanceOf(MockCustomerPushProvider);
    const result = await app.get(CustomerPushSenderService).sendDue(at);
    expect(result.sent).toBeGreaterThanOrEqual(1);
    expect(provider.sent.some((m) => m.to === `ExponentPushToken[e2e-${stamp}-aaaa]`)).toBe(true);

    const row = await prisma.customerInboxMessage.findFirst({ where: { accountId: accounts[0].id } });
    expect(row).toMatchObject({ kind: 'refund_approved', language: 'kn', pushStatus: 'sent' });
    const log = await prisma.messageLog.findUnique({ where: { id: row!.messageLogId! } });
    expect(log).toMatchObject({ channel: 'push', status: 'sent', subjectType: 'customer_account', subjectId: accounts[0].id });
    // C17: a push is never a contact attempt.
    expect(await prisma.contactAttempt.count({ where: { messageLogId: log!.id } })).toBe(0);
    // The second account has no phone: inbox only.
    const other = await prisma.customerInboxMessage.findFirst({ where: { accountId: accounts[1].id } });
    expect(other).toMatchObject({ pushStatus: 'none' });
  });

  it('lists only my own inbox', async () => {
    const res = await api().get('/customer-api/v1/me/inbox?limit=10').set('Authorization', bearer(0)).expect(200);
    expect(res.body.unreadCount).toBe(1);
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0]).toMatchObject({ kind: 'refund_approved', category: 'service', deepLink: '/home', readAt: null });
    expect(res.body.items[0].data).not.toHaveProperty('trigger');
  });

  it('marks my message read; someone else\'s message answers 404', async () => {
    const mine = await prisma.customerInboxMessage.findFirstOrThrow({ where: { accountId: accounts[0].id } });
    const theirs = await prisma.customerInboxMessage.findFirstOrThrow({ where: { accountId: accounts[1].id } });
    const refused = await api().post(`/customer-api/v1/me/inbox/${theirs.id}/read`).set('Authorization', bearer(0)).expect(404);
    expect(refused.body.code).toBe('MESSAGE_NOT_FOUND');
    expect((await prisma.customerInboxMessage.findUniqueOrThrow({ where: { id: theirs.id } })).readAt).toBeNull();
    await api().post(`/customer-api/v1/me/inbox/${mine.id}/read`).set('Authorization', bearer(0)).expect(204);
    expect((await prisma.customerInboxMessage.findUniqueOrThrow({ where: { id: mine.id } })).readAt).not.toBeNull();
    await api().post('/customer-api/v1/me/inbox/read-all').set('Authorization', bearer(0)).expect(204);
    expect((await prisma.customerInboxMessage.findUniqueOrThrow({ where: { id: theirs.id } })).readAt).toBeNull();
  });

  it('shows and changes my notification settings', async () => {
    const res = await api().get('/customer-api/v1/me/notification-settings').set('Authorization', bearer(1)).expect(200);
    expect(res.body).toEqual({ service: true, jobUpdates: false, promotions: false, quietStart: '21:00', quietEnd: '09:00', dailyCap: 3, serviceLocked: false });
    const changed = await api().put('/customer-api/v1/me/notification-settings').set('Authorization', bearer(1)).send({ promotions: true }).expect(200);
    expect(changed.body.promotions).toBe(true);
    const bad = await api().put('/customer-api/v1/me/notification-settings').set('Authorization', bearer(1)).send({ service: 'off' }).expect(400);
    expect(bad.body.code).toBe('VALIDATION_FAILED');
  });

  it('stops pushes to my phone when asked', async () => {
    await api()
      .delete('/customer-api/v1/me/device/push-token')
      .set('Authorization', bearer(0))
      .set('X-Laboura-Installation', `inst-${stamp}-a`)
      .expect(204);
    const device = await prisma.customerDevice.findFirst({ where: { accountId: accounts[0].id } });
    expect(device?.pushToken).toBeNull();
  });

  it('refuses staff tokens and missing tokens', async () => {
    const staffJwt = app.get(JwtService);
    const staff = staffJwt.sign({ sub: ceoId, email: `notify.${stamp}@laboura.local`, role: 'ceo', code: `CEO-NTF-${stamp}` });
    const res = await api().get('/customer-api/v1/me/inbox').set('Authorization', `Bearer ${staff}`).expect(401);
    expect(res.body.code).toBe('CUSTOMER_TOKEN_INVALID');
    await api().get('/customer-api/v1/me/notification-settings').expect(401);
  });
});
