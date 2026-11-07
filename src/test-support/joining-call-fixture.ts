import { PrismaService } from '../common/prisma/prisma.service';
import { IdService } from '../common/id/id.service';

export async function createJoiningCallsFixture(input: {
  prisma: PrismaService;
  idService: IdService;
  placementId: string;
  jobSeekerId: string;
  businessId: string;
  callTime?: Date;
  staffId?: string;
  workerAnswered?: boolean;
  businessAnswered?: boolean;
}) {
  const { prisma, idService, placementId, jobSeekerId, businessId } = input;
  const callTime = input.callTime ?? new Date();
  const workerAnswered = input.workerAnswered ?? true;
  const businessAnswered = input.businessAnswered ?? true;

  const workerCallCode = await idService.generateCode('call_record');
  const workerCall = await prisma.callRecord.create({
    data: {
      code: workerCallCode,
      provider: 'mock',
      providerCallId: `call_worker_${placementId}_${Date.now()}_${Math.random()}`,
      direction: 'outbound',
      subjectType: 'job_seeker',
      subjectId: jobSeekerId,
      purpose: 'joining_confirmation',
      relatedType: 'placement',
      relatedId: placementId,
      providerStatus: workerAnswered ? 'completed' : 'no_answer',
      answered: workerAnswered,
      startedAt: callTime,
      answeredAt: workerAnswered ? callTime : null,
      endedAt: new Date(callTime.getTime() + 60000),
      durationSec: workerAnswered ? 60 : 0,
      staffId: input.staffId ?? null,
    },
  });

  const businessCallCode = await idService.generateCode('call_record');
  const businessCall = await prisma.callRecord.create({
    data: {
      code: businessCallCode,
      provider: 'mock',
      providerCallId: `call_biz_${placementId}_${Date.now()}_${Math.random()}`,
      direction: 'outbound',
      subjectType: 'business',
      subjectId: businessId,
      purpose: 'joining_confirmation',
      relatedType: 'placement',
      relatedId: placementId,
      providerStatus: businessAnswered ? 'completed' : 'no_answer',
      answered: businessAnswered,
      startedAt: callTime,
      answeredAt: businessAnswered ? callTime : null,
      endedAt: new Date(callTime.getTime() + 60000),
      durationSec: businessAnswered ? 60 : 0,
      staffId: input.staffId ?? null,
    },
  });

  return { workerCall, businessCall };
}
