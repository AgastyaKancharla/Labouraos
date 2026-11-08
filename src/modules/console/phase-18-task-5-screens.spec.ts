import { renderAdminDashboardHtml } from './templates/admin-dashboard.html';
import { renderCallAgentConsoleHtml } from './templates/call-agent-console.html';
import { renderFieldAgentAppHtml } from './templates/field-agent-app.html';

describe('Phase 18 Task 5 screens', () => {
  describe('Admin Dashboard (Finance & CEO Screens)', () => {
    const html = renderAdminDashboardHtml();

    it('renders money owed waiting for approval with oldest first sort, masked account, and approve button', () => {
      // Card and section
      expect(html).toContain('finance-money-owed-card');
      expect(html).toContain('Money Owed (Waiting for Approval)');
      expect(html).toContain('money-owed-tbody');

      // Table headers
      expect(html).toContain('Payment Code');
      expect(html).toContain('Payee / Subject');
      expect(html).toContain('Created Date');
      expect(html).toContain('Masked Account');

      // Approve action
      expect(html).toContain('approveMoneyOut');
      expect(html).toContain('/payments/');
      expect(html).toContain('/approve');
    });

    it('renders approved and ready to pay table with masked account, reveal button, and record payment button', () => {
      // Card and section
      expect(html).toContain('finance-ready-to-pay-card');
      expect(html).toContain('Approved and Ready to Pay');
      expect(html).toContain('ready-to-pay-tbody');

      // Headers and columns
      expect(html).toContain('Approved Date');
      expect(html).toContain('Approved By');

      // Actions
      expect(html).toContain('openRevealPayoutModal');
      expect(html).toContain('openRecordPayoutModal');
      expect(html).toContain('Record payment');
    });

    it('renders reveal payout details modal with decrypted fields and audited notice', () => {
      expect(html).toContain('reveal-payout-modal');
      expect(html).toContain('Payout Details (Decrypted for Payment)');
      expect(html).toContain('Audited access');
      expect(html).toContain('modal-reveal-name');
      expect(html).toContain('modal-reveal-type');
      expect(html).toContain('modal-reveal-details');
      expect(html).toContain('modal-reveal-ifsc');
      expect(html).toContain('modal-reveal-masked');
      expect(html).toContain('closeRevealPayoutModal');
      expect(html).toContain('/reveal-payout-details');
    });

    it('renders record payout transfer modal with UTR, name shown in app, and paid date fields', () => {
      expect(html).toContain('record-payout-modal');
      expect(html).toContain('Record Payout Transfer');
      expect(html).toContain('record-payout-id');
      expect(html).toContain('record-payout-utr');
      expect(html).toContain('Bank UTR (12 digits / transfer reference)');
      expect(html).toContain('record-payout-receiver-name');
      expect(html).toContain('Name Shown in UPI / Bank App');
      expect(html).toContain('record-payout-paid-at');
      expect(html).toContain('submitRecordPayout');
      expect(html).toContain('/record-payout');
    });

    it('renders payout accounts in 48-hour wait (cooling period)', () => {
      expect(html).toContain('finance-cooling-accounts-card');
      expect(html).toContain('Payout Accounts in 48-Hour Wait (Cooling Period)');
      expect(html).toContain('cooling-accounts-tbody');
      expect(html).toContain('Account Code');
      expect(html).toContain('Owner Type & ID');
      expect(html).toContain('Cooling Until');
      expect(html).toContain('/payout-accounts/cooling');
    });

    it('renders payout fraud and mismatch flags with resolve action', () => {
      expect(html).toContain('finance-payout-flags-card');
      expect(html).toContain('Payout Flags (Fraud & Mismatch)');
      expect(html).toContain('payout-flags-tbody');
      expect(html).toContain('payout_shared_account');
      expect(html).toContain('payout_matches_staff');
      expect(html).toContain('payout_name_mismatch');
      expect(html).toContain('promptResolvePayoutFlag');
    });

    it('enforces RBAC visibility gating: Reveal, Record payment, and payout cards are visible only to Finance and CEO', () => {
      // Role checks in script
      expect(html).toContain("const isFinanceOrCeo = ['ceo', 'finance'].includes(payload.role)");
      expect(html).toContain("moneyOwedCard.classList.remove('hidden')");
      expect(html).toContain("moneyOwedCard.classList.add('hidden')");
      expect(html).toContain("readyToPayCard.classList.remove('hidden')");
      expect(html).toContain("readyToPayCard.classList.add('hidden')");
      expect(html).toContain("coolingAccountsCard.classList.remove('hidden')");
      expect(html).toContain("coolingAccountsCard.classList.add('hidden')");
      expect(html).toContain("payoutFlagsCard.classList.remove('hidden')");
      expect(html).toContain("payoutFlagsCard.classList.add('hidden')");
    });
  });

  describe('Call Agent Console', () => {
    const html = renderCallAgentConsoleHtml();

    it('renders payout details row and send payout link button on calling profile card', () => {
      expect(html).toContain('profile-payout-details-row');
      expect(html).toContain('profile-card-payout-status');
      expect(html).toContain('None on file');
      expect(html).toContain('btn-send-payout-link');
      expect(html).toContain('Send payout details link');
      expect(html).toContain('sendCurrentProfilePayoutLink');
      expect(html).toContain('/payout-accounts/links');
    });

    it('renders business payout details and send payout link button on business profile tab', () => {
      expect(html).toContain('business-payout-row');
      expect(html).toContain('business-payout-status');
      expect(html).toContain('btn-business-send-payout-link');
      expect(html).toContain('sendBusinessPayoutLink');
    });

    it('strictly forbids full credentials, reveal, or payment recording in Call Agent console', () => {
      // No reveal or record actions
      expect(html).not.toContain('reveal-payout');
      expect(html).not.toContain('record-payout');
      expect(html).not.toContain('openRevealPayoutModal');
      expect(html).not.toContain('openRecordPayoutModal');

      // No full details input or display
      expect(html).not.toContain('modal-reveal-details');
      expect(html).not.toContain('record-payout-utr');
    });

    it('enforces privacy floor: contains no full 10-digit phone number in markup or static scripts', () => {
      expect(html).not.toMatch(/(?:\+91)?[6-9]\d{9}/);
    });
  });

  describe('Field Agent App', () => {
    const html = renderFieldAgentAppHtml();

    it('renders payout details status and send payout link button in calling modal', () => {
      expect(html).toContain('fa-profile-payout-row');
      expect(html).toContain('fa-profile-payout-status');
      expect(html).toContain('None on file');
      expect(html).toContain('fa-btn-send-payout-link');
      expect(html).toContain('Send payout details link');
      expect(html).toContain('sendFaProfilePayoutLink');
      expect(html).toContain('/payout-accounts/links');
    });

    it('strictly forbids full credentials, reveal, or payment recording in Field Agent app', () => {
      // No reveal or record actions
      expect(html).not.toContain('reveal-payout');
      expect(html).not.toContain('record-payout');
      expect(html).not.toContain('openRevealPayoutModal');
      expect(html).not.toContain('openRecordPayoutModal');

      // No full details input or display
      expect(html).not.toContain('modal-reveal-details');
      expect(html).not.toContain('record-payout-utr');
    });

    it('enforces privacy floor: contains no full 10-digit phone number in markup or static scripts', () => {
      expect(html).not.toMatch(/(?:\+91)?[6-9]\d{9}/);
    });
  });
});
