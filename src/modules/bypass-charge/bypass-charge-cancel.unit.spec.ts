import { ConflictException } from '@nestjs/common';
import { BypassChargeService } from './bypass-charge.service';

/**
 * N3: if the charge's payment was pending when read but the conditional close
 * changes nothing (it was paid or confirmed meanwhile), the cancel throws so
 * the transaction rolls back and nothing is audited.
 */
describe('Bypass charge cancel loses the race to a payment', () => {
  it('throws when the pending payment could not be closed, and audits nothing', async () => {
    const tx = {
      $executeRaw: jest.fn().mockResolvedValue(1),
      bypassCharge: {
        findUnique: jest.fn().mockResolvedValue({ id: 'c1', code: 'BYP-00001', businessId: 'b1', jobSeekerId: 'js1', paymentId: 'p1', invoiceCode: 'INV-00042' }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      payment: {
        findUnique: jest.fn().mockResolvedValue({ id: 'p1', status: 'pending' }),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      business: { findUnique: jest.fn().mockResolvedValue({ code: 'BZ-00001' }) },
      statusHistory: { create: jest.fn() },
    };
    const prisma = { $transaction: jest.fn((fn: (t: typeof tx) => unknown) => fn(tx)) };
    const audit = { log: jest.fn() };
    const service = new BypassChargeService(prisma as never, audit as never, {} as never, {} as never, {} as never, {} as never);
    await expect(service.cancel('ceo-1', 'c1', { reason: 'Owner showed the worker left' }, new Date())).rejects.toBeInstanceOf(ConflictException);
    expect(tx.statusHistory.create).not.toHaveBeenCalled();
    expect(audit.log).not.toHaveBeenCalled();
  });
});
