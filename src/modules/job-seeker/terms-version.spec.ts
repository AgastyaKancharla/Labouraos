import { JobSeekerService } from './job-seeker.service';
import { ReconsentRequiredException } from '../legal/legal-status';

/** Legal documents v1.1 (rev 176) on the payment step: the version recorded and the re-consent guard. */
describe('Job seeker terms at payment', () => {
  const now = new Date('2026-11-15T10:00:00Z');
  function build(status: { needsReconsent: boolean }) {
    const prisma = {
      jobSeeker: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findUniqueOrThrow: jest.fn().mockResolvedValue({ id: 'js-1', code: 'JS-00001', city: 'Bengaluru' }),
        findUnique: jest.fn().mockResolvedValue({ id: 'js-1', status: 'consented', dateOfBirth: null }),
      },
    };
    const audit = { log: jest.fn() };
    const legal = {
      status: jest.fn().mockResolvedValue({ documentKey: 'job_seeker_terms', currentVersion: '1.1', acceptedVersion: '1.0', ...status }),
      render: jest.fn().mockResolvedValue({ key: 'job_seeker_terms', version: '1.1', language: 'kn', hash: 'h'.repeat(64), html: '<p>terms</p>' }),
      recordAcceptance: jest.fn(),
    };
    const service = new JobSeekerService(
      prisma as never, {} as never, audit as never, {} as never, {} as never, {} as never, {} as never, {} as never, {} as never, {} as never,
      undefined, undefined, { now: () => now } as never, undefined, undefined, undefined, legal as never,
    );
    jest.spyOn(service, 'registrationTerms').mockResolvedValue({ guaranteeFloorPaise: 1200000 } as never);
    const pay = jest.spyOn(service, 'createActivationPayment').mockResolvedValue({ paymentId: 'pay-1' } as never);
    return { service, prisma, legal, pay };
  }

  it('records the current version on a fresh guarantee — before any payment or after deactivation, closing or a refund', async () => {
    const { service, prisma, legal } = build({ needsReconsent: false });
    await service.acceptTermsAndCreatePayment('js-1', true, { language: 'kn', otpRequestId: 'otp-1', method: 'sms_link' });
    expect(prisma.jobSeeker.updateMany).toHaveBeenCalledWith({
      where: { id: 'js-1', OR: [{ paymentReceivedAt: null }, { status: { in: ['deactivated', 'closed', 'refunded'] } }] },
      data: expect.objectContaining({ termsAcceptedVersion: '1.1', termsAcceptedLanguage: 'kn', termsAcceptedHash: 'h'.repeat(64) }),
    });
    expect(legal.recordAcceptance).toHaveBeenCalledWith(expect.objectContaining({ context: 'payment_terms', otpRequestId: 'otp-1' }));
  });

  it('H3: while he must accept the updated terms, no terms are recorded and no ₹499 request is made (RECONSENT_REQUIRED)', async () => {
    const { service, prisma, pay } = build({ needsReconsent: true });
    const error = await service.acceptTermsAndCreatePayment('js-1', true, { language: 'kn' }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ReconsentRequiredException);
    expect((error as ReconsentRequiredException).getResponse()).toMatchObject({ code: 'RECONSENT_REQUIRED', currentVersion: '1.1' });
    expect(prisma.jobSeeker.updateMany).not.toHaveBeenCalled();
    expect(pay).not.toHaveBeenCalled();
  });
});
