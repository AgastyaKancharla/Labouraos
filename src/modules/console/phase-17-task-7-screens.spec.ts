import { renderAdminDashboardHtml } from './templates/admin-dashboard.html';
import { renderCallAgentConsoleHtml } from './templates/call-agent-console.html';
import { renderFieldAgentAppHtml } from './templates/field-agent-app.html';

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

  describe('Call Agent Console', () => {
    const html = renderCallAgentConsoleHtml();

    it('renders placement view with joining checklist, guarantee days left, replacements, rejections, and open claim', () => {
      expect(html).toContain('Placement Payment Status');
      expect(html).toContain('Joining checklist:');
      expect(html).toContain('✓ Worker call');
      expect(html).toContain('✓ Business call');
      expect(html).toContain('Record Joining');
      expect(html).toContain('days left');
      expect(html).toContain('/ 2');
      expect(html).toContain('Open Claim:');
      expect(html).toContain('Report Claim');
    });

    it('renders claim reporting form requiring answered owner call', () => {
      expect(html).toContain('ca-claim-modal');
      expect(html).toContain('ca-claim-call-record-id');
      expect(html).toContain('ca-claim-worker-left-on');
      expect(html).toContain('ca-claim-reason');
      expect(html).toContain('submitCaClaim');
      expect(html).toContain('Answered owner call record ID is required');
    });

    it('renders My Follow-ups list for call agents and follow-up completion form with introduced businesses lookup', () => {
      // Tab and container
      expect(html).toContain('data-tab="follow-ups"');
      expect(html).toContain('My Follow-ups');
      expect(html).toContain('view-follow-ups');
      expect(html).toContain('follow-ups-tbody');
      expect(html).toContain('loadMyFollowUps');
      expect(html).toContain('/follow-up-tasks');

      // Complete modal
      expect(html).toContain('follow-up-modal');
      expect(html).toContain('follow-up-call-record-id');
      expect(html).toContain('follow-up-answer');
      expect(html).toContain('working_elsewhere');
      expect(html).toContain('not_working');
      expect(html).toContain('working_at_introduced_business');
      expect(html).toContain('no_answer');

      // Introduced businesses lookup when working at introduced business
      expect(html).toContain('follow-up-introduced-business');
      expect(html).toContain('onFollowUpAnswerChange');
      expect(html).toContain('/introduced-businesses');
      expect(html).toContain('submitCompleteFollowUp');
      expect(html).toContain('/complete');
    });

    it('enforces privacy floor: contains no full 10-digit phone number in markup or static scripts', () => {
      expect(html).not.toMatch(/(?:\+91)?[6-9]\d{9}/);
    });
  });

  describe('Field Agent App', () => {
    const html = renderFieldAgentAppHtml();

    it('renders placement details under interviews with joining checklist, guarantee, replacements, rejections, and open claim', () => {
      expect(html).toContain('Joining checklist:');
      expect(html).toContain('✓ Worker call');
      expect(html).toContain('✓ Business call');
      expect(html).toContain('Record Joining');
      expect(html).toContain('days left');
      expect(html).toContain('/ 2');
      expect(html).toContain('Open Claim:');
      expect(html).toContain('Report Claim');
    });

    it('renders claim reporting form requiring answered owner call', () => {
      expect(html).toContain('fa-claim-modal');
      expect(html).toContain('fa-claim-call-record-id');
      expect(html).toContain('fa-claim-worker-left-on');
      expect(html).toContain('fa-claim-reason');
      expect(html).toContain('submitFaClaim');
    });

    it('renders My Follow-ups list for field agents with completion form and introduced business lookup', () => {
      // Tab and container
      expect(html).toContain('data-tab="follow-ups"');
      expect(html).toContain('My Follow-ups');
      expect(html).toContain('view-follow-ups');
      expect(html).toContain('fa-follow-ups-tbody');
      expect(html).toContain('loadFaFollowUps');

      // Complete modal
      expect(html).toContain('fa-follow-up-modal');
      expect(html).toContain('fa-follow-up-call-record-id');
      expect(html).toContain('fa-follow-up-answer');
      expect(html).toContain('working_at_introduced_business');
      expect(html).toContain('fa-follow-up-introduced-business');
      expect(html).toContain('onFaFollowUpAnswerChange');
      expect(html).toContain('/introduced-businesses');
      expect(html).toContain('submitFaCompleteFollowUp');
    });

    it('enforces privacy floor: contains no full 10-digit phone number in markup or static scripts', () => {
      expect(html).not.toMatch(/(?:\+91)?[6-9]\d{9}/);
    });
  });
});
