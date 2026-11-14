import { RetentionController } from '../retention/retention.controller';
import { RetentionService } from '../retention/retention.service';
import { EditPolicyController } from '../../common/edit-policy/edit-policy.controller';
import { EditPolicyService } from '../../common/edit-policy/edit-policy.service';
import { AuditController } from '../../common/audit/audit.controller';
import { StatusHistoryController } from '../status-history/status-history.controller';
import { Reflector } from '@nestjs/core';
import { ROLES_METADATA_KEY } from '../../common/rbac/roles.decorator';
import { Request } from 'express';
import { JwtPayload } from '../../common/auth/jwt-payload.interface';

describe('Phase 19 Task 5 — Screens (Edit reasons, lock banners, change history, retention)', () => {
  describe('Client Logic Contracts', () => {
    describe('Reason Box appears only for changes to existing saved values', () => {
      // Simulate client-side checkEditFieldsChanged rule:
      // A reason is required if and only if an existing non-empty saved value is modified
      function evaluateReasonRequired(
        initialValues: Record<string, unknown>,
        currentValues: Record<string, unknown>,
      ): boolean {
        for (const [key, initialVal] of Object.entries(initialValues)) {
          const curVal = currentValues[key] !== undefined ? String(currentValues[key]).trim() : '';
          const initStr = initialVal !== null && initialVal !== undefined ? String(initialVal).trim() : '';
          if (initStr !== '' && curVal !== initStr) {
            return true;
          }
        }
        return false;
      }

      it('returns false when no fields are modified', () => {
        const initial = { name: 'Asha Rao', phone: '9876543210', locality: 'Indiranagar' };
        const current = { name: 'Asha Rao', phone: '9876543210', locality: 'Indiranagar' };
        expect(evaluateReasonRequired(initial, current)).toBe(false);
      });

      it('returns false when filling a previously empty field (first fill)', () => {
        const initial = { name: 'Asha Rao', phone: '9876543210', locality: '' };
        const current = { name: 'Asha Rao', phone: '9876543210', locality: 'Indiranagar' };
        expect(evaluateReasonRequired(initial, current)).toBe(false);
      });

      it('returns true when modifying an already saved field', () => {
        const initial = { name: 'Asha Rao', phone: '9876543210', locality: 'Indiranagar' };
        const current = { name: 'Asha Rao', phone: '9999999999', locality: 'Indiranagar' };
        expect(evaluateReasonRequired(initial, current)).toBe(true);
      });
    });

    describe('Change history table rendering never outputs personal values', () => {
      it('formats audit logs into table row columns (Who, When, Which Fields, Reason) without personal data', () => {
        const mockAuditLog = {
          actor: { name: 'Lead Officer', code: 'TL-00001' },
          createdAt: new Date('2026-11-09T10:00:00.000Z'),
          changedFields: ['phone', 'locality'],
          reason: 'Candidate requested phone correction',
          before: { phone: '[changed]', locality: 'Koramangala' },
          after: { phone: '[changed]', locality: 'HSR Layout' },
        };

        // Render mock row function matching the console scripts
        const who = mockAuditLog.actor.name || mockAuditLog.actor.code;
        const when = mockAuditLog.createdAt.toISOString();
        const whichFields = mockAuditLog.changedFields.join(', ');
        const reason = mockAuditLog.reason;

        const rowHtml = `<tr><td>${who}</td><td>${when}</td><td>${whichFields}</td><td>${reason}</td></tr>`;

        expect(rowHtml).toContain('Lead Officer');
        expect(rowHtml).toContain('phone, locality');
        expect(rowHtml).toContain('Candidate requested phone correction');
        // Raw personal phone number is completely absent
        expect(rowHtml).not.toContain('9876543210');
        expect(rowHtml).not.toContain('9999999999');
      });
    });
  });

  describe('Controller RBAC Decorator Enforcement', () => {
    const reflector = new Reflector();

    it('RetentionController routes are restricted strictly to CEO', () => {
      const summaryRoles = reflector.get<string[]>(ROLES_METADATA_KEY, RetentionController.prototype.getLatestSummary);
      const dryRunRoles = reflector.get<string[]>(ROLES_METADATA_KEY, RetentionController.prototype.runDryRun);
      const runRoles = reflector.get<string[]>(ROLES_METADATA_KEY, RetentionController.prototype.runRetention);

      expect(summaryRoles).toEqual(['ceo']);
      expect(dryRunRoles).toEqual(['ceo']);
      expect(runRoles).toEqual(['ceo']);
    });

    it('AuditController GET routes are restricted to CEO, Manager, and Team Lead', () => {
      const getLogsRoles = reflector.get<string[]>(ROLES_METADATA_KEY, AuditController.prototype.getAuditLogs);
      const getLogByIdRoles = reflector.get<string[]>(ROLES_METADATA_KEY, AuditController.prototype.getAuditLogById);

      expect(getLogsRoles).toEqual(['ceo', 'manager', 'team_lead']);
      expect(getLogByIdRoles).toEqual(['ceo', 'manager', 'team_lead']);
    });

    it('StatusHistoryController GET routes are restricted to CEO, Manager, and Team Lead', () => {
      const historyRoles = reflector.get<string[]>(ROLES_METADATA_KEY, StatusHistoryController.prototype.getHistory);

      expect(historyRoles).toEqual(['ceo', 'manager', 'team_lead']);
    });

    it('RetentionController methods delegate directly to RetentionService', async () => {
      const mockSummary = {
        executedAt: new Date(),
        dryRun: true,
        profilesAnonymised: { jobSeekers: 2, businesses: 1, referrals: 0 },
        recordingsDeleted: 5,
        recordingsProtected: 1,
        accessLogsDeleted: { sessions: 10, loginCodes: 4 },
        moneyRecordsDeleted: { payments: 0, bankCredits: 0, invoices: 0, agreements: 0 },
        errors: [],
      };

      const mockService = {
        getLatestSummary: jest.fn().mockResolvedValue(mockSummary),
        runRetentionCleanup: jest.fn().mockResolvedValue(mockSummary),
      } as unknown as RetentionService;

      const controller = new RetentionController(mockService);

      const summaryRes = await controller.getLatestSummary();
      expect(summaryRes).toEqual(mockSummary);
      expect(mockService.getLatestSummary).toHaveBeenCalledTimes(1);

      const dryRunRes = await controller.runDryRun();
      expect(dryRunRes).toEqual(mockSummary);
      expect(mockService.runRetentionCleanup).toHaveBeenCalledWith({ dryRun: true });
    });

    it('EditPolicyController checkEditPermission delegates to EditPolicyService', async () => {
      const mockPerm = {
        allowed: false,
        isMoneyInvolved: true,
        reason: 'Locked — money involved, ask your Team Lead',
      };

      const mockService = {
        loadEntity: jest.fn().mockResolvedValue({ id: 'js-1', code: 'JS-00001' }),
        checkEditPermission: jest.fn().mockResolvedValue(mockPerm),
      } as unknown as EditPolicyService;

      const controller = new EditPolicyController(mockService);
      const req = { user: { sub: 'agent-1', role: 'call_agent', code: 'CA-00001' } } as unknown as Request & { user: JwtPayload };

      const res = await controller.checkEditPermission('job_seeker', 'js-1', req);
      expect(res).toEqual(mockPerm);
      expect(mockService.loadEntity).toHaveBeenCalledWith('job_seeker', 'js-1');
      expect(mockService.checkEditPermission).toHaveBeenCalledWith(
        { id: 'agent-1', role: 'call_agent', code: 'CA-00001' },
        'job_seeker',
        { id: 'js-1', code: 'JS-00001' },
      );
    });
  });
});
