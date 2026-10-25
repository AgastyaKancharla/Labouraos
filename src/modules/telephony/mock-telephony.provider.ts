import { Injectable, Logger } from '@nestjs/common';
import {
  InboundCallEvent,
  InboundCallResult,
  OutboundCallParams,
  OutboundCallResult,
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

    const isConsentLogged = event.recordingConsent === true;
    const retainedRecordingUrl = isConsentLogged
      ? (event.recordingUrl ?? null)
      : null;

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
        recordingUrl: retainedRecordingUrl,
        recordingConsent: isConsentLogged,
      },
    });

    this.logger.log(
      `[MOCK TELEPHONY] Created callback task ${task.id} for phone ${event.callerPhone} (callId: ${event.callId})`,
    );

    return {
      callbackTaskId: task.id,
      isDuplicate: false,
      consentAnnounced: isConsentLogged,
    };
  }

  async initiateOutboundCall(
    params: OutboundCallParams,
  ): Promise<OutboundCallResult> {
    const callId = `outbound_call_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const recordingEnabled = Boolean(params.recordCall);

    this.logger.log(
      `[MOCK TELEPHONY] Outbound click-to-call initiated from agent ${params.agentPhone} to customer ${params.customerPhone} (callId: ${callId}, recording: ${recordingEnabled})`,
    );

    return {
      callId,
      status: 'initiated',
      recordingEnabled,
      consentAnnounced: recordingEnabled,
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
