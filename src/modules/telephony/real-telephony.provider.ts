import { Injectable, Logger } from '@nestjs/common';
import {
  InboundCallEvent,
  InboundCallResult,
  TelephonyCapacity,
  TelephonyProvider,
} from './telephony.interface';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';

export interface RealTelephonyProviderOptions {
  apiKey?: string;
  vendor?: string;
  virtualNumber?: string;
  concurrentChannels?: number;
}

export const DPDP_CONSENT_ANNOUNCEMENT =
  'This call is recorded for quality, training and compliance under the Digital Personal Data Protection Act. By continuing, you consent to this recording.';

@Injectable()
export class RealTelephonyProvider implements TelephonyProvider {
  private readonly logger = new Logger(RealTelephonyProvider.name);
  private readonly vendor: string;
  private readonly virtualNumber: string;
  private readonly concurrentChannels: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    options?: RealTelephonyProviderOptions,
  ) {
    this.vendor =
      options?.vendor ??
      process.env.TELEPHONY_VENDOR ??
      'exotel-cloud-telephony';
    this.virtualNumber =
      options?.virtualNumber ??
      process.env.TOLL_FREE_NUMBER ??
      '18001234567';
    this.concurrentChannels =
      options?.concurrentChannels ??
      parseInt(process.env.TELEPHONY_CHANNELS || '60', 10);
  }

  async handleInboundCall(event: InboundCallEvent): Promise<InboundCallResult> {
    // 1. Idempotency: Webhooks may be delivered more than once (AGENTS.md §2 rule 7).
    // A repeat must be a no-op, never a duplicate callback task.
    const existing = await this.prisma.callbackTask.findUnique({
      where: { callId: event.callId },
    });

    if (existing) {
      this.logger.log(
        `[REAL TELEPHONY] Inbound call webhook with callId '${event.callId}' already received. Idempotent no-op.`,
      );
      return {
        callbackTaskId: existing.id,
        isDuplicate: true,
        consentAnnounced: existing.recordingConsent,
      };
    }

    // 2. DPDP Act (2023) Mandatory Recording Consent Notice
    const recordingEnabled = Boolean(
      event.recordingEnabled || event.recordingUrl,
    );
    let consentAuditCode: string | undefined;

    if (recordingEnabled) {
      this.logger.log(
        `[DPDP NOTICE] Triggered mandatory recording consent announcement for call ${event.callId}`,
      );

      // System or actor logging the DPDP consent
      let actor = await this.prisma.staff.findFirst({
        where: { role: 'ceo' },
      });
      if (!actor) {
        actor = await this.prisma.staff.findFirst();
      }

      if (actor) {
        const auditLog = await this.auditService.log({
          actorId: actor.id,
          action: 'dpdp_consent.recorded',
          entityType: 'telephony_call',
          entityCode: event.callId,
          after: {
            consented: true,
            noticeGiven: true,
            announcement: DPDP_CONSENT_ANNOUNCEMENT,
            recordingUrl: event.recordingUrl ?? null,
            callerPhone: event.callerPhone,
            virtualNumber: event.virtualNumber ?? this.virtualNumber,
            timestamp: event.timestamp ?? new Date(),
          },
          city: 'Bengaluru',
        });
        consentAuditCode = auditLog.code;
      }
    }

    // 3. Candidate Lookup: Match incoming caller phone against registered JobSeeker pool
    const cleanPhone = event.callerPhone.replace(/\D/g, '');
    const candidate = await this.prisma.jobSeeker.findFirst({
      where: {
        OR: [
          { phone: event.callerPhone },
          { phone: cleanPhone },
          { phone: `+91${cleanPhone.replace(/^91/, '')}` },
        ],
      },
    });

    // 4. Create single CallbackTask in PostgreSQL
    const task = await this.prisma.callbackTask.create({
      data: {
        callId: event.callId,
        phone: event.callerPhone,
        callerName: candidate?.name ?? null,
        jobSeekerId: candidate?.id ?? null,
        virtualNumber: event.virtualNumber ?? this.virtualNumber,
        status: 'pending',
        recordingUrl: event.recordingUrl ?? null,
        recordingConsent: recordingEnabled,
      },
    });

    this.logger.log(
      `[REAL TELEPHONY] Enqueued callback task ${task.id} for caller ${event.callerPhone} (callId: ${event.callId})`,
    );

    return {
      callbackTaskId: task.id,
      isDuplicate: false,
      consentAnnounced: recordingEnabled,
      consentAuditLogId: consentAuditCode,
    };
  }

  getCapacity(): TelephonyCapacity {
    return {
      concurrentChannels: this.concurrentChannels,
      maxAgentsSupported: Math.floor(this.concurrentChannels / 1.5), // e.g. 60 channels covers 40 agents
      vendor: this.vendor,
    };
  }
}
