import { createHash, randomUUID } from 'crypto';
import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import * as request from 'supertest';
import { AppModule } from '../../app.module';
import { PrismaService } from '../../common/prisma/prisma.service';
import { OtpService } from '../../common/otp/otp.service';
import { MockOtpProvider } from '../../common/otp/mock-otp.provider';
import { PricingService } from '../pricing/pricing.service';
import { ConsentClock } from './consent-clock';
import {
  AGREEMENT_DOCUMENT_STORAGE,
  MemoryAgreementDocumentStorage,
} from './agreement-document.storage';
import { ConsentLinkService } from './consent-link.service';
import { MessagingService } from '../message/messaging.service';

class AgreementTestClock extends ConsentClock {
  current = new Date('2026-11-05T10:00:00.000Z');

  override now(): Date {
    return new Date(this.current.getTime());
  }

  advance(ms: number) {
    this.current = new Date(this.current.getTime() + ms);
  }
}

describe('Phase 13 Task 4 — business agreement owner OTP', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let jwt: JwtService;
  let otpService: OtpService;
  let pricingService: PricingService;
  let clock: AgreementTestClock;
  let storage: MemoryAgreementDocumentStorage;
  let messagingService: MessagingService;
  let messagingSend: jest.SpyInstance;
  let agentToken: string;
  let staffId: string;
  let businessId: string;
  let ownerPhone: string;
  const suffix = randomUUID().replace(/-/g, '').slice(0, 10).toUpperCase();

  beforeAll(async () => {
    process.env.PUBLIC_APP_URL = 'https://app.laboura.in';
    clock = new AgreementTestClock();
    storage = new MemoryAgreementDocumentStorage();
    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(ConsentClock)
      .useValue(clock)
      .overrideProvider(AGREEMENT_DOCUMENT_STORAGE)
      .useValue(storage)
      .compile();

    app = moduleRef.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);
    jwt = app.get(JwtService);
    otpService = app.get(OtpService);
    pricingService = app.get(PricingService);
    messagingService = app.get(MessagingService);
    messagingSend = jest.spyOn(messagingService, 'send');

    const staff = await prisma.staff.create({
      data: {
        code: `CA-AG-${suffix}`,
        name: 'Agreement Link Agent',
        email: `agreement_agent_${suffix.toLowerCase()}@laboura.local`,
        passwordHash: await bcrypt.hash('Agreement-Test-Password-1', 4),
        role: 'call_agent',
        status: 'active',
        city: 'Bengaluru',
      },
    });
    staffId = staff.id;
    agentToken = jwt.sign({ sub: staff.id, role: staff.role, code: staff.code, email: staff.email });

    ownerPhone = `+9198${suffix.slice(0, 8)}`;
    const business = await prisma.business.create({
      data: {
        code: `BZ-AG-${suffix}`,
        name: `Agreement Business ${suffix}`,
        phone: ownerPhone,
        phoneVerified: true,
        ownerName: 'Owner Test',
        contactRole: 'manager',
        leadCreatedByStaffId: staff.id,
        leadChannel: 'phone_call',
        verificationStatus: 'lead',
      },
    });
    businessId = business.id;
  }, 120000);

  afterAll(async () => {
    if (prisma) {
      await prisma.auditLog.deleteMany({ where: { actorId: staffId } });
      await prisma.consent.deleteMany({ where: { subjectType: 'business', subjectId: businessId } });
      await prisma.businessAgreement.deleteMany({ where: { businessId } });
      await prisma.messageLog.deleteMany({ where: { subjectType: 'business', subjectId: businessId } });
      await prisma.business.deleteMany({ where: { id: businessId } });
      await prisma.staff.deleteMany({ where: { id: staffId } });
      await app.close();
    }
  });

  it('sends fixed PricingPolicy terms and creates one agreement plus both owner consents from OTP', async () => {
    const policyAtSend = await pricingService.current();
    const changedPolicy = {
      ...policyAtSend,
      noBypassMonths: policyAtSend.noBypassMonths + 1,
      noBypassPenaltyPercent: policyAtSend.noBypassPenaltyPercent + 1,
      placementFeePercent: policyAtSend.placementFeePercent + 1,
      gstPercent: policyAtSend.gstPercent + 1,
    };
    const currentSpy = jest.spyOn(pricingService, 'current').mockResolvedValue(policyAtSend);

    const link = await request(app.getHttpServer())
      .post(`/businesses/${businessId}/agreement-links`)
      .set('Authorization', `Bearer ${agentToken}`)
      .send({ language: 'en' })
      .expect(201);
    expect(currentSpy).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(link.body)).not.toContain(ownerPhone);
    const agreementMessage = await prisma.messageLog.findFirst({
      where: { subjectType: 'business', subjectId: businessId, template: 'agreement_link' },
    });
    expect(agreementMessage).not.toBeNull();
    expect(messagingSend).toHaveBeenCalledWith(expect.objectContaining({
      template: 'agreement_link',
      variables: { token: link.body.token, link: `https://app.laboura.in/consent/${link.body.token}` },
    }));

    const page = await request(app.getHttpServer())
      .get(`/consent/${link.body.token}`)
      .set('Accept', 'text/html')
      .expect(200);
    expect(page.text).toContain(`${policyAtSend.placementFeePercent}%`);
    expect(page.text).toContain(`${policyAtSend.gstPercent}%`);

    currentSpy.mockResolvedValue(changedPolicy);
    const otp = await request(app.getHttpServer())
      .post('/consent/send-otp')
      .send({ token: link.body.token })
      .expect(201);
    expect(otp.body.phone).toBe(`******${ownerPhone.replace(/\D/g, '').slice(-4)}`);
    const provider = otpService.getProvider() as MockOtpProvider;
    const code = provider.getCode(otp.body.requestId);
    expect(code).toBeDefined();

    const signed = await request(app.getHttpServer())
      .post('/consent/submit')
      .send({
        token: link.body.token,
        otpRequestId: otp.body.requestId,
        otpCode: code,
        signedName: 'Owner Test',
        purposes: ['agreement_terms', 'call_recording'],
      })
      .expect(201);

    const agreement = await prisma.businessAgreement.findUniqueOrThrow({
      where: { id: signed.body.agreementId },
    });
    expect(agreement).toMatchObject({
      businessId,
      noBypassMonths: policyAtSend.noBypassMonths,
      noBypassPenaltyPercent: policyAtSend.noBypassPenaltyPercent,
      feePercent: policyAtSend.placementFeePercent,
      gstPercent: policyAtSend.gstPercent,
      signedName: 'Owner Test',
      signedPhone: `******${ownerPhone.replace(/\D/g, '').slice(-4)}`,
      signedRole: 'manager',
      otpRequestId: otp.body.requestId,
    });
    expect(agreement.feePercent).not.toBe(changedPolicy.placementFeePercent);
    expect(agreement.gstPercent).not.toBe(changedPolicy.gstPercent);

    const consents = await prisma.consent.findMany({
      where: { subjectType: 'business', subjectId: businessId },
      orderBy: { purpose: 'asc' },
    });
    expect(consents).toHaveLength(2);
    expect(consents.map(({ purpose, method, otpRequestId }) => ({ purpose, method, otpRequestId }))).toEqual([
      { purpose: 'agreement_terms', method: 'sms_link', otpRequestId: otp.body.requestId },
      { purpose: 'call_recording', method: 'sms_link', otpRequestId: otp.body.requestId },
    ]);

    const storedDocument = await storage.get(agreement.documentStoragePath);
    expect(storedDocument).toBeDefined();
    expect(createHash('sha256').update(storedDocument!).digest('hex')).toBe(agreement.termsHash);
    await request(app.getHttpServer()).get(`/consent/${link.body.token}`).expect(400);
    currentSpy.mockRestore();
  });

  it('refuses an OTP from any phone other than the business owner and exposes no staff signing route', async () => {
    const link = await request(app.getHttpServer())
      .post(`/businesses/${businessId}/agreement-links`)
      .set('Authorization', `Bearer ${agentToken}`)
      .send({ language: 'en' })
      .expect(201);
    await request(app.getHttpServer())
      .post(`/businesses/${businessId}/agreements`)
      .set('Authorization', `Bearer ${agentToken}`)
      .send({ signedName: 'Agent', purposes: ['agreement_terms', 'call_recording'] })
      .expect(404);

    const otherPhoneOtp = await otpService.sendOtp('+919700000001');
    const provider = otpService.getProvider() as MockOtpProvider;
    const code = provider.getCode(otherPhoneOtp.requestId);
    await request(app.getHttpServer())
      .post('/consent/submit')
      .send({
        token: link.body.token,
        otpRequestId: otherPhoneOtp.requestId,
        otpCode: code,
        signedName: 'Impostor',
        purposes: ['agreement_terms', 'call_recording'],
      })
      .expect(400);
    expect(await prisma.businessAgreement.count({ where: { businessId } })).toBe(1);
  });

  it('refuses an expired agreement link', async () => {
    const service = app.get(ConsentLinkService);
    service.setTtlMs(1);
    const link = await request(app.getHttpServer())
      .post(`/businesses/${businessId}/agreement-links`)
      .set('Authorization', `Bearer ${agentToken}`)
      .send({ language: 'en' })
      .expect(201);
    clock.advance(2);
    await request(app.getHttpServer()).get(`/consent/${link.body.token}`).expect(400);
    service.setTtlMs(24 * 60 * 60 * 1000);
  });
});
