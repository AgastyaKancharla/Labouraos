import { notificationStyle } from './notificationStyle';

describe('notification colours (Master Guide rev 171)', () => {
  it.each([
    ['interview_booked', 'orange'],
    ['offer_check', 'orange'],
    ['job_match', 'orange'],
    ['selected_pay_fee', 'orange'],
    ['payment_confirmed', 'good'],
    ['fee_paid', 'good'],
    ['payout_paid', 'good'],
    ['id_check_approved', 'cyan'],
    ['id_check_retry', 'cyan'],
    ['signup_reminder', 'gold'],
    ['interview_reminder_tomorrow', 'gold'],
    ['guarantee_countdown', 'gold'],
    ['refund_approved', 'royal'],
    ['refund_paid', 'royal'],
    ['promotion', 'navy'],
    ['something_new', 'navy'],
  ])('%s → %s', (kind, accent) => {
    expect(notificationStyle(kind).accent).toBe(accent);
  });
});
