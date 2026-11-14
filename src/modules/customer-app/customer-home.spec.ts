import { CustomerHomeService } from './customer-home.service';
import { SEEDED_PRICING_POLICY } from '../../test-support/seeded-pricing';

/**
 * No-bypass on the job seeker's Home (guide: the business name must never show
 * before an interview is booked). An offer waiting for a reply shows the time
 * only; once the booking details were sent, the business and address appear.
 */
describe('Job seeker Home: no business before the interview is booked', () => {
  const now = new Date('2026-11-28T06:00:00.000Z');
  const interview = {
    status: 'offered',
    slotStartsAt: new Date('2026-11-29T05:30:00.000Z'),
    replyDueAt: new Date('2026-11-30T06:00:00.000Z'),
    businessDetailsSentAt: null as Date | null,
    business: { name: 'Sri Sai Bakery', address: '12, 4th Cross, Jayanagar', latitude: 12.93, longitude: 77.58 },
    vacancy: { locality: 'Jayanagar' },
  };
  const prisma = {
    jobSeeker: { findUniqueOrThrow: jest.fn().mockResolvedValue({ code: 'JS-00001', name: 'Ravi Kumar', status: 'active', hitCount: 1, paymentReceivedAt: new Date('2026-11-20T06:00:00.000Z') }) },
    jobSeekerHit: { findFirst: jest.fn().mockResolvedValue(null) },
    consent: { findFirst: jest.fn().mockResolvedValue(null) },
    payment: { findFirst: jest.fn().mockResolvedValue(null) },
    interview: { findFirst: jest.fn() },
  };
  const journey = {
    status: jest.fn().mockResolvedValue({
      otpRequired: false,
      currentStep: 'complete',
      steps: { consent: true, selfie: true, idCheck: true, payment: true },
      idCheck: { serviceDown: false, waitingForService: false, lastResult: 'verified' },
      stopped: null,
      termsAcceptedAt: new Date('2026-11-20T05:00:00.000Z'),
      payment: { state: 'confirmed', amountPaise: 49900, confirmedAt: new Date('2026-11-20T06:00:00.000Z') },
    }),
  };
  const service = new CustomerHomeService(
    prisma as never,
    { now: () => now } as never,
    {} as never,
    { current: jest.fn().mockResolvedValue(SEEDED_PRICING_POLICY) } as never,
    journey as never,
  );
  const profile = { id: 'p1', accountId: 'a1', kind: 'job_seeker' as const, role: 'self', jobSeekerId: 'js1', businessId: null, branchId: null, referralId: null };

  it('an offer waiting for a reply shows the time, never the business', async () => {
    prisma.interview.findFirst.mockResolvedValue({ ...interview });
    const home = await service.jobSeekerHome(profile);
    expect(home.interview).toEqual(expect.objectContaining({ state: 'offered', businessName: null, address: null, area: null, latitude: null }));
    expect(JSON.stringify(home)).not.toContain('Sri Sai Bakery');
    expect(home.nextAction).toBe('reply_to_offer');
    expect(home.guarantee).toEqual(expect.objectContaining({ active: true, day: 9, days: 30 }));
    expect(home.hits).toEqual({ count: 1, max: 3 });
  });

  it('a booked interview shows the business and address', async () => {
    prisma.interview.findFirst.mockResolvedValue({ ...interview, status: 'confirmed', businessDetailsSentAt: new Date('2026-11-28T05:00:00.000Z') });
    const home = await service.jobSeekerHome(profile);
    expect(home.interview).toEqual(expect.objectContaining({ state: 'booked', businessName: 'Sri Sai Bakery', address: '12, 4th Cross, Jayanagar' }));
    expect(home.nextAction).toBe('go_to_interview');
  });

  it('after day 30 with no forfeit, the refund is due (status only)', async () => {
    prisma.interview.findFirst.mockResolvedValue(null);
    prisma.jobSeeker.findUniqueOrThrow.mockResolvedValueOnce({ code: 'JS-00001', name: 'Ravi Kumar', status: 'active', hitCount: 0, paymentReceivedAt: new Date('2026-10-20T06:00:00.000Z') });
    const home = await service.jobSeekerHome(profile);
    expect(home.refund).toEqual(expect.objectContaining({ state: 'due' }));
    expect(home.guarantee.active).toBe(false);
  });

  it('a declined offer ends the refund', async () => {
    prisma.interview.findFirst.mockResolvedValue(null);
    prisma.jobSeekerHit.findFirst.mockResolvedValueOnce({ id: 'hit' });
    const home = await service.jobSeekerHome(profile);
    expect(home.refund.state).toBe('not_owed');
    expect(home.guarantee.active).toBe(false);
  });
});
