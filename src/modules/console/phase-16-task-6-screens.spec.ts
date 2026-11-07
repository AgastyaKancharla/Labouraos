import { renderAdminDashboardHtml } from './templates/admin-dashboard.html';
import { renderCallAgentConsoleHtml } from './templates/call-agent-console.html';
import { renderFieldAgentAppHtml } from './templates/field-agent-app.html';
import { UpiCollectionService } from '../payment/upi-collection.service';

describe('Phase 16 Task 6 screens', () => {
  describe('Finance & Management Screen (Admin Dashboard)', () => {
    it('renders Finance pending payments, unmatched bank credits, add credit form, match, ignore, and payment_mismatch flags', () => {
      const html = renderAdminDashboardHtml();

      // Pending payments table
      expect(html).toContain('Pending Payments Awaiting Confirmation');
      expect(html).toContain('Payer\'s UTR Hint');
      expect(html).toContain('pending-payments-tbody');
      expect(html).toContain('promptMatchPayment');

      // Unmatched bank credits table
      expect(html).toContain('Unmatched Bank Credits');
      expect(html).toContain('bank-credits-tbody');
      expect(html).toContain('promptMatchCredit');
      expect(html).toContain('promptIgnoreBankCredit');

      // Add bank credit form
      expect(html).toContain('Add Bank Credit (From Bank Statement)');
      expect(html).toContain('id="credit-utr"');
      expect(html).toContain('id="credit-amount"');
      expect(html).toContain('id="credit-received-at"');
      expect(html).toContain('submitAddBankCredit');

      // Payment mismatch flags
      expect(html).toContain('Payment Mismatch Flags');
      expect(html).toContain('mismatch-flags-tbody');
      expect(html).toContain('promptResolveFlag');

      // Placements payment status & resend payment link
      expect(html).toContain('Payment status');
      expect(html).toContain('Awaiting payment');
      expect(html).toContain('Overdue');
      expect(html).toContain('Paid');
      expect(html).toContain('Resend payment link');
      expect(html).toContain('resendPlacementPayment');
      expect(html).toContain('resendSeekerPayment');
    });
  });

  describe('Agent Consoles (Call Agent & Field Agent)', () => {
    it('renders payment status and resend payment link for Call Agents', () => {
      const html = renderCallAgentConsoleHtml();

      // Placement status view
      expect(html).toContain('Placement Payment Status');
      expect(html).toContain('Awaiting payment');
      expect(html).toContain('Overdue');
      expect(html).toContain('Paid');
      expect(html).toContain('Resend payment link');

      // Calling & profile payment status
      expect(html).toContain('profile-payment-status-row');
      expect(html).toContain('profile-card-payment-status');
      expect(html).toContain('btn-resend-profile-payment');
      expect(html).toContain('resendCurrentProfilePayment');

      // Strictly NO "mark as paid" button
      expect(html.toLowerCase()).not.toContain('mark as paid');
      expect(html.toLowerCase()).not.toContain('mark paid');
    });

    it('renders payment status and resend payment link for Field Agents', () => {
      const html = renderFieldAgentAppHtml();

      // Placement status view in interviews
      expect(html).toContain('My Interviews');
      expect(html).toContain('Awaiting payment');
      expect(html).toContain('Paid');
      expect(html).toContain('Resend payment link');

      // Strictly NO "mark as paid" button
      expect(html.toLowerCase()).not.toContain('mark as paid');
      expect(html.toLowerCase()).not.toContain('mark paid');
    });
  });

  describe('Public Payment Page', () => {
    const originalVpa = process.env.COMPANY_UPI_VPA;
    const originalPayee = process.env.COMPANY_UPI_PAYEE_NAME;

    beforeAll(() => {
      process.env.COMPANY_UPI_VPA = 'laboura@icici';
      process.env.COMPANY_UPI_PAYEE_NAME = 'Laboura Staffing Services';
    });

    afterAll(() => {
      if (originalVpa === undefined) delete process.env.COMPANY_UPI_VPA;
      else process.env.COMPANY_UPI_VPA = originalVpa;
      if (originalPayee === undefined) delete process.env.COMPANY_UPI_PAYEE_NAME;
      else process.env.COMPANY_UPI_PAYEE_NAME = originalPayee;
    });

    it('renders responsive mobile viewport and no screenshot or file upload', async () => {
      const mockPrisma = {
        payment: {
          findUnique: jest.fn().mockResolvedValue({
            id: 'pay-uuid-1',
            code: 'PAY-00001',
            type: 'activation',
            method: 'upi_direct',
            status: 'pending',
            expectedAmountPaise: 49900,
            upiReference: 'PAY-00001-ABCD',
            gatewayReference: null,
          }),
        },
      };

      const upiService = new UpiCollectionService(mockPrisma as never, {} as never, {} as never);
      const html = await upiService.renderPaymentPage('PAY-00001-ABCD');

      // Responsive mobile viewport
      expect(html).toContain('<meta name="viewport" content="width=device-width, initial-scale=1">');

      // Pay with UPI app button
      expect(html).toContain('Pay with a UPI app');
      expect(html).toContain('upi://pay?');

      // Pay by card option
      expect(html).toContain('Pay by card');
      expect(html).toContain('/payments/request/PAY-00001-ABCD/card');

      // 12-digit UTR hint input
      expect(html).toContain('Paid already? Enter your UPI reference number (12 digits)');
      expect(html).toContain('name="utr"');

      // Notice about bank confirmation
      expect(html).toContain("Payment is confirmed once it reaches Laboura's bank");

      // Strictly NO screenshot or file upload
      expect(html).not.toContain('type="file"');
      expect(html.toLowerCase()).not.toContain('screenshot');
      expect(html.toLowerCase()).not.toContain('upload');
    });
  });
});
