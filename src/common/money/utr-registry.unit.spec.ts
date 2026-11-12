import { ConflictException } from '@nestjs/common';
import { assertUtrUnused } from './utr-registry';

/** The shared UTR check (Phase 22 Part B; re-check 12 Nov hardening). */
describe('assertUtrUnused', () => {
  const none = { findFirst: jest.fn().mockResolvedValue(null) };
  const full = { payment: none, bankCredit: none, expense: none, payrollLine: none };
  const env = process.env.NODE_ENV;
  afterEach(() => {
    process.env.NODE_ENV = env;
  });

  it('passes a UTR nobody has used', async () => {
    await expect(assertUtrUnused(full, 'UTR123456')).resolves.toBeUndefined();
  });

  it('refuses a UTR already on a salary with 409', async () => {
    const db = { ...full, payrollLine: { findFirst: jest.fn().mockResolvedValue({ staffCode: 'S-1' }) } };
    await expect(assertUtrUnused(db, 'UTR123456')).rejects.toBeInstanceOf(ConflictException);
  });

  it('lets a test double leave models out only under test', async () => {
    process.env.NODE_ENV = 'test';
    await expect(assertUtrUnused({ payment: none }, 'UTR123456')).resolves.toBeUndefined();
  });

  it('fails loudly outside tests when a model is missing, never passing the check', async () => {
    process.env.NODE_ENV = 'production';
    await expect(assertUtrUnused({ payment: none }, 'UTR123456')).rejects.toThrow(/no bankCredit model/);
    process.env.NODE_ENV = 'development';
    await expect(assertUtrUnused({ payment: none, bankCredit: none, expense: none }, 'UTR123456')).rejects.toThrow(/no payrollLine model/);
  });
});
