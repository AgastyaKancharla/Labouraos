import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
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

type MockPrisma = {
  staff: Record<string, jest.Mock>;
  placement: Record<string, jest.Mock>;
  callRecord: Record<string, jest.Mock>;
  statusHistory: Record<string, jest.Mock>;
  replacementClaim: Record<string, jest.Mock>;
  reviewFlag: Record<string, jest.Mock>;
  vacancy: Record<string, jest.Mock>;
  $transaction: jest.Mock;
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
      },
      placement: {
        findFirst: jest.fn().mockResolvedValue(basePlacement),
        findUnique: jest.fn().mockResolvedValue(basePlacement),
        findMany: jest.fn().mockResolvedValue([]),
        update: jest.fn().mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
          ...basePlacement,
          ...data,
        })),
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
      },
      reviewFlag: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: 'flag-1' }),
      },
      vacancy: {
        create: jest.fn().mockResolvedValue({ id: 'vac-rep-1' }),
        findUniqueOrThrow: jest.fn().mockResolvedValue(basePlacement.vacancy),
      },
      $transaction: jest.fn(async (cb: (tx: unknown) => Promise<unknown>) => cb(prisma)),
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
      // Account agent
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
      expect(prisma.placement.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'pl-100' },
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
      expect(prisma.replacementClaim.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            decision: 'accepted',
            overruledByStaff: { connect: { id: mgrStaff.id } },
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
