import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import {
  InboundCallEvent,
  InboundCallResult,
  TELEPHONY_PROVIDER,
  TelephonyCapacity,
  TelephonyProvider,
} from './telephony.interface';
import { PrismaService } from '../../common/prisma/prisma.service';

@Injectable()
export class TelephonyService {
  constructor(
    @Inject(TELEPHONY_PROVIDER)
    private readonly provider: TelephonyProvider,
    private readonly prisma: PrismaService,
  ) {}

  async handleInboundWebhook(
    payload: Record<string, unknown>,
  ): Promise<InboundCallResult> {
    const callId = String(
      payload.CallSid ||
        payload.call_id ||
        payload.callId ||
        payload.sid ||
        `call_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
    );

    const callerPhone = String(
      payload.From ||
        payload.caller_number ||
        payload.caller ||
        payload.phone ||
        payload.mobile ||
        '',
    );

    const virtualNumber = String(
      payload.To ||
        payload.virtual_number ||
        payload.called_number ||
        payload.virtualNumber ||
        '18001234567',
    );

    const recordingUrl = payload.RecordingUrl
      ? String(payload.RecordingUrl)
      : payload.recordingUrl
        ? String(payload.recordingUrl)
        : undefined;

    const recordingEnabled =
      payload.recordingEnabled === true ||
      payload.record === 'true' ||
      Boolean(recordingUrl);

    const event: InboundCallEvent = {
      callId,
      callerPhone,
      virtualNumber,
      timestamp: new Date(),
      recordingUrl,
      recordingEnabled,
    };

    return this.provider.handleInboundCall(event);
  }

  async getCallbackQueue(filters?: { status?: string }) {
    const where: { status?: string } = {};
    if (filters?.status) {
      where.status = filters.status;
    }

    return this.prisma.callbackTask.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: {
        jobSeeker: true,
        assignedToStaff: true,
      },
    });
  }

  async assignCallback(id: string, staffId: string) {
    const existing = await this.prisma.callbackTask.findUnique({
      where: { id },
    });
    if (!existing) {
      throw new NotFoundException(`Callback task '${id}' not found`);
    }

    return this.prisma.callbackTask.update({
      where: { id },
      data: {
        assignedToStaffId: staffId,
        status: 'assigned',
      },
      include: {
        assignedToStaff: true,
      },
    });
  }

  async completeCallback(id: string) {
    const existing = await this.prisma.callbackTask.findUnique({
      where: { id },
    });
    if (!existing) {
      throw new NotFoundException(`Callback task '${id}' not found`);
    }

    return this.prisma.callbackTask.update({
      where: { id },
      data: {
        status: 'completed',
      },
    });
  }

  getCapacity(): TelephonyCapacity {
    return this.provider.getCapacity();
  }
}
