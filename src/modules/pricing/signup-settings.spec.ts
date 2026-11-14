import { BadRequestException } from '@nestjs/common';
import { PricingService } from './pricing.service';
import { SEEDED_PRICING_POLICY } from '../../test-support/seeded-pricing';

/**
 * Customer app sign-up tracker settings (PricingPolicy.signup*): the CEO can
 * change them in a new pricing version; out-of-range values are refused, and a
 * new version keeps the ones not changed.
 */
describe('Sign-up tracker settings in Pricing & policy', () => {
  const create = jest.fn(async ({ data }: { data: Record<string, unknown> }) => ({ id: 'pp-2', ...data }));
  const prisma = {
    pricingPolicy: { findFirst: jest.fn().mockResolvedValue({ ...SEEDED_PRICING_POLICY }), create },
    staff: { findUnique: jest.fn().mockResolvedValue(null) },
  };
  const service = new PricingService(prisma as never, { log: jest.fn() } as never);

  beforeEach(() => create.mockClear());

  it('keeps the current values and changes only what was sent', async () => {
    await service.createVersion({ signupMaxCallTries: 5 } as never, 'ceo-1');
    const data = create.mock.calls[0]![0].data;
    expect(data).toEqual(expect.objectContaining({
      signupMaxCallTries: 5,
      signupFirstReminderMinutes: 30,
      signupSecondReminderMinutes: 240,
      signupBusinessCallMinutes: 240,
      signupPaymentStopWorkingMinutes: 120,
      signupCallTryDays: 3,
      signupReengageDays: 30,
      signupAreaClusterMin: 3,
      signupStuckHours: 24,
    }));
  });

  it('refuses values outside the allowed range', async () => {
    await expect(service.createVersion({ signupMaxCallTries: 0 } as never, 'ceo-1')).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.createVersion({ signupFirstReminderMinutes: 1.5 } as never, 'ceo-1')).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.createVersion({ signupStuckHours: 100000 } as never, 'ceo-1')).rejects.toBeInstanceOf(BadRequestException);
    expect(create).not.toHaveBeenCalled();
  });
});
