import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { CallRecord } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { ConsentService } from '../consent/consent.service';
import { IdService } from '../../common/id/id.service';
import { AuditService } from '../../common/audit/audit.service';
import { Role, RBAC_MATRIX } from '../../common/rbac/rbac.types';
import { PricingService } from '../pricing/pricing.service';
import { TELEPHONY_PROVIDER, TelephonyProvider } from '../telephony/telephony.interface';
import { decryptCallRoutingPhone } from '../staff/call-routing-key';
import { CallStatusEvent, toCallStatusEvent } from './call-status.event';
import { canAdvanceCallStatus, FINAL_CALL_STATUSES } from './call-status';
import { callStatusSignatureMatches } from './call-signature';
import { RecordingCopyJob } from './recording-copy.job';
import { RECORDING_LINK_TTL_SECONDS, RECORDING_STORAGE, RecordingStorage } from './recording-storage';
import { CALL_ANNOUNCEMENT } from './call-announcement';
import { CallClock } from './call-clock';
import { isAgentOutcome, isCallPurpose } from './call-outcomes';
import { isWithinClockWindow } from './call-window';
import { getCalendarPartsInTimezone } from '../../common/time/period-boundary';
import { EditPolicyService, EditActor } from '../../common/edit-policy/edit-policy.service';
import { AttendanceService } from '../attendance/attendance.service';
import { CallFollowThroughService } from './call-follow-through.service';
import { parseClock } from './call-window';

export interface CallActor {
  id: string;
  role: string;
}

@Injectable()
export class CallService {
  private readonly logger = new Logger(CallService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly consentService: ConsentService,
    private readonly idService: IdService,
    private readonly auditService: AuditService,
    private readonly copyJob: RecordingCopyJob,
    private readonly pricing: PricingService,
    private readonly clock: CallClock,
    @Inject(TELEPHONY_PROVIDER) private readonly telephony: TelephonyProvider,
    @Inject(RECORDING_STORAGE) private readonly storage: RecordingStorage,
    private readonly editPolicyService: EditPolicyService,
    private readonly attendance: AttendanceService,
    private readonly followThrough: CallFollowThroughService,
  ) {}

  async updateNotes(
    actor: EditActor | string,
    id: string,
    body: { notes?: string; agentOutcomeReason?: string; reason?: string },
  ) {
    let editActor: EditActor;
    if (typeof actor === 'string') {
      const staff = await this.prisma.staff.findUnique({
        where: { id: actor },
        select: { id: true, role: true, teamLeadId: true },
      });
      if (staff) {
        editActor = { id: staff.id, role: staff.role, teamLeadId: staff.teamLeadId };
      } else {
        editActor = { id: actor, role: 'manager' };
      }
    } else {
      editActor = actor;
    }

    const updates: Record<string, unknown> = {};
    if (body.agentOutcomeReason !== undefined) {
      updates.agentOutcomeReason = body.agentOutcomeReason;
    }
    if (body.notes !== undefined) {
      updates.agentOutcomeReason = body.notes;
    }

    const { record, diff } = await this.editPolicyService.assertCanEdit({
      actor: editActor,
      entityType: 'call_record',
      entityId: id,
      updates: body as unknown as Record<string, unknown>,
      reason: body.reason,
    });

    if (!diff || !diff.hasChange) {
      return record;
    }

    const updated = await this.prisma.callRecord.update({
      where: { id: record.id as string },
      data: {
        agentOutcomeReason: (updates.agentOutcomeReason as string) ?? (record.agentOutcomeReason as string | null),
      },
    });

    await this.editPolicyService.logEdit({
      actorId: editActor.id,
      entityType: 'call_record',
      entityCode: record.code as string,
      diff,
      reason: body.reason,
    });

    return updated;
  }

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
      await this.recordContactAttemptIfFinal(created);
      await this.reflectOnAttendance(null, created);
      await this.followThrough.onStatusChanged(null, created);
      return { id: created.id, code: created.code, unchanged: false };
    }

    if (!canAdvanceCallStatus(existing.providerStatus, event.status)) {
      return { id: existing.id, code: existing.code, unchanged: true };
    }

    const updated = await this.prisma.callRecord.update({
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
    await this.recordContactAttemptIfFinal(updated);
    await this.reflectOnAttendance(existing, updated);
    await this.followThrough.onStatusChanged(existing, updated);
    return { id: existing.id, code: existing.code, unchanged: false };
  }

  /**
   * answeredAt starts On call. endedAt after an answer starts After-call notes.
   * A repeat webhook does not reach here. A call that was never answered stays put.
   */
  private async reflectOnAttendance(
    before: { staffId: string | null; answeredAt: Date | null; endedAt: Date | null } | null,
    after: { staffId: string | null; answeredAt: Date | null; endedAt: Date | null },
  ): Promise<void> {
    if (!after.staffId) return;
    const answeredNow = after.answeredAt !== null && before?.answeredAt == null;
    const endedNow = after.endedAt !== null && before?.endedAt == null;
    if (endedNow && after.answeredAt) {
      await this.attendance.onCallEnded(after.staffId);
      return;
    }
    if (answeredNow) {
      await this.attendance.onCallAnswered(after.staffId);
    }
  }

  private async recordContactAttemptIfFinal(call: CallRecord) {
    if (
      !FINAL_CALL_STATUSES.includes(
        call.providerStatus as (typeof FINAL_CALL_STATUSES)[number],
      )
    ) {
      return;
    }
    if (call.subjectType !== 'job_seeker' || !call.subjectId) {
      return;
    }
    const existing = await this.prisma.contactAttempt.findUnique({
      where: { callRecordId: call.id },
    });
    if (existing) {
      return;
    }
    const attemptedAt = call.startedAt ?? call.createdAt;
    const parts = getCalendarPartsInTimezone(attemptedAt, 'Asia/Kolkata');
    const timeOfDay = parts.hour < 12 ? 'am' : 'pm';
    try {
      await this.prisma.contactAttempt.create({
        data: {
          jobSeekerId: call.subjectId,
          channel: 'call',
          outcome: call.answered ? 'picked_up' : 'no_pickup',
          attemptedAt,
          timeOfDay,
          staffId: call.staffId,
          callRecordId: call.id,
        },
      });
    } catch (err: unknown) {
      if ((err as { code?: string })?.code !== 'P2002') {
        throw err;
      }
    }
  }

  async place(
    actor: CallActor,
    input: {
      subjectType?: string;
      subjectId?: string;
      purpose?: string;
      relatedType?: string;
      relatedId?: string;
    },
  ) {
    const subjectType = input.subjectType ?? '';
    const subjectId = input.subjectId ?? '';
    const purpose = input.purpose ?? '';
    if (subjectType !== 'job_seeker' && subjectType !== 'business' && subjectType !== 'referral') {
      throw new BadRequestException('subjectType must be job_seeker, business or referral');
    }
    if (!subjectId) {
      throw new BadRequestException('subjectId is required');
    }
    if (!isCallPurpose(purpose)) {
      throw new BadRequestException('purpose is not one of the allowed call purposes');
    }

    const subject = await this.loadSubject(subjectType, subjectId);
    if (!subject) {
      throw new NotFoundException('The person or business to call was not found');
    }

    if (subjectType === 'job_seeker' && purpose !== 'consent_explain') {
      const hasCallRecordingConsent = await this.consentService.hasConsent(
        'job_seeker',
        subject.id,
        'call_recording',
      );
      if (!hasCallRecordingConsent) {
        throw new ForbiddenException(
          'Consent for call_recording is required before calling a job seeker',
        );
      }
    }

    if (
      subjectType === 'job_seeker' &&
      ['offer', 'follow_up', 'interview_result', 'joining_confirmation'].includes(purpose)
    ) {
      const hasJobMatchingConsent = await this.consentService.hasConsent(
        'job_seeker',
        subject.id,
        'job_matching',
      );
      if (!hasJobMatchingConsent) {
        throw new ForbiddenException(
          'Consent for job_matching is required before calling a job seeker about job opportunities',
        );
      }
    }

    await this.assertCanCall(actor, subjectType, subject);

    const now = this.clock.now();
    const policy = await this.pricing.current();
    if (!isWithinClockWindow(now, policy.callingHoursStart, policy.callingHoursEnd)) {
      throw new BadRequestException(
        `Calls are only placed between ${policy.callingHoursStart} and ${policy.callingHoursEnd} IST`,
      );
    }
    if (
      subjectType === 'job_seeker' &&
      subject.windowStart &&
      subject.windowEnd &&
      !isWithinClockWindow(now, subject.windowStart, subject.windowEnd)
    ) {
      throw new BadRequestException(
        `This candidate can only be called between ${subject.windowStart} and ${subject.windowEnd} IST`,
      );
    }

    const caller = await this.prisma.staff.findUnique({
      where: { id: actor.id },
      select: { callRoutingPhone: true },
    });
    if (!caller?.callRoutingPhone) {
      throw new BadRequestException(
        'Set the phone the calling system rings before placing a call',
      );
    }
    const agentPhone = decryptCallRoutingPhone(caller.callRoutingPhone);
    if (!(await this.attendance.isAvailable(actor.id))) {
      throw new BadRequestException('Calls are placed only while you are Available');
    }

    const provider = this.telephony.getCapacity().vendor;
    const code = await this.idService.generateCode('call');
    const created = await this.prisma.callRecord.create({
      data: {
        code,
        provider,
        providerCallId: `pending-${code}`,
        direction: 'outbound',
        staffId: actor.id,
        subjectType,
        subjectId: subject.id,
        purpose,
        relatedType: input.relatedType ?? null,
        relatedId: input.relatedId ?? null,
        providerStatus: 'initiated',
        answered: false,
        announcementPlayed: true,
      },
    });

    const result = await this.telephony.initiateOutboundCall({
      agentPhone,
      customerPhone: subject.phone,
      recordCall: true,
      ringAgentFirst: true,
      announcement: CALL_ANNOUNCEMENT,
      metadata: { callRecordId: created.id },
    });

    if (result.callId && result.callId !== created.providerCallId) {
      await this.prisma.callRecord.update({
        where: { id: created.id },
        data: { providerCallId: result.callId },
      });
    }

    return { callRecordId: created.id };
  }

  async recordOutcome(
    actor: CallActor,
    id: string,
    input: { agentOutcome?: string; reason?: string; callbackAt?: string },
  ) {
    const row = await this.prisma.callRecord.findUnique({ where: { id } });
    if (!row) {
      throw new NotFoundException('Call not found');
    }
    if (row.staffId !== actor.id) {
      throw new ForbiddenException('Only the person who made the call can record the outcome');
    }
    if (!row.answered) {
      throw new BadRequestException('A call that was not answered cannot have an outcome');
    }
    const agentOutcome = input.agentOutcome ?? '';
    if (!isAgentOutcome(agentOutcome)) {
      throw new BadRequestException('agentOutcome is not one of the allowed outcomes');
    }
    const reason = typeof input.reason === 'string' && input.reason.trim() ? input.reason.trim() : null;
    const at = this.clock.now();
    if (agentOutcome === 'rejected_offer' && !reason) {
      throw new BadRequestException('A reason is required when he turns down the offer');
    }
    // "Call me back" needs a date and time, which puts the person back on the list then.
    let callbackAt: Date | null = null;
    if (agentOutcome === 'callback_requested') {
      callbackAt = await this.validCallbackTime(input.callbackAt, at);
    }
    await this.prisma.callRecord.update({
      where: { id: row.id },
      data: {
        agentOutcome,
        agentOutcomeReason: reason,
        agentOutcomeAt: at,
      },
    });
    await this.auditService.log({
      actorId: actor.id,
      action: 'call.outcome_recorded',
      entityType: 'call_record',
      entityCode: row.code,
      after: { agentOutcome },
      reason,
      changedFields: ['agentOutcome'],
    });
    if (row.subjectType && row.subjectId) {
      // Whatever he said, earlier callbacks and retries for him are done.
      await this.prisma.callTask.updateMany({
        where: {
          subjectType: row.subjectType,
          subjectId: row.subjectId,
          status: 'open',
          OR: [{ sourceCallRecordId: null }, { sourceCallRecordId: { not: row.id } }],
        },
        data: { status: 'done', doneAt: at, doneCallRecordId: row.id },
      });
      if (callbackAt) {
        await this.prisma.callTask.upsert({
          where: { sourceCallRecordId_kind: { sourceCallRecordId: row.id, kind: 'callback' } },
          create: {
            staffId: actor.id,
            subjectType: row.subjectType,
            subjectId: row.subjectId,
            kind: 'callback',
            dueAt: callbackAt,
            sourceCallRecordId: row.id,
          },
          update: { dueAt: callbackAt, status: 'open', doneAt: null, doneCallRecordId: null },
        });
      }
    }
    return { callRecordId: row.id, agentOutcome, ...(callbackAt ? { callbackAt: callbackAt.toISOString() } : {}) };
  }

  /** A callback must be in the future and inside the calling hours (IST). */
  private async validCallbackTime(value: string | undefined, now: Date): Promise<Date> {
    const when = typeof value === 'string' ? new Date(value) : null;
    if (!when || Number.isNaN(when.getTime())) {
      throw new BadRequestException('"Call me back" needs a date and time');
    }
    if (when.getTime() <= now.getTime()) {
      throw new BadRequestException('The callback time must be in the future');
    }
    const policy = await this.pricing.current();
    const parts = getCalendarPartsInTimezone(when, 'Asia/Kolkata');
    const minute = parts.hour * 60 + parts.minute;
    const start = parseClock(policy.callingHoursStart);
    const end = parseClock(policy.callingHoursEnd);
    if (start === null || end === null || minute < start || minute > end) {
      throw new BadRequestException(
        `Callbacks can only be set between ${policy.callingHoursStart} and ${policy.callingHoursEnd}`,
      );
    }
    return when;
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
    const subject = await this.loadSubject(subjectType, subjectId);
    const resolvedSubjectId = subject ? subject.id : subjectId;
    const staffIds = await this.visibleStaffIds(actor);
    const rows = await this.prisma.callRecord.findMany({
      where: {
        subjectType,
        subjectId: resolvedSubjectId,
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

  private async loadSubject(subjectType: string, subjectId: string) {
    if (subjectType === 'job_seeker') {
      let row = await this.prisma.jobSeeker.findUnique({
        where: { id: subjectId },
        select: {
          id: true,
          phone: true,
          preferredCallWindowStart: true,
          preferredCallWindowEnd: true,
        },
      });
      if (!row) {
        row = await this.prisma.jobSeeker.findUnique({
          where: { code: subjectId },
          select: {
            id: true,
            phone: true,
            preferredCallWindowStart: true,
            preferredCallWindowEnd: true,
          },
        });
      }
      if (!row) {
        return null;
      }
      return {
        id: row.id,
        phone: row.phone,
        windowStart: row.preferredCallWindowStart,
        windowEnd: row.preferredCallWindowEnd,
        accountAgentId: null,
      };
    }
    if (subjectType === 'business') {
      let row = await this.prisma.business.findUnique({
        where: { id: subjectId },
        select: { id: true, phone: true, accountAgentId: true },
      });
      if (!row) {
        row = await this.prisma.business.findUnique({
          where: { code: subjectId },
          select: { id: true, phone: true, accountAgentId: true },
        });
      }
      if (!row) {
        return null;
      }
      return { id: row.id, phone: row.phone, accountAgentId: row.accountAgentId, windowStart: null, windowEnd: null };
    }
    let row = await this.prisma.referral.findUnique({
      where: { id: subjectId },
      select: { id: true, phone: true },
    });
    if (!row) {
      row = await this.prisma.referral.findUnique({
        where: { code: subjectId },
        select: { id: true, phone: true },
      });
    }
    if (!row) {
      return null;
    }
    return { id: row.id, phone: row.phone, accountAgentId: null, windowStart: null, windowEnd: null };
  }

  private async assertCanCall(
    actor: CallActor,
    subjectType: 'job_seeker' | 'business' | 'referral',
    subject: { accountAgentId: string | null },
  ) {
    const rule = RBAC_MATRIX[actor.role as Role]?.[subjectType]?.read;
    if (!rule?.allowed) {
      throw new ForbiddenException('You cannot call this record');
    }
    if (actor.role === 'field_agent' && subjectType === 'business') {
      if (subject.accountAgentId !== actor.id) {
        throw new ForbiddenException('Field agents may only call their account businesses');
      }
    }
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
