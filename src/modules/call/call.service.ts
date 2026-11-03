import {
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { CallRecord } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { IdService } from '../../common/id/id.service';
import { AuditService } from '../../common/audit/audit.service';
import { CallStatusEvent, toCallStatusEvent } from './call-status.event';
import { canAdvanceCallStatus } from './call-status';
import { callStatusSignatureMatches } from './call-signature';
import { RecordingCopyJob } from './recording-copy.job';
import { RECORDING_LINK_TTL_SECONDS, RECORDING_STORAGE, RecordingStorage } from './recording-storage';

export interface CallActor {
  id: string;
  role: string;
}

@Injectable()
export class CallService {
  private readonly logger = new Logger(CallService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly idService: IdService,
    private readonly auditService: AuditService,
    private readonly copyJob: RecordingCopyJob,
    @Inject(RECORDING_STORAGE) private readonly storage: RecordingStorage,
  ) {}

  async applyWebhook(rawBody: Buffer | undefined, signature: string | undefined) {
    const secret = process.env.TELEPHONY_WEBHOOK_SECRET ?? '';
    if (!callStatusSignatureMatches(rawBody, signature, secret)) {
      throw new UnauthorizedException('Invalid call status signature');
    }
    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(rawBody!.toString('utf8')) as Record<string, unknown>;
    } catch {
      throw new UnauthorizedException('Invalid call status signature');
    }
    const event = toCallStatusEvent(payload);
    if (!event) {
      throw new UnauthorizedException('Invalid call status signature');
    }
    return this.applyStatus(event);
  }

  /** The only writer of providerStatus, answered, times and duration. */
  async applyStatus(event: CallStatusEvent) {
    const existing = await this.prisma.callRecord.findUnique({
      where: {
        provider_providerCallId: {
          provider: event.provider,
          providerCallId: event.providerCallId,
        },
      },
    });

    if (!existing) {
      const created = await this.prisma.callRecord.create({
        data: {
          code: await this.idService.generateCode('call'),
          provider: event.provider,
          providerCallId: event.providerCallId,
          direction: event.direction,
          providerStatus: event.status,
          answered: event.answered,
          startedAt: event.startedAt,
          answeredAt: event.answeredAt,
          endedAt: event.endedAt,
          durationSec: event.durationSec,
        },
      });
      await this.copyIfCompleted(created.id, event);
      return { id: created.id, code: created.code, unchanged: false };
    }

    if (!canAdvanceCallStatus(existing.providerStatus, event.status)) {
      return { id: existing.id, code: existing.code, unchanged: true };
    }

    await this.prisma.callRecord.update({
      where: { id: existing.id },
      data: {
        providerStatus: event.status,
        answered: event.answered,
        startedAt: event.startedAt ?? existing.startedAt,
        answeredAt: event.answeredAt ?? existing.answeredAt,
        endedAt: event.endedAt ?? existing.endedAt,
        durationSec: event.durationSec ?? existing.durationSec,
        direction: event.direction ?? existing.direction,
      },
    });
    await this.copyIfCompleted(existing.id, event);
    return { id: existing.id, code: existing.code, unchanged: false };
  }

  async getOne(actor: CallActor, id: string) {
    const row = await this.prisma.callRecord.findUnique({ where: { id } });
    if (!row) {
      throw new NotFoundException('Call not found');
    }
    if (!(await this.canRead(actor, row))) {
      throw new ForbiddenException('You cannot view this call');
    }
    return this.toPublic(row);
  }

  async list(actor: CallActor, subjectType: string, subjectId: string) {
    const staffIds = await this.visibleStaffIds(actor);
    const rows = await this.prisma.callRecord.findMany({
      where: {
        subjectType,
        subjectId,
        ...(staffIds ? { staffId: { in: staffIds } } : {}),
      },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map((row) => this.toPublic(row));
  }

  async recordingLink(actor: CallActor, id: string) {
    const row = await this.prisma.callRecord.findUnique({ where: { id } });
    if (!row) {
      throw new NotFoundException('Call not found');
    }
    if (!(await this.canListen(actor, row))) {
      throw new ForbiddenException('You cannot listen to this recording');
    }
    if (!row.recordingStoragePath) {
      throw new NotFoundException('Recording is not available');
    }
    const url = await this.storage.signedUrl(row.recordingStoragePath, RECORDING_LINK_TTL_SECONDS);
    await this.auditService.log({
      actorId: actor.id,
      action: 'call.recording.listened',
      entityType: 'call_record',
      entityCode: row.code,
      after: { callRecordId: row.id },
      changedFields: [],
    });
    return { url, expiresInSeconds: RECORDING_LINK_TTL_SECONDS };
  }

  private async copyIfCompleted(callRecordId: string, event: CallStatusEvent): Promise<void> {
    if (event.status !== 'completed' || !event.recordingUrl) {
      return;
    }
    try {
      await this.copyJob.run(callRecordId, event.recordingUrl);
    } catch (err) {
      this.logger.warn(`Recording copy failed for ${callRecordId}`);
      try {
        await this.copyJob.schedule(callRecordId, event.recordingUrl);
      } catch {
        this.logger.warn(`Recording copy retry was not queued for ${callRecordId}: ${String(err)}`);
      }
    }
  }

  private toPublic(row: CallRecord) {
    return {
      id: row.id,
      code: row.code,
      provider: row.provider,
      providerCallId: row.providerCallId,
      direction: row.direction,
      staffId: row.staffId,
      subjectType: row.subjectType,
      subjectId: row.subjectId,
      purpose: row.purpose,
      relatedType: row.relatedType,
      relatedId: row.relatedId,
      providerStatus: row.providerStatus,
      answered: row.answered,
      startedAt: row.startedAt,
      answeredAt: row.answeredAt,
      endedAt: row.endedAt,
      durationSec: row.durationSec,
      recordingStoragePath: row.recordingStoragePath,
      announcementPlayed: row.announcementPlayed,
      agentOutcome: row.agentOutcome,
      agentOutcomeReason: row.agentOutcomeReason,
      agentOutcomeAt: row.agentOutcomeAt,
    };
  }

  private async canRead(actor: CallActor, row: CallRecord): Promise<boolean> {
    if (actor.role === 'ceo' || actor.role === 'manager') {
      return true;
    }
    if (!row.staffId) {
      return false;
    }
    if (row.staffId === actor.id) {
      return actor.role === 'call_agent' || actor.role === 'field_agent' || actor.role === 'team_lead';
    }
    if (actor.role !== 'team_lead') {
      return false;
    }
    const maker = await this.prisma.staff.findUnique({
      where: { id: row.staffId },
      select: { teamLeadId: true },
    });
    return maker?.teamLeadId === actor.id;
  }

  private async canListen(actor: CallActor, row: CallRecord): Promise<boolean> {
    if (actor.role === 'ceo' || actor.role === 'manager') {
      return true;
    }
    if (actor.role !== 'team_lead' || !row.staffId) {
      return false;
    }
    const maker = await this.prisma.staff.findUnique({
      where: { id: row.staffId },
      select: { teamLeadId: true },
    });
    return maker?.teamLeadId === actor.id;
  }

  private async visibleStaffIds(actor: CallActor): Promise<string[] | null> {
    if (actor.role === 'ceo' || actor.role === 'manager') {
      return null;
    }
    if (actor.role === 'call_agent' || actor.role === 'field_agent') {
      return [actor.id];
    }
    if (actor.role === 'team_lead') {
      const team = await this.prisma.staff.findMany({
        where: { OR: [{ id: actor.id }, { teamLeadId: actor.id }] },
        select: { id: true },
      });
      return team.map((member) => member.id);
    }
    return [];
  }
}
