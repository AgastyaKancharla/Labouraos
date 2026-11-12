import { BadRequestException } from '@nestjs/common';
import { assertPayrollCanCorrect, monthOfDay, monthsBetween, monthsBeyondCorrections } from './payroll-window';

/** Which frozen months payroll still works out again (CORRECTION_LOOKBACK_MONTHS = 12). */
describe('payroll correction window', () => {
  /** A stand-in for prisma.payrollRun over a fixed list of sheets. */
  const runs = (sheets: Record<string, string>) => {
    const match = (where: { month: { in: string[] }; status: { in: string[] } }) =>
      Object.entries(sheets).filter(([m, s]) => where.month.in.includes(m) && where.status.in.includes(s));
    return {
      payrollRun: {
        findMany: async ({ where }: { where: { month: { in: string[] }; status: { in: string[] } } }) => match(where).map(([month]) => ({ month })),
        count: async ({ where }: { where: { month: { in: string[] }; status: { in: string[] } } }) => match(where).length,
      },
    } as unknown as Parameters<typeof monthsBeyondCorrections>[0];
  };
  const paidFrom = (from: string, to: string) => Object.fromEntries(monthsBetween(from, to).map((m) => [m, 'paid']));

  it('lists the months between two months, either way round', () => {
    expect(monthsBetween('2025-11', '2026-02')).toEqual(['2025-11', '2025-12', '2026-01', '2026-02']);
    expect(monthsBetween('2026-02', '2025-11')).toHaveLength(4);
    expect(monthOfDay(new Date('2026-10-28T00:00:00.000Z'))).toBe('2026-10');
  });

  it('a frozen month is beyond reach only when each of the next 12 months has a frozen sheet', async () => {
    // Paid Oct 2025 … Oct 2026: the Nov 2026 sheet works out Nov 2025 … Oct 2026 again.
    const prisma = runs(paidFrom('2025-10', '2026-10'));
    expect(await monthsBeyondCorrections(prisma, ['2025-10'])).toEqual(['2025-10']);
    expect(await monthsBeyondCorrections(prisma, ['2025-11', '2026-10'])).toEqual([]);
  });

  it('a month with no frozen sheet is never beyond reach (nothing to correct)', async () => {
    expect(await monthsBeyondCorrections(runs(paidFrom('2025-11', '2026-10')), ['2025-10'])).toEqual([]);
  });

  it('a returned sheet among the next 12 will be prepared again, so the month is still reached', async () => {
    const sheets = { ...paidFrom('2025-10', '2026-10'), '2026-03': 'returned' };
    expect(await monthsBeyondCorrections(runs(sheets), ['2025-10'])).toEqual([]);
    const withCeo = { ...paidFrom('2025-10', '2026-10'), '2026-10': 'with_ceo' };
    expect(await monthsBeyondCorrections(runs(withCeo), ['2025-10'])).toEqual(['2025-10']);
  });

  it('refuses with a message to raise a manual correction', async () => {
    const prisma = runs(paidFrom('2025-10', '2026-10'));
    await expect(assertPayrollCanCorrect(prisma, ['2025-10'], 'This holiday change')).rejects.toThrow(BadRequestException);
    await expect(assertPayrollCanCorrect(prisma, ['2025-10'], 'This holiday change')).rejects.toThrow(/October 2025 pay.*manual correction/);
    await expect(assertPayrollCanCorrect(prisma, ['2026-01'], 'This holiday change')).resolves.toBeUndefined();
  });
});
