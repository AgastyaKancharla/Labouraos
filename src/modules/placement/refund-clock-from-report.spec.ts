import { evaluatePlacementRefundEligibility } from './placement-refund-eligibility';

/**
 * Guide, Money rules at a glance: business refund when there is "No replacement within
 * 15 days of the dropout report". The clock starts at the report, not at the claim
 * decision (which can come up to 48 hours later).
 */
describe('Business refund clock counts from the dropout report', () => {
  const reportedAt = new Date('2026-10-01T10:00:00.000Z');
  const decidedAt = new Date('2026-10-03T10:00:00.000Z'); // decided 2 days after the report
  const base = {
    code: 'PL-00001',
    status: 'dropped_out',
    hasAcceptedReplacement: false,
    hasSelectedReplacement: false,
    claimAcceptedAt: decidedAt,
    dropoutReportedAt: reportedAt,
    placementFee: 800000,
    hasExistingRefund: false,
    searchDays: 15,
  };

  it('is not due on day 14 after the report', () => {
    const result = evaluatePlacementRefundEligibility(base, new Date('2026-10-15T10:00:00.000Z'));
    expect(result.eligible).toBe(false);
    expect(result.daysElapsed).toBe(14);
    expect(result.ineligibleReason).toContain('from the dropout report');
  });

  it('is due on day 15 after the report, even though only 13 days have passed since the decision', () => {
    const result = evaluatePlacementRefundEligibility(base, new Date('2026-10-16T10:00:00.000Z'));
    expect(result.eligible).toBe(true);
    expect(result.daysElapsed).toBe(15);
    expect(result.amountPaise).toBe(800000);
  });

  it('falls back to the decision date only when no report time is known', () => {
    const result = evaluatePlacementRefundEligibility(
      { ...base, dropoutReportedAt: null },
      new Date('2026-10-16T10:00:00.000Z'),
    );
    expect(result.eligible).toBe(false);
    expect(result.daysElapsed).toBe(13);
  });
});
