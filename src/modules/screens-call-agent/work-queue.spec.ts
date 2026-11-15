import { countByCategory, KIND_CATEGORY, orderWorkItems, pickNext, WorkItem, WorkKind } from './work-queue';

let n = 0;
function item(kind: WorkKind, over: Partial<WorkItem> = {}): WorkItem {
  n += 1;
  return {
    key: `${kind}:${n}`,
    kind,
    category: KIND_CATEGORY[kind],
    subjectType: 'job_seeker',
    subjectId: `js-${n}`,
    code: `JS-${String(n).padStart(5, '0')}`,
    name: `Person ${n}`,
    maskedPhone: '******0000',
    trade: 'Electrician',
    dueAt: '2026-11-11T04:00:00.000Z',
    priority: false,
    daysLeft: null,
    guaranteeDay: null,
    guaranteeDays: null,
    detail: {},
    call: { purpose: 'general', relatedType: null, relatedId: null },
    callable: true,
    lockedReason: null,
    ...over,
  };
}

describe('call agent work queue order', () => {
  it('puts everyone in the refund-priority window first, fewest days left first', () => {
    const callback = item('callback');
    const followUp = item('follow_up', { priority: true, daysLeft: 9 });
    const nearRefund = item('close_to_refund', { priority: true, daysLeft: 3 });
    const retry = item('retry', { priority: true, daysLeft: 3 });
    const ordered = orderWorkItems([callback, followUp, nearRefund, retry]);
    expect(ordered.map((i) => i.key)).toEqual([nearRefund.key, retry.key, followUp.key, callback.key]);
  });

  it('then follows the kind order: callback, refund check, offers, follow-ups, retries, stuck registrations', () => {
    const stuck = item('stuck_registration');
    const retry = item('retry');
    const followUp = item('follow_up');
    const offer = item('offer_reply');
    const refundCheck = item('refund_check');
    const callback = item('callback');
    const ordered = orderWorkItems([stuck, retry, followUp, offer, refundCheck, callback]);
    expect(ordered.map((i) => i.kind)).toEqual([
      'callback',
      'refund_check',
      'offer_reply',
      'follow_up',
      'retry',
      'stuck_registration',
    ]);
  });

  it('breaks ties by who has waited longest', () => {
    const later = item('follow_up', { dueAt: '2026-11-11T08:00:00.000Z' });
    const earlier = item('follow_up', { dueAt: '2026-11-10T08:00:00.000Z' });
    expect(orderWorkItems([later, earlier]).map((i) => i.key)).toEqual([earlier.key, later.key]);
  });

  it('keeps one row per person, the most urgent reason', () => {
    const retry = item('retry', { subjectId: 'same' });
    const callback = item('callback', { subjectId: 'same' });
    const ordered = orderWorkItems([retry, callback]);
    expect(ordered).toHaveLength(1);
    expect(ordered[0]!.kind).toBe('callback');
  });

  it('Call next skips rows that cannot be called now and people set aside', () => {
    const locked = item('callback', { callable: false, lockedReason: 'outside_window' });
    const skipped = item('refund_check');
    const next = item('follow_up');
    const ordered = orderWorkItems([locked, skipped, next]);
    expect(pickNext(ordered, new Set([skipped.subjectId]))?.key).toBe(next.key);
    expect(pickNext([locked])).toBeNull();
  });

  it('counts rows for the filter chips', () => {
    const counts = countByCategory([item('callback'), item('retry'), item('follow_up'), item('offer_reply'), item('stuck_registration')]);
    expect(counts).toEqual({ all: 5, callbacks: 2, follow_ups: 1, offers: 1, new_leads: 1, priority: 0, app_signups: 0 });
  });

  it('app sign-ups: stopped at payment just under callbacks, other sign-ups with the stuck registrations, own chip', () => {
    const callback = item('callback');
    const payment = item('signup_payment');
    const offer = item('offer_reply');
    const help = item('signup_help', { dueAt: '2026-11-11T03:00:00.000Z' });
    const stuck = item('stuck_registration', { dueAt: '2026-11-11T05:00:00.000Z' });
    const winBack = item('win_back');
    const ordered = orderWorkItems([winBack, stuck, help, offer, payment, callback]);
    expect(ordered.map((i) => i.key)).toEqual([callback.key, payment.key, offer.key, help.key, stuck.key, winBack.key]);
    expect(countByCategory([payment, help]).app_signups).toBe(2);
  });
});
