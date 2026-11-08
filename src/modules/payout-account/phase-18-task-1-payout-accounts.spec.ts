import { BadRequestException } from '@nestjs/common';
import { PayoutAccountService } from './payout-account.service';
import {
  decryptPayoutValue,
  encryptPayoutValue,
  getPayoutAccountKey,
  hashPayoutValue,
  maskPayoutValue,
} from './payout-account-key';
import { encryptCallRoutingPhone } from '../staff/call-routing-key';

describe('Phase 18 Task 1: Payout Accounts', () => {
  const originalPayoutKey = process.env.PAYOUT_ACCOUNT_KEY;
  const originalCallRoutingKey = process.env.CALL_ROUTING_KEY;
  const validKey = 'payout_account_secret_key_32_characters_long_minimum!';
  const validRoutingKey = 'call_routing_secret_key_32_characters_long_min!';

  beforeAll(() => {
    process.env.PAYOUT_ACCOUNT_KEY = validKey;
    process.env.CALL_ROUTING_KEY = validRoutingKey;
    process.env.PUBLIC_APP_URL = 'https://app.laboura.in';
  });

  afterAll(() => {
    if (originalPayoutKey) {
      process.env.PAYOUT_ACCOUNT_KEY = originalPayoutKey;
    } else {
      delete process.env.PAYOUT_ACCOUNT_KEY;
    }
    if (originalCallRoutingKey) {
      process.env.CALL_ROUTING_KEY = originalCallRoutingKey;
    } else {
      delete process.env.CALL_ROUTING_KEY;
    }
  });

  describe('1. PAYOUT_ACCOUNT_KEY validation & encryption security', () => {
    it('refuses to start when PAYOUT_ACCOUNT_KEY is missing or empty', () => {
      delete process.env.PAYOUT_ACCOUNT_KEY;
      expect(() => getPayoutAccountKey()).toThrow(/PAYOUT_ACCOUNT_KEY environment variable is missing/);
      process.env.PAYOUT_ACCOUNT_KEY = '';
      expect(() => getPayoutAccountKey()).toThrow(/PAYOUT_ACCOUNT_KEY environment variable is missing/);
      process.env.PAYOUT_ACCOUNT_KEY = validKey;
    });

    it('refuses to start when PAYOUT_ACCOUNT_KEY is shorter than 32 characters', () => {
      process.env.PAYOUT_ACCOUNT_KEY = 'too-short-secret';
      expect(() => getPayoutAccountKey()).toThrow(/PAYOUT_ACCOUNT_KEY must be at least 32 characters long/);
      process.env.PAYOUT_ACCOUNT_KEY = validKey;
    });

    it('encrypts sensitive payout value so stored text is not readable as plain UPI or account number', () => {
      const upiId = 'worker123@okhdfcbank';
      const encrypted = encryptPayoutValue(upiId);

      expect(encrypted).not.toContain('worker123');
      expect(encrypted).not.toContain('okhdfcbank');
      expect(encrypted.split('.')).toHaveLength(3); // iv.tag.ciphertext

      const decrypted = decryptPayoutValue(encrypted);
      expect(decrypted).toBe(upiId);
    });

    it('hashes values with HMAC-SHA256 for duplicate checks without decrypting', () => {
      const hash1 = hashPayoutValue('upi', 'WORKER123@okhdfcbank');
      const hash2 = hashPayoutValue('upi', 'worker123@okhdfcbank ');
      expect(hash1).toBe(hash2); // Case & whitespace insensitive

      const bankHash1 = hashPayoutValue('bank', '1234-5678-9012');
      const bankHash2 = hashPayoutValue('bank', '123456789012');
      expect(bankHash1).toBe(bankHash2); // Digits only
    });

    it('masks UPI handles and bank accounts safely', () => {
      expect(maskPayoutValue('upi', 'candidate@okhdfcbank')).toBe('c***@okhdfcbank');
      expect(maskPayoutValue('upi', 'ab@paytm')).toBe('*@paytm');
      expect(maskPayoutValue('bank', '98765432101234')).toBe('••••••••1234');
    });
  });

  describe('2. Link creation and single-use phone-based entry', () => {
    let mockPrisma: {
      jobSeeker: { findUnique: jest.Mock };
      referral: { findUnique: jest.Mock };
      business: { findUnique: jest.Mock };
      staff: { findMany: jest.Mock };
      payoutAccount: {
        findFirst: jest.Mock;
        findMany: jest.Mock;
        create: jest.Mock;
        updateMany: jest.Mock;
      };
    };
    let mockMessagingService: { send: jest.Mock };
    let mockAuditService: { log: jest.Mock };
    let mockOtpService: { sendOtp: jest.Mock; verifyOtp: jest.Mock };
    let mockPricingService: { current: jest.Mock };
    let mockReviewFlagService: { raise: jest.Mock };
    let service: PayoutAccountService;

    const policy = {
      payoutDetailsCoolingHours: 48,
    };

    beforeEach(() => {
      process.env.PAYOUT_ACCOUNT_KEY = validKey;
      process.env.CALL_ROUTING_KEY = validRoutingKey;

      mockPrisma = {
        jobSeeker: {
          findUnique: jest.fn().mockImplementation(({ where }) => {
            if (where.id === 'js-1') return Promise.resolve({ id: 'js-1', name: 'Ravi Kumar', phone: '+919876543210' });
            return Promise.resolve(null);
          }),
        },
        referral: {
          findUnique: jest.fn().mockImplementation(({ where }) => {
            if (where.id === 'ref-1') return Promise.resolve({ id: 'ref-1', name: 'Partner One', phone: '+919876543211' });
            return Promise.resolve(null);
          }),
        },
        business: {
          findUnique: jest.fn().mockImplementation(({ where }) => {
            if (where.id === 'biz-1') return Promise.resolve({ id: 'biz-1', name: 'Cafe Coffee', ownerName: 'Suresh Babu', phone: '+919876543212' });
            return Promise.resolve(null);
          }),
        },
        staff: {
          findMany: jest.fn().mockResolvedValue([]),
        },
        payoutAccount: {
          findFirst: jest.fn().mockResolvedValue(null),
          findMany: jest.fn().mockResolvedValue([]),
          create: jest.fn().mockImplementation(({ data }) => Promise.resolve({ id: 'pa-1', ...data })),
          updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        },
      };

      mockMessagingService = {
        send: jest.fn().mockResolvedValue({ id: 'msg-1' }),
      };

      mockAuditService = {
        log: jest.fn().mockResolvedValue(undefined),
      };

      mockOtpService = {
        sendOtp: jest.fn().mockResolvedValue({ requestId: 'otp-req-123' }),
        verifyOtp: jest.fn().mockImplementation((_reqId, code) => Promise.resolve(code === '123456')),
      };

      mockPricingService = {
        current: jest.fn().mockResolvedValue(policy),
      };

      mockReviewFlagService = {
        raise: jest.fn().mockResolvedValue({ id: 'flag-1' }),
      };

      service = new PayoutAccountService(
        mockPrisma as never,
        mockPricingService as never,
        { generateCode: jest.fn().mockResolvedValue('PA-00001') } as never,
        mockAuditService as never,
        mockMessagingService as never,
        mockOtpService as never,
        mockReviewFlagService as never,
      );
    });

    it('sends payout details link by SMS and does not return phone number in response', async () => {
      const res = await service.createPayoutLink('staff-1', 'call_agent', {
        ownerType: 'job_seeker',
        ownerId: 'js-1',
      });

      expect(res.linkSent).toBe(true);
      expect(mockMessagingService.send).toHaveBeenCalledWith(
        expect.objectContaining({
          channel: 'sms',
          template: 'payout_details_link',
          subjectType: 'job_seeker',
          subjectId: 'js-1',
          variables: expect.objectContaining({
            link: expect.stringMatching(/https:\/\/app\.laboura\.in\/payout-accounts\/link\/[a-f0-9]{64}/),
          }),
        }),
      );
      expect(mockAuditService.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'payout_link_created',
        }),
      );
    });

    it('allows opening the link and requesting OTP to registered phone only', async () => {
      await service.createPayoutLink('staff-1', 'call_agent', {
        ownerType: 'referral',
        ownerId: 'ref-1',
      });

      const token = mockMessagingService.send.mock.calls[0][0].variables.token;
      const details = service.getLinkDetails(token);

      expect(details.valid).toBe(true);
      expect(details.ownerType).toBe('referral');
      expect(details.ownerName).toBe('Partner One');
      expect(details.maskedPhone).toContain('******3211');

      const otp = await service.sendOtp(token);
      expect(otp.success).toBe(true);
      expect(otp.requestId).toBe('otp-req-123');
      expect(mockOtpService.sendOtp).toHaveBeenCalledWith('+919876543211');
    });

    it('refuses submission with invalid OTP code', async () => {
      await service.createPayoutLink('staff-1', 'call_agent', {
        ownerType: 'job_seeker',
        ownerId: 'js-1',
      });
      const token = mockMessagingService.send.mock.calls[0][0].variables.token;

      await expect(
        service.submitPayoutAccount({
          token,
          otpRequestId: 'otp-req-123',
          otpCode: 'wrong-code',
          method: 'upi',
          upiId: 'ravi@okaxis',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('creates first payout account with pending_validation and activeFrom = now', async () => {
      const now = new Date('2026-11-10T10:00:00Z');
      await service.createPayoutLink(
        'staff-1',
        'call_agent',
        {
          ownerType: 'job_seeker',
          ownerId: 'js-1',
        },
        now,
      );
      const token = mockMessagingService.send.mock.calls[0][0].variables.token;

      const result = await service.submitPayoutAccount(
        {
          token,
          otpRequestId: 'otp-req-123',
          otpCode: '123456',
          method: 'upi',
          upiId: 'ravi@okaxis',
        },
        now,
      );

      expect(result.success).toBe(true);
      expect(result.status).toBe('pending_validation');
      expect(result.maskedValue).toBe('r***@okaxis');
      expect(result.activeFrom).toEqual(now);

      expect(mockPrisma.payoutAccount.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            ownerType: 'job_seeker',
            ownerId: 'js-1',
            ownerNameAtEntry: 'Ravi Kumar',
            method: 'upi',
            status: 'pending_validation',
            activeFrom: now,
            changeOtpRequestId: null,
          }),
        }),
      );

      // Single-use check: cannot reuse token
      await expect(
        service.submitPayoutAccount(
          {
            token,
            otpRequestId: 'otp-req-123',
            otpCode: '123456',
            method: 'upi',
            upiId: 'ravi@okaxis',
          },
          now,
        ),
      ).rejects.toThrow(/Payout link token has already been used/);
    });

    it('enforces 48-hour cooling period and supersedes old account when changed', async () => {
      // Simulate existing account
      mockPrisma.payoutAccount.findMany.mockResolvedValueOnce([
        { id: 'pa-old', status: 'verified', activeFrom: new Date('2026-10-01') },
      ]);

      const now = new Date('2026-11-10T10:00:00Z');
      await service.createPayoutLink(
        'staff-1',
        'call_agent',
        {
          ownerType: 'job_seeker',
          ownerId: 'js-1',
        },
        now,
      );
      const token = mockMessagingService.send.mock.calls[0][0].variables.token;

      const result = await service.submitPayoutAccount(
        {
          token,
          otpRequestId: 'otp-req-change',
          otpCode: '123456',
          method: 'bank',
          accountNumber: '123456789012',
          ifsc: 'HDFC0001234',
        },
        now,
      );

      expect(result.success).toBe(true);
      // 48 hours later = 2026-11-12T10:00:00Z
      const expectedActiveFrom = new Date('2026-11-12T10:00:00Z');
      expect(result.activeFrom).toEqual(expectedActiveFrom);

      expect(mockPrisma.payoutAccount.updateMany).toHaveBeenCalledWith({
        where: {
          ownerType: 'job_seeker',
          ownerId: 'js-1',
          status: { not: 'superseded' },
        },
        data: { status: 'superseded' },
      });

      expect(mockPrisma.payoutAccount.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            changeOtpRequestId: 'otp-req-change',
            activeFrom: expectedActiveFrom,
          }),
        }),
      );
    });

    it('raises payout_shared_account and marks flagged when same valueHash belongs to another owner', async () => {
      // Existing account with same hash belonging to a different owner
      mockPrisma.payoutAccount.findFirst.mockResolvedValueOnce({
        id: 'pa-other',
        code: 'PA-00099',
        ownerType: 'referral',
        ownerId: 'ref-other',
      });

      await service.createPayoutLink('staff-1', 'call_agent', {
        ownerType: 'job_seeker',
        ownerId: 'js-1',
      });
      const token = mockMessagingService.send.mock.calls[0][0].variables.token;

      const result = await service.submitPayoutAccount({
        token,
        otpRequestId: 'otp-req-123',
        otpCode: '123456',
        method: 'upi',
        upiId: 'shared@okaxis',
      });

      expect(result.status).toBe('flagged');
      expect(mockReviewFlagService.raise).toHaveBeenCalledWith(
        expect.objectContaining({
          kind: 'payout_shared_account',
          subjectType: 'job_seeker',
          subjectId: 'js-1',
        }),
      );
    });

    it('raises payout_matches_staff and marks flagged when UPI contains a staff phone or routing number', async () => {
      const encryptedRouting = encryptCallRoutingPhone('+919988776655');

      mockPrisma.staff.findMany.mockResolvedValueOnce([
        { id: 'staff-fa', code: 'FA-00001', callRoutingPhone: encryptedRouting },
      ]);

      await service.createPayoutLink('staff-1', 'call_agent', {
        ownerType: 'job_seeker',
        ownerId: 'js-1',
      });
      const token = mockMessagingService.send.mock.calls[0][0].variables.token;

      const result = await service.submitPayoutAccount({
        token,
        otpRequestId: 'otp-req-123',
        otpCode: '123456',
        method: 'upi',
        upiId: '9988776655@paytm',
      });

      expect(result.status).toBe('flagged');
      expect(mockReviewFlagService.raise).toHaveBeenCalledWith(
        expect.objectContaining({
          kind: 'payout_matches_staff',
          subjectType: 'job_seeker',
          subjectId: 'js-1',
        }),
      );
    });

    it('never returns full unencrypted UPI ID or bank account in listing APIs', async () => {
      mockPrisma.payoutAccount.findMany.mockResolvedValueOnce([
        {
          id: 'pa-1',
          code: 'PA-00001',
          ownerType: 'job_seeker',
          ownerId: 'js-1',
          method: 'upi',
          maskedValue: 'r***@okaxis',
          status: 'verified',
          activeFrom: new Date(),
        },
      ]);

      const list = await service.listAccountsForOwner('job_seeker', 'js-1');
      expect(list).toHaveLength(1);
      expect(list[0].maskedValue).toBe('r***@okaxis');
      const accountRecord = list[0] as unknown as Record<string, unknown>;
      expect(accountRecord.upiIdEncrypted).toBeUndefined();
      expect(accountRecord.bankAccountEncrypted).toBeUndefined();
      expect(accountRecord.upiId).toBeUndefined();
    });
  });
});
