import { NotFoundException } from '@nestjs/common';
import { PaymentController } from './payment.controller';
import { PaymentService } from './payment.service';
import { mockPaymentToolsAllowed, paymentProviderMode } from './payment-mode';

/**
 * POST /payments/mock/simulate-webhook marks a payment paid with no money
 * moving. It works only while payments are in mock mode and never in
 * production; in live mode it answers 404.
 */
describe('Mock simulate-webhook is refused outside mock mode', () => {
  const saved = {
    node: process.env.NODE_ENV,
    mode: process.env.PAYMENT_PROVIDER_MODE,
    legacy: process.env.PAYMENT_PROVIDER,
  };
  const restore = (key: string, value: string | undefined) => {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  };
  afterEach(() => {
    restore('NODE_ENV', saved.node);
    restore('PAYMENT_PROVIDER_MODE', saved.mode);
    restore('PAYMENT_PROVIDER', saved.legacy);
  });

  it('decides from the payment mode setting and NODE_ENV', () => {
    expect(paymentProviderMode({} as NodeJS.ProcessEnv)).toBe('mock');
    expect(paymentProviderMode({ PAYMENT_PROVIDER: 'razorpay' } as NodeJS.ProcessEnv)).toBe('razorpay');
    expect(mockPaymentToolsAllowed({ NODE_ENV: 'test' } as NodeJS.ProcessEnv)).toBe(true);
    expect(mockPaymentToolsAllowed({ NODE_ENV: 'development', PAYMENT_PROVIDER_MODE: 'mock' } as NodeJS.ProcessEnv)).toBe(true);
    expect(mockPaymentToolsAllowed({ NODE_ENV: 'test', PAYMENT_PROVIDER_MODE: 'real' } as NodeJS.ProcessEnv)).toBe(false);
    expect(mockPaymentToolsAllowed({ NODE_ENV: 'development', PAYMENT_PROVIDER: 'razorpay' } as NodeJS.ProcessEnv)).toBe(false);
    expect(mockPaymentToolsAllowed({ NODE_ENV: 'production', PAYMENT_PROVIDER_MODE: 'mock' } as NodeJS.ProcessEnv)).toBe(false);
  });

  describe('the route', () => {
    const simulateMockWebhook = jest.fn().mockResolvedValue({ received: true });
    const controller = Object.create(PaymentController.prototype) as PaymentController;
    Object.assign(controller, { paymentService: { simulateMockWebhook } });
    const post = (body: Record<string, unknown>) => controller.simulateWebhook(body);
    beforeEach(() => simulateMockWebhook.mockClear());

    it('live payment mode: 404 and the payment is never touched', async () => {
      process.env.PAYMENT_PROVIDER_MODE = 'real';
      await expect(post({ gatewayReference: 'gw-1', status: 'succeeded' })).rejects.toMatchObject({ status: 404 });
      expect(simulateMockWebhook).not.toHaveBeenCalled();
    });

    it('production, even with mock payments: 404', async () => {
      process.env.NODE_ENV = 'production';
      process.env.PAYMENT_PROVIDER_MODE = 'mock';
      await expect(post({ gatewayReference: 'gw-1' })).rejects.toThrow(NotFoundException);
      expect(simulateMockWebhook).not.toHaveBeenCalled();
    });

    it('mock mode in tests: allowed', async () => {
      process.env.NODE_ENV = 'test';
      process.env.PAYMENT_PROVIDER_MODE = 'mock';
      await expect(post({ gatewayReference: 'gw-1' })).resolves.toEqual({ received: true });
      expect(simulateMockWebhook).toHaveBeenCalledTimes(1);
    });
  });

  it('the service refuses too (defence in depth)', async () => {
    process.env.PAYMENT_PROVIDER_MODE = 'razorpay';
    const service = Object.create(PaymentService.prototype) as PaymentService;
    await expect(service.simulateMockWebhook({ gatewayReference: 'gw-1' })).rejects.toThrow(NotFoundException);
  });
});
