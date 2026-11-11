import { evaluateJobSeekerRefundEligibility, JobSeekerRefundEligibilityInput } from './job-seeker-refund-eligibility';
import { loadJobSeekerRefundGuards } from './job-seeker-refund-guards';

const DAY_MS = 24 * 60 * 60 * 1000;

describe('₹499 refund guards (Master Guide: refund check, 48-hour offer reply, own job, fresh guarantee)', () => {
  const paidAt = new Date('2026-10-01T00:00:00.000Z');
  const day31 = new Date(paidAt.getTime() + 31 * DAY_MS);
  const base: JobSeekerRefundEligibilityInput = {
    code: 'JS-00042',
    paymentReceivedAt: paidAt,
    status: 'active',
    hasOfferRejectedHit: false,
    hasExistingRefund: false,
    activationPaymentPaise: 49900,
    guaranteeDays: 30,
  };

  describe('evaluateJobSeekerRefundEligibility', () => {
    it('stays eligible for the refunds-due list when the approval-only facts are not given', () => {
      expect(evaluateJobSeekerRefundEligibility(base, day31)).toMatchObject({ eligible: true, amountPaise: 49900 });
    });

    it('is eligible at approval once the refund check is recorded and no offer is open', () => {
      expect(evaluateJobSeekerRefundEligibility({
        ...base, refundCheckRecorded: true, refundCheckWorkingElsewhere: false, hasOpenOfferReply: false,
      }, day31)).toMatchObject({ eligible: true, amountPaise: 49900 });
    });

    it('refuses approval until the refund-check call is recorded', () => {
      const result = evaluateJobSeekerRefundEligibility({ ...base, refundCheckRecorded: false }, day31);
      expect(result.eligible).toBe(false);
      expect(result.ineligibleReason).toContain('refund-check call');
    });

    it('refuses approval while an offer is still waiting for his 48-hour reply', () => {
      const result = evaluateJobSeekerRefundEligibility({ ...base, refundCheckRecorded: true, hasOpenOfferReply: true }, day31);
      expect(result.eligible).toBe(false);
      expect(result.ineligibleReason).toContain('48 hours');
    });

    it('refuses when he said at the refund check that he is working elsewhere', () => {
      const result = evaluateJobSeekerRefundEligibility({
        ...base, refundCheckRecorded: true, refundCheckWorkingElsewhere: true,
      }, day31);
      expect(result.eligible).toBe(false);
      expect(result.ineligibleReason).toContain('working elsewhere');
    });

    it('refuses a profile closed because he found a job on his own, on any day', () => {
      for (const now of [new Date(paidAt.getTime() + 10 * DAY_MS), day31]) {
        const result = evaluateJobSeekerRefundEligibility({ ...base, status: 'closed' }, now);
        expect(result.eligible).toBe(false);
        expect(result.ineligibleReason).toContain('found a job on his own');
      }
    });

    it('keeps the day-30 rule ahead of the approval-only checks', () => {
      const result = evaluateJobSeekerRefundEligibility({ ...base, refundCheckRecorded: false, hasOpenOfferReply: true },
        new Date(paidAt.getTime() + 20 * DAY_MS));
      expect(result.ineligibleReason).toContain('after 30 days');
    });
  });

  describe('loadJobSeekerRefundGuards', () => {
    function fakeDb(rows: { hit?: unknown; check?: { answer: string | null } | null; offer?: unknown }) {
      return {
        jobSeekerHit: { findFirst: jest.fn().mockResolvedValue(rows.hit ?? null) },
        followUpTask: { findFirst: jest.fn().mockResolvedValue(rows.check ?? null) },
        interview: { findFirst: jest.fn().mockResolvedValue(rows.offer ?? null) },
      };
    }

    it('counts only unreversed hits of the current guarantee and refund checks made since he paid', async () => {
      const db = fakeDb({ check: { answer: 'not_working' } });
      const guards = await loadJobSeekerRefundGuards(db, { id: 'js-1', paymentReceivedAt: paidAt });
      expect(guards).toEqual({
        hasOfferRejectedHit: false,
        refundCheckRecorded: true,
        refundCheckWorkingElsewhere: false,
        hasOpenOfferReply: false,
      });
      expect(db.jobSeekerHit.findFirst).toHaveBeenCalledWith(expect.objectContaining({
        where: expect.objectContaining({ jobSeekerId: 'js-1', reversedAt: null, supersededAt: null }),
      }));
      expect(db.followUpTask.findFirst).toHaveBeenCalledWith(expect.objectContaining({
        where: expect.objectContaining({ kind: 'refund_check', status: 'done', createdAt: { gte: paidAt } }),
      }));
      expect(db.interview.findFirst).toHaveBeenCalledWith(expect.objectContaining({
        where: { jobSeekerId: 'js-1', status: 'offered' },
      }));
    });

    it("treats a 'no_answer' refund check as not recorded, and flags open offers and forfeiting hits", async () => {
      const guards = await loadJobSeekerRefundGuards(
        fakeDb({ hit: { id: 'hit-1' }, check: { answer: 'no_answer' }, offer: { id: 'iv-1' } }),
        { id: 'js-1', paymentReceivedAt: paidAt },
      );
      expect(guards).toEqual({
        hasOfferRejectedHit: true,
        refundCheckRecorded: false,
        refundCheckWorkingElsewhere: false,
        hasOpenOfferReply: true,
      });
    });

    it('reports working elsewhere from the refund check', async () => {
      const guards = await loadJobSeekerRefundGuards(fakeDb({ check: { answer: 'working_elsewhere' } }), { id: 'js-1', paymentReceivedAt: paidAt });
      expect(guards.refundCheckRecorded).toBe(true);
      expect(guards.refundCheckWorkingElsewhere).toBe(true);
    });
  });
});
