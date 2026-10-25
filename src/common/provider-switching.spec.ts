import { Test, TestingModule } from '@nestjs/testing';
import { OTP_PROVIDER } from './otp/otp.interface';
import { MockOtpProvider } from './otp/mock-otp.provider';
import { RealOtpProvider } from './otp/real-otp.provider';
import { OtpModule } from './otp/otp.module';

import { PAYMENT_PROVIDER } from '../modules/payment/payment-provider.interface';
import { MockPaymentProvider } from '../modules/payment/mock-payment.provider';
import { RealPaymentProvider } from '../modules/payment/real-payment.provider';
import { PaymentModule } from '../modules/payment/payment.module';

import { KYC_PROVIDER } from './kyc/kyc.interface';
import { MockKycProvider } from './kyc/mock-kyc.provider';
import { RealKycProvider } from './kyc/real-kyc.provider';
import { KycModule } from './kyc/kyc.module';

import { TELEPHONY_PROVIDER } from '../modules/telephony/telephony.interface';
import { MockTelephonyProvider } from '../modules/telephony/mock-telephony.provider';
import { RealTelephonyProvider } from '../modules/telephony/real-telephony.provider';
import { TelephonyModule } from '../modules/telephony/telephony.module';

import { WHATSAPP_PROVIDER } from './whatsapp/whatsapp.interface';
import { MockWhatsAppProvider } from './whatsapp/mock-whatsapp.provider';
import { RealWhatsAppProvider } from './whatsapp/real-whatsapp.provider';
import { WhatsAppModule } from './whatsapp/whatsapp.module';

import { PrismaModule } from './prisma/prisma.module';
import { AuditModule } from './audit/audit.module';
import { IdModule } from './id/id.module';

describe('Provider Switching and Config (Task 1)', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    delete process.env.OTP_PROVIDER_MODE;
    delete process.env.OTP_PROVIDER;
    delete process.env.PAYMENT_PROVIDER_MODE;
    delete process.env.PAYMENT_PROVIDER;
    delete process.env.KYC_PROVIDER_MODE;
    delete process.env.KYC_PROVIDER;
    delete process.env.TELEPHONY_PROVIDER_MODE;
    delete process.env.TELEPHONY_PROVIDER;
    delete process.env.WHATSAPP_PROVIDER_MODE;
    delete process.env.WHATSAPP_PROVIDER;
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  describe('Defaulting to Mock when mode env var is unset', () => {
    let moduleRef: TestingModule;

    beforeAll(async () => {
      moduleRef = await Test.createTestingModule({
        imports: [
          PrismaModule,
          AuditModule,
          IdModule,
          OtpModule,
          PaymentModule,
          KycModule,
          TelephonyModule,
          WhatsAppModule,
        ],
      }).compile();
    });

    afterAll(async () => {
      await moduleRef.close();
    });

    it('injects MockOtpProvider when OTP_PROVIDER_MODE is unset', () => {
      const provider = moduleRef.get(OTP_PROVIDER);
      expect(provider).toBeInstanceOf(MockOtpProvider);
    });

    it('injects MockPaymentProvider when PAYMENT_PROVIDER_MODE is unset', () => {
      const provider = moduleRef.get(PAYMENT_PROVIDER);
      expect(provider).toBeInstanceOf(MockPaymentProvider);
    });

    it('injects MockKycProvider when KYC_PROVIDER_MODE is unset', () => {
      const provider = moduleRef.get(KYC_PROVIDER);
      expect(provider).toBeInstanceOf(MockKycProvider);
    });

    it('injects MockTelephonyProvider when TELEPHONY_PROVIDER_MODE is unset', () => {
      const provider = moduleRef.get(TELEPHONY_PROVIDER);
      expect(provider).toBeInstanceOf(MockTelephonyProvider);
    });

    it('injects MockWhatsAppProvider when WHATSAPP_PROVIDER_MODE is unset', () => {
      const provider = moduleRef.get(WHATSAPP_PROVIDER);
      expect(provider).toBeInstanceOf(MockWhatsAppProvider);
    });
  });

  describe('Switching to Real when mode env var is set to real', () => {
    let moduleRef: TestingModule;

    beforeAll(async () => {
      process.env.OTP_PROVIDER_MODE = 'real';
      process.env.PAYMENT_PROVIDER_MODE = 'real';
      process.env.KYC_PROVIDER_MODE = 'real';
      process.env.TELEPHONY_PROVIDER_MODE = 'real';
      process.env.WHATSAPP_PROVIDER_MODE = 'real';

      moduleRef = await Test.createTestingModule({
        imports: [
          PrismaModule,
          AuditModule,
          IdModule,
          OtpModule,
          PaymentModule,
          KycModule,
          TelephonyModule,
          WhatsAppModule,
        ],
      }).compile();
    });

    afterAll(async () => {
      await moduleRef.close();
      delete process.env.OTP_PROVIDER_MODE;
      delete process.env.PAYMENT_PROVIDER_MODE;
      delete process.env.KYC_PROVIDER_MODE;
      delete process.env.TELEPHONY_PROVIDER_MODE;
      delete process.env.WHATSAPP_PROVIDER_MODE;
    });

    it('injects RealOtpProvider when OTP_PROVIDER_MODE=real', () => {
      const provider = moduleRef.get(OTP_PROVIDER);
      expect(provider).toBeInstanceOf(RealOtpProvider);
    });

    it('injects RealPaymentProvider when PAYMENT_PROVIDER_MODE=real', () => {
      const provider = moduleRef.get(PAYMENT_PROVIDER);
      expect(provider).toBeInstanceOf(RealPaymentProvider);
    });

    it('injects RealKycProvider when KYC_PROVIDER_MODE=real', () => {
      const provider = moduleRef.get(KYC_PROVIDER);
      expect(provider).toBeInstanceOf(RealKycProvider);
    });

    it('injects RealTelephonyProvider when TELEPHONY_PROVIDER_MODE=real', () => {
      const provider = moduleRef.get(TELEPHONY_PROVIDER);
      expect(provider).toBeInstanceOf(RealTelephonyProvider);
    });

    it('injects RealWhatsAppProvider when WHATSAPP_PROVIDER_MODE=real', () => {
      const provider = moduleRef.get(WHATSAPP_PROVIDER);
      expect(provider).toBeInstanceOf(RealWhatsAppProvider);
    });
  });
});
