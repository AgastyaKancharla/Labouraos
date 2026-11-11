import { describe, expect, it } from 'vitest';
import { guaranteeFloorPaise, isAboveMarket, isBelowLegalMinimum } from './salary';

const painter = { id: 't1', name: 'Painter', salaryMinPaise: 1800000, salaryMaxPaise: 2800000, minimumWageLevel: 'skilled', legalMinimumPaise: 2830000 };

describe('salary rules on the registration forms', () => {
  it('warns when the expected minimum is above the top of the market range', () => {
    expect(isAboveMarket(painter, 3000000, 'monthly')).toBe(true);
    expect(isAboveMarket(painter, 2800000, 'monthly')).toBe(false);
    expect(isAboveMarket(painter, 3000000, 'daily')).toBe(false);
    expect(isAboveMarket(undefined, 3000000, 'monthly')).toBe(false);
  });

  it('uses the lower of his minimum and the top of the range for the guarantee', () => {
    expect(guaranteeFloorPaise(painter, 3000000)).toBe(2800000);
    expect(guaranteeFloorPaise(painter, 2000000)).toBe(2000000);
    expect(guaranteeFloorPaise(undefined, 2000000)).toBe(2000000);
  });

  it('warns below the legal minimum wage for the trade', () => {
    expect(isBelowLegalMinimum(painter, 2500000, 'monthly')).toBe(true);
    expect(isBelowLegalMinimum(painter, 2830000, 'monthly')).toBe(false);
  });
});
