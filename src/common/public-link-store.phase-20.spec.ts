import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { createHash } from 'node:crypto';
import { AppModule } from '../app.module';
import { PrismaService } from './prisma/prisma.service';
import { PublicLinkStoreService } from './public-link-store.service';
import { RealOtpProvider } from './otp/real-otp.provider';

describe('Phase 20 Task 1: restart-safe public links and real OTP sessions', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const linkIds: string[] = [];
  const otpRequestIds: string[] = [];
  const callRoutingKey = process.env.CALL_ROUTING_KEY;
  const payoutAccountKey = process.env.PAYOUT_ACCOUNT_KEY;

  const startApp = async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    const nextApp = moduleRef.createNestApplication();
    await nextApp.init();
    return nextApp;
  };

  beforeAll(async () => {
    process.env.CALL_ROUTING_KEY = 'phase20_call_routing_secret_key_32_chars_min!';
    process.env.PAYOUT_ACCOUNT_KEY = 'phase20_payout_account_secret_key_32_chars_min!';
    process.env.PUBLIC_APP_URL = 'https://app.laboura.in';
    app = await startApp();
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    try {
      if (prisma) {
        await prisma.publicLink.deleteMany({ where: { id: { in: linkIds } } }).catch(() => {});
        await prisma.otpSession.deleteMany({ where: { requestId: { in: otpRequestIds } } }).catch(() => {});
      }
    } finally {
      if (app) await app.close();
      if (callRoutingKey === undefined) delete process.env.CALL_ROUTING_KEY;
      else process.env.CALL_ROUTING_KEY = callRoutingKey;
      if (payoutAccountKey === undefined) delete process.env.PAYOUT_ACCOUNT_KEY;
      else process.env.PAYOUT_ACCOUNT_KEY = payoutAccountKey;
    }
  });

  it('opens a link created before app shutdown and stores only its hash and encrypted phone', async () => {
    const store = app.get(PublicLinkStoreService);
    const secretPhone = '+919876543210';
    const created = await store.create({
      purpose: 'registration',
      subjectType: 'job_seeker',
      subjectId: `phase20-${Date.now()}`,
      phone: secretPhone,
      expiresAt: new Date(Date.now() + 60_000),
    });
    const row = await prisma.publicLink.findUnique({ where: { tokenHash: createHash('sha256').update(created.token).digest('hex') } });
    expect(row).toBeTruthy();
    if (!row) throw new Error('PublicLink row was not created');
    linkIds.push(row.id);
    expect(JSON.stringify(row)).not.toContain(created.token);
    expect(JSON.stringify(row)).not.toContain(secretPhone);
    expect(row.tokenHash).toBe(createHash('sha256').update(created.token).digest('hex'));

    await app.close();
    app = await startApp();
    prisma = app.get(PrismaService);
    const reopened = await app.get(PublicLinkStoreService).findByToken(created.token);
    expect(reopened.subjectId).toBe(row.subjectId);
    expect(reopened.phone).toBe(secretPhone);
  });

  it('refuses expired, used, and revoked links', async () => {
    const store = app.get(PublicLinkStoreService);
    const expired = await store.create({ purpose: 'registration', subjectType: 'job_seeker', subjectId: 'expired', expiresAt: new Date(Date.now() - 1) });
    const used = await store.create({ purpose: 'registration', subjectType: 'job_seeker', subjectId: 'used', expiresAt: new Date(Date.now() + 60_000) });
    const revoked = await store.create({ purpose: 'registration', subjectType: 'job_seeker', subjectId: 'revoked', expiresAt: new Date(Date.now() + 60_000) });
    const hashes = [expired, used, revoked].map(({ token }) => createHash('sha256').update(token).digest('hex'));
    const rows = await prisma.publicLink.findMany({ where: { tokenHash: { in: hashes } }, select: { id: true } });
    linkIds.push(...rows.map(({ id }) => id));
    await store.markUsed(used.token);
    await store.revoke(revoked.token);
    await expect(store.findByToken(expired.token)).rejects.toThrow('Public link has expired');
    await expect(store.findByToken(used.token)).rejects.toThrow('Public link has already been used');
    await expect(store.findByToken(revoked.token)).rejects.toThrow('Public link has been revoked');
  });

  it('verifies a real OTP session with a second provider instance using the database', async () => {
    const now = new Date('2026-11-09T06:00:00.000Z');
    const fetchFn: typeof fetch = async (input) => {
      const url = String(input);
      return {
        ok: true,
        status: 200,
        json: async () => url.includes('/otp/verify')
          ? { type: 'success', message: 'OTP verified success' }
          : { request_id: `phase20-${Date.now()}` },
        text: async () => '',
      } as Response;
    };
    const sender = new RealOtpProvider({ fetchFn, timeProvider: () => now });
    sender.setPrismaService(prisma);
    const { requestId } = await sender.sendOtp('+919876543210');
    otpRequestIds.push(requestId);
    const session = await prisma.otpSession.findUnique({ where: { requestId } });
    expect(session).toBeTruthy();
    expect(JSON.stringify(session)).not.toContain('+919876543210');

    await app.close();
    app = await startApp();
    prisma = app.get(PrismaService);
    const verifier = new RealOtpProvider({ fetchFn, timeProvider: () => now });
    verifier.setPrismaService(prisma);
    expect(await verifier.verifyOtp(requestId, '123456')).toBe(true);
    expect(await verifier.isVerified(requestId, '+919876543210')).toBe(true);
  });
});
