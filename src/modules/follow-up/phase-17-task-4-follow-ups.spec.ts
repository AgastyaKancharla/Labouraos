import { BadRequestException } from '@nestjs/common';
import { FollowUpService } from './follow-up.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { IdService } from '../../common/id/id.service';
import { AuditService } from '../../common/audit/audit.service';
import { PricingService } from '../pricing/pricing.service';
import { ReviewFlagService } from '../review-flag/review-flag.service';
import { CandidateIntroductionService } from '../vacancy/candidate-introduction.service';
import { evaluateJobSeekerRefundEligibility } from '../job-seeker/job-seeker-refund-eligibility';

type MockPrisma = {
  followUpTask: {
    findUnique: jest.Mock;
    findFirst: jest.Mock;
    findMany: jest.Mock;
    create: jest.Mock;
    update: jest.Mock;
    updateMany: jest.Mock;
  };
  callRecord: {
    findUnique: jest.Mock;
  };
  candidateIntroduction: {
    findFirst: jest.Mock;
    findMany: jest.Mock;
  };
  placement: {
    findFirst: jest.Mock;
    findMany: jest.Mock;
  };
  interview: {
    findFirst: jest.Mock;
    findMany: jest.Mock;
  };
  jobSeeker: {
    findUnique: jest.Mock;
    findMany: jest.Mock;
  };
  business: {
    findUnique: jest.Mock;
  };
  replacementClaim: {
    update: jest.Mock;
  };
  staff: {
    findFirst: jest.Mock;
    findMany: jest.Mock;
  };
};

describe('Phase 17 Task 4: Follow-up calls, the refund check and catching bypass', () => {
  let service: FollowUpService;
  let prisma: MockPrisma;
  let idService: IdService;
  let auditService: AuditService;
  let pricingService: PricingService;
  let reviewFlagService: ReviewFlagService;
  let candidateIntroService: CandidateIntroductionService;

  const mockPolicy = {
    followUpGraceDays: 2,
    noBypassMonths: 12,
    jobSeekerGuaranteeDays: 30,
    activationFeePaise: 49900,
  };

  const sampleStaff = {
    id: 'staff-1',
    code: 'CA-00001',
    name: 'Call Agent 1',
    role: 'call_agent',
    teamLeadId: 'tl-1',
  };

  const sampleJobSeeker = {
    id: 'js-1',
    code: 'JS-00001',
    name: 'Ravi Kumar',
    status: 'active',
    city: 'Bengaluru',
    paymentReceivedAt: new Date('2026-10-01T10:00:00.000Z'),
    registeredByStaffId: sampleStaff.id,
    registeredBy: sampleStaff,
    hits: [],
  };

  const sampleBusiness = {
    id: 'bz-1',
    code: 'BZ-00001',
    name: 'Acme Logistics',
    city: 'Bengaluru',
    accountAgentId: 'fa-1',
  };

  beforeEach(() => {
    prisma = {
      followUpTask: {
        findUnique: jest.fn(),
        findFirst: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn().mockImplementation(({ data }) => Promise.resolve({ id: 'task-1', ...data })),
        update: jest.fn().mockImplementation(({ data }) => Promise.resolve({ id: 'task-1', ...data })),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      callRecord: {
        findUnique: jest.fn(),
      },
      candidateIntroduction: {
        findFirst: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
      },
      placement: {
        findFirst: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
      },
      interview: {
        findFirst: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
      },
      jobSeeker: {
        findUnique: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
      },
      business: {
        findUnique: jest.fn(),
      },
      replacementClaim: {
        update: jest.fn().mockResolvedValue({ id: 'claim-1' }),
      },
      staff: {
        findFirst: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
      },
    };

    idService = {
      generateCode: jest.fn().mockResolvedValue('FUT-00001'),
    } as unknown as IdService;

    auditService = {
      log: jest.fn().mockResolvedValue(undefined),
    } as unknown as AuditService;

    pricingService = {
      current: jest.fn().mockResolvedValue(mockPolicy),
    } as unknown as PricingService;

    reviewFlagService = {
      raise: jest.fn().mockResolvedValue({ id: 'flag-1', code: 'FL-00001' }),
    } as unknown as ReviewFlagService;

    candidateIntroService = {
      firstIntroduction: jest.fn().mockResolvedValue(new Date('2026-09-01T10:00:00.000Z')),
    } as unknown as CandidateIntroductionService;

    service = new FollowUpService(
      prisma as unknown as PrismaService,
      idService,
      auditService,
      pricingService,
      reviewFlagService,
      candidateIntroService,
    );
  });

  describe('1. Scheduled Task Creation & Missed Sweep', () => {
    it('creates not_selected_day_7 on day 7, not on day 6, and not twice', async () => {
      const interview = {
        id: 'int-1',
        jobSeekerId: 'js-1',
        result: 'not_selected',
        resultRecordedAt: new Date('2026-10-01T10:00:00.000Z'),
        proposedByStaffId: 'staff-1',
      };
      prisma.interview.findMany.mockResolvedValue([interview]);

      // Day 6: no task created
      const day6 = new Date('2026-10-07T09:00:00.000Z');
      const res6 = await service.createScheduledTasks(day6);
      expect(res6.created).toBe(0);
      expect(prisma.followUpTask.create).not.toHaveBeenCalled();

      // Day 7: task created
      const day7 = new Date('2026-10-08T11:00:00.000Z');
      const res7 = await service.createScheduledTasks(day7);
      expect(res7.created).toBe(1);
      expect(prisma.followUpTask.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            kind: 'not_selected_day_7',
            subjectId: 'js-1',
            relatedId: 'int-1',
            assignedStaffId: 'staff-1',
          }),
        }),
      );

      // Second run on Day 7: already exists, does not duplicate
      prisma.followUpTask.findFirst.mockResolvedValue({ id: 'existing-task' });
      const res7Repeat = await service.createScheduledTasks(day7);
      expect(res7Repeat.created).toBe(0);
    });

    it('creates placement_check_in_day_7 counted from joinedDate', async () => {
      const placement = {
        id: 'pl-1',
        jobSeekerId: 'js-1',
        joinedDate: new Date('2026-10-01T10:00:00.000Z'),
        status: 'active',
        business: { accountAgentId: 'fa-1' },
      };
      prisma.placement.findMany.mockResolvedValue([placement]);

      const now = new Date('2026-10-08T11:00:00.000Z');
      const res = await service.createScheduledTasks(now);
      expect(res.created).toBe(1);
      expect(prisma.followUpTask.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            kind: 'placement_check_in_day_7',
            subjectId: 'js-1',
            relatedId: 'pl-1',
            assignedStaffId: 'fa-1',
          }),
        }),
      );
    });

    it('creates refund_check approaching day 30 guarantee expiry for eligible candidate', async () => {
      const candidate = {
        ...sampleJobSeeker,
        paymentReceivedAt: new Date('2026-10-01T10:00:00.000Z'),
      };
      prisma.jobSeeker.findMany.mockResolvedValue([candidate]);

      const day29 = new Date('2026-10-30T10:00:00.000Z');
      const res = await service.createScheduledTasks(day29);
      expect(res.created).toBe(1);
      expect(prisma.followUpTask.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            kind: 'refund_check',
            subjectId: candidate.id,
          }),
        }),
      );
    });

    it('marks pending tasks missed when dueAt + followUpGraceDays has elapsed', async () => {
      const now = new Date('2026-10-15T10:00:00.000Z');
      await service.createScheduledTasks(now);

      expect(prisma.followUpTask.updateMany).toHaveBeenCalledWith({
        where: {
          status: 'pending',
          dueAt: { lt: new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000) },
        },
        data: { status: 'missed' },
      });
    });
  });

  describe('2. Task Completion & Answered Call Enforcement', () => {
    it('refuses completion if call was not answered', async () => {
      const task = {
        id: 'task-1',
        code: 'FUT-00001',
        kind: 'not_selected_day_7',
        status: 'pending',
        subjectType: 'job_seeker',
        subjectId: 'js-1',
      };
      prisma.followUpTask.findUnique.mockResolvedValue(task);
      prisma.callRecord.findUnique.mockResolvedValue({
        id: 'call-1',
        answered: false,
        subjectType: 'job_seeker',
        subjectId: 'js-1',
        purpose: 'follow_up',
      });

      await expect(
        service.completeTask('task-1', { callRecordId: 'call-1', answer: 'not_working' }, 'actor-1'),
      ).rejects.toThrow(BadRequestException);
    });

    it('refuses completion if call subject does not match task subject', async () => {
      const task = {
        id: 'task-1',
        code: 'FUT-00001',
        kind: 'not_selected_day_7',
        status: 'pending',
        subjectType: 'job_seeker',
        subjectId: 'js-1',
      };
      prisma.followUpTask.findUnique.mockResolvedValue(task);
      prisma.callRecord.findUnique.mockResolvedValue({
        id: 'call-1',
        answered: true,
        subjectType: 'job_seeker',
        subjectId: 'js-other',
        purpose: 'follow_up',
      });

      await expect(
        service.completeTask('task-1', { callRecordId: 'call-1', answer: 'not_working' }, 'actor-1'),
      ).rejects.toThrow(BadRequestException);
    });

    it('refuses completion if task is already done or missed', async () => {
      const task = {
        id: 'task-1',
        code: 'FUT-00001',
        status: 'done',
        subjectType: 'job_seeker',
        subjectId: 'js-1',
      };
      prisma.followUpTask.findUnique.mockResolvedValue(task);

      await expect(
        service.completeTask('task-1', { callRecordId: 'call-1', answer: 'not_working' }, 'actor-1'),
      ).rejects.toThrow(BadRequestException);
    });

    it('links callRecordId to ReplacementClaim when completing exit_call task', async () => {
      const task = {
        id: 'task-exit',
        code: 'FUT-00002',
        kind: 'exit_call',
        status: 'pending',
        subjectType: 'job_seeker',
        subjectId: 'js-1',
        relatedType: 'replacement_claim',
        relatedId: 'claim-1',
      };
      prisma.followUpTask.findUnique.mockResolvedValue(task);
      prisma.callRecord.findUnique.mockResolvedValue({
        id: 'call-exit-1',
        answered: true,
        subjectType: 'job_seeker',
        subjectId: 'js-1',
        purpose: 'exit_call',
      });

      await service.completeTask('task-exit', { callRecordId: 'call-exit-1', answer: 'not_working' }, 'actor-1');

      expect(prisma.replacementClaim.update).toHaveBeenCalledWith({
        where: { id: 'claim-1' },
        data: { exitCallRecordId: 'call-exit-1' },
      });
    });
  });

  describe('3. Introduced Businesses & Bypass Detection', () => {
    it('returns only businesses introduced to this candidate', async () => {
      const task = { id: 'task-1', subjectType: 'job_seeker', subjectId: 'js-1' };
      prisma.followUpTask.findUnique.mockResolvedValue(task);
      prisma.candidateIntroduction.findMany.mockResolvedValue([
        { business: { id: 'bz-1', code: 'BZ-00001', name: 'Biz 1' } },
        { business: { id: 'bz-2', code: 'BZ-00002', name: 'Biz 2' } },
      ]);

      // The CEO sees every introduction (ownership is checked since the 11 Nov fixes).
      const list = await service.getIntroducedBusinesses('task-1', { id: 'ceo-1', role: 'ceo' });
      expect(list).toEqual([
        { id: 'bz-1', code: 'BZ-00001', name: 'Biz 1' },
        { id: 'bz-2', code: 'BZ-00002', name: 'Biz 2' },
      ]);
    });

    it('rejects answer working_at_introduced_business if business was never introduced', async () => {
      const task = {
        id: 'task-1',
        code: 'FUT-00001',
        kind: 'not_selected_day_30',
        status: 'pending',
        subjectType: 'job_seeker',
        subjectId: 'js-1',
      };
      prisma.followUpTask.findUnique.mockResolvedValue(task);
      prisma.callRecord.findUnique.mockResolvedValue({
        id: 'call-1',
        answered: true,
        subjectType: 'job_seeker',
        subjectId: 'js-1',
        purpose: 'follow_up',
      });
      prisma.candidateIntroduction.findFirst.mockResolvedValue(null);

      await expect(
        service.completeTask(
          'task-1',
          {
            callRecordId: 'call-1',
            answer: 'working_at_introduced_business',
            answerBusinessId: 'bz-unintroduced',
          },
          'actor-1',
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('raises bypass_suspected ReviewFlag when candidate works at introduced unpaid business', async () => {
      const task = {
        id: 'task-1',
        code: 'FUT-00001',
        kind: 'not_selected_day_30',
        status: 'pending',
        subjectType: 'job_seeker',
        subjectId: 'js-1',
      };
      prisma.followUpTask.findUnique.mockResolvedValue(task);
      prisma.callRecord.findUnique.mockResolvedValue({
        id: 'call-1',
        answered: true,
        subjectType: 'job_seeker',
        subjectId: 'js-1',
        purpose: 'follow_up',
      });
      prisma.candidateIntroduction.findFirst.mockResolvedValue({ id: 'intro-1' });
      // Business never paid
      prisma.placement.findFirst.mockResolvedValue(null);
      prisma.business.findUnique.mockResolvedValue(sampleBusiness);
      prisma.interview.findFirst.mockResolvedValue({ result: 'not_selected' });

      await service.completeTask(
        'task-1',
        {
          callRecordId: 'call-1',
          answer: 'working_at_introduced_business',
          answerBusinessId: sampleBusiness.id,
        },
        'actor-1',
      );

      expect(reviewFlagService.raise).toHaveBeenCalledWith(
        expect.objectContaining({
          kind: 'bypass_suspected',
          subjectType: 'job_seeker',
          subjectId: 'js-1',
          details: expect.objectContaining({
            businessId: sampleBusiness.id,
            interviewResult: 'not_selected',
            callRecordId: 'call-1',
          }),
        }),
      );
    });

    it('does NOT raise bypass_suspected if business paid for this candidate', async () => {
      const task = {
        id: 'task-1',
        code: 'FUT-00001',
        kind: 'not_selected_day_30',
        status: 'pending',
        subjectType: 'job_seeker',
        subjectId: 'js-1',
      };
      prisma.followUpTask.findUnique.mockResolvedValue(task);
      prisma.callRecord.findUnique.mockResolvedValue({
        id: 'call-1',
        answered: true,
        subjectType: 'job_seeker',
        subjectId: 'js-1',
        purpose: 'follow_up',
      });
      prisma.candidateIntroduction.findFirst.mockResolvedValue({ id: 'intro-1' });
      // Business PAID
      prisma.placement.findFirst.mockResolvedValue({
        id: 'pl-paid-1',
        paidAt: new Date('2026-09-15T10:00:00.000Z'),
        status: 'confirmed',
      });

      await service.completeTask(
        'task-1',
        {
          callRecordId: 'call-1',
          answer: 'working_at_introduced_business',
          answerBusinessId: sampleBusiness.id,
        },
        'actor-1',
      );

      expect(reviewFlagService.raise).not.toHaveBeenCalled();
    });
  });

  describe('4. Candidate Refund Eligibility & Consent Withdrawal (7 Nov Decision)', () => {
    it('blocks ₹499 refund when open bypass_suspected flag exists', () => {
      const res = evaluateJobSeekerRefundEligibility(
        {
          code: 'JS-00001',
          paymentReceivedAt: new Date('2026-10-01T10:00:00.000Z'),
          status: 'active',
          hasOfferRejectedHit: false,
          hasExistingRefund: false,
          activationPaymentPaise: 49900,
          guaranteeDays: 30,
          hasOpenBypassFlag: true,
        },
        new Date('2026-11-05T10:00:00.000Z'),
      );

      expect(res.eligible).toBe(false);
      expect(res.ineligibleReason).toContain('bypass_suspected');
    });

    it('blocks ₹499 refund when refund_check answered working_at_introduced_business', () => {
      const res = evaluateJobSeekerRefundEligibility(
        {
          code: 'JS-00001',
          paymentReceivedAt: new Date('2026-10-01T10:00:00.000Z'),
          status: 'active',
          hasOfferRejectedHit: false,
          hasExistingRefund: false,
          activationPaymentPaise: 49900,
          guaranteeDays: 30,
          hasWorkingAtIntroducedBusinessFollowUp: true,
        },
        new Date('2026-11-05T10:00:00.000Z'),
      );

      expect(res.eligible).toBe(false);
      expect(res.ineligibleReason).toContain('working at an introduced business');
    });

    it('candidate who withdrew job matching after paying is not refund-eligible', () => {
      const res = evaluateJobSeekerRefundEligibility(
        {
          code: 'JS-00001',
          paymentReceivedAt: new Date('2026-10-01T10:00:00.000Z'),
          status: 'active',
          hasOfferRejectedHit: false,
          hasExistingRefund: false,
          activationPaymentPaise: 49900,
          guaranteeDays: 30,
          hasWithdrawnEssentialConsent: true,
        },
        new Date('2026-11-05T10:00:00.000Z'),
      );

      expect(res.eligible).toBe(false);
      expect(res.ineligibleReason).toContain('withdrew essential consent');
    });

    it('candidate who only withdrew promotions is still refund-eligible', () => {
      const res = evaluateJobSeekerRefundEligibility(
        {
          code: 'JS-00001',
          paymentReceivedAt: new Date('2026-10-01T10:00:00.000Z'),
          status: 'active',
          hasOfferRejectedHit: false,
          hasExistingRefund: false,
          activationPaymentPaise: 49900,
          guaranteeDays: 30,
          hasWithdrawnEssentialConsent: false,
          hasOpenBypassFlag: false,
          hasWorkingAtIntroducedBusinessFollowUp: false,
        },
        new Date('2026-11-05T10:00:00.000Z'),
      );

      expect(res.eligible).toBe(true);
      expect(res.amountPaise).toBe(49900);
    });
  });
});
