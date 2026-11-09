import { JobSeekerService } from './job-seeker.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { IdService } from '../../common/id/id.service';
import { AuditService } from '../../common/audit/audit.service';
import { OtpService } from '../../common/otp/otp.service';
import { PaymentService } from '../payment/payment.service';
import { PricingService } from '../pricing/pricing.service';
import { UpiCollectionService } from '../payment/upi-collection.service';
import { EditPolicyService } from '../../common/edit-policy/edit-policy.service';
import { AnonymisationService } from '../../common/anonymisation/anonymisation.service';
import { TradeService } from '../trade/trade.service';

describe('Activation charge requires a readable pricing policy', () => {
  it('fails activation when the pricing read fails instead of charging a default', async () => {
    const createCharge = jest.fn();
    const prisma = {
      jobSeeker: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'js-1',
          status: 'pending_payment',
          city: 'Bengaluru',
        }),
      },
    };
    const pricingService = {
      current: jest.fn().mockRejectedValue(new Error('No active PricingPolicy found in database')),
    };

    const createRequest = jest.fn();
    const service = new JobSeekerService(
      prisma as unknown as PrismaService,
      {} as IdService,
      {} as AuditService,
      {} as OtpService,
      { createCharge } as unknown as PaymentService,
      pricingService as unknown as PricingService,
      { createRequest } as unknown as UpiCollectionService,
      {} as unknown as EditPolicyService,
      {} as unknown as AnonymisationService,
      {} as unknown as TradeService,
    );

    await expect(service.createActivationPayment('js-1')).rejects.toThrow(
      'No active PricingPolicy found in database',
    );
    expect(createRequest).not.toHaveBeenCalled();
  });
});
