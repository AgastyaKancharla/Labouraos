import { BadRequestException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { AppModule } from '../../app.module';
import { PrismaService } from '../../common/prisma/prisma.service';
import { IdService } from '../../common/id/id.service';
import { PaymentService } from './payment.service';
import { PAYMENT_PROVIDER, PaymentProvider } from './payment-provider.interface';

describe('Phase 8: payout disbursement is claimed atomically (AGENTS.md §2 rule 7)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let idService: IdService;
  let service: PaymentService;
  let provider: PaymentProvider;
  const timestamp = Date.now();
  const createdPaymentIds: string[] = [];
  const createdReferralIds: string[] = [];
  let seq = 0;

  const makePendingPayout = async () => {
    seq += 1;
    const referral = await prisma.referral.create({
      data: {
        code: `RF-IDEM-${timestamp}-${seq}`,
        name: 'Idempotency Partner',
        phone: `94${String(timestamp).slice(-6)}${String(seq).padStart(2, '0')}`,
        phoneVerified: true,
        type: 'individual',
        city: 'Bengaluru',
      },
    });
    createdReferralIds.push(referral.id);
    const payment = await prisma.payment.create({
      data: {
        code: await idService.generateCode('payment'),
        type: 'referral_payout',
        amount: 20000,
        status: 'pending',
        gatewayReference: `gw_idem_${timestamp}_${seq}`,
        subjectType: 'referral',
        subjectId: referral.id,
        referralId: referral.id,
        city: 'Bengaluru',
      },
    });
    createdPaymentIds.push(payment.id);
    return payment;
  };

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    const app = moduleRef.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);
    idService = app.get(IdService);
    service = app.get(PaymentService);
    provider = app.get<PaymentProvider>(PAYMENT_PROVIDER);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  afterAll(async () => {
    const payments = await prisma.payment.findMany({
      where: { id: { in: createdPaymentIds } },
      select: { code: true },
    });
    await prisma.auditLog.deleteMany({
      where: { entityCode: { in: payments.map((p) => p.code) } },
    });
    await prisma.payment.deleteMany({ where: { id: { in: createdPaymentIds } } });
    await prisma.referral.deleteMany({ where: { id: { in: createdReferralIds } } });
    await moduleRef.close();
  });

  // Slow enough that, without an atomic claim, every concurrent caller would
  // still be inside the "is it pending?" window when the first one reaches the gateway.
  const slowSuccess = () =>
    jest.spyOn(provider, 'disbursePayout').mockImplementation(async () => {
      await new Promise((r) => setTimeout(r, 150));
      return { success: true, gatewayReference: `gw_ok_${Math.random()}`, status: 'succeeded' };
    });

  it('two concurrent disbursements of one pending payment make exactly one provider call', async () => {
    const payment = await makePendingPayout();
    const spy = slowSuccess();

    const results = await Promise.allSettled([
      service.disbursePayout(payment.id),
      service.disbursePayout(payment.id),
    ]);

    expect(spy).toHaveBeenCalledTimes(1);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
    expect(rejected).toHaveLength(1);
    expect(rejected[0].reason).toBeInstanceOf(BadRequestException);

    const after = await prisma.payment.findUnique({ where: { id: payment.id } });
    expect(after?.status).toBe('succeeded');
  });

  it('holds under a burst of 10 concurrent attempts: one provider call, one audit row', async () => {
    const payment = await makePendingPayout();
    const spy = slowSuccess();

    const results = await Promise.allSettled(
      Array.from({ length: 10 }, () => service.disbursePayout(payment.id)),
    );

    expect(spy).toHaveBeenCalledTimes(1);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((r) => r.status === 'rejected')).toHaveLength(9);

    const audits = await prisma.auditLog.findMany({
      where: { entityCode: payment.code, action: 'payout_release' },
    });
    expect(audits).toHaveLength(1);
  });

  it('passes the payment id to the provider so a real gateway can derive an idempotent key', async () => {
    const payment = await makePendingPayout();
    const spy = slowSuccess();

    await service.disbursePayout(payment.id);

    expect(spy).toHaveBeenCalledWith(
      payment.amount,
      payment.subjectType,
      payment.subjectId,
      expect.objectContaining({ paymentId: payment.id }),
    );
  });

  it('a payment whose provider call threw stays in processing and cannot be paid again', async () => {
    const payment = await makePendingPayout();
    jest.spyOn(provider, 'disbursePayout').mockRejectedValueOnce(new Error('gateway exploded'));

    await expect(service.disbursePayout(payment.id)).rejects.toThrow('gateway exploded');
    expect((await prisma.payment.findUnique({ where: { id: payment.id } }))?.status).toBe(
      'processing',
    );

    // spyOn returns the existing mock, so drop the first (rejected) call from its history
    const spy = slowSuccess();
    spy.mockClear();
    await expect(service.disbursePayout(payment.id)).rejects.toBeInstanceOf(BadRequestException);
    expect(spy).not.toHaveBeenCalled();
  });

  it('a normal sequential disbursement still succeeds and cannot be repeated', async () => {
    const payment = await makePendingPayout();
    const spy = slowSuccess();

    const done = await service.disbursePayout(payment.id);
    expect(done.status).toBe('succeeded');
    await expect(service.disbursePayout(payment.id)).rejects.toBeInstanceOf(BadRequestException);
    expect(spy).toHaveBeenCalledTimes(1);
  });
});
