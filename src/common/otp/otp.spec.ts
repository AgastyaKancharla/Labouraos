import { Test, TestingModule } from '@nestjs/testing';
import { MockOtpProvider } from './mock-otp.provider';
import { OTP_PROVIDER, OtpProvider } from './otp.interface';
import { OtpModule } from './otp.module';
import { AuthModule } from '../auth/auth.module';
import { OtpService } from './otp.service';

describe('OTP Provider and Mock Implementation', () => {
  describe('MockOtpProvider', () => {
    let provider: MockOtpProvider;
    let mockTime: number;

    beforeEach(() => {
      mockTime = 1700000000000;
      provider = new MockOtpProvider({
        ttlMs: 300000, // 5 minutes
        timeProvider: () => mockTime,
      });
    });

    it('generates a 6-digit code and returns a requestId', async () => {
      const phone = '9876543210';
      const result = await provider.sendOtp(phone);

      expect(result).toBeDefined();
      expect(result.requestId).toBeDefined();
      expect(typeof result.requestId).toBe('string');

      const code = provider.getCode(result.requestId);
      expect(code).toBeDefined();
      expect(code).toMatch(/^\d{6}$/);
    });

    it('verifies successfully with the correct code once', async () => {
      const { requestId } = await provider.sendOtp('9876543210');
      const code = provider.getCode(requestId)!;

      const verified = await provider.verifyOtp(requestId, code);
      expect(verified).toBe(true);

      const isVerified = await provider.isVerified(requestId, '9876543210');
      expect(isVerified).toBe(true);
    });

    it('fails when given a wrong code', async () => {
      const { requestId } = await provider.sendOtp('9876543210');
      const code = provider.getCode(requestId)!;
      const wrongCode = code === '123456' ? '654321' : '123456';

      const verified = await provider.verifyOtp(requestId, wrongCode);
      expect(verified).toBe(false);
    });

    it('rejects reuse of an already-verified code', async () => {
      const { requestId } = await provider.sendOtp('9876543210');
      const code = provider.getCode(requestId)!;

      // First verification succeeds
      const first = await provider.verifyOtp(requestId, code);
      expect(first).toBe(true);

      // Second verification attempt is rejected
      const second = await provider.verifyOtp(requestId, code);
      expect(second).toBe(false);
    });

    it('fails when the request has expired (configurable TTL)', async () => {
      const { requestId } = await provider.sendOtp('9876543210');
      const code = provider.getCode(requestId)!;

      // Fast forward time past 5 minutes (300001 ms)
      mockTime += 300001;

      const verified = await provider.verifyOtp(requestId, code);
      expect(verified).toBe(false);
    });

    it('rejects unknown request IDs', async () => {
      const verified = await provider.verifyOtp('non-existent-request', '123456');
      expect(verified).toBe(false);
    });

    it('isVerified verifies matching phone and rejects mismatched phone', async () => {
      const { requestId } = await provider.sendOtp('9876543210');
      const code = provider.getCode(requestId)!;
      await provider.verifyOtp(requestId, code);

      expect(await provider.isVerified(requestId, '9876543210')).toBe(true);
      expect(await provider.isVerified(requestId, '9999999999')).toBe(false);
    });
  });

  describe('Module and Provider Selection', () => {
    const originalEnv = process.env.OTP_PROVIDER;

    afterEach(() => {
      if (originalEnv === undefined) {
        delete process.env.OTP_PROVIDER;
      } else {
        process.env.OTP_PROVIDER = originalEnv;
      }
    });

    it('defaults to MockOtpProvider when OTP_PROVIDER env is not set', async () => {
      delete process.env.OTP_PROVIDER;

      const moduleRef: TestingModule = await Test.createTestingModule({
        imports: [AuthModule, OtpModule],
      }).compile();

      const provider = moduleRef.get<OtpProvider>(OTP_PROVIDER);
      const service = moduleRef.get<OtpService>(OtpService);

      expect(provider).toBeInstanceOf(MockOtpProvider);
      expect(service).toBeDefined();
    });

    it('selects MockOtpProvider when OTP_PROVIDER=mock', async () => {
      process.env.OTP_PROVIDER = 'mock';

      const moduleRef: TestingModule = await Test.createTestingModule({
        imports: [AuthModule, OtpModule],
      }).compile();

      const provider = moduleRef.get<OtpProvider>(OTP_PROVIDER);
      expect(provider).toBeInstanceOf(MockOtpProvider);
    });

    it('throws an error if an unsupported OTP_PROVIDER is specified', async () => {
      process.env.OTP_PROVIDER = 'unknown_provider';

      await expect(
        Test.createTestingModule({
          imports: [AuthModule, OtpModule],
        }).compile(),
      ).rejects.toThrow('Unsupported OTP provider: unknown_provider');
    });
  });
});
