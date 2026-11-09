import { Test, TestingModule } from '@nestjs/testing';
import { MockOtpProvider } from './mock-otp.provider';
import { OTP_PROVIDER, OtpProvider } from './otp.interface';
import { OtpModule } from './otp.module';
import { AuthModule } from '../auth/auth.module';
import { OtpService } from './otp.service';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';

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

    it('waits 30 seconds, permits exactly three resends, and blocks the fourth', async () => {
      let now = 1_700_000_000_000;
      const resendProvider = new MockOtpProvider({ ttlMs: 300_000, timeProvider: () => now });
      const initial = await resendProvider.sendOtp('9876543210', { purpose: 'job_seeker' });
      expect(initial.resendsLeft).toBe(3);
      await expect(resendProvider.sendOtp('9876543210', { purpose: 'job_seeker', requestId: initial.requestId }))
        .rejects.toThrow(/Resend is available/);

      for (let resend = 1; resend <= 3; resend += 1) {
        now += 30_000;
        const result = await resendProvider.sendOtp('9876543210', {
          purpose: 'job_seeker',
          requestId: initial.requestId,
        });
        expect(result.requestId).toBe(initial.requestId);
        expect(result.resendsLeft).toBe(3 - resend);
      }
      now += 30_000;
      await expect(resendProvider.sendOtp('9876543210', {
        purpose: 'job_seeker',
        requestId: initial.requestId,
      })).rejects.toThrow(/maximum of 3/);
    });

    it('locks an OTP request on the fifth wrong code and allows one record consumption', async () => {
      const { requestId } = await provider.sendOtp('9876543210');
      for (let attempt = 0; attempt < 5; attempt += 1) {
        expect(await provider.verifyOtp(requestId, '000000')).toBe(false);
      }
      expect(await provider.verifyOtp(requestId, provider.getCode(requestId)!)).toBe(false);

      const { requestId: secondRequestId } = await provider.sendOtp('9876543211');
      expect(await provider.verifyOtp(secondRequestId, provider.getCode(secondRequestId)!)).toBe(true);
      expect(await provider.consumeVerified(secondRequestId, '9876543211')).toBe(true);
      expect(await provider.consumeVerified(secondRequestId, '9876543211')).toBe(false);
      expect(await provider.isVerified(secondRequestId, '9876543211')).toBe(false);
    });
  });

  describe('Phase 20 duplicate phone checks', () => {
    it('returns the existing code to a visible staff member and sends no OTP', async () => {
      const provider = { sendOtp: jest.fn() } as unknown as OtpProvider;
      const prisma = {
        jobSeeker: { findFirst: jest.fn().mockResolvedValue({ id: 'seeker-1', code: 'JS-01042', registeredByStaffId: 'agent-1' }) },
        business: { findFirst: jest.fn() },
        referral: { findFirst: jest.fn() },
        staff: { findUnique: jest.fn(), findFirst: jest.fn() },
      } as unknown as PrismaService;
      const audit = { log: jest.fn().mockResolvedValue(undefined) } as unknown as AuditService;
      const service = new OtpService(provider, audit, prisma);

      await expect(service.sendOtp('9876543210', 'job_seeker', 'agent-1', 'call_agent'))
        .resolves.toEqual({ alreadyRegistered: true, type: 'job_seeker', code: 'JS-01042' });
      expect(provider.sendOtp).not.toHaveBeenCalled();
      expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({
        action: 'otp.send_attempt',
        after: expect.objectContaining({ phoneMasked: '******3210', alreadyRegistered: true }),
      }));
    });

    it('does not reveal the code when a Team Lead cannot see the record', async () => {
      const provider = { sendOtp: jest.fn() } as unknown as OtpProvider;
      const prisma = {
        jobSeeker: { findFirst: jest.fn().mockResolvedValue({ id: 'seeker-1', code: 'JS-01042', registeredByStaffId: 'other-agent' }) },
        business: { findFirst: jest.fn() },
        referral: { findFirst: jest.fn() },
        staff: { findUnique: jest.fn().mockResolvedValue({ id: 'lead-1', role: 'team_lead' }), findFirst: jest.fn().mockResolvedValue(null) },
      } as unknown as PrismaService;
      const audit = { log: jest.fn().mockResolvedValue(undefined) } as unknown as AuditService;
      const service = new OtpService(provider, audit, prisma);

      await expect(service.sendOtp('9876543210', 'job_seeker', 'lead-1', 'team_lead'))
        .resolves.toEqual({ alreadyRegistered: true });
      expect(provider.sendOtp).not.toHaveBeenCalled();
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
