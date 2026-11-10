import { PlacementService } from './placement.service';

describe('Branch vacancy payment links', () => {
  it('sends the payment link to the branch contact', async () => {
    const prisma = {
      placement: { findFirst: jest.fn().mockResolvedValue({
        id: 'placement-id', businessId: 'business-id', vacancy: { branchId: 'branch-id' },
      }) },
      payment: { findFirst: jest.fn().mockResolvedValue({ id: 'payment-id' }) },
      businessBranch: { findUnique: jest.fn().mockResolvedValue({ contactPersonPhone: '+919999999999' }) },
    };
    const upi = { resendRequest: jest.fn().mockResolvedValue({ paymentId: 'payment-id' }) };
    const service = new PlacementService(
      prisma as never, {} as never, {} as never, {} as never, {} as never,
      {} as never, upi as never, {} as never, {} as never,
    );

    await service.resendPaymentLink('placement-id');

    expect(prisma.businessBranch.findUnique).toHaveBeenCalledWith({ where: { id: 'branch-id' } });
    expect(upi.resendRequest).toHaveBeenCalledWith('payment-id', 'business', 'business-id', '+919999999999');
  });
});
