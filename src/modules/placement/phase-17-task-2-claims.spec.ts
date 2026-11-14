import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PlacementService } from './placement.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { IdService } from '../../common/id/id.service';
import { AuditService } from '../../common/audit/audit.service';
import { PricingService } from '../pricing/pricing.service';
import { JobSeekerService } from '../job-seeker/job-seeker.service';
import { PaymentService } from '../payment/payment.service';
import { UpiCollectionService } from '../payment/upi-collection.service';
import { ReviewFlagService } from '../review-flag/review-flag.service';
import { ReportClaimDto } from './dto/report-claim.dto';
import { DecideClaimDto } from './dto/decide-claim.dto';
import { rejectionCodeOf } from './claim-refile';
import { EditPolicyService } from '../../common/edit-policy/edit-policy.service';

type MockPrisma = {
  staff: Record<string, jest.Mock>;
  placement: Record<string, jest.Mock>;
  callRecord: Record<string, jest.Mock>;
  statusHistory: Record<string, jest.Mock>;
  replacementClaim: Record<string, jest.Mock>;
  reviewFlag: Record<string, jest.Mock>;
  vacancy: Record<string, jest.Mock>;
  candidateIntroduction: Record<string, jest.Mock>;
  $transaction: jest.Mock;
  $queryRaw: jest.Mock;
};

describe('Phase 17 Task 2: Replacement Claims', () => {
  let prisma: MockPrisma;
  let idService: IdService;
  let auditService: { log: jest.Mock };
  let pricingService: { current: jest.Mock };
  let reviewFlagService: { raise: jest.Mock };
  let placementService: PlacementService;

  const faStaff = {
    id: 'fa-1',
    role: 'field_agent',
    name: 'Field Agent 1',
    teamLeadId: 'tl-1',
  };

  const otherFaStaff = {
    id: 'fa-2',
    role: 'field_agent',
    name: 'Other Field Agent',
    teamLeadId: 'tl-2',
  };

  const caStaff = {
    id: 'ca-1',
    role: 'call_agent',
    name: 'Call Agent 1',
    teamLeadId: 'tl-1',
  };

  const tlStaff = {
    id: 'tl-1',
    role: 'team_lead',
    name: 'Team Lead 1',
    teamLeadId: null,
  };

  const otherTlStaff = {
    id: 'tl-2',
    role: 'team_lead',
    name: 'Other Team Lead',
    teamLeadId: null,
  };

  const mgrStaff = {
    id: 'mgr-1',
    role: 'manager',
    name: 'Manager 1',
  };

  const ceoStaff = {
    id: 'ceo-1',
    role: 'ceo',
    name: 'CEO 1',
  };

  const financeStaff = {
    id: 'fin-1',
    role: 'finance',
    name: 'Finance 1',
  };

  const rootJoinedDate = new Date('2026-10-01T10:00:00.000Z');

  const basePlacement = {
    id: 'pl-100',
    code: 'PL-00100',
    city: 'Bengaluru',
    status: 'active',
    joinedDate: rootJoinedDate,
    rootPlacementId: null,
    replacementNumber: 0,
    paidAt: new Date('2026-10-01T09:00:00.000Z'),
    guaranteeEndedReason: null,
    businessId: 'bz-200',
    jobSeekerId: 'js-300',
    business: { id: 'bz-200', accountAgentId: 'fa-1' },
    jobSeeker: { id: 'js-300' },
    vacancy: { id: 'vc-1' },
    payments: [{ id: 'pay-1', type: 'placement_fee', status: 'succeeded' }],
  };

  const validOwnerCall = {
    id: 'call-owner-1',
    code: 'CALL-00001',
    subjectType: 'business',
    subjectId: 'bz-200',
    purpose: 'exit_call',
    answered: true,
    staffId: 'ca-1',
    startedAt: new Date('2026-10-15T10:00:00.000Z'),
    createdAt: new Date('2026-10-15T10:00:00.000Z'),
  };

  beforeEach(() => {
    prisma = {
      staff: {
        findUnique: jest.fn().mockImplementation(async ({ where }: { where: { id: string } }) => {
          const allStaff = [faStaff, otherFaStaff, caStaff, tlStaff, otherTlStaff, mgrStaff, ceoStaff, financeStaff];
          return allStaff.find((s) => s.id === where.id) ?? null;
        }),
        findFirst: jest.fn().mockResolvedValue(mgrStaff),
        // tl-1's team (claim call scope)
        findMany: jest.fn().mockResolvedValue([{ id: 'tl-1' }, { id: 'ca-1' }, { id: 'fa-1' }]),
      },
      placement: {
        findFirst: jest.fn().mockResolvedValue(basePlacement),
        findUnique: jest.fn().mockResolvedValue(basePlacement),
        findMany: jest.fn().mockResolvedValue([]),
        update: jest.fn().mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
          ...basePlacement,
          ...data,
        })),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      callRecord: {
        findUnique: jest.fn().mockImplementation(async ({ where }: { where: { id: string } }) => {
          if (where.id === validOwnerCall.id) return validOwnerCall;
          return null;
        }),
        findFirst: jest.fn().mockResolvedValue(null),
      },
      statusHistory: {
        create: jest.fn().mockResolvedValue({ id: 'sh-1' }),
      },
      replacementClaim: {
        findFirst: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn().mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
          id: 'claim-1',
          ...data,
        })),
        update: jest.fn().mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
          id: 'claim-1',
          ...data,
        })),
        // decideClaim: a conditional update, then the claim read back
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findUniqueOrThrow: jest.fn().mockImplementation(async () => ({
          id: 'claim-1',
          ...((prisma.replacementClaim.updateMany.mock.calls.at(-1)?.[0] as { data?: Record<string, unknown> } | undefined)?.data ?? {}),
        })),
      },
      reviewFlag: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: 'flag-1' }),
      },
      vacancy: {
        create: jest.fn().mockResolvedValue({ id: 'vac-rep-1' }),
        findUniqueOrThrow: jest.fn().mockResolvedValue(basePlacement.vacancy),
      },
      candidateIntroduction: { findMany: jest.fn().mockResolvedValue([]) },
      $transaction: jest.fn(async (cb: (tx: unknown) => Promise<unknown>) => cb(prisma)),
      $queryRaw: jest.fn().mockResolvedValue([]),
    };

    idService = {
      generateCode: jest.fn().mockResolvedValue('RCL-00001'),
    } as unknown as IdService;

    auditService = {
      log: jest.fn().mockResolvedValue(undefined),
    };

    pricingService = {
      current: jest.fn().mockResolvedValue({
        replacementWindowDays: 60,
        claimReportDays: 7,
        claimDecisionHours: 48,
      }),
    };

    reviewFlagService = {
      raise: jest.fn().mockResolvedValue({ id: 'flag-1' }),
    };

    placementService = new PlacementService(
      prisma as unknown as PrismaService,
      idService,
      auditService as unknown as AuditService,
      {} as unknown as JobSeekerService,
      {} as unknown as PaymentService,
      pricingService as unknown as PricingService,
      {} as unknown as UpiCollectionService,
      reviewFlagService as unknown as ReviewFlagService,
      {} as unknown as EditPolicyService,
    );
  });

  describe('reportClaim', () => {
    const validDto: ReportClaimDto = {
      workerLeftOn: '2026-10-12T00:00:00.000Z',
      reason: 'resigned',
      callRecordId: validOwnerCall.id,
      evidencePaths: ['/evidence/claim1.pdf'],
    };

    it('refuses if placement is not found', async () => {
      prisma.placement.findFirst.mockResolvedValueOnce(null);
      await expect(
        placementService.reportClaim('pl-999', validDto, caStaff.id),
      ).rejects.toThrow(NotFoundException);
    });

    it('refuses if actor is not an allowed role (e.g. finance)', async () => {
      await expect(
        placementService.reportClaim('pl-100', validDto, financeStaff.id),
      ).rejects.toThrow(ForbiddenException);
    });

    it('refuses if field_agent is not the account agent of the business', async () => {
      await expect(
        placementService.reportClaim('pl-100', validDto, otherFaStaff.id),
      ).rejects.toThrow(ForbiddenException);
    });

    it('allows account agent (field_agent) or any call_agent or team_lead or manager or ceo', async () => {
      // Account agent, on his own call
      prisma.callRecord.findUnique.mockResolvedValueOnce({ ...validOwnerCall, staffId: 'fa-1' });
      const faRes = await placementService.reportClaim('pl-100', validDto, faStaff.id);
      expect(faRes.code).toBe('RCL-00001');

      // Call agent
      const caRes = await placementService.reportClaim('pl-100', validDto, caStaff.id);
      expect(caRes.code).toBe('RCL-00001');

      // Team Lead
      const tlRes = await placementService.reportClaim('pl-100', validDto, tlStaff.id);
      expect(tlRes.code).toBe('RCL-00001');

      // Manager
      const mgrRes = await placementService.reportClaim('pl-100', validDto, mgrStaff.id);
      expect(mgrRes.code).toBe('RCL-00001');

      // CEO
      const ceoRes = await placementService.reportClaim('pl-100', validDto, ceoStaff.id);
      expect(ceoRes.code).toBe('RCL-00001');
    });

    it('refuses if placement is not in active status', async () => {
      prisma.placement.findFirst.mockResolvedValueOnce({
        ...basePlacement,
        status: 'confirmed',
      });
      await expect(
        placementService.reportClaim('pl-100', validDto, caStaff.id),
      ).rejects.toThrow(BadRequestException);
    });

    it('refuses if worker left outside the 60-day replacement guarantee window', async () => {
      const wayLaterDto: ReportClaimDto = {
        ...validDto,
        workerLeftOn: '2026-12-15T00:00:00.000Z', // > 60 days after 2026-10-01
      };
      await expect(
        placementService.reportClaim('pl-100', wayLaterDto, caStaff.id),
      ).rejects.toThrow(BadRequestException);
    });

    it('refuses without an answered owner call', async () => {
      // Missing call
      await expect(
        placementService.reportClaim('pl-100', { ...validDto, callRecordId: 'missing-call' }, caStaff.id),
      ).rejects.toThrow(BadRequestException);

      // Unanswered call
      prisma.callRecord.findUnique.mockResolvedValueOnce({
        ...validOwnerCall,
        answered: false,
      });
      await expect(
        placementService.reportClaim('pl-100', validDto, caStaff.id),
      ).rejects.toThrow(BadRequestException);

      // Wrong subject type (e.g. called worker instead of owner)
      prisma.callRecord.findUnique.mockResolvedValueOnce({
        ...validOwnerCall,
        subjectType: 'job_seeker',
      });
      await expect(
        placementService.reportClaim('pl-100', validDto, caStaff.id),
      ).rejects.toThrow(BadRequestException);
    });

    it('refuses invalid claim reason not in accept or reject list', async () => {
      await expect(
        placementService.reportClaim('pl-100', { ...validDto, reason: 'unknown_custom_reason' }, caStaff.id),
      ).rejects.toThrow(BadRequestException);
    });

    it('creates a pending claim with 48h decision deadline when reported within 7 days on paid placement', async () => {
      const now = new Date('2026-10-15T12:00:00.000Z');
      const claim = await placementService.reportClaim('pl-100', validDto, caStaff.id, now);

      expect(claim.decision).toBeNull();
      expect(claim.decisionReason).toBeNull();
      expect(claim.reportedWithinDeadline).toBe(true);
      expect(claim.feePaidInFull).toBe(true);
      expect(new Date(claim.decisionDueAt).toISOString()).toBe('2026-10-17T12:00:00.000Z'); // 48h later
      expect(auditService.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'replacement_claim_reported',
          entityType: 'ReplacementClaim',
          entityCode: 'RCL-00001',
        }),
      );
    });

    it('auto-rejects if reported more than 7 days after worker left', async () => {
      const now = new Date('2026-10-25T12:00:00.000Z'); // 13 days after 2026-10-12
      const claim = await placementService.reportClaim('pl-100', validDto, caStaff.id, now);

      expect(claim.decision).toBe('rejected');
      expect(claim.reportedWithinDeadline).toBe(false);
      expect(claim.decisionReason).toContain('Auto-rejected: Reported 13 days after worker left');
    });

    it('auto-rejects if root placement fee is not paid in full', async () => {
      prisma.placement.findFirst.mockResolvedValueOnce({
        ...basePlacement,
        paidAt: null,
        payments: [],
      });
      const now = new Date('2026-10-15T12:00:00.000Z');
      const claim = await placementService.reportClaim('pl-100', validDto, caStaff.id, now);

      expect(claim.decision).toBe('rejected');
      expect(claim.feePaidInFull).toBe(false);
      expect(claim.decisionReason).toContain('Root placement fee is not paid in full');
    });

    it('auto-rejects each reason from the reject list', async () => {
      const rejectReasons = [
        'business_closed',
        'role_changed',
        'salary_unpaid',
        'unsafe_workplace',
        'fired_without_reason',
        'hired_own_person',
      ];

      const now = new Date('2026-10-15T12:00:00.000Z');
      for (const reason of rejectReasons) {
        const claim = await placementService.reportClaim(
          'pl-100',
          { ...validDto, reason },
          caStaff.id,
          now,
        );
        expect(claim.decision).toBe('rejected');
        expect(claim.decisionReason).toContain(`Reason '${reason}' is in the non-eligible rejection list`);
      }
    });
  });

  describe('decideClaim', () => {
    const pendingClaim = {
      id: 'claim-10',
      code: 'RCL-00010',
      placementId: 'pl-100',
      workerLeftOn: new Date('2026-10-12T00:00:00.000Z'),
      reportedAt: new Date('2026-10-14T00:00:00.000Z'),
      reason: 'resigned',
      decision: null,
      decisionReason: null,
      decidedByStaffId: null,
      decidedAt: null,
      overruledByStaffId: null,
      overruleReason: null,
      placement: basePlacement,
    };

    beforeEach(() => {
      prisma.replacementClaim.findFirst.mockResolvedValue(pendingClaim);
    });

    it('refuses decide for unauthorized roles (call_agent, field_agent, finance)', async () => {
      const dto: DecideClaimDto = { decision: 'accepted', decisionReason: 'Valid resignation' };
      await expect(
        placementService.decideClaim('pl-100', 'claim-10', dto, caStaff.id),
      ).rejects.toThrow(ForbiddenException);

      await expect(
        placementService.decideClaim('pl-100', 'claim-10', dto, faStaff.id),
      ).rejects.toThrow(ForbiddenException);

      await expect(
        placementService.decideClaim('pl-100', 'claim-10', dto, financeStaff.id),
      ).rejects.toThrow(ForbiddenException);
    });

    it('refuses team_lead from another team', async () => {
      const dto: DecideClaimDto = { decision: 'accepted', decisionReason: 'Valid resignation' };
      await expect(
        placementService.decideClaim('pl-100', 'claim-10', dto, otherTlStaff.id),
      ).rejects.toThrow(ForbiddenException);
    });

    it('allows team_lead of own team to accept claim: moves placement to dropped_out', async () => {
      const dto: DecideClaimDto = { decision: 'accepted', decisionReason: 'Resignation confirmed by exit call' };
      const res = await placementService.decideClaim('pl-100', 'claim-10', dto, tlStaff.id);

      expect(res.decision).toBe('accepted');
      // only while the placement is still active
      expect(prisma.placement.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'pl-100', status: 'active' },
          data: expect.objectContaining({
            status: 'dropped_out',
            dropoutReportedAt: pendingClaim.reportedAt,
          }),
        }),
      );
      expect(prisma.statusHistory.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            fromStatus: 'active',
            toStatus: 'dropped_out',
          }),
        }),
      );
      expect(auditService.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'replacement_claim_decided',
          actorId: tlStaff.id,
        }),
      );
    });

    it('allows team_lead of own team to reject claim: placement stays active', async () => {
      const dto: DecideClaimDto = { decision: 'rejected', decisionReason: 'Worker disputed departure' };
      const res = await placementService.decideClaim('pl-100', 'claim-10', dto, tlStaff.id);

      expect(res.decision).toBe('rejected');
      expect(prisma.placement.update).not.toHaveBeenCalled();
    });

    it('allows Manager to overrule an existing Team Lead decision with overruleReason', async () => {
      const alreadyDecidedClaim = {
        ...pendingClaim,
        decision: 'rejected',
        decisionReason: 'Initial TL rejection',
        decidedByStaffId: tlStaff.id,
        decidedAt: new Date('2026-10-15T10:00:00.000Z'),
      };
      prisma.replacementClaim.findFirst.mockResolvedValueOnce(alreadyDecidedClaim);

      const overruleDto: DecideClaimDto = {
        decision: 'accepted',
        decisionReason: 'Manager overrule: worker provided official resignation notice',
      };

      const res = await placementService.decideClaim('pl-100', 'claim-10', overruleDto, mgrStaff.id);

      expect(res.decision).toBe('accepted');
      expect(prisma.replacementClaim.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          // only if nobody changed it since it was read
          where: { id: 'claim-10', decision: 'rejected', overruledByStaffId: null },
          data: expect.objectContaining({
            decision: 'accepted',
            overruledByStaffId: mgrStaff.id,
            overruleReason: overruleDto.decisionReason,
          }),
        }),
      );
      expect(auditService.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'replacement_claim_overruled',
          actorId: mgrStaff.id,
        }),
      );
    });

    it('refuses Team Lead attempting to overrule an already decided claim', async () => {
      const alreadyDecidedClaim = {
        ...pendingClaim,
        decision: 'rejected',
        decisionReason: 'Initial TL rejection',
        decidedByStaffId: tlStaff.id,
      };
      prisma.replacementClaim.findFirst.mockResolvedValueOnce(alreadyDecidedClaim);

      const overruleDto: DecideClaimDto = {
        decision: 'accepted',
        decisionReason: 'TL trying to change mind',
      };

      await expect(
        placementService.decideClaim('pl-100', 'claim-10', overruleDto, tlStaff.id),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('PR #137 review: one claim at a time, real evidence, IST days, scope', () => {
    const dto: ReportClaimDto = { workerLeftOn: '2026-10-12', reason: 'resigned', callRecordId: validOwnerCall.id };
    const now = new Date('2026-10-15T12:00:00.000Z');

    it('refuses a second claim while one is waiting (409), checked with the placement row locked', async () => {
      prisma.replacementClaim.findFirst.mockImplementation(async ({ where }: { where: Record<string, unknown> }) =>
        where.decision === null ? { id: 'claim-open' } : null,
      );
      await expect(placementService.reportClaim('pl-100', dto, caStaff.id, now)).rejects.toMatchObject({ status: 409 });
      expect(prisma.$queryRaw).toHaveBeenCalled();
      expect(prisma.replacementClaim.create).not.toHaveBeenCalled();
    });

    it('two claims at the same moment: the database index refuses the second (409)', async () => {
      prisma.replacementClaim.create
        .mockImplementationOnce(async ({ data }: { data: Record<string, unknown> }) => ({ id: 'claim-a', ...data }))
        .mockRejectedValueOnce(new Prisma.PrismaClientKnownRequestError('Unique constraint failed', { code: 'P2002', clientVersion: 'test' }));
      const [first, second] = await Promise.allSettled([
        placementService.reportClaim('pl-100', dto, caStaff.id, now),
        placementService.reportClaim('pl-100', dto, caStaff.id, now),
      ]);
      expect(first.status).toBe('fulfilled');
      expect(second).toMatchObject({ status: 'rejected', reason: expect.objectContaining({ status: 409 }) });
    });

    it('records who reported the claim', async () => {
      await placementService.reportClaim('pl-100', dto, caStaff.id, now);
      expect(prisma.replacementClaim.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ reportedByStaffId: 'ca-1' }) }));
    });

    it('refuses an owner call made before the day the worker left, or a call in the future', async () => {
      prisma.callRecord.findUnique.mockResolvedValueOnce({ ...validOwnerCall, createdAt: new Date('2026-10-11T12:00:00.000Z') });
      await expect(placementService.reportClaim('pl-100', dto, caStaff.id, now)).rejects.toThrow('on or after the day the worker left');
      prisma.callRecord.findUnique.mockResolvedValueOnce({ ...validOwnerCall, createdAt: new Date('2026-10-16T12:00:00.000Z') });
      await expect(placementService.reportClaim('pl-100', dto, caStaff.id, now)).rejects.toThrow(BadRequestException);
      // a call at 00:10 IST on the leaving day counts
      prisma.callRecord.findUnique.mockResolvedValueOnce({ ...validOwnerCall, createdAt: new Date('2026-10-11T18:40:00.000Z') });
      await expect(placementService.reportClaim('pl-100', dto, caStaff.id, now)).resolves.toBeTruthy();
    });

    it("refuses another agent's call, and a call already used by another claim", async () => {
      prisma.callRecord.findUnique.mockResolvedValueOnce({ ...validOwnerCall, staffId: 'someone-else' });
      await expect(placementService.reportClaim('pl-100', dto, caStaff.id, now)).rejects.toThrow(ForbiddenException);
      prisma.replacementClaim.findFirst.mockImplementation(async ({ where }: { where: Record<string, unknown> }) =>
        where.callRecordId ? { code: 'RCL-00007' } : null,
      );
      await expect(placementService.reportClaim('pl-100', dto, caStaff.id, now)).rejects.toThrow('already the evidence of claim RCL-00007');
    });

    it('a Manager or the CEO may use any staff member’s call', async () => {
      prisma.callRecord.findUnique.mockResolvedValueOnce({ ...validOwnerCall, staffId: 'someone-else' });
      await expect(placementService.reportClaim('pl-100', dto, mgrStaff.id, now)).resolves.toBeTruthy();
    });

    it('a worker who joined and left on the same Indian day can be reported', async () => {
      // joined 1 Oct 15:30 IST, left "2026-10-01"
      const sameDay = { ...dto, workerLeftOn: '2026-10-01' };
      prisma.callRecord.findUnique.mockResolvedValueOnce({ ...validOwnerCall, createdAt: new Date('2026-10-01T11:00:00.000Z') });
      await expect(placementService.reportClaim('pl-100', sameDay, caStaff.id, now)).resolves.toBeTruthy();
      await expect(placementService.reportClaim('pl-100', { ...dto, workerLeftOn: '2026-09-30' }, caStaff.id, now)).rejects.toThrow('earlier than the joining day');
    });

    it('between 00:00 and 05:30 IST, "today" is already the new Indian day', async () => {
      const earlyMorning = new Date('2026-10-14T19:00:00.000Z'); // 15 Oct 00:30 IST
      prisma.callRecord.findUnique.mockResolvedValueOnce({ ...validOwnerCall, createdAt: new Date('2026-10-14T18:45:00.000Z') });
      await expect(placementService.reportClaim('pl-100', { ...dto, workerLeftOn: '2026-10-15' }, caStaff.id, earlyMorning)).resolves.toBeTruthy();
      await expect(placementService.reportClaim('pl-100', { ...dto, workerLeftOn: '2026-10-16' }, caStaff.id, earlyMorning)).rejects.toThrow('in the future');
    });

    it('counts the 7 days to report in Indian days', async () => {
      const lateEvening = new Date('2026-10-19T17:00:00.000Z'); // 19 Oct 22:30 IST, 7 days after 12 Oct
      const ok = await placementService.reportClaim('pl-100', dto, caStaff.id, lateEvening);
      expect(ok.reportedWithinDeadline).toBe(true);
      const pastMidnight = new Date('2026-10-19T19:00:00.000Z'); // 20 Oct 00:30 IST, 8 days
      const late = await placementService.reportClaim('pl-100', dto, caStaff.id, pastMidnight);
      expect(late.reportedWithinDeadline).toBe(false);
    });

    it("a replacement worker cannot have left before his own joining day (the window still counts from the first worker's)", async () => {
      const replacement = { ...basePlacement, id: 'pl-101', rootPlacementId: 'pl-100', joinedDate: new Date('2026-10-20T05:00:00.000Z') };
      prisma.placement.findFirst.mockResolvedValue(replacement);
      prisma.placement.findUnique.mockResolvedValue(basePlacement);
      await expect(placementService.reportClaim('pl-101', dto, caStaff.id, new Date('2026-10-22T12:00:00.000Z'))).rejects.toThrow('earlier than the joining day (2026-10-20)');
    });

    it('a call agent or Team Lead outside the placement scope gets 404', async () => {
      prisma.placement.findFirst
        .mockResolvedValueOnce(basePlacement) // the placement itself
        .mockResolvedValueOnce(null); // not in the person's scope
      await expect(placementService.reportClaim('pl-100', dto, caStaff.id, now)).rejects.toThrow(NotFoundException);
    });
  });

  describe('Owner decision 14 Nov: reporting again after a rejection', () => {
    const dto: ReportClaimDto = { workerLeftOn: '2026-10-12', reason: 'resigned', callRecordId: validOwnerCall.id };
    const now = new Date('2026-10-15T12:00:00.000Z'); // 3 days after leaving; window ends 19 Oct
    const past = (over: Record<string, unknown>) => ({
      code: 'RCL-00001', workerLeftOn: new Date('2026-10-12T00:00:00.000Z'), reportedAt: new Date('2026-10-13T06:00:00.000Z'),
      decision: 'rejected', decisionReason: 'x', rejectionCode: null, decidedByStaffId: 'tl-1', overruledByStaffId: null, ...over,
    });
    const withPast = (...claims: Array<Record<string, unknown>>) => prisma.replacementClaim.findMany.mockResolvedValue(claims);

    it.each([
      ['reported_late', 'more than 7 days'],
      ['fee_unpaid', 'fee was not paid'],
      ['reason_not_covered', 'not covered by the guarantee'],
    ])('never again after an automatic "%s" rejection, not even by the CEO', async (code, words) => {
      withPast(past({ rejectionCode: code, decidedByStaffId: null }));
      for (const actor of [caStaff.id, mgrStaff.id, ceoStaff.id]) {
        await expect(placementService.reportClaim('pl-100', dto, actor, now)).rejects.toThrow(words);
      }
      expect(prisma.replacementClaim.create).not.toHaveBeenCalled();
    });

    it('reads older automatic rejections (no code) from their text', async () => {
      withPast(past({ decidedByStaffId: null, decisionReason: 'Auto-rejected: Reported 9 days after worker left; deadline is 7 days' }));
      await expect(placementService.reportClaim('pl-100', dto, ceoStaff.id, now)).rejects.toThrow('more than 7 days');
    });

    it('a fixable mistake (wrong details / no owner call): one more report by anyone, within the original 7 days', async () => {
      withPast(past({ rejectionCode: 'wrong_details' }));
      await expect(placementService.reportClaim('pl-100', dto, caStaff.id, now)).resolves.toBeTruthy();
      withPast(past({ rejectionCode: 'no_owner_call' }));
      await expect(placementService.reportClaim('pl-100', dto, caStaff.id, now)).resolves.toBeTruthy();
    });

    it('…but not after the 7 days, and not a second time — then only a Manager or the CEO', async () => {
      withPast(past({ rejectionCode: 'wrong_details' }));
      const late = new Date('2026-10-20T12:00:00.000Z'); // window ended 19 Oct
      await expect(placementService.reportClaim('pl-100', dto, caStaff.id, late)).rejects.toThrow('only a Manager or the CEO');
      withPast(past({ code: 'RCL-00002', rejectionCode: 'wrong_details', reportedAt: new Date('2026-10-14T06:00:00.000Z') }), past({ rejectionCode: 'no_owner_call' }));
      await expect(placementService.reportClaim('pl-100', dto, caStaff.id, now)).rejects.toThrow('already reported once more');
      await expect(placementService.reportClaim('pl-100', dto, mgrStaff.id, now)).resolves.toBeTruthy();
    });

    it('after a person reviewed and rejected it, only a Manager or the CEO reports it again', async () => {
      withPast(past({ rejectionCode: 'reviewed' }));
      for (const actor of [caStaff.id, tlStaff.id, faStaff.id]) {
        prisma.callRecord.findUnique.mockResolvedValueOnce({ ...validOwnerCall, staffId: actor });
        await expect(placementService.reportClaim('pl-100', dto, actor, now)).rejects.toThrow('only a Manager or the CEO');
      }
      await expect(placementService.reportClaim('pl-100', dto, mgrStaff.id, now)).resolves.toBeTruthy();
      await expect(placementService.reportClaim('pl-100', dto, ceoStaff.id, now)).resolves.toBeTruthy();
    });

    it('an accepted earlier claim does not block reporting', async () => {
      withPast(past({ decision: 'accepted' }));
      await expect(placementService.reportClaim('pl-100', dto, caStaff.id, now)).resolves.toBeTruthy();
    });

    it('automatic rejections are stored with their code', async () => {
      withPast();
      const late = await placementService.reportClaim('pl-100', dto, caStaff.id, new Date('2026-10-25T12:00:00.000Z'));
      expect(late.rejectionCode).toBe('reported_late');
      const notCovered = await placementService.reportClaim('pl-100', { ...dto, reason: 'business_closed' }, caStaff.id, now);
      expect(notCovered.rejectionCode).toBe('reason_not_covered');
    });

    it("the decider's rejection records why (fixable or reviewed); anything else is refused", async () => {
      const pendingClaim = { ...past({ decision: null }), id: 'claim-30', placementId: 'pl-100', reason: 'resigned', reportedByStaffId: 'ca-1', placement: basePlacement };
      prisma.replacementClaim.findFirst.mockResolvedValue(pendingClaim);
      await placementService.decideClaim('pl-100', 'claim-30', { decision: 'rejected', decisionReason: 'Wrong date', rejectionCode: 'wrong_details' }, tlStaff.id);
      expect(prisma.replacementClaim.updateMany).toHaveBeenLastCalledWith(expect.objectContaining({ data: expect.objectContaining({ rejectionCode: 'wrong_details' }) }));
      await placementService.decideClaim('pl-100', 'claim-30', { decision: 'rejected', decisionReason: 'Not true' }, tlStaff.id);
      expect(prisma.replacementClaim.updateMany).toHaveBeenLastCalledWith(expect.objectContaining({ data: expect.objectContaining({ rejectionCode: 'reviewed' }) }));
      await expect(placementService.decideClaim('pl-100', 'claim-30', { decision: 'rejected', decisionReason: 'x', rejectionCode: 'reported_late' }, tlStaff.id)).rejects.toThrow(BadRequestException);
    });
  });

  describe('PR #137 re-check: automatic codes, deciding at the same moment, evidence race, claim list scope', () => {
    const autoRejected = {
      id: 'claim-40', code: 'RCL-00040', placementId: 'pl-100', workerLeftOn: new Date('2026-10-01T00:00:00.000Z'), reportedAt: new Date('2026-10-14T00:00:00.000Z'),
      reason: 'resigned', decision: 'rejected', decisionReason: 'Auto-rejected: Reported 13 days after worker left; deadline is 7 days', rejectionCode: 'reported_late',
      decidedByStaffId: null, decidedAt: new Date('2026-10-14T00:00:00.000Z'), overruledByStaffId: null, overruleReason: null, reportedByStaffId: 'ca-1', placement: basePlacement,
    };

    it('a Manager overruling an automatic rejection but keeping it rejected keeps the automatic code (never re-reportable)', async () => {
      prisma.replacementClaim.findFirst.mockResolvedValue(autoRejected);
      await placementService.decideClaim('pl-100', 'claim-40', { decision: 'rejected', decisionReason: 'Detail was wrong', rejectionCode: 'wrong_details' }, mgrStaff.id);
      expect(prisma.replacementClaim.updateMany).toHaveBeenLastCalledWith(expect.objectContaining({ data: expect.objectContaining({ rejectionCode: 'reported_late', overruledByStaffId: mgrStaff.id }) }));
    });

    it('…while overruling it to accepted stays allowed (owner decision 14 Nov)', async () => {
      prisma.replacementClaim.findFirst.mockResolvedValue(autoRejected);
      const res = await placementService.decideClaim('pl-100', 'claim-40', { decision: 'accepted', decisionReason: 'Owner told us on day 2; logged late by us' }, mgrStaff.id);
      expect(res.decision).toBe('accepted');
      expect(prisma.replacementClaim.updateMany).toHaveBeenLastCalledWith(expect.objectContaining({ data: expect.objectContaining({ decision: 'accepted', rejectionCode: null }) }));
    });

    it('an older automatic rejection overruled and kept rejected is still read as automatic', () => {
      expect(rejectionCodeOf({ ...autoRejected, rejectionCode: null, overruledByStaffId: 'mgr-1' })).toBe('reported_late');
    });

    it('an accept and a reject at the same moment: the second finds the claim already decided (409) and changes nothing', async () => {
      const pending = { ...autoRejected, id: 'claim-41', decision: null, decisionReason: null, rejectionCode: null, decidedAt: null };
      prisma.replacementClaim.findFirst.mockResolvedValue(pending);
      prisma.replacementClaim.updateMany.mockResolvedValueOnce({ count: 1 }).mockResolvedValueOnce({ count: 0 });
      // Both read the claim while it was still undecided (findFirst answers "pending" to both).
      await expect(placementService.decideClaim('pl-100', 'claim-41', { decision: 'accepted', decisionReason: 'Confirmed' }, tlStaff.id)).resolves.toBeTruthy();
      await expect(placementService.decideClaim('pl-100', 'claim-41', { decision: 'rejected', decisionReason: 'Not true' }, mgrStaff.id)).rejects.toMatchObject({ status: 409 });
      // both read the claim undecided, so both asked only "if still undecided"
      for (const call of prisma.replacementClaim.updateMany.mock.calls) {
        expect((call[0] as { where: unknown }).where).toEqual({ id: 'claim-41', decision: null, overruledByStaffId: null });
      }
      expect(prisma.vacancy.create).toHaveBeenCalledTimes(1);
    });

    it('two claims using the same owner call at the same moment: the second is refused (409)', async () => {
      const dto: ReportClaimDto = { workerLeftOn: '2026-10-12', reason: 'resigned', callRecordId: validOwnerCall.id };
      prisma.replacementClaim.create.mockRejectedValueOnce(
        new Prisma.PrismaClientKnownRequestError('Unique constraint failed', { code: 'P2002', clientVersion: 'test', meta: { target: 'ReplacementClaim_one_claim_per_call' } }),
      );
      await expect(placementService.reportClaim('pl-100', dto, caStaff.id, new Date('2026-10-15T12:00:00.000Z'))).rejects.toThrow('already the evidence of another claim');
    });

    it('the claim list is scoped for agents and Team Leads (404 outside), open to Managers, the CEO and Finance', async () => {
      prisma.placement.findFirst.mockResolvedValueOnce(basePlacement).mockResolvedValueOnce(null);
      await expect(placementService.listClaims('pl-100', { id: 'ca-1', role: 'call_agent' })).rejects.toThrow(NotFoundException);
      prisma.placement.findFirst.mockResolvedValueOnce(basePlacement).mockResolvedValueOnce({ id: 'pl-100' });
      await expect(placementService.listClaims('pl-100', { id: 'tl-1', role: 'team_lead' })).resolves.toEqual([]);
      prisma.placement.findFirst.mockResolvedValue(basePlacement);
      for (const role of ['manager', 'ceo', 'finance']) {
        await expect(placementService.listClaims('pl-100', { id: 'x', role })).resolves.toEqual([]);
      }
    });
  });

  describe('PR #137 review: deciding a claim', () => {
    const pending = {
      id: 'claim-20', code: 'RCL-00020', placementId: 'pl-100', workerLeftOn: new Date('2026-10-12T00:00:00.000Z'), reportedAt: new Date('2026-10-14T00:00:00.000Z'),
      reason: 'resigned', decision: null, decisionReason: null, decidedByStaffId: null, decidedAt: null, overruledByStaffId: null, overruleReason: null,
      reportedByStaffId: 'ca-1', placement: basePlacement,
    };

    it('two acceptances never create two replacement vacancies: the second finds the placement no longer active (409)', async () => {
      prisma.replacementClaim.findFirst.mockResolvedValue(pending);
      prisma.placement.updateMany.mockResolvedValueOnce({ count: 1 }).mockResolvedValueOnce({ count: 0 });
      const dto: DecideClaimDto = { decision: 'accepted', decisionReason: 'Resignation confirmed' };
      await placementService.decideClaim('pl-100', 'claim-20', dto, tlStaff.id);
      await expect(placementService.decideClaim('pl-100', 'claim-20', dto, mgrStaff.id)).rejects.toMatchObject({ status: 409 });
      expect(prisma.vacancy.create).toHaveBeenCalledTimes(1);
    });

    it('the person who reported a claim does not decide it', async () => {
      prisma.replacementClaim.findFirst.mockResolvedValue({ ...pending, reportedByStaffId: 'tl-1' });
      await expect(placementService.decideClaim('pl-100', 'claim-20', { decision: 'accepted', decisionReason: 'x' }, tlStaff.id)).rejects.toThrow('someone else decides it');
    });

    it('a Team Lead decides only when the business is on their team, also when it has no account agent', async () => {
      prisma.replacementClaim.findFirst.mockResolvedValue({ ...pending, placement: { ...basePlacement, business: { id: 'bz-200', accountAgentId: null, leadCreatedByStaffId: null } } });
      await expect(placementService.decideClaim('pl-100', 'claim-20', { decision: 'accepted', decisionReason: 'x' }, tlStaff.id)).rejects.toThrow(ForbiddenException);
      prisma.replacementClaim.findFirst.mockResolvedValue({ ...pending, placement: { ...basePlacement, business: { id: 'bz-200', accountAgentId: null, leadCreatedByStaffId: 'ca-1' } } });
      await expect(placementService.decideClaim('pl-100', 'claim-20', { decision: 'rejected', decisionReason: 'x' }, tlStaff.id)).resolves.toBeTruthy();
    });

    it('overruling an acceptance puts the placement back only when this claim dropped it out', async () => {
      const accepted = { ...pending, decision: 'accepted', decidedByStaffId: 'tl-1' };
      prisma.replacementClaim.findFirst.mockResolvedValueOnce({ ...accepted, placement: { ...basePlacement, status: 'dropped_out', dropoutReportedAt: pending.reportedAt } });
      await placementService.decideClaim('pl-100', 'claim-20', { decision: 'rejected', decisionReason: 'Worker is still there' }, mgrStaff.id);
      expect(prisma.placement.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ id: 'pl-100', status: 'dropped_out' }), data: expect.objectContaining({ status: 'active' }) }));

      prisma.placement.updateMany.mockClear();
      // dropped out by something else (another claim, a no-show): left alone
      prisma.replacementClaim.findFirst.mockResolvedValueOnce({ ...accepted, placement: { ...basePlacement, status: 'dropped_out', dropoutReportedAt: new Date('2026-10-20T00:00:00.000Z') } });
      await placementService.decideClaim('pl-100', 'claim-20', { decision: 'rejected', decisionReason: 'x' }, mgrStaff.id);
      expect(prisma.placement.updateMany).not.toHaveBeenCalled();

      // a first-time rejection never reactivates a dropped-out placement
      prisma.replacementClaim.findFirst.mockResolvedValueOnce({ ...pending, placement: { ...basePlacement, status: 'dropped_out', dropoutReportedAt: pending.reportedAt } });
      await placementService.decideClaim('pl-100', 'claim-20', { decision: 'rejected', decisionReason: 'x' }, mgrStaff.id);
      expect(prisma.placement.updateMany).not.toHaveBeenCalled();
    });
  });

  describe('checkOverdueClaims', () => {
    it('raises claim_decision_overdue ReviewFlag to manager when decisionDueAt is passed', async () => {
      const overdueClaim = {
        id: 'claim-overdue-1',
        code: 'RCL-00099',
        placementId: 'pl-100',
        decision: null,
        decisionDueAt: new Date('2026-10-14T10:00:00.000Z'),
        placement: basePlacement,
      };

      prisma.replacementClaim.findMany.mockResolvedValueOnce([overdueClaim]);

      const now = new Date('2026-10-15T00:00:00.000Z');
      const count = await placementService.checkOverdueClaims(now);

      expect(count).toBe(1);
      expect(reviewFlagService.raise).toHaveBeenCalledWith(
        expect.objectContaining({
          kind: 'claim_decision_overdue',
          subjectType: 'replacement_claim',
          subjectId: 'claim-overdue-1',
          raisedForStaffId: mgrStaff.id,
        }),
      );
    });

    it('does not duplicate an existing open flag on a second run', async () => {
      const overdueClaim = {
        id: 'claim-overdue-1',
        code: 'RCL-00099',
        placementId: 'pl-100',
        decision: null,
        decisionDueAt: new Date('2026-10-14T10:00:00.000Z'),
        placement: basePlacement,
      };

      prisma.replacementClaim.findMany.mockResolvedValueOnce([overdueClaim]);
      prisma.reviewFlag.findFirst.mockResolvedValueOnce({ id: 'existing-flag' }); // already open flag

      const now = new Date('2026-10-15T00:00:00.000Z');
      const count = await placementService.checkOverdueClaims(now);

      expect(count).toBe(0);
      expect(reviewFlagService.raise).not.toHaveBeenCalled();
    });
  });

  describe('listClaims', () => {
    it('lists all claims for the given placement', async () => {
      const mockClaims = [
        { id: 'claim-1', code: 'RCL-00001', placementId: 'pl-100', reason: 'resigned' },
      ];
      prisma.replacementClaim.findMany.mockResolvedValueOnce(mockClaims);

      const result = await placementService.listClaims('pl-100');
      expect(result).toEqual(mockClaims);
    });
  });
});
