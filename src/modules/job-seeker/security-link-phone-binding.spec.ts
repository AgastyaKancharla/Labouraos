import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as request from 'supertest';
import { randomUUID } from 'node:crypto';
import { AppModule } from '../../app.module';
import { PrismaService } from '../../common/prisma/prisma.service';
import { PublicLinkStoreService } from '../../common/public-link-store.service';
import { OtpService } from '../../common/otp/otp.service';
import { MockOtpProvider } from '../../common/otp/mock-otp.provider';

/**
 * Security follow-up: a registration-type link is bound to the number it was
 * sent to. A link saved without a phone used to skip that binding
 * (`isVerified(requestId, link.phone ?? '')`); now it opens nothing, and an
 * empty phone never matches a verified code.
 */
describe('Security: a person\'s own link without a phone opens nothing', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let links: PublicLinkStoreService;
  const linkIds: string[] = [];
  const expiresAt = () => new Date(Date.now() + 24 * 60 * 60 * 1000);

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);
    links = app.get(PublicLinkStoreService);
  });

  afterAll(async () => {
    try {
      await prisma.publicLink.deleteMany({ where: { id: { in: linkIds } } }).catch(() => undefined);
    } finally {
      await app?.close();
    }
  });

  async function phoneless(purpose: 'registration' | 'referral_registration' | 'business_agreement', subjectType: string) {
    const link = await links.create({ purpose, subjectType, subjectId: randomUUID(), expiresAt: expiresAt() });
    linkIds.push(link.id);
    return link.token;
  }

  it('job seeker registration: refused even with a verified code', async () => {
    const token = await phoneless('registration', 'job_seeker');
    const otp = app.get(OtpService);
    const sent = await otp.sendPublicPageOtp('+919876500001', token);
    await otp.verifyOtp(sent.requestId, (otp.getProvider() as MockOtpProvider).getCode(sent.requestId)!);
    expect((await request(app.getHttpServer()).get(`/registration/${token}/status`).query({ requestId: sent.requestId })).status).toBe(400);
    expect(await otp.isVerified(sent.requestId, '', `x`)).toBe(false);
  });

  it('referral partner registration: refused', async () => {
    const token = await phoneless('referral_registration', 'referral');
    expect((await request(app.getHttpServer()).get(`/referral-registration/${token}/status`)).status).toBe(400);
    expect((await request(app.getHttpServer()).get(`/consent/${token}`)).status).toBe(400);
  });

  it('business agreement link: refused', async () => {
    const token = await phoneless('business_agreement', 'business');
    expect((await request(app.getHttpServer()).get(`/consent/${token}`)).status).toBe(400);
  });
});
