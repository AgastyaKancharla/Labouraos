import { randomUUID } from 'node:crypto';
import { PrismaService } from '../common/prisma/prisma.service';
import { IdService } from '../common/id/id.service';
import { calculateGst, calculatePlacementFee } from '../common/money/money';

export async function createAwaitingPaymentPlacementFixture(input: {
  prisma: PrismaService;
  idService: IdService;
  vacancyId: string;
  jobSeekerId: string;
  createdByStaffId: string;
  agreedSalary: number;
  feePercent: number;
  gstPercent: number;
  paymentDueHours: number;
  now?: Date;
}) {
  const { prisma, idService } = input;
  const now = input.now ?? new Date();
  const vacancy = await prisma.vacancy.findUniqueOrThrow({ where: { id: input.vacancyId } });
  const placementId = randomUUID();
  const placementFee = calculatePlacementFee(input.agreedSalary, input.feePercent);
  const gstAmount = calculateGst(placementFee, input.gstPercent);
  const placement = await prisma.placement.create({
    data: {
      id: placementId,
      code: await idService.generateCode('placement'),
      city: vacancy.city,
      vacancyId: vacancy.id,
      jobSeekerId: input.jobSeekerId,
      businessId: vacancy.businessId,
      createdByStaffId: input.createdByStaffId,
      selectedAt: now,
      paymentDueAt: new Date(now.getTime() + input.paymentDueHours * 60 * 60 * 1000),
      joiningDate: now,
      rootPlacementId: placementId,
      replacementNumber: 0,
      feePercentAtCreation: input.feePercent,
      gstPercentAtCreation: input.gstPercent,
      agreedSalary: input.agreedSalary,
      placementFee,
      gstAmount,
      status: 'awaiting_payment',
    },
  });
  const payment = await prisma.payment.create({
    data: {
      code: await idService.generateCode('payment'),
      city: vacancy.city,
      type: 'placement_fee',
      amount: placementFee + gstAmount,
      status: 'pending',
      gatewayReference: `test_paid_placement_${placementId}`,
      subjectType: 'placement',
      subjectId: placementId,
      businessId: vacancy.businessId,
      placementId,
      jobSeekerId: null,
    },
  });
  return { placement, payment };
}
