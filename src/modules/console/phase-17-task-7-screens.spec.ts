import { renderAdminDashboardHtml } from './templates/admin-dashboard.html';

describe('Phase 17 Task 7 screens', () => {
  describe('Admin Dashboard (Management & Team Lead Screens)', () => {
    const html = renderAdminDashboardHtml();

    it('renders placement page with joining checklist, guarantee days left, replacements used, rejections used, and open claim', () => {
      // Table headers & structure
      expect(html).toContain('Joining Checklist');
      expect(html).toContain('Guarantee Days Left');
      expect(html).toContain('Replacements Used');
      expect(html).toContain('Rejections Used');
      expect(html).toContain('Open Claim');
      expect(html).toContain('placements-tbody');
      expect(html).toContain('loadPlacements');

      // Joining checklist elements & confirm button
      expect(html).toContain('✓ Worker call');
      expect(html).toContain('✗ Worker call');
      expect(html).toContain('✓ Business call');
      expect(html).toContain('✗ Business call');
      expect(html).toContain('Record Joining');
      expect(html).toContain('openJoiningModal');
      expect(html).toContain('submitAdminJoining');
      expect(html).toContain('/joined');

      // Guarantee days left calculation from root & replacement / rejection counters
      expect(html).toContain('days left');
      expect(html).toContain('/ 2'); // max replacements & rejections display format

      // Open claim indicator & due time
      expect(html).toContain('Pending · Due');
      expect(html).toContain('decisionDueAt');
    });

    it('renders replacement claim reporting form requiring answered owner call', () => {
      expect(html).toContain('Report Replacement Claim');
      expect(html).toContain('admin-claim-modal');
      expect(html).toContain('claim-placement-id');
      expect(html).toContain('claim-call-record-id');
      expect(html).toContain('Answered Owner Call Record ID');
      expect(html).toContain('claim-worker-left-on');
      expect(html).toContain('claim-reason');
      expect(html).toContain('resigned');
      expect(html).toContain('absconded');
      expect(html).toContain('misconduct');
      expect(html).toContain('performance');
      expect(html).toContain('attendance');
      expect(html).toContain('business_closed');
      expect(html).toContain('claim-notes');
      expect(html).toContain('submitAdminClaim');
      expect(html).toContain('/claims');
    });

    it('renders decision screen for Team Leads and Managers with exit call recording', () => {
      // Pending claims table
      expect(html).toContain('Replacement Claim Decisions (Team Lead & Manager)');
      expect(html).toContain('claim-decisions-card');
      expect(html).toContain('claim-decisions-tbody');
      expect(html).toContain('loadClaimDecisions');
      expect(html).toContain('/placements/claims/pending');

      // Exit call recording link/listen button
      expect(html).toContain('Exit Call Recording');
      expect(html).toContain('Listen Exit Call');
      expect(html).toContain('Missing exit call');

      // Accept & Reject actions
      expect(html).toContain('promptDecideClaim');
      expect(html).toContain('accepted');
      expect(html).toContain('rejected');
      expect(html).toContain('/decide');

      // Visibility gated to Team Lead, Manager, CEO
      expect(html).toContain("const isLeadOrManager = ['team_lead', 'manager', 'ceo'].includes(payload.role)");
      expect(html).toContain('claimCard.classList.remove(\'hidden\')');
    });

    it('renders pattern and bypass flags with structured evidence for Team Leads and Managers', () => {
      expect(html).toContain('Pattern & Bypass Flags with Evidence (Team Lead & Manager)');
      expect(html).toContain('pattern-flags-card');
      expect(html).toContain('pattern-flags-tbody');
      expect(html).toContain('loadPatternFlags');
      expect(html).toContain('/review-flags?status=open');

      // Expected flag kinds
      expect(html).toContain('bypass_suspected');
      expect(html).toContain('business_many_rejections');
      expect(html).toContain('business_stopped_after_interviews');
      expect(html).toContain('agent_rejection_pattern');
      expect(html).toContain('claim_decision_overdue');

      // Resolution action
      expect(html).toContain('promptResolvePatternFlag');
      expect(html).toContain('/resolve');
    });
  });

});
