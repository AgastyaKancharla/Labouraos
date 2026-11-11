import {
  bankDay,
  checkExpenseApproval,
  expenseNeedsCeo,
  financialYear,
  initialExpenseStatus,
  istDay,
  istDayBounds,
  matchHints,
  moneyInStatus,
  monthsInRange,
  parsePaise,
  payoutState,
  profitAndLoss,
  tdsWarning,
} from './finance-rules';

const LIMIT = 1000000; // ₹10,000, the launch value in Settings

describe('Finance rules (Phase 22 Part A)', () => {
  describe('expense approval limits', () => {
    it('Finance approves up to and including its limit; one paisa more needs the CEO', () => {
      expect(expenseNeedsCeo(LIMIT, LIMIT)).toBe(false);
      expect(expenseNeedsCeo(LIMIT + 1, LIMIT)).toBe(true);
    });

    it('a missing or broken limit sends every expense to the CEO', () => {
      expect(expenseNeedsCeo(100, null)).toBe(true);
      expect(expenseNeedsCeo(100, undefined)).toBe(true);
      expect(expenseNeedsCeo(100, -5)).toBe(true);
    });

    it('the CEO entering an expense is the approval; Finance entries wait for the right approver', () => {
      expect(initialExpenseStatus('ceo', 5000000, LIMIT)).toBe('approved');
      expect(initialExpenseStatus('finance', 240000, LIMIT)).toBe('waiting_finance');
      expect(initialExpenseStatus('finance', 1840000, LIMIT)).toBe('waiting_ceo');
    });

    it('Finance approves within the limit with a bill', () => {
      expect(checkExpenseApproval({ actorRole: 'finance', status: 'waiting_finance', amountPaise: 240000, limitPaise: LIMIT, hasBill: true })).toEqual({ ok: true });
    });

    it('Finance is refused above the limit, even if the expense was entered under an older, higher limit', () => {
      const r = checkExpenseApproval({ actorRole: 'finance', status: 'waiting_finance', amountPaise: LIMIT + 100, limitPaise: LIMIT, hasBill: true });
      expect(r).toMatchObject({ ok: false, code: 'needs_ceo' });
      expect(checkExpenseApproval({ actorRole: 'finance', status: 'waiting_ceo', amountPaise: 100, limitPaise: LIMIT, hasBill: true })).toMatchObject({ ok: false, code: 'needs_ceo' });
    });

    it('the CEO approves above the limit', () => {
      expect(checkExpenseApproval({ actorRole: 'ceo', status: 'waiting_ceo', amountPaise: 4500000, limitPaise: LIMIT, hasBill: true })).toEqual({ ok: true });
    });

    it('no bill, no approval — for the CEO too', () => {
      expect(checkExpenseApproval({ actorRole: 'ceo', status: 'waiting_ceo', amountPaise: 4500000, limitPaise: LIMIT, hasBill: false })).toMatchObject({ ok: false, code: 'no_bill' });
      expect(checkExpenseApproval({ actorRole: 'finance', status: 'waiting_finance', amountPaise: 100, limitPaise: LIMIT, hasBill: false })).toMatchObject({ ok: false, code: 'no_bill' });
    });

    it('nothing to approve once approved, paid or rejected; other roles are refused', () => {
      for (const status of ['approved', 'paid', 'rejected']) {
        expect(checkExpenseApproval({ actorRole: 'ceo', status, amountPaise: 100, limitPaise: LIMIT, hasBill: true })).toMatchObject({ ok: false, code: 'not_waiting' });
      }
      expect(checkExpenseApproval({ actorRole: 'manager', status: 'waiting_finance', amountPaise: 100, limitPaise: LIMIT, hasBill: true })).toMatchObject({ ok: false, code: 'forbidden' });
    });
  });

  describe('paise', () => {
    it('accepts whole paise and refuses floats, negatives and zero', () => {
      expect(parsePaise(240000, 'a')).toBe(240000);
      expect(parsePaise('240000', 'a')).toBe(240000);
      expect(() => parsePaise(2400.5, 'a')).toThrow();
      expect(() => parsePaise(-1, 'a')).toThrow();
      expect(() => parsePaise(0, 'a')).toThrow();
      expect(parsePaise(0, 'a', { allowZero: true })).toBe(0);
      expect(() => parsePaise('12abc', 'a')).toThrow();
    });
  });

  describe('payouts paid daily', () => {
    const now = new Date('2026-11-11T06:00:00Z');
    const account = (activeFrom: string, status = 'verified') => ({ status, activeFrom: new Date(activeFrom) });

    it('is ready once the 48-hour wait after changed details has passed', () => {
      expect(payoutState({ status: 'pending', withCeo: false, account: account('2026-11-11T05:59:59Z'), now })).toEqual({ state: 'ready', payableAt: null });
      expect(payoutState({ status: 'approved', withCeo: false, account: account('2026-11-11T06:00:00Z'), now }).state).toBe('ready');
    });

    it('waits, with the time it becomes payable, while the 48 hours run', () => {
      const r = payoutState({ status: 'pending', withCeo: false, account: account('2026-11-12T05:30:00Z'), now });
      expect(r.state).toBe('waiting_48h');
      expect(r.payableAt?.toISOString()).toBe('2026-11-12T05:30:00.000Z');
    });

    it('cannot be paid without details, with flagged details, while with the CEO, or after failing', () => {
      expect(payoutState({ status: 'pending', withCeo: false, account: null, now }).state).toBe('no_details');
      expect(payoutState({ status: 'pending', withCeo: false, account: account('2026-11-01T00:00:00Z', 'superseded'), now }).state).toBe('no_details');
      expect(payoutState({ status: 'pending', withCeo: false, account: account('2026-11-01T00:00:00Z', 'flagged'), now }).state).toBe('flagged');
      expect(payoutState({ status: 'pending', withCeo: true, account: account('2026-11-01T00:00:00Z'), now }).state).toBe('with_ceo');
      expect(payoutState({ status: 'failed', withCeo: false, account: account('2026-11-01T00:00:00Z'), now }).state).toBe('failed');
    });

    it('works out the Indian financial year in IST', () => {
      expect(financialYear(new Date('2026-11-11T06:00:00Z')).label).toBe('2026-27');
      // 31 March 23:00 IST is still the old year; 1 April 00:30 IST is the new one.
      expect(financialYear(new Date('2027-03-31T17:30:00Z')).label).toBe('2026-27');
      expect(financialYear(new Date('2027-03-31T19:00:00Z')).label).toBe('2027-28');
      expect(financialYear(new Date('2026-11-11T06:00:00Z')).from.toISOString()).toBe('2026-03-31T18:30:00.000Z');
    });

    it('warns when a referral payout takes a partner past the yearly TDS limit, and not before', () => {
      expect(tdsWarning(1960000, 40000, 2000000)).toBeNull();
      expect(tdsWarning(1980000, 40000, 2000000)).toEqual({ paidThisYearPaise: 1980000, afterPaise: 2020000, limitPaise: 2000000, alreadyOver: false });
      expect(tdsWarning(2100000, 20000, 2000000)?.alreadyOver).toBe(true);
      expect(tdsWarning(5000000, 20000, 0)).toBeNull();
    });
  });

  describe('money in', () => {
    const base = { creditStatus: 'matched', source: 'bank_feed', matchedType: 'activation', confirmedBy: 'bank_feed', hasTds: false, flagReason: null };
    it('says how each credit was matched', () => {
      expect(moneyInStatus(base)).toBe('matched_auto');
      expect(moneyInStatus({ ...base, confirmedBy: 'finance_manual' })).toBe('matched_finance');
      expect(moneyInStatus({ ...base, hasTds: true, matchedType: 'placement_fee' })).toBe('tds_recorded');
      expect(moneyInStatus({ ...base, matchedType: 'duplicate_refund' })).toBe('duplicate');
    });
    it('says what still needs Finance', () => {
      const u = { ...base, creditStatus: 'unmatched', matchedType: null, confirmedBy: null };
      expect(moneyInStatus({ ...u, flagReason: 'short_possible_tds' })).toBe('less');
      expect(moneyInStatus({ ...u, flagReason: 'amount_mismatch' })).toBe('wrong_amount');
      expect(moneyInStatus({ ...u, flagReason: 'no_reference' })).toBe('not_matched');
      expect(moneyInStatus({ ...u, creditStatus: 'returned' })).toBe('returned');
      expect(moneyInStatus({ ...u, creditStatus: 'ignored' })).toBe('ignored');
    });

    it('offers only waiting payments of the same amount (or a short placement fee), best first', () => {
      const creditAt = new Date('2026-11-09T04:28:00Z');
      const payment = { expectedPaise: 49900, type: 'activation', reference: 'LB-JS249', createdAt: new Date('2026-11-09T04:11:00Z'), payerHint: null, names: ['Ravi Kumar'] };
      const strong = matchHints({ creditPaise: 49900, creditAt, payerName: 'RAVI K', remark: '', payment });
      expect(strong?.reasons).toEqual(expect.arrayContaining(['Same amount', 'Same first name', '17 min after the link was sent']));
      const weak = matchHints({ creditPaise: 49900, creditAt, payerName: 'Someone', remark: '', payment: { ...payment, names: ['Imran'] } });
      expect(strong!.score).toBeGreaterThan(weak!.score);
      expect(matchHints({ creditPaise: 50000, creditAt, payerName: null, remark: null, payment })).toBeNull();
      const short = matchHints({ creditPaise: 810000, creditAt, payerName: null, remark: null, payment: { ...payment, type: 'placement_fee', expectedPaise: 885000 } });
      expect(short?.shortByPaise).toBe(75000);
      expect(matchHints({ creditPaise: 810000, creditAt, payerName: null, remark: null, payment: { ...payment, expectedPaise: 885000 } })).toBeNull();
    });
  });

  describe('bank', () => {
    it('opening + in − out = our closing, compared with the bank', () => {
      expect(bankDay(36415300, 1854000, 49900, 38219400)).toMatchObject({ booksClosingPaise: 38219400, differencePaise: 0 });
      expect(bankDay(36415300, 1854000, 49900, 38101400).differencePaise).toBe(-118000);
      expect(bankDay(100, 0, 0, null).differencePaise).toBeNull();
    });

    it('uses IST calendar days', () => {
      expect(istDay(new Date('2026-11-08T18:29:59Z'))).toBe('2026-11-08');
      expect(istDay(new Date('2026-11-08T18:30:00Z'))).toBe('2026-11-09');
      expect(istDayBounds('2026-11-09')).toEqual({ from: new Date('2026-11-08T18:30:00.000Z'), to: new Date('2026-11-09T18:29:59.999Z') });
      expect(() => istDayBounds('9 Nov')).toThrow();
    });
  });

  describe('profit and loss', () => {
    it('takes refunds off revenue and expenses off net revenue', () => {
      const r = profitAndLoss({ activationPaise: 15968000, placementFeePaise: 32000000, refundsPaise: 1193500, expensesPaise: 55091000, placements: 40 });
      expect(r.netRevenuePaise).toBe(46774500);
      expect(r.profitPaise).toBe(-8316500);
      expect(r.costPerPlacementPaise).toBe(1377300);
      // ₹8,000 average fee: ₹5,50,910 of costs need 69 placements' fees.
      expect(r.breakEvenPlacements).toBe(69);
    });
    it('has no cost per placement or break-even without placements', () => {
      const r = profitAndLoss({ activationPaise: 0, placementFeePaise: 0, refundsPaise: 0, expensesPaise: 100, placements: 0 });
      expect(r.costPerPlacementPaise).toBeNull();
      expect(r.breakEvenPlacements).toBeNull();
    });
    it('lists the IST months a period touches', () => {
      expect(monthsInRange(new Date('2026-09-30T18:30:00Z'), new Date('2026-11-11T06:00:00Z'))).toEqual(['2026-10', '2026-11']);
      expect(monthsInRange(new Date('2026-12-15T00:00:00Z'), new Date('2027-01-02T00:00:00Z'))).toEqual(['2026-12', '2027-01']);
    });
  });
});
