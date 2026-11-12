import { BadRequestException, ConflictException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { AppModule } from '../../app.module';
import { PrismaService } from '../../common/prisma/prisma.service';
import { IdService } from '../../common/id/id.service';
import { PaymentService } from './payment.service';
import {
  encryptPayoutValue,
  hashPayoutValue,
  maskPayoutValue,
} from '../payout-account/payout-account-key';

describe('Phase 18: payout recording is claimed atomically and UTR is unique', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let idService: IdService;
  let service: PaymentService;
  const timestamp = Date.now();
  let ceoStaffId: string;
  const createdPaymentIds: string[] = [];
  const createdReferralIds: string[] = [];
  let seq = 0;

  const makeApprovedPayoutWithAccount = async () => {
    seq += 1;
    const referral = await prisma.referral.create({
      data: {
        code: `RF-IDEM-${timestamp}-${seq}`,
        name: 'Arun Kumar',
        phone: `94${String(timestamp).slice(-6)}${String(seq).padStart(2, '0')}`,
        phoneVerified: true,
        type: 'individual',
        city: 'Bengaluru',
      },
    });
    createdReferralIds.push(referral.id);

    // Create payout account
    const upiId = `arun.idem.${timestamp}.${seq}@okaxis`;
    const account = await prisma.payoutAccount.create({
      data: {
        code: await idService.generateCode('payout_account'),
        ownerType: 'referral',
        ownerId: referral.id,
        ownerNameAtEntry: 'Arun Kumar',
        method: 'upi',
        maskedValue: maskPayoutValue('upi', upiId),
        valueHash: hashPayoutValue('upi', upiId),
        upiIdEncrypted: encryptPayoutValue(upiId),
        status: 'pending_validation',
        activeFrom: new Date(),
      },
    });

    const payment = await prisma.payment.create({
      data: {
        code: await idService.generateCode('payment'),
        type: 'referral_payout',
        amount: 20000,
        status: 'approved',
        approvedByStaffId: ceoStaffId,
        approvedAt: new Date(),
        subjectType: 'referral',
        subjectId: referral.id,
        referralId: referral.id,
        city: 'Bengaluru',
      },
    });
    createdPaymentIds.push(payment.id);
    return { payment, account, referral };
  };

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    const app = moduleRef.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);
    idService = app.get(IdService);
    service = app.get(PaymentService);

    const ceo = await prisma.staff.create({
      data: {
        code: `CEO-IDEM-${timestamp}`,
        name: 'Audit actor',
        email: `ceo_idem_${timestamp}@laboura.local`,
        passwordHash: 'not-a-real-hash',
        role: 'ceo',
        city: 'Bengaluru',
      },
    });
    ceoStaffId = ceo.id;
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
    await prisma.payoutAccount.deleteMany({
      where: { ownerType: 'referral', ownerId: { in: createdReferralIds } },
    });
    await prisma.auditLog.deleteMany({ where: { actorId: ceoStaffId } });
    await prisma.staff.deleteMany({ where: { id: ceoStaffId } });
    await prisma.referral.deleteMany({ where: { id: { in: createdReferralIds } } });
    await moduleRef.close();
  });

  it('refuses to record a payout if status is not approved (e.g. pending)', async () => {
    const { payment } = await makeApprovedPayoutWithAccount();
    await prisma.payment.update({
      where: { id: payment.id },
      data: { status: 'pending' },
    });

    await expect(
      service.recordPayout(payment.id, ceoStaffId, {
        bankUtr: `UTR${timestamp}001`,
        receiverNameShown: 'Arun Kumar',
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('two concurrent recordings on one approved payment: exactly one succeeds', async () => {
    const { payment } = await makeApprovedPayoutWithAccount();
    const utr1 = `UTR${timestamp}002`;
    const utr2 = `UTR${timestamp}003`;

    const results = await Promise.allSettled([
      service.recordPayout(payment.id, ceoStaffId, {
        bankUtr: utr1,
        receiverNameShown: 'Arun Kumar',
      }),
      service.recordPayout(payment.id, ceoStaffId, {
        bankUtr: utr2,
        receiverNameShown: 'Arun Kumar',
      }),
    ]);

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0].reason).toBeInstanceOf(BadRequestException);

    const after = await prisma.payment.findUnique({ where: { id: payment.id } });
    expect(after?.status).toBe('succeeded');
    expect(after?.bankUtr).toBeTruthy();
  });

  it('a payment marked succeeded cannot be paid again', async () => {
    const { payment } = await makeApprovedPayoutWithAccount();
    const utr = `UTR${timestamp}004`;

    const done = await service.recordPayout(payment.id, ceoStaffId, {
      bankUtr: utr,
      receiverNameShown: 'Arun Kumar',
    });
    expect(done.status).toBe('succeeded');

    await expect(
      service.recordPayout(payment.id, ceoStaffId, {
        bankUtr: `UTR${timestamp}005`,
        receiverNameShown: 'Arun Kumar',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  // One shared UTR check across the books answers 409 Conflict (Phase 22 Part B review, defect 7).
  it('a UTR cannot be reused across different payments (409)', async () => {
    const item1 = await makeApprovedPayoutWithAccount();
    const item2 = await makeApprovedPayoutWithAccount();
    const reusedUtr = `UTR${timestamp}REUSE`;

    await service.recordPayout(item1.payment.id, ceoStaffId, {
      bankUtr: reusedUtr,
      receiverNameShown: 'Arun Kumar',
    });

    await expect(
      service.recordPayout(item2.payment.id, ceoStaffId, {
        bankUtr: reusedUtr,
        receiverNameShown: 'Arun Kumar',
      }),
    ).rejects.toThrow(ConflictException);
  });
});
