import jsQR from 'jsqr';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { IdService } from '../../common/id/id.service';
import { MessagingService } from '../message/messaging.service';
import { buildUpiQr, UpiCollectionService } from './upi-collection.service';

describe('UpiCollectionService', () => {
  const originalVpa = process.env.COMPANY_UPI_VPA;
  const originalPayeeName = process.env.COMPANY_UPI_PAYEE_NAME;
  const originalPublicUrl = process.env.PUBLIC_APP_URL;
  const payment = {
    id: 'payment-1', code: 'PAY-00042', city: 'Bengaluru', type: 'activation', amount: 49900,
    expectedAmountPaise: 49900, status: 'pending', method: 'upi_direct', upiReference: 'PAY-00042-12ab34cd',
    subjectType: 'job_seeker', subjectId: 'seeker-1', jobSeekerId: 'seeker-1', businessId: null,
    placementId: null, gatewayReference: null,
  };
  const create = jest.fn();
  const findFirst = jest.fn();
  const findUnique = jest.fn();
  const update = jest.fn();
  const send = jest.fn().mockResolvedValue({ status: 'sent' });
  const tx = {
    $queryRaw: jest.fn().mockResolvedValue([]),
    $executeRaw: jest.fn().mockResolvedValue(1),
    payment: { findFirst, create },
    statusHistory: { create: jest.fn().mockResolvedValue({}) },
  } as unknown as Prisma.TransactionClient;
  const prisma = {
    $transaction: jest.fn((work: (client: Prisma.TransactionClient) => Promise<unknown>) => work(tx)),
    payment: { findUnique, update },
  } as unknown as PrismaService;
  const idService = { generateCode: jest.fn().mockResolvedValue('PAY-00042') } as unknown as IdService;
  const messaging = { send } as unknown as MessagingService;
  const service = new UpiCollectionService(prisma, idService, messaging);

  beforeEach(() => {
    process.env.COMPANY_UPI_VPA = 'laboura@bank';
    process.env.COMPANY_UPI_PAYEE_NAME = 'Laboura Staffing';
    process.env.PUBLIC_APP_URL = 'https://app.laboura.in';
    jest.clearAllMocks();
    findFirst.mockResolvedValue(null);
    create.mockResolvedValue(payment);
    send.mockResolvedValue({ status: 'sent' });
  });

  afterAll(() => {
    if (originalVpa === undefined) delete process.env.COMPANY_UPI_VPA;
    else process.env.COMPANY_UPI_VPA = originalVpa;
    if (originalPayeeName === undefined) delete process.env.COMPANY_UPI_PAYEE_NAME;
    else process.env.COMPANY_UPI_PAYEE_NAME = originalPayeeName;
    if (originalPublicUrl === undefined) delete process.env.PUBLIC_APP_URL;
    else process.env.PUBLIC_APP_URL = originalPublicUrl;
  });

  it('builds a UPI request with the exact paise amount, unique reference, and public link', async () => {
    const result = await service.createRequest({
      type: 'activation', subjectType: 'job_seeker', subjectId: 'seeker-1',
      jobSeekerId: 'seeker-1', amountPaise: 49900,
    });
    const params = new URL(result.upiUri);
    expect(params.protocol).toBe('upi:');
    expect(params.searchParams.get('pa')).toBe('laboura@bank');
    expect(params.searchParams.get('pn')).toBe('Laboura Staffing');
    expect(params.searchParams.get('am')).toBe('499.00');
    expect(params.searchParams.get('tn')).toBe('PAY-00042');
    expect(params.searchParams.get('tr')).toBe(payment.upiReference);
    expect(params.searchParams.get('cu')).toBe('INR');
    // The SMS and WhatsApp link opens the public phone page (P05b); /payments/request/... redirects there.
    expect(result.paymentLink).toBe(`https://app.laboura.in/p/fee/${payment.upiReference}`);
    expect(create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        method: 'upi_direct', status: 'pending', amount: 49900,
        expectedAmountPaise: 49900, upiReference: expect.stringMatching(/^PAY-00042-[a-f0-9]{8}$/),
      }),
    }));
    expect(findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ method: 'upi_direct', gatewayReference: null }),
    }));
    expect(send).toHaveBeenCalledTimes(2);
  });

  it('reuses the same pending obligation and UPI reference when re-sending', async () => {
    findFirst.mockResolvedValue(payment);
    findUnique.mockResolvedValue(payment);
    const first = await service.createRequest({
      type: 'activation', subjectType: 'job_seeker', subjectId: 'seeker-1', amountPaise: 49900,
    });
    const resent = await service.resendRequest(payment.id, 'job_seeker', 'seeker-1');
    expect(create).not.toHaveBeenCalled();
    expect(first.paymentId).toBe(payment.id);
    expect(resent.paymentId).toBe(payment.id);
    expect(resent.upiReference).toBe(first.upiReference);
    expect(resent.paymentLink).toBe(first.paymentLink);
  });

  it('decodes the generated QR matrix to the exact UPI link', () => {
    const uri = 'upi://pay?pa=laboura%40bank&pn=Laboura&am=499.00&tn=PAY-00042&tr=PAY-00042-12ab34cd&cu=INR';
    const qr = buildUpiQr(uri);
    const scale = 8;
    const quietZone = 4;
    const width = (qr.size + quietZone * 2) * scale;
    const rgba = new Uint8ClampedArray(width * width * 4);
    rgba.fill(255);
    for (let row = 0; row < qr.size; row += 1) {
      for (let column = 0; column < qr.size; column += 1) {
        if (!qr.darkModules[row * qr.size + column]) continue;
        for (let y = 0; y < scale; y += 1) {
          for (let x = 0; x < scale; x += 1) {
            const pixel = ((row + quietZone) * scale + y) * width + (column + quietZone) * scale + x;
            rgba[pixel * 4] = 0;
            rgba[pixel * 4 + 1] = 0;
            rgba[pixel * 4 + 2] = 0;
          }
        }
      }
    }
    expect(jsQR(rgba, width, width)?.data).toBe(uri);
    expect(qr.svg).toContain('<svg');
  });

  it('fails payment request creation clearly when UPI configuration is missing', async () => {
    delete process.env.COMPANY_UPI_VPA;
    await expect(service.createRequest({
      type: 'activation', subjectType: 'job_seeker', subjectId: 'seeker-1', amountPaise: 49900,
    })).rejects.toThrow(/UPI collection is not configured/);
    expect(create).not.toHaveBeenCalled();
  });

  it('stores a typed UTR as a hint and leaves the payment pending', async () => {
    findUnique.mockResolvedValue(payment);
    update.mockResolvedValue({ ...payment, payerUtrHint: '123456789012' });
    await expect(service.saveUtrHint(payment.upiReference, '123456789012')).resolves.toEqual({
      saved: true, status: 'pending',
    });
    expect(update).toHaveBeenCalledWith({
      where: { id: payment.id }, data: { payerUtrHint: '123456789012' },
    });
    expect(update.mock.calls[0][0].data).not.toHaveProperty('status');
    await expect(service.saveUtrHint(payment.upiReference, 'bad')).rejects.toThrow(/12 digits/);
  });

  it('renders the public payment page without an image upload field', async () => {
    findUnique.mockResolvedValue(payment);
    const page = await service.renderPaymentPage(payment.upiReference);
    expect(page).toContain('Pay with a UPI app');
    expect(page).toContain('Pay by card');
    expect(page).toContain('Payment is confirmed once it reaches Laboura\'s bank');
    expect(page).not.toMatch(/type=["']file["']/i);
  });

  describe('public payment summary (P05b)', () => {
    const originalSecret = process.env.JWT_SECRET;
    beforeEach(() => {
      process.env.JWT_SECRET = 'test-secret-that-is-at-least-32-characters';
    });
    afterAll(() => {
      if (originalSecret === undefined) delete process.env.JWT_SECRET;
      else process.env.JWT_SECRET = originalSecret;
    });

    const placementPayment = {
      ...payment, type: 'placement_fee', expectedAmountPaise: 944000, amount: 944000, subjectType: 'placement',
      jobSeekerId: null, jobSeeker: null, placementId: 'placement-1', payerUtrHint: null, confirmedAt: null,
      placement: {
        id: 'placement-1', agreedSalary: 1600000, placementFee: 800000, gstAmount: 144000,
        feePercentAtCreation: 50, gstPercentAtCreation: 18, paymentDueAt: new Date('2026-11-12T09:30:00Z'),
        jobSeeker: { name: 'Ramesh Kumar' }, business: { name: 'Sri Sai Hotel', contactLanguage: 'Kannada' },
      },
    };

    it('shows the fee breakdown, the deadline and the QR while unpaid, with no candidate details beyond the first name', async () => {
      findUnique.mockResolvedValue(placementPayment);
      const summary = await service.getPublicSummary(payment.upiReference);
      expect(summary).toMatchObject({
        type: 'placement_fee', state: 'pending', amountPaise: 944000, language: 'kn', receipt: null, invoicePath: null,
        placement: {
          candidateFirstName: 'Ramesh', businessName: 'Sri Sai Hotel', agreedSalaryPaise: 1600000,
          feePercent: 50, placementFeePaise: 800000, gstPercent: 18, gstPaise: 144000,
        },
      });
      expect(summary.pay?.upiUri).toContain('am=9440.00');
      expect(JSON.stringify(summary)).not.toContain('Kumar');
    });

    it('says "confirming" — never "received" — when the payer only typed a UPI reference', async () => {
      findUnique.mockResolvedValue({ ...placementPayment, payerUtrHint: '123456789012' });
      expect((await service.getPublicSummary(payment.upiReference)).state).toBe('confirming');
    });

    it('says "received" only once the bank confirmed it, with a signed receipt and invoice link and no QR', async () => {
      findUnique.mockResolvedValue({ ...placementPayment, status: 'succeeded', confirmedAt: new Date('2026-11-11T06:00:00Z') });
      const summary = await service.getPublicSummary(payment.upiReference);
      expect(summary.state).toBe('received');
      expect(summary.pay).toBeNull();
      expect(summary.receipt).toEqual({ paymentId: payment.id, token: expect.any(String) });
      expect(summary.invoicePath).toMatch(/^\/placements\/placement-1\/invoice\/copy\?token=/);
    });

    it('refuses references that are not UPI collection requests', async () => {
      findUnique.mockResolvedValue({ ...placementPayment, type: 'refund' });
      await expect(service.getPublicSummary('x')).rejects.toThrow(/not found/);
      findUnique.mockResolvedValue(null);
      await expect(service.getPublicSummary('x')).rejects.toThrow(/not found/);
    });
  });
});
