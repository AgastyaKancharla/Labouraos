import { Injectable, Logger } from '@nestjs/common';
import {
  InboundCallEvent,
  InboundCallResult,
  OutboundCallParams,
  OutboundCallResult,
  TelephonyCapacity,
  TelephonyProvider,
  ThreeWayCallParams,
} from './telephony.interface';
import { PrismaService } from '../../common/prisma/prisma.service';
import { mobileLookupValues, normaliseIndianMobile, phoneLast4 } from '../../common/phone/indian-mobile';

@Injectable()
export class MockTelephonyProvider implements TelephonyProvider {
  private readonly logger = new Logger(MockTelephonyProvider.name);
  lastOutbound: OutboundCallParams | null = null;

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
    // Every spelling of the caller's number matches the job seeker saved as +91 and 10 digits.
    const candidate = await this.prisma.jobSeeker.findFirst({
      where: { phone: { in: mobileLookupValues(event.callerPhone) } },
    });

    const task = await this.prisma.callbackTask.create({
      data: {
        callId: event.callId,
        phone: normaliseIndianMobile(event.callerPhone),
        callerName: candidate?.name ?? null,
        jobSeekerId: candidate?.id ?? null,
        virtualNumber: event.virtualNumber ?? '18001234567',
        status: 'pending',
        recordingUrl: retainedRecordingUrl,
        recordingConsent: isConsentLogged,
      },
    });

    this.logger.log(
      `[MOCK TELEPHONY] Created callback task ${task.id} for phone ******${phoneLast4(event.callerPhone)} (callId: ${event.callId})`,
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
    this.lastOutbound = params;
    const callId = `outbound_call_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const recordingEnabled = Boolean(params.recordCall);

    this.logger.log(
      `[MOCK TELEPHONY] Outbound call initiated, agent leg first: ${params.ringAgentFirst === true}, recording: ${recordingEnabled}, callId: ${callId}`,
    );

    return {
      callId,
      status: 'initiated',
      recordingEnabled,
      consentAnnounced: recordingEnabled,
    };
  }

  lastThreeWay: ThreeWayCallParams | null = null;

  supportsThreeWayCalls(): boolean {
    return true;
  }

  async initiateThreeWayCall(params: ThreeWayCallParams): Promise<OutboundCallResult> {
    this.lastThreeWay = params;
    const callId = `three_way_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    this.logger.log(`[MOCK TELEPHONY] 3-way call initiated, recording: ${params.recordCall}, callId: ${callId}`);
    return { callId, status: 'initiated', recordingEnabled: params.recordCall, consentAnnounced: params.recordCall };
  }

  getCapacity(): TelephonyCapacity {
    return {
      concurrentChannels: 60,
      maxAgentsSupported: 40,
      vendor: 'mock-cloud-telephony',
    };
  }
}
