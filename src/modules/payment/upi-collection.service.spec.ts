import jsQR from 'jsqr';
import { PAY_PAGE_DAYS_AFTER_PAYMENT, payPageTokenFor, payPageTokenHash } from './pay-page-token';
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
  const updateMany = jest.fn().mockResolvedValue({ count: 0 });
  const txUpdateMany = jest.fn().mockResolvedValue({ count: 1 });
  const statusCreate = jest.fn().mockResolvedValue({});
  const statusFindFirst = jest.fn().mockResolvedValue(null);
  // The ID gate before a ₹499 is sent again (L-5): a verified ID, no under-18 stop, unless a test says otherwise.
  const identityFindFirst = jest.fn();
  const send = jest.fn().mockResolvedValue({ status: 'sent' });
  const tx = {
    $queryRaw: jest.fn().mockResolvedValue([]),
    $executeRaw: jest.fn().mockResolvedValue(1),
    payment: { findFirst, create, updateMany: txUpdateMany },
    statusHistory: { create: statusCreate },
  } as unknown as Prisma.TransactionClient;
  const prisma = {
    $transaction: jest.fn((work: (client: Prisma.TransactionClient) => Promise<unknown>) => work(tx)),
    payment: { findUnique, update, updateMany },
    jobSeeker: { findUnique: jest.fn().mockResolvedValue({ id: 'seeker-1', dateOfBirth: null }) },
    statusHistory: { findFirst: statusFindFirst },
    identityVerification: { findFirst: identityFindFirst },
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
    identityFindFirst.mockImplementation(async (args: { where: Record<string, unknown> }) => (args.where.status === 'verified' ? { id: 'idv-1' } : null));
    txUpdateMany.mockResolvedValue({ count: 1 });
    statusCreate.mockResolvedValue({});
    statusFindFirst.mockResolvedValue(null);
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
    // The SMS and WhatsApp link opens the public phone page (P05b) by its own page token (INF-1),
    // never by the UPI reference; only the token's hash is stored.
    expect(result.paymentLink).toBe(`https://app.laboura.in/p/fee/${payPageTokenFor(payment.id)}`);
    expect(result.paymentLink).not.toContain(payment.upiReference);
    expect(Buffer.from(payPageTokenFor(payment.id), 'base64url').length).toBeGreaterThanOrEqual(16);
    expect(create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        method: 'upi_direct', status: 'pending', amount: 49900,
        expectedAmountPaise: 49900, upiReference: expect.stringMatching(/^PAY-00042-[a-f0-9]{8}$/),
        pageTokenHash: expect.stringMatching(/^[a-f0-9]{64}$/),
      }),
    }));
    const createdData = create.mock.calls[0][0].data as { id: string; pageTokenHash: string };
    expect(createdData.pageTokenHash).toBe(payPageTokenHash(payPageTokenFor(createdData.id)));
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

  it('does not send a ₹499 again past an under-18 stop or without a verified ID (L-5)', async () => {
    findUnique.mockResolvedValue(payment);
    identityFindFirst.mockImplementation(async (args: { where: Record<string, unknown> }) => ('under18LiftedAt' in args.where ? { id: 'stop-1' } : { id: 'idv-1' }));
    await expect(service.resendRequest(payment.id)).rejects.toThrow(/under 18/i);
    identityFindFirst.mockResolvedValue(null);
    await expect(service.resendRequest(payment.id)).rejects.toThrow('Finish the ID check first');
    identityFindFirst.mockImplementation(async (args: { where: Record<string, unknown> }) => (args.where.status === 'pending' ? { id: 'p-1' } : null));
    await expect(service.resendRequest(payment.id)).rejects.toThrow(/Team Lead/);
    expect(send).not.toHaveBeenCalled();
    // A placement fee isn't an activation: no ID gate.
    findUnique.mockResolvedValue({ ...payment, type: 'placement_fee', jobSeekerId: null, businessId: 'biz-1' });
    await expect(service.resendRequest(payment.id)).resolves.toMatchObject({ paymentId: payment.id });
  });

  describe('the public payment page asks the ID gate again (owner rule: under 18 stops before payment)', () => {
    const stoppedForUnder18 = () =>
      identityFindFirst.mockImplementation(async (args: { where: Record<string, unknown> }) => ('under18LiftedAt' in args.where ? { id: 'stop-1' } : { id: 'idv-1' }));

    it('an under-18 stop raised after the link was sent: the page refuses, and the ₹499 request is closed for good', async () => {
      findUnique.mockResolvedValue(payment);
      stoppedForUnder18();
      await expect(service.getPaymentPage(payment.upiReference)).rejects.toThrow("This payment can't go ahead. Please contact Laboura.");
      expect(txUpdateMany).toHaveBeenCalledWith({ where: { id: payment.id, status: 'pending' }, data: { status: 'failed' } });
      expect(statusCreate).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({ subjectType: 'payment', subjectId: payment.id, fromStatus: 'pending', toStatus: 'failed', reason: 'id_gate_stopped' }),
      }));
    });

    it('the summary shows only "stopped" (no UPI link or QR), now and on every later visit', async () => {
      findUnique.mockResolvedValue(payment);
      stoppedForUnder18();
      const now = await service.getPublicSummary(payment.upiReference);
      expect(now).toMatchObject({ state: 'closed', stopped: true, pay: null, stoppedMessage: "This payment can't go ahead. Please contact Laboura." });
      // Later: the request is failed, and its history says the ID gate closed it.
      findUnique.mockResolvedValue({ ...payment, status: 'failed' });
      statusFindFirst.mockResolvedValue({ id: 'sh-1' });
      expect(await service.getPublicSummary(payment.upiReference)).toMatchObject({ state: 'closed', stopped: true, pay: null });
    });

    it('no UPI reference hint either, and without a verified ID the same', async () => {
      findUnique.mockResolvedValue(payment);
      identityFindFirst.mockResolvedValue(null);
      await expect(service.saveUtrHint(payment.upiReference, '123456789012')).rejects.toThrow(/can't go ahead/);
      expect(update).not.toHaveBeenCalled();
    });

    it('a verified ID and no stop: the page works; a placement fee is never asked', async () => {
      findUnique.mockResolvedValue(payment);
      await expect(service.getPaymentPage(payment.upiReference)).resolves.toMatchObject({ type: 'activation', amountPaise: 49900 });
      identityFindFirst.mockResolvedValue(null);
      findUnique.mockResolvedValue({ ...payment, type: 'placement_fee', jobSeekerId: null });
      await expect(service.getPaymentPage(payment.upiReference)).resolves.toMatchObject({ type: 'placement_fee' });
      expect(txUpdateMany).not.toHaveBeenCalled();
    });
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
        type: 'placement_fee', state: 'pending', amountPaise: 944000, language: 'en',
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

    it('says "received" only once the bank confirmed it, with no QR and no receipt or invoice token (INF-1: they go by SMS)', async () => {
      findUnique.mockResolvedValue({ ...placementPayment, status: 'succeeded', confirmedAt: new Date('2026-11-11T06:00:00Z') });
      const summary = await service.getPublicSummary(payment.upiReference, new Date('2026-11-12T06:00:00Z'));
      expect(summary.state).toBe('received');
      expect(summary.pay).toBeNull();
      expect(summary).not.toHaveProperty('receipt');
      expect(summary).not.toHaveProperty('invoicePath');
      expect(JSON.stringify(summary)).not.toMatch(/token|invoice\/copy|receipt\?/);
      expect(summary.sentBySms).toBe('receipt_and_invoice');
    });

    it('INF-1: a paid page closes PAY_PAGE_DAYS_AFTER_PAYMENT days after the bank confirmed it', async () => {
      const confirmedAt = new Date('2026-11-11T06:00:00Z');
      findUnique.mockResolvedValue({ ...placementPayment, status: 'succeeded', confirmedAt });
      const day = 24 * 60 * 60 * 1000;
      await expect(service.getPublicSummary(payment.upiReference, new Date(confirmedAt.getTime() + PAY_PAGE_DAYS_AFTER_PAYMENT * day - 1000))).resolves.toMatchObject({ state: 'received' });
      await expect(service.getPublicSummary(payment.upiReference, new Date(confirmedAt.getTime() + PAY_PAGE_DAYS_AFTER_PAYMENT * day + 1000))).rejects.toThrow(/expired/);
    });

    it('D3 (rev 176): a replacement salary-upgrade request opens on the business fee page, marked as an upgrade', async () => {
      findUnique.mockResolvedValue({
        ...placementPayment, type: 'replacement_upgrade', expectedAmountPaise: 118000, amount: 118000,
        placement: { ...placementPayment.placement, placementFee: 100000, gstAmount: 18000 },
      });
      const summary = await service.getPublicSummary(payment.upiReference);
      expect(summary).toMatchObject({ type: 'placement_fee', upgrade: true, state: 'pending', amountPaise: 118000, placement: { placementFeePaise: 100000, gstPaise: 18000 } });
      expect(summary.pay?.upiUri).toContain('am=1180.00');
    });

    it('refuses references that are not UPI collection requests', async () => {
      findUnique.mockResolvedValue({ ...placementPayment, type: 'refund' });
      await expect(service.getPublicSummary('x')).rejects.toThrow(/not found/);
      findUnique.mockResolvedValue(null);
      await expect(service.getPublicSummary('x')).rejects.toThrow(/not found/);
    });
  });

  describe('INF-1: the pay page opens only by its page token', () => {
    it('finds the request by the hash of its page token; the UPI reference opens nothing once a page token exists', async () => {
      const withToken = { ...payment, pageTokenHash: payPageTokenHash(payPageTokenFor(payment.id)) };
      findUnique.mockImplementation(async (args: { where: Record<string, unknown> }) => {
        if (args.where.pageTokenHash === withToken.pageTokenHash) return withToken;
        if (args.where.upiReference === payment.upiReference) return withToken;
        if (args.where.id === payment.id) return withToken;
        return null;
      });
      await expect(service.getPaymentPage(payPageTokenFor(payment.id))).resolves.toMatchObject({ upiReference: payment.upiReference });
      await expect(service.getPaymentPage(payment.upiReference)).rejects.toThrow(/not found/);
      await expect(service.saveUtrHint(payment.upiReference, '123456789012')).rejects.toThrow(/not found/);
    });

    it('L3: a request with no page token hash does not open by its UPI reference', async () => {
      const legacy = { ...payment, pageTokenHash: null };
      findUnique.mockImplementation(async (args: { where: Record<string, unknown> }) => (args.where.upiReference === payment.upiReference ? legacy : null));
      await expect(service.getPaymentPage(payment.upiReference)).rejects.toThrow(/not found/);
      await expect(service.getPublicSummary(payment.upiReference)).rejects.toThrow(/not found/);
    });
  });
});
