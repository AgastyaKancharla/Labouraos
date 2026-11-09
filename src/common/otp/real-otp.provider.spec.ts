import { BadRequestException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { RealOtpProvider, isWithinTraiWindow } from './real-otp.provider';
import { OtpModule } from './otp.module';
import { AuthModule } from '../auth/auth.module';
import { OTP_PROVIDER, OtpProvider } from './otp.interface';
import { PrismaService } from '../prisma/prisma.service';

describe('Phase 7 Task 1: Real OTP/SMS Vendor Provider & TRAI DLT Compliance', () => {
  describe('isWithinTraiWindow', () => {
    it('accurately identifies IST 09:00–21:00 window from UTC dates', () => {
      // 08:59 IST = 03:29 UTC -> outside (false)
      const earlyMorning = new Date('2026-10-25T03:29:00.000Z');
      expect(isWithinTraiWindow(earlyMorning)).toBe(false);

      // 09:00 IST = 03:30 UTC -> inside (true)
      const windowStart = new Date('2026-10-25T03:30:00.000Z');
      expect(isWithinTraiWindow(windowStart)).toBe(true);

      // 14:00 IST = 08:30 UTC -> inside (true)
      const midDay = new Date('2026-10-25T08:30:00.000Z');
      expect(isWithinTraiWindow(midDay)).toBe(true);

      // 20:59 IST = 15:29 UTC -> inside (true)
      const windowEndMinuteBefore = new Date('2026-10-25T15:29:00.000Z');
      expect(isWithinTraiWindow(windowEndMinuteBefore)).toBe(true);

      // 21:00 IST = 15:30 UTC -> outside (false)
      const windowCutoff = new Date('2026-10-25T15:30:00.000Z');
      expect(isWithinTraiWindow(windowCutoff)).toBe(false);

      // 23:30 IST = 18:00 UTC -> outside (false)
      const night = new Date('2026-10-25T18:00:00.000Z');
      expect(isWithinTraiWindow(night)).toBe(false);
    });
  });

  describe('RealOtpProvider', () => {
    let capturedRequests: Array<{ url: string; options?: RequestInit }>;
    let mockFetch: typeof fetch;
    let sessions: Map<string, Record<string, unknown>>;
    let sessionDb: PrismaService;

    const attachSessionStore = (provider: RealOtpProvider) => provider.setPrismaService(sessionDb);

    beforeEach(() => {
      capturedRequests = [];
      process.env.CALL_ROUTING_KEY = 'phase20_call_routing_secret_key_32_chars_min!';
      sessions = new Map();
      sessionDb = {
        otpSession: {
          create: async ({ data }: { data: Record<string, unknown> }) => {
            const row = { id: 'otp-row', attempts: 0, resendCount: 0, verified: false, ...data };
            sessions.set(String(data.requestId), row);
            return row;
          },
          findUnique: async ({ where }: { where: { requestId: string } }) => sessions.get(where.requestId) ?? null,
          update: async ({ where, data }: { where: { requestId: string }; data: Record<string, unknown> }) => {
            const prior = sessions.get(where.requestId) ?? {};
            const nextData = { ...data };
            for (const [key, value] of Object.entries(nextData)) {
              if (typeof value === 'object' && value !== null && 'increment' in value) {
                nextData[key] = Number(prior[key] ?? 0) + Number((value as { increment: number }).increment);
              }
            }
            const row = { ...prior, ...nextData };
            sessions.set(where.requestId, row);
            return row;
          },
          updateMany: async ({ where, data }: { where: { requestId: string }; data: Record<string, unknown> }) => {
            const prior = sessions.get(where.requestId);
            if (!prior) return { count: 0 };
            const nextData = { ...data };
            for (const [key, value] of Object.entries(nextData)) {
              if (typeof value === 'object' && value !== null && 'increment' in value) {
                nextData[key] = Number(prior[key] ?? 0) + Number((value as { increment: number }).increment);
              }
            }
            sessions.set(where.requestId, { ...prior, ...nextData });
            return { count: 1 };
          },
        },
      } as unknown as PrismaService;
      mockFetch = (async (url: string | URL | Request, init?: RequestInit) => {
        const urlStr = typeof url === 'string' ? url : url.toString();
        capturedRequests.push({ url: urlStr, options: init });

        if (urlStr.includes('/otp/verify')) {
          const parsedUrl = new URL(urlStr);
          const otp = parsedUrl.searchParams.get('otp');
          if (otp === '123456') {
            return {
              ok: true,
              status: 200,
              json: async () => ({ type: 'success', message: 'OTP verified success' }),
              text: async () => JSON.stringify({ type: 'success' }),
            } as Response;
          }
          return {
            ok: false,
            status: 400,
            json: async () => ({ type: 'error', message: 'OTP not match' }),
            text: async () => 'OTP not match',
          } as Response;
        }

        // Default send OTP endpoint
        return {
          ok: true,
          status: 200,
          json: async () => ({
            request_id: 'vendor_msg91_req_778899',
            type: 'success',
          }),
          text: async () => '{"type":"success"}',
        } as Response;
      }) as unknown as typeof fetch;
    });

    it('rejects sending OTP when outside 09:00–21:00 IST per TRAI compliance', async () => {
      const provider = new RealOtpProvider({
        fetchFn: mockFetch,
        timeProvider: () => new Date('2026-10-25T02:00:00.000Z'), // 07:30 IST
      });
      attachSessionStore(provider);

      await expect(provider.sendOtp('9876543210')).rejects.toThrow(
        BadRequestException,
      );
      await expect(provider.sendOtp('9876543210')).rejects.toThrow(
        /TRAI compliance: Commercial\/OTP messages cannot be transmitted outside 09:00–21:00 IST/,
      );
      expect(capturedRequests).toHaveLength(0);
    });

    it('transmits OTP inside 09:00–21:00 IST with DLT-registered sender ID and templates', async () => {
      const provider = new RealOtpProvider({
        apiKey: 'test_auth_key_123',
        senderId: 'LABOUR',
        dltTemplateId: '1007998877665544332',
        dltEntityId: '1001112233445566778',
        fetchFn: mockFetch,
        timeProvider: () => new Date('2026-10-25T05:30:00.000Z'), // 11:00 IST
      });
      attachSessionStore(provider);

      const res = await provider.sendOtp('+919876543210');
      expect(res.requestId).toBe('vendor_msg91_req_778899');

      expect(capturedRequests).toHaveLength(1);
      const req = capturedRequests[0];
      expect(req.url).toBe('https://control.msg91.com/api/v5/otp');
      expect(req.options?.headers).toMatchObject({
        'Content-Type': 'application/json',
        authkey: 'test_auth_key_123',
      });

      const body = JSON.parse(req.options?.body as string);
      expect(body.mobile).toBe('9876543210');
      expect(body.sender).toBe('LABOUR');
      expect(body.template_id).toBe('1007998877665544332');
      expect(body.entity_id).toBe('1001112233445566778');
    });

    it('verifies code successfully against the vendor API and rejects wrong codes and reuses', async () => {
      const firstProvider = new RealOtpProvider({
        apiKey: 'test_auth_key_123',
        fetchFn: mockFetch,
        timeProvider: () => new Date('2026-10-25T06:00:00.000Z'), // 11:30 IST
      });
      const secondProvider = new RealOtpProvider({
        apiKey: 'test_auth_key_123',
        fetchFn: mockFetch,
        timeProvider: () => new Date('2026-10-25T06:00:00.000Z'),
      });
      attachSessionStore(firstProvider);
      attachSessionStore(secondProvider);

      const { requestId } = await firstProvider.sendOtp('9876543210');

      // Wrong code
      const wrongVerify = await secondProvider.verifyOtp(requestId, '999999');
      expect(wrongVerify).toBe(false);

      // Correct code
      const validVerify = await secondProvider.verifyOtp(requestId, '123456');
      expect(validVerify).toBe(true);

      // isVerified tracks phone
      expect(await secondProvider.isVerified(requestId, '9876543210')).toBe(true);
      expect(await secondProvider.isVerified(requestId, '9111111111')).toBe(false);

      // Replay/reuse rejected
      const replayVerify = await secondProvider.verifyOtp(requestId, '123456');
      expect(replayVerify).toBe(false);
    });

    it('resends the same request only after 30 seconds and records the resend count', async () => {
      let now = new Date('2026-10-25T06:00:00.000Z');
      const provider = new RealOtpProvider({
        apiKey: 'test_auth_key_123',
        fetchFn: mockFetch,
        timeProvider: () => now,
      });
      attachSessionStore(provider);
      const initial = await provider.sendOtp('9876543210', { purpose: 'job_seeker' });

      await expect(provider.sendOtp('9876543210', {
        purpose: 'job_seeker',
        requestId: initial.requestId,
      })).rejects.toThrow(/Resend is available/);
      now = new Date(now.getTime() + 30_000);
      const resent = await provider.sendOtp('9876543210', {
        purpose: 'job_seeker',
        requestId: initial.requestId,
      });

      expect(resent).toMatchObject({ requestId: initial.requestId, resendsLeft: 2 });
      expect(capturedRequests[1].url).toContain('/otp/retry?');
      expect(sessions.get(initial.requestId)?.resendCount).toBe(1);
    });

    it('handles vendor HTTP errors cleanly with informative message', async () => {
      const failingFetch = (async () => {
        return {
          ok: false,
          status: 402,
          text: async () => 'Insufficient SMS credits with DLT vendor',
        } as Response;
      }) as unknown as typeof fetch;

      const provider = new RealOtpProvider({
        fetchFn: failingFetch,
        timeProvider: () => new Date('2026-10-25T06:00:00.000Z'),
      });
      attachSessionStore(provider);

      await expect(provider.sendOtp('9876543210')).rejects.toThrow(
        /SMS vendor delivery failed: Insufficient SMS credits with DLT vendor/,
      );
    });
  });

  describe('OtpModule integration with OTP_PROVIDER env flag', () => {
    const originalEnv = process.env.OTP_PROVIDER;

    afterEach(() => {
      if (originalEnv === undefined) {
        delete process.env.OTP_PROVIDER;
      } else {
        process.env.OTP_PROVIDER = originalEnv;
      }
    });

    it('instantiates RealOtpProvider when OTP_PROVIDER=real or msg91', async () => {
      process.env.OTP_PROVIDER = 'real';

      const moduleRef: TestingModule = await Test.createTestingModule({
        imports: [AuthModule, OtpModule],
      }).compile();

      const provider = moduleRef.get<OtpProvider>(OTP_PROVIDER);
      expect(provider).toBeInstanceOf(RealOtpProvider);

      process.env.OTP_PROVIDER = 'msg91';
      const moduleRefMsg91 = await Test.createTestingModule({
        imports: [AuthModule, OtpModule],
      }).compile();
      expect(moduleRefMsg91.get<OtpProvider>(OTP_PROVIDER)).toBeInstanceOf(
        RealOtpProvider,
      );
    });
  });
});
