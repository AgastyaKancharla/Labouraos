import { KycProvider } from './kyc.interface';
import { KycService } from './kyc.service';
import { KycRecoveryService } from './kyc-recovery.service';
import { PrismaService } from '../prisma/prisma.service';
import { PublicLinkStoreService } from '../public-link-store.service';
import { MessagingService } from '../../modules/message/messaging.service';

describe('KycRecoveryService', () => {
  it('marks the service down on provider errors, but not on a personal name mismatch', async () => {
    const kycServiceState = {
      findUnique: jest.fn().mockResolvedValue({ status: 'up' }),
      upsert: jest.fn().mockResolvedValue({ status: 'down' }),
    };
    const prisma = { kycServiceState } as unknown as PrismaService;
    const provider: KycProvider = {
      verifyOfflineAadhaar: jest.fn().mockRejectedValue(new Error('connection timeout')),
      checkHealth: jest.fn().mockResolvedValue({ healthy: true }),
    };
    const service = new KycRecoveryService(
      prisma,
      new KycService(provider),
      {} as PublicLinkStoreService,
      {} as MessagingService,
    );

    await expect(service.verify({ method: 'digilocker' })).rejects.toThrow('connection timeout');
    expect(kycServiceState.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'id-check' },
      create: expect.objectContaining({ status: 'down' }),
    }));

    kycServiceState.findUnique.mockResolvedValue({ status: 'up' });
    kycServiceState.upsert.mockClear();
    provider.verifyOfflineAadhaar = jest.fn().mockResolvedValue({
      status: 'failed',
      vendorReference: 'reference-1',
      error: 'Name mismatch',
      failureType: 'person',
    });
    await service.verify({ method: 'digilocker' });
    expect(kycServiceState.upsert).not.toHaveBeenCalled();
  });

  it('recovers once, notifies each waiting person once, and replaces an expired registration link', async () => {
    const now = new Date();
    const state = { status: 'down' };
    const prisma = {
      kycServiceState: {
        findUnique: jest.fn().mockResolvedValue(state),
        updateMany: jest.fn().mockResolvedValueOnce({ count: 1 }).mockResolvedValue({ count: 0 }),
      },
      kycRecoveryRequest: {
        findMany: jest.fn().mockResolvedValue([
          { id: 'request-1', jobSeekerId: 'seeker-1', registrationLinkId: 'link-expired' },
          { id: 'request-2', jobSeekerId: 'seeker-2', registrationLinkId: null },
        ]),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        update: jest.fn().mockResolvedValue({}),
      },
      publicLink: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'link-expired',
          expiresAt: new Date(now.getTime() - 1000),
          revokedAt: null,
          usedAt: null,
        }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      jobSeeker: {
        findUnique: jest.fn().mockResolvedValue({ id: 'seeker-1', phone: '9876543210', messageLanguage: 'kn' }),
      },
    } as unknown as PrismaService;
    const provider: KycProvider = {
      verifyOfflineAadhaar: jest.fn(),
      checkHealth: jest.fn().mockResolvedValue({ healthy: true }),
    };
    const links = { create: jest.fn().mockResolvedValue({ id: 'link-fresh', token: 'fresh-token' }) };
    const messages = { send: jest.fn().mockResolvedValue({ status: 'sent' }) };
    const service = new KycRecoveryService(
      prisma,
      new KycService(provider),
      links as unknown as PublicLinkStoreService,
      messages as unknown as MessagingService,
    );

    const first = await service.checkAndRecover();
    const second = await service.checkAndRecover();

    expect(first).toEqual({ checked: true, healthy: true, notified: 2 });
    expect(second).toEqual({ checked: true, healthy: true, notified: 0 });
    expect(messages.send).toHaveBeenCalledTimes(2);
    expect(messages.send).toHaveBeenCalledWith(expect.objectContaining({
      subjectId: 'seeker-1',
      template: 'id_check_recovered',
      variables: expect.objectContaining({ link: expect.stringContaining('fresh-token') }),
    }));
    expect(messages.send).toHaveBeenCalledWith(expect.objectContaining({ subjectId: 'seeker-2' }));
    expect(links.create).toHaveBeenCalledTimes(1);
    expect((prisma as unknown as { publicLink: { updateMany: jest.Mock } }).publicLink.updateMany)
      .toHaveBeenCalledWith(expect.objectContaining({ data: { revokedAt: expect.any(Date) } }));
  });
});
