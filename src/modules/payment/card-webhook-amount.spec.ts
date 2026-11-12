import { PaymentService } from './payment.service';
import { PaymentProvider, WebhookVerificationResult } from './payment-provider.interface';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import { IdService } from '../../common/id/id.service';
import { PricingService } from '../pricing/pricing.service';
import { ReviewFlagService } from '../review-flag/review-flag.service';
import { MessagingService } from '../message/messaging.service';
import { PublicLinkStoreService } from '../../common/public-link-store.service';

/** M6: a signed "paid" card webhook confirms a payment only for the amount owed. */
describe('M6: the card payment webhook checks the amount', () => {
  const savedMode = process.env.PAYMENT_PROVIDER_MODE;
  afterEach(() => {
    if (savedMode === undefined) delete process.env.PAYMENT_PROVIDER_MODE;
    else process.env.PAYMENT_PROVIDER_MODE = savedMode;
  });

  function build(verification: Partial<WebhookVerificationResult>) {
    const payment = { id: 'pay-1', status: 'pending', amount: 1475000, expectedAmountPaise: 1475000, gatewayReference: 'plink_1' };
    const prisma = { payment: { findUnique: jest.fn().mockResolvedValue(payment) } };
    const provider = {
      verifyWebhook: jest.fn().mockResolvedValue({ isValid: true, gatewayReference: 'plink_1', status: 'succeeded', ...verification }),
    } as unknown as PaymentProvider;
    const flags = { raise: jest.fn().mockResolvedValue({ id: 'flag-1', code: 'FL-1' }) };
    const service = new PaymentService(
      prisma as unknown as PrismaService,
      { log: jest.fn() } as unknown as AuditService,
      {} as IdService,
      provider,
      {} as never,
      {} as PricingService,
      {} as MessagingService,
      flags as unknown as ReviewFlagService,
      {} as PublicLinkStoreService,
    );
    const confirm = jest.spyOn(service, 'onPaymentSucceeded').mockResolvedValue({ received: true } as never);
    return { service, flags, confirm };
  }

  it('refuses and flags a webhook reporting ₹1 on a ₹14,750 fee', async () => {
    const { service, flags, confirm } = build({ amountPaise: 100 });
    const res = await service.handleWebhook({}, 'sig', '{}');
    expect(res).toMatchObject({ received: true, confirmed: false, amountMismatch: true, paymentId: 'pay-1' });
    expect(confirm).not.toHaveBeenCalled();
    expect(flags.raise).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'payment_mismatch',
      subjectType: 'payment',
      subjectId: 'pay-1',
      details: expect.objectContaining({ reason: 'gateway_amount_mismatch', reportedAmountPaise: 100, expectedAmountPaise: 1475000 }),
    }));
  });

  it('confirms when the reported amount is exactly the amount owed', async () => {
    const { service, flags, confirm } = build({ amountPaise: 1475000 });
    await service.handleWebhook({}, 'sig', '{}');
    expect(confirm).toHaveBeenCalledWith('pay-1', expect.objectContaining({ confirmedBy: 'gateway' }));
    expect(flags.raise).not.toHaveBeenCalled();
  });

  it('a live gateway that reports no amount is refused; the mock gateway may leave it out', async () => {
    process.env.PAYMENT_PROVIDER_MODE = 'real';
    const live = build({});
    await expect(live.service.handleWebhook({}, 'sig', '{}')).resolves.toMatchObject({ confirmed: false, amountMismatch: true });
    expect(live.confirm).not.toHaveBeenCalled();
    expect(live.flags.raise).toHaveBeenCalledWith(expect.objectContaining({ details: expect.objectContaining({ reason: 'gateway_amount_missing' }) }));

    process.env.PAYMENT_PROVIDER_MODE = 'mock';
    const mock = build({});
    await mock.service.handleWebhook({}, 'sig', '{}');
    expect(mock.confirm).toHaveBeenCalled();
  });
});
