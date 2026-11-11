import { businessRefundNeedsCeo, ceoApprovalMessage, safeLimitPaise } from './approval-limits';

describe('Approval limits (guide: Finance portal)', () => {
  const limit = 1500000; // ₹15,000 in paise, the launch value kept in Settings

  it('lets Finance approve an eligible business refund up to and including the limit', () => {
    expect(businessRefundNeedsCeo({ actorRole: 'finance', amountPaise: 944000, limitPaise: limit })).toBeNull();
    expect(businessRefundNeedsCeo({ actorRole: 'finance', amountPaise: limit, limitPaise: limit })).toBeNull();
  });

  it('sends a business refund above the limit to the CEO', () => {
    expect(businessRefundNeedsCeo({ actorRole: 'finance', amountPaise: limit + 1, limitPaise: limit })).toBe(
      'above_finance_limit',
    );
    expect(businessRefundNeedsCeo({ actorRole: 'finance', amountPaise: 1770000, limitPaise: limit })).toBe(
      'above_finance_limit',
    );
  });

  it('always sends a refund outside the rules (goodwill) to the CEO, whatever the amount', () => {
    expect(
      businessRefundNeedsCeo({ actorRole: 'finance', amountPaise: 100, limitPaise: limit, outsideRules: true }),
    ).toBe('goodwill');
  });

  it('lets Finance send anything to the CEO', () => {
    expect(
      businessRefundNeedsCeo({ actorRole: 'finance', amountPaise: 944000, limitPaise: limit, sendToCeo: true }),
    ).toBe('sent_by_finance');
  });

  it('never limits the CEO', () => {
    expect(
      businessRefundNeedsCeo({ actorRole: 'ceo', amountPaise: 99999999, limitPaise: limit, outsideRules: true }),
    ).toBeNull();
  });

  it('fails closed: a missing or broken limit sends every Finance refund to the CEO', () => {
    expect(safeLimitPaise(undefined)).toBe(0);
    expect(safeLimitPaise(null)).toBe(0);
    expect(safeLimitPaise(-5)).toBe(0);
    expect(safeLimitPaise(1.5)).toBe(0);
    expect(businessRefundNeedsCeo({ actorRole: 'finance', amountPaise: 1, limitPaise: undefined })).toBe(
      'above_finance_limit',
    );
  });

  it('tells Finance plainly that the refund has gone to the CEO', () => {
    const above = ceoApprovalMessage('above_finance_limit', 1770000, limit, 'PAY-00061');
    expect(above).toContain('above Finance');
    expect(above).toContain('15,000');
    expect(above).toContain('PAY-00061 has been sent to the CEO');
    expect(ceoApprovalMessage('goodwill', 944000, limit, 'PAY-00067')).toContain('always needs the CEO');
  });
});
