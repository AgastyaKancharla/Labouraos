import { Injectable, Logger } from '@nestjs/common';
import {
  InboundCallEvent,
  InboundCallResult,
  TelephonyCapacity,
  TelephonyProvider,
} from './telephony.interface';
import { PrismaService } from '../../common/prisma/prisma.service';

@Injectable()
export class MockTelephonyProvider implements TelephonyProvider {
  private readonly logger = new Logger(MockTelephonyProvider.name);

  constructor(private readonly prisma: PrismaService) {}

  async handleInboundCall(event: InboundCallEvent): Promise<InboundCallResult> {
    const existing = await this.prisma.callbackTask.findUnique({
      where: { callId: event.callId },
    });

    if (existing) {
      this.logger.log(
        `[MOCK TELEPHONY] Duplicate inbound call webhook for callId ${event.callId}. Idempotent no-op.`,
      );
      return {
        callbackTaskId: existing.id,
        isDuplicate: true,
        consentAnnounced: existing.recordingConsent,
      };
    }

    const consentAnnounced = Boolean(
      event.recordingEnabled || event.recordingUrl,
    );

    // Look up caller in JobSeeker pool by phone
    const candidate = await this.prisma.jobSeeker.findFirst({
      where: {
        OR: [
          { phone: event.callerPhone },
          { phone: `+91${event.callerPhone.replace(/^\+91/, '')}` },
        ],
      },
    });

    const task = await this.prisma.callbackTask.create({
      data: {
        callId: event.callId,
        phone: event.callerPhone,
        callerName: candidate?.name ?? null,
        jobSeekerId: candidate?.id ?? null,
        virtualNumber: event.virtualNumber ?? '18001234567',
        status: 'pending',
        recordingUrl: event.recordingUrl ?? null,
        recordingConsent: consentAnnounced,
      },
    });

    this.logger.log(
      `[MOCK TELEPHONY] Created callback task ${task.id} for phone ${event.callerPhone} (callId: ${event.callId})`,
    );

    return {
      callbackTaskId: task.id,
      isDuplicate: false,
      consentAnnounced,
    };
  }

  getCapacity(): TelephonyCapacity {
    return {
      concurrentChannels: 60,
      maxAgentsSupported: 40,
      vendor: 'mock-cloud-telephony',
    };
  }
}
