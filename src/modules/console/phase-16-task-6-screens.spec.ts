import { UpiCollectionService } from '../payment/upi-collection.service';

describe('Phase 16 Task 6 screens', () => {
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
