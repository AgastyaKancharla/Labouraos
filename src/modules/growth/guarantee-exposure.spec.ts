import {
  ActivationExposureInput,
  ChainPlacement,
  classifyActivationPayment,
  classifyPlacementFeePayment,
  PlacementFeeExposureInput,
} from './guarantee-exposure';

const DAY = 24 * 60 * 60 * 1000;
const PAID = new Date('2026-10-01T06:30:00.000Z');
const at = (days: number) => new Date(PAID.getTime() + days * DAY);

function activation(overrides: Partial<ActivationExposureInput> = {}): ActivationExposureInput {
  return {
    code: 'JS-00001',
    amountPaise: 49900,
    receivedAt: PAID,
    isLatestActivation: true,
    refundedThisCycle: false,
    seekerStatus: 'active',
    hasForfeitingHit: false,
    hasWithdrawnEssentialConsent: false,
    hasOpenBypassFlag: false,
    hasWorkingAtIntroducedBusinessFollowUp: false,
    guaranteeDays: 30,
    ...overrides,
  };
}

describe('N1 money under guarantee: a ₹499 registration fee', () => {
  it('is under guarantee on day 1, day 15 and day 30, and the guarantee ends on day 30', () => {
    for (const day of [0, 1, 15, 30]) {
      const result = classifyActivationPayment(activation(), at(day));
      expect(result.state).toBe('under_guarantee');
      expect(result.guaranteeEndsAt?.toISOString()).toBe(at(30).toISOString());
    }
  });

  it('becomes a refund due on day 31 when he was never placed, deactivated or forfeited', () => {
    expect(classifyActivationPayment(activation(), at(31)).state).toBe('refund_due');
  });

  it('is safely earned once he is placed, closed (found his own job) or deactivated, on any day', () => {
    for (const seekerStatus of ['placed', 'closed', 'deactivated']) {
      expect(classifyActivationPayment(activation({ seekerStatus }), at(10)).state).toBe('safely_earned');
      expect(classifyActivationPayment(activation({ seekerStatus }), at(40)).state).toBe('safely_earned');
    }
  });

  it('is safely earned after a refund-ending hit or a withdrawn essential consent', () => {
    expect(classifyActivationPayment(activation({ hasForfeitingHit: true }), at(5)).state).toBe('safely_earned');
    expect(classifyActivationPayment(activation({ hasWithdrawnEssentialConsent: true }), at(5)).state).toBe('safely_earned');
  });

  it('after day 30 follows the shared refund rule: an open bypass flag blocks the refund', () => {
    expect(classifyActivationPayment(activation({ hasOpenBypassFlag: true }), at(31)).state).toBe('safely_earned');
    expect(classifyActivationPayment(activation({ hasWorkingAtIntroducedBusinessFollowUp: true }), at(31)).state).toBe('safely_earned');
  });

  it('is refunded when a refund in its guarantee exists, whatever else is true', () => {
    expect(classifyActivationPayment(activation({ refundedThisCycle: true }), at(31)).state).toBe('refunded');
    expect(classifyActivationPayment(activation({ refundedThisCycle: true, seekerStatus: 'deactivated' }), at(5)).state).toBe('refunded');
  });

  it('an earlier ₹499 (he paid again later) is safely earned unless it was refunded', () => {
    expect(classifyActivationPayment(activation({ isLatestActivation: false }), at(5)).state).toBe('safely_earned');
    expect(classifyActivationPayment(activation({ isLatestActivation: false, refundedThisCycle: true }), at(5)).state).toBe('refunded');
  });

  it('reads the guarantee length from the policy, not a fixed 30', () => {
    expect(classifyActivationPayment(activation({ guaranteeDays: 45 }), at(40)).state).toBe('under_guarantee');
    expect(classifyActivationPayment(activation({ guaranteeDays: 45 }), at(46)).state).toBe('refund_due');
  });
});

const JOINED = new Date('2026-09-01T04:30:00.000Z');
const fromJoin = (days: number) => new Date(JOINED.getTime() + days * DAY);

function chainPlacement(overrides: Partial<ChainPlacement> = {}): ChainPlacement {
  return {
    id: 'pl-root',
    code: 'PL-00001',
    status: 'active',
    placementFee: 750000,
    dropoutReportedAt: null,
    guaranteeEndedReason: null,
    claims: [],
    replacementCandidates: [],
    ...overrides,
  };
}

function fee(overrides: Partial<PlacementFeeExposureInput> = {}, chain: ChainPlacement[] = [chainPlacement()]): PlacementFeeExposureInput {
  return {
    root: { code: 'PL-00001', joinedDate: JOINED, guaranteeEndedReason: null, status: 'active' },
    chain,
    refunded: false,
    windowDays: 60,
    searchDays: 15,
    ...overrides,
  };
}

describe('N1 money under guarantee: a placement fee', () => {
  it('is under guarantee from joining until day 60 and safely earned on day 60 and after', () => {
    expect(classifyPlacementFeePayment(fee(), fromJoin(1)).state).toBe('under_guarantee');
    expect(classifyPlacementFeePayment(fee(), fromJoin(59)).state).toBe('under_guarantee');
    const day60 = classifyPlacementFeePayment(fee(), fromJoin(60));
    expect(day60.state).toBe('safely_earned');
    expect(day60.guaranteeEndsAt?.toISOString()).toBe(fromJoin(60).toISOString());
    expect(classifyPlacementFeePayment(fee(), fromJoin(61)).state).toBe('safely_earned');
  });

  it('is under guarantee when paid but the worker has not joined yet', () => {
    const result = classifyPlacementFeePayment(
      fee({ root: { code: 'PL-00001', joinedDate: null, guaranteeEndedReason: null, status: 'confirmed' } }),
      fromJoin(100),
    );
    expect(result).toEqual({ state: 'under_guarantee', guaranteeEndsAt: null });
  });

  it('stays under guarantee past day 60 while a claim for a worker who left is undecided', () => {
    const dropped = chainPlacement({
      status: 'dropped_out',
      dropoutReportedAt: fromJoin(58),
      claims: [{ decision: null, reportedAt: fromJoin(58), decidedAt: null }],
    });
    expect(classifyPlacementFeePayment(fee({}, [dropped]), fromJoin(62)).state).toBe('under_guarantee');
  });

  it('inside the 15-day replacement search it is under guarantee; with no replacement after 15 days it is a refund due', () => {
    const dropped = chainPlacement({
      status: 'dropped_out',
      dropoutReportedAt: fromJoin(50),
      claims: [{ decision: 'accepted', reportedAt: fromJoin(50), decidedAt: fromJoin(51) }],
    });
    expect(classifyPlacementFeePayment(fee({}, [dropped]), fromJoin(64)).state).toBe('under_guarantee');
    expect(classifyPlacementFeePayment(fee({}, [dropped]), fromJoin(66)).state).toBe('refund_due');
  });

  it('is safely earned when the guarantee ended with no refund (second replacement left, two rejections)', () => {
    for (const reason of ['second_replacement_left', 'two_rejections']) {
      expect(
        classifyPlacementFeePayment(
          fee({ root: { code: 'PL-00001', joinedDate: JOINED, guaranteeEndedReason: reason, status: 'guarantee_ended' } }),
          fromJoin(20),
        ).state,
      ).toBe('safely_earned');
    }
  });

  it('is refunded when a refund on the chain exists', () => {
    expect(classifyPlacementFeePayment(fee({ refunded: true }), fromJoin(20)).state).toBe('refunded');
  });

  it('a rejected claim adds no risk after day 60', () => {
    const dropped = chainPlacement({
      status: 'dropped_out',
      claims: [{ decision: 'rejected', reportedAt: fromJoin(40), decidedAt: fromJoin(41) }],
    });
    expect(classifyPlacementFeePayment(fee({}, [dropped]), fromJoin(65)).state).toBe('safely_earned');
  });
});
