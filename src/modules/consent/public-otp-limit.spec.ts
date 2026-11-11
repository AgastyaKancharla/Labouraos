import { PublicOtpLimitError } from '../../common/public-otp-limiter.service';
import { ConsentLinkService } from './consent-link.service';

/**
 * Every public "Send code" that goes through ConsentLinkService.sendOtp —
 * registration link (P00), business agreement (P04), owner's interview result
 * (P05) and referral terms — is limited on the server before an SMS is sent.
 */
describe('Public OTP sends through the consent link service', () => {
  const now = new Date('2026-11-11T06:00:00.000Z');
  const base = { expiresAt: new Date(now.getTime() + 3600_000), usedAt: null, revokedAt: null, createdAt: now, metadata: {} };
  const rows: Record<string, Record<string, unknown>> = {
    reg: { ...base, purpose: 'registration', subjectType: 'job_seeker', subjectId: 'seeker-1', phone: '+919876512345' },
    biz: { ...base, purpose: 'business_agreement', subjectType: 'business', subjectId: 'biz-1', phone: '+919811100000', metadata: { agreement: {} } },
    owner: { ...base, purpose: 'interview_owner_result', subjectType: 'interview', subjectId: 'int-1', phone: '+919822200000' },
  };
  let limiter: { claimSend: jest.Mock };
  let otp: { sendOtp: jest.Mock };
  let service: ConsentLinkService;

  beforeEach(() => {
    limiter = { claimSend: jest.fn().mockResolvedValue(undefined) };
    otp = { sendOtp: jest.fn().mockResolvedValue({ requestId: 'req-1' }) };
    const prisma = { jobSeeker: { findUnique: jest.fn().mockResolvedValue({ id: 'seeker-1', phone: '+919876512345' }) } };
    const publicLinks = { findByToken: jest.fn(async (token: string) => rows[token]), hashToken: (token: string) => `hash-${token}` };
    service = new ConsentLinkService(
      prisma as never, publicLinks as never, { now: () => now } as never, {} as never, {} as never, otp as never,
      {} as never, {} as never, {} as never, {} as never, limiter as never,
    );
  });

  it.each([
    ['reg', '+919876512345'],
    ['biz', '+919811100000'],
    ['owner', '+919822200000'],
  ])('claims a send for the %s link and its phone before sending', async (token, phone) => {
    await expect(service.sendOtp(token)).resolves.toMatchObject({ success: true, requestId: 'req-1' });
    expect(limiter.claimSend).toHaveBeenCalledWith(`hash-${token}`, phone, now);
    expect(otp.sendOtp).toHaveBeenCalledWith(phone);
  });

  it('sends no SMS when the limit is reached (429)', async () => {
    limiter.claimSend.mockRejectedValue(new PublicOtpLimitError('A code was just sent. Wait 30 seconds before asking for another.', 30));
    const error = await service.sendOtp('reg').catch((e: unknown) => e);
    expect((error as PublicOtpLimitError).getStatus()).toBe(429);
    expect(otp.sendOtp).not.toHaveBeenCalled();
  });
});
