import { ForbiddenException } from '@nestjs/common';
import { PlacementInvoiceCopyController } from './placement.controller';
import { INVOICE_LINK_VALID_DAYS, invoiceLink, invoiceToken, isValidInvoiceToken } from './invoice-link';
import { RECEIPT_LINK_VALID_DAYS, isValidReceiptToken, receiptToken } from '../payment/receipt-link';
import { renderInvoicePage } from './invoice-page';
import { GstInvoiceResponse } from './dto/gst-invoice.dto';

const invoice: GstInvoiceResponse = {
  invoiceNumber: 'INV-00007',
  invoiceDate: '2026-11-11T06:00:00.000Z',
  supplier: { legalName: 'Laboura Private Limited', gstin: 'GSTIN_PENDING_REGISTRATION', address: 'Bengaluru', state: 'Karnataka', stateCode: '29' },
  customer: {
    businessId: 'b-1', businessCode: 'BZ-00012', businessName: 'Sri Sai <Hotel>', contactName: null, gstin: null,
    address: '27th Main', locality: 'HSR Layout', city: 'Bengaluru', state: 'Karnataka', stateCode: '29',
  },
  placement: {
    placementId: 'pl-1', placementCode: 'PL-00003', candidateCode: 'JS-00042', candidateName: 'Ramesh Kumar',
    tradeSkill: 'Electrician', monthlySalaryPaise: 1600000, joinedDate: null,
  },
  lineItems: [{
    itemNumber: 1, description: 'Placement fee', sacCode: '9985', baseAmountPaise: 800000, taxRatePercent: 18,
    cgstRatePercent: 9, cgstAmountPaise: 72000, sgstRatePercent: 9, sgstAmountPaise: 72000,
    igstRatePercent: 0, igstAmountPaise: 0, totalAmountPaise: 944000,
  }],
  summary: { subtotalPaise: 800000, totalTaxPaise: 144000, totalAmountPaise: 944000, currency: 'INR', amountInWords: '₹9,440' },
};

describe('Business invoice copy by signed link', () => {
  const originalSecret = process.env.JWT_SECRET;
  const originalUrl = process.env.PUBLIC_APP_URL;
  beforeAll(() => {
    process.env.JWT_SECRET = 'test-secret-that-is-at-least-32-characters';
    process.env.PUBLIC_APP_URL = 'https://app.laboura.in';
  });
  afterAll(() => {
    if (originalSecret === undefined) delete process.env.JWT_SECRET; else process.env.JWT_SECRET = originalSecret;
    if (originalUrl === undefined) delete process.env.PUBLIC_APP_URL; else process.env.PUBLIC_APP_URL = originalUrl;
  });

  it('signs the placement id, so the id alone or another placement token opens nothing', () => {
    // One fixed time for the token and the link: the expiry is in seconds, so two
    // separate clock reads across a second boundary gave two different tokens (flaky in CI).
    const now = new Date();
    const token = invoiceToken('pl-1', now);
    expect(isValidInvoiceToken('pl-1', token)).toBe(true);
    expect(isValidInvoiceToken('pl-2', token)).toBe(false);
    expect(isValidInvoiceToken('pl-1', undefined)).toBe(false);
    expect(isValidInvoiceToken('pl-1', 'x')).toBe(false);
    expect(invoiceLink('pl-1', now)).toBe(`https://app.laboura.in/placements/pl-1/invoice/copy?token=${token}`);
  });

  it('opens the invoice for a valid token (JSON for API clients, printable page for a browser) and refuses others', async () => {
    const service = { getInvoiceForBusiness: jest.fn().mockResolvedValue(invoice) };
    const controller = new PlacementInvoiceCopyController(service as never);
    const res = { setHeader: jest.fn() };
    await expect(controller.invoiceCopy('pl-1', 'forged', 'text/html', res as never)).rejects.toBeInstanceOf(ForbiddenException);
    expect(service.getInvoiceForBusiness).not.toHaveBeenCalled();

    const json = await controller.invoiceCopy('pl-1', invoiceToken('pl-1'), 'application/json', res as never);
    expect(json).toBe(invoice);
    const html = await controller.invoiceCopy('pl-1', invoiceToken('pl-1'), 'text/html', res as never) as string;
    expect(html).toContain('INV-00007');
    expect(html).toContain('₹9,440');
    expect(html).toContain('Sri Sai &lt;Hotel&gt;');
    expect(html).not.toContain('<Hotel>');
    expect(res.setHeader).toHaveBeenCalledWith('Cache-Control', 'private, no-store');
  });

  it('renders CGST and SGST lines and the total', () => {
    const html = renderInvoicePage(invoice);
    expect(html).toContain('CGST 9%');
    expect(html).toContain('SGST 9%');
    expect(html).toContain('₹8,000');
  });
});

describe('AC-5: receipt and invoice links expire', () => {
  const originalSecret = process.env.JWT_SECRET;
  beforeAll(() => { process.env.JWT_SECRET = 'test-secret-that-is-at-least-32-characters'; });
  afterAll(() => { if (originalSecret === undefined) delete process.env.JWT_SECRET; else process.env.JWT_SECRET = originalSecret; });
  const day = 24 * 60 * 60 * 1000;
  const issued = new Date('2026-11-16T06:00:00.000Z');

  it.each([
    ['invoice', invoiceToken, isValidInvoiceToken, INVOICE_LINK_VALID_DAYS],
    ['receipt', receiptToken, isValidReceiptToken, RECEIPT_LINK_VALID_DAYS],
  ] as const)('%s: valid until its days are up, refused after', (_name, sign, verify, days) => {
    const token = sign('id-1', issued);
    expect(verify('id-1', token, new Date(issued.getTime() + (days * day) - 1000))).toBe(true);
    expect(verify('id-1', token, new Date(issued.getTime() + (days * day) + 1000))).toBe(false);
  });

  it.each([
    ['invoice', invoiceToken, isValidInvoiceToken],
    ['receipt', receiptToken, isValidReceiptToken],
  ] as const)('%s: the expiry cannot be pushed out, and old tokens without one are refused', (_name, sign, verify) => {
    const token = sign('id-1', issued);
    const [expiry, sig] = token.split('.');
    const later = (parseInt(expiry, 36) + 365 * 24 * 3600).toString(36);
    expect(verify('id-1', `${later}.${sig}`, issued)).toBe(false);
    expect(verify('id-1', sig, issued)).toBe(false);
    expect(verify('id-1', `${expiry}.${sig}.x`, issued)).toBe(false);
  });

  it('the days live in named constants', () => {
    expect(INVOICE_LINK_VALID_DAYS).toBeGreaterThan(0);
    expect(RECEIPT_LINK_VALID_DAYS).toBeGreaterThan(0);
  });
});
