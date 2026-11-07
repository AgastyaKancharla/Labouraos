import {
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import {
  InboundCallEvent,
  InboundCallResult,
  OutboundCallResult,
  TELEPHONY_PROVIDER,
  TelephonyCapacity,
  TelephonyProvider,
} from './telephony.interface';
import { PrismaService } from '../../common/prisma/prisma.service';
import { JwtPayload } from '../../common/auth/jwt-payload.interface';
import { validateWebhookHmac } from '../../common/webhook/webhook-signature';

@Injectable()
export class TelephonyService {
  constructor(
    @Inject(TELEPHONY_PROVIDER)
    private readonly provider: TelephonyProvider,
    private readonly prisma: PrismaService,
  ) {}

  async handleInboundWebhook(
    payload: Record<string, unknown>,
    signature?: string,
    rawBody?: Buffer | string,
  ): Promise<InboundCallResult> {
    const secret = process.env.TELEPHONY_WEBHOOK_SECRET;
    const bodyToVerify = rawBody ?? Buffer.from(JSON.stringify(payload), 'utf8');
    const validation = validateWebhookHmac(bodyToVerify, signature, secret);
    if (!validation.isValid) {
      throw new UnauthorizedException('Invalid or missing telephony webhook signature');
    }

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

    const recordingConsent =
      payload.recordingConsent === true ||
      payload.consent_confirmed === true ||
      payload.consent === 'true';

    const event: InboundCallEvent = {
      callId,
      callerPhone,
      virtualNumber,
      timestamp: new Date(),
      recordingUrl,
      recordingEnabled,
      recordingConsent,
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

  async assignCallback(id: string, staffId: string, actor?: JwtPayload) {
    const existing = await this.prisma.callbackTask.findUnique({
      where: { id },
    });
    if (!existing) {
      throw new NotFoundException(`Callback task '${id}' not found`);
    }

    if (actor?.role === 'team_lead' && staffId !== actor.sub) {
      const targetStaff = await this.prisma.staff.findUnique({
        where: { id: staffId },
        select: { teamLeadId: true },
      });
      if (!targetStaff || targetStaff.teamLeadId !== actor.sub) {
        throw new ForbiddenException(
          `Access denied: staff '${staffId}' is not part of your team`,
        );
      }
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

  async initiateOutboundCall(
    agentPhone: string,
    customerPhone: string,
    recordCall = true,
  ): Promise<OutboundCallResult> {
    return this.provider.initiateOutboundCall({
      agentPhone,
      customerPhone,
      recordCall,
    });
  }

  getCapacity(): TelephonyCapacity {
    return this.provider.getCapacity();
  }
}
