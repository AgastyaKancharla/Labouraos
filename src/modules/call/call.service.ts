import { coversPieceAt } from '../field-visit/field-handover.service';
import { OwnTeam } from '../../common/rbac/own-team';
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
import { normaliseIndianMobile } from '../../common/phone/indian-mobile';
import { CallStatusEvent, toCallStatusEvent } from './call-status.event';
import { canAdvanceCallStatus, FINAL_CALL_STATUSES } from './call-status';
import { callStatusSignatureMatches } from './call-signature';
import { RecordingCopyJob } from './recording-copy.job';
import { RECORDING_LINK_TTL_SECONDS, RECORDING_STORAGE, RecordingStorage } from './recording-storage';
import { CALL_ANNOUNCEMENT } from './call-announcement';
import { CallClock } from './call-clock';
import { isAgentOutcome, isCallPurpose, NO_ANSWER_OUTCOMES, STOP_OUTCOMES } from './call-outcomes';
import { ContactBlockKind, callsBlocked, liveKeyOf, phoneHash } from './contact-block';
import { ReviewFlagService } from '../review-flag/review-flag.service';
import { mapTeleCmiReport, teleCmiKeyMatches, TELECMI_VENDOR } from '../telephony/telecmi';
import { isWithinClockWindow } from './call-window';
import { getCalendarPartsInTimezone } from '../../common/time/period-boundary';
import { EditPolicyService, EditActor } from '../../common/edit-policy/edit-policy.service';
import { AttendanceService } from '../attendance/attendance.service';
import { CallFollowThroughService } from './call-follow-through.service';
import { parseClock } from './call-window';

/** Security L4: the only keys PATCH /calls/:id takes. */
const CALL_NOTE_EDIT_KEYS = new Set(['notes', 'agentOutcomeReason', 'reason']);

export interface CallActor {
  id: string;
  role: string;
}

/** Statuses (besides Available) in which a field agent may place a call (21 Nov, B2). */
const FIELD_CALLING_STATUSES: readonly string[] = ['on_visit', 'travelling'];

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
    private readonly reviewFlags: ReviewFlagService,
  ) {
    this.team = new OwnTeam(prisma);
  }

  /** A Team Lead's own team (the one shared definition, OwnTeam). */
  private readonly team: OwnTeam;

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

    // Only the agent's note is editable (security AC-1, L4): any key other than
    // notes, agentOutcomeReason and reason is refused here, before the edit policy.
    const { notes, agentOutcomeReason } = (body ?? {}) as Record<string, unknown>;
    const refused = Object.keys(body ?? {}).filter((key) => !CALL_NOTE_EDIT_KEYS.has(key));
    if (refused.length) {
      throw new BadRequestException(
        `Call provider fields and recordings are never editable; only the agent's note can be changed (notes or agentOutcomeReason, with a reason). Refused: ${refused.join(', ')}`,
      );
    }
    for (const [key, value] of [['notes', notes], ['agentOutcomeReason', agentOutcomeReason]] as const) {
      if (value !== undefined && typeof value !== 'string') throw new BadRequestException(`${key} must be text`);
    }
    const updates: Record<string, unknown> = {};
    if (agentOutcomeReason !== undefined) {
      updates.agentOutcomeReason = agentOutcomeReason;
    }
    if (notes !== undefined) {
      updates.agentOutcomeReason = notes;
    }

    const { record, diff } = await this.editPolicyService.assertCanEdit({
      actor: editActor,
      entityType: 'call_record',
      entityId: id,
      updates,
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

  /**
   * TeleCMI call reports (21 Nov fixes, src/modules/telephony/telecmi.ts):
   * a missed inbound call goes on the missed-call list (handed out by the
   * software); an outbound or answered call updates its call record through
   * applyStatus, like any other status webhook. Repeats are no-ops.
   */
  async applyTeleCmiReport(key: string | undefined, payload: Record<string, unknown>) {
    if (!teleCmiKeyMatches(key)) throw new UnauthorizedException('Invalid TeleCMI webhook key');
    if (!process.env.TELECMI_APP_ID) throw new UnauthorizedException('TeleCMI is not set up here (TELECMI_APP_ID)');
    const report = mapTeleCmiReport(payload ?? {}, process.env.TELECMI_APP_ID, this.clock.now());
    if (report.kind === 'ignored') {
      // The reason only: never the number, the call id or the key (first real reports: see what is dropped).
      this.logger.warn(`TeleCMI report ignored: ${report.reason}`);
      if (report.reason === 'another app') throw new UnauthorizedException('Report for another TeleCMI app');
      return { ignored: report.reason };
    }
    if (report.kind === 'missed_inbound') {
      const result = await this.telephony.handleInboundCall({ callId: report.callId, callerPhone: report.callerPhone, timestamp: report.at });
      return { callbackTaskId: result.callbackTaskId, duplicate: result.isDuplicate };
    }
    // Only one of our own TeleCMI calls is ever changed (never another vendor's, never a new record),
    // and only forward (applyStatus refuses a step back).
    const ours = report.callRecordId
      ? await this.prisma.callRecord.findUnique({ where: { id: report.callRecordId }, select: { provider: true, providerCallId: true } })
      : await this.prisma.callRecord.findUnique({
          where: { provider_providerCallId: { provider: report.event.provider, providerCallId: report.event.providerCallId } },
          select: { provider: true, providerCallId: true },
        });
    if (!ours || ours.provider !== TELECMI_VENDOR) {
      this.logger.warn('TeleCMI report ignored: no matching TeleCMI call');
      return { ignored: 'no matching TeleCMI call' };
    }
    return this.applyStatus({ ...report.event, provider: ours.provider, providerCallId: ours.providerCallId });
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
    // 21 Nov fixes: "do not call" blocks every call until a Team Lead lifts it.
    if (await callsBlocked(this.prisma, { subjectType, subjectId: subject.id })) {
      throw new ForbiddenException('This person asked not to be called (do not call). A Team Lead can lift it.');
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
        actor.role === 'field_agent'
          ? 'Set the phone the calling system rings before placing a call: Laboura Field → Me → "Your calling phone" (your Team Lead can also set it)'
          : 'Set the phone the calling system rings before placing a call: Home → "Your calling phone" (a Team Lead, Manager or the CEO can also set it on Team & Access)',
      );
    }
    const agentPhone = normaliseIndianMobile(decryptCallRoutingPhone(caller.callRoutingPhone));
    if (!(await this.mayPlaceCallNow(actor))) {
      throw new BadRequestException(
        actor.role === 'field_agent'
          ? 'Calls are placed only while you are Available, On visit or Travelling'
          : 'Calls are placed only while you are Available',
      );
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
      // Both legs dialled in the one stored format (+91 and 10 digits).
      customerPhone: normaliseIndianMobile(subject.phone),
      recordCall: true,
      ringAgentFirst: true,
      announcement: CALL_ANNOUNCEMENT,
      metadata: { callRecordId: created.id },
    });

    // A call was really placed: the Team Lead's "app sign-up call not made" flag for him closes,
    // whatever the call's outcome turns out to be (21 Nov fixes).
    await this.closeNotAttemptedFlags(subjectType, subject.id, created.code);

    if (result.callId && result.callId !== created.providerCallId) {
      await this.prisma.callRecord.update({
        where: { id: created.id },
        data: { providerCallId: result.callId },
      });
    }

    return { callRecordId: created.id };
  }

  /**
   * Who may place a call right now (21 Nov, B2): Available, and for a field
   * agent also On visit or Travelling, since at a shop the status is On visit
   * (calling candidates from the shop is the whole point of the visit).
   */
  private async mayPlaceCallNow(actor: CallActor): Promise<boolean> {
    if (await this.attendance.isAvailable(actor.id)) return true;
    if (actor.role !== 'field_agent') return false;
    const today = await this.attendance.today(actor.id);
    return Boolean(today.status && FIELD_CALLING_STATUSES.includes(today.status) && !today.logoutAt);
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
    const agentOutcome = input.agentOutcome ?? '';
    if (!isAgentOutcome(agentOutcome)) {
      throw new BadRequestException('agentOutcome is not one of the allowed outcomes');
    }
    const noAnswer = NO_ANSWER_OUTCOMES.includes(agentOutcome);
    // "Busy" and "switched off" may be told about a call nobody answered, once it has ended.
    const ended = (FINAL_CALL_STATUSES as readonly string[]).includes(row.providerStatus);
    if (!row.answered && !(noAnswer && ended)) {
      throw new BadRequestException(
        noAnswer ? 'Wait until the call has ended to mark it busy or switched off' : 'A call that was not answered cannot have an outcome',
      );
    }
    if (noAnswer && !row.answered) {
      // The phone system already treated it as no answer (retry, WhatsApp): only the label is kept.
      const at = this.clock.now();
      await this.prisma.callRecord.update({ where: { id: row.id }, data: { agentOutcome, agentOutcomeReason: input.reason?.trim() || null, agentOutcomeAt: at } });
      await this.auditService.log({
        actorId: actor.id,
        action: 'call.outcome_recorded',
        entityType: 'call_record',
        entityCode: row.code,
        after: { agentOutcome },
        changedFields: ['agentOutcome'],
      });
      return { callRecordId: row.id, agentOutcome };
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
    if (row.subjectType && row.subjectId && noAnswer) {
      // Answered by a network message: treated as no answer (retry rules, 3-try limit).
      const updated = await this.prisma.callRecord.findUniqueOrThrow({ where: { id: row.id } });
      await this.followThrough.onAgentNoAnswer(updated);
      return { callRecordId: row.id, agentOutcome };
    }
    if (row.subjectType && row.subjectId && STOP_OUTCOMES.includes(agentOutcome)) {
      await this.blockContact(actor, row, agentOutcome as ContactBlockKind, at);
    }
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

  /**
   * "Wrong number" / "do not call" (21 Nov fixes): a live block for the person
   * (no retries, no automatic messages; do not call also no calls), every open
   * call task and missed call for him closed, and a wrong number on a paid job
   * seeker goes to the Team Lead.
   */
  private async blockContact(actor: CallActor, row: CallRecord, kind: ContactBlockKind, at: Date): Promise<void> {
    const subject = { subjectType: row.subjectType!, subjectId: row.subjectId! };
    const loaded = await this.loadSubject(subject.subjectType, subject.subjectId);
    const liveKey = liveKeyOf(subject, kind);
    await this.prisma.contactBlock.upsert({
      where: { liveKey },
      create: {
        subjectType: subject.subjectType,
        subjectId: subject.subjectId,
        kind,
        phoneHash: phoneHash(loaded?.phone),
        callRecordId: row.id,
        byStaffId: actor.id,
        liveKey,
      },
      update: { phoneHash: phoneHash(loaded?.phone), callRecordId: row.id, byStaffId: actor.id },
    });
    // Sign-up help tasks too: nothing more is planned for him.
    await this.prisma.callTask.updateMany({
      where: { subjectType: subject.subjectType, subjectId: subject.subjectId, status: 'open' },
      data: { status: 'cancelled', doneAt: at, doneCallRecordId: row.id },
    });
    const digits = loaded?.phone ? loaded.phone.replace(/\D/g, '').slice(-10) : '';
    if (digits.length === 10) {
      await this.prisma.callbackTask.updateMany({
        where: { status: { in: ['pending', 'assigned'] }, phone: { endsWith: digits } },
        data: { status: 'completed', completedAt: at },
      });
    }
    await this.auditService.log({
      actorId: actor.id,
      action: 'call.contact_blocked',
      entityType: subject.subjectType,
      entityCode: subject.subjectId,
      after: { kind, callRecordId: row.id },
      changedFields: ['contactBlock'],
      reason: kind === 'do_not_call' ? 'Asked not to be called' : 'Wrong number',
    });
    if (kind === 'wrong_number' && subject.subjectType === 'job_seeker') {
      const seeker = await this.prisma.jobSeeker.findUnique({ where: { id: subject.subjectId }, select: { paymentReceivedAt: true } });
      if (seeker?.paymentReceivedAt) {
        const open = await this.prisma.reviewFlag.findFirst({
          where: { kind: 'wrong_number_paid', subjectType: 'job_seeker', subjectId: subject.subjectId, status: 'open' },
          select: { id: true },
        });
        if (!open) {
          await this.reviewFlags.raise({
            kind: 'wrong_number_paid',
            subjectType: 'job_seeker',
            subjectId: subject.subjectId,
            raisedForStaffId: actor.id,
            details: { callRecordId: row.id, callCode: row.code },
          });
        }
      }
    }
  }

  /**
   * A Team Lead (own team's people), Manager or the CEO lifts a wrong number or
   * do not call, with a reason (audited).
   */
  async liftContactBlock(actor: CallActor, subjectType: string, subjectId: string, kind: string, reason: string | undefined) {
    if (!['team_lead', 'manager', 'ceo'].includes(actor.role)) {
      throw new ForbiddenException('Only a Team Lead, Manager or the CEO lifts a wrong number or do not call');
    }
    if (kind !== 'wrong_number' && kind !== 'do_not_call') throw new BadRequestException('kind is wrong_number or do_not_call');
    const why = typeof reason === 'string' ? reason.trim() : '';
    if (!why) throw new BadRequestException('A reason is needed');
    const live = await this.prisma.contactBlock.findUnique({ where: { liveKey: liveKeyOf({ subjectType, subjectId }, kind) } });
    if (!live) throw new NotFoundException('No live block of that kind for this person');
    if (actor.role === 'team_lead') {
      // Decided by who looks after the person (assigned, else registering agent; a business's
      // account agent, else lead creator); only a person nobody looks after falls back to who recorded it.
      const owners = await this.ownersOf(subjectType, subjectId);
      const candidates = owners.length ? owners : [live.byStaffId].filter((x): x is string => Boolean(x));
      let mine = false;
      for (const owner of candidates) if (await this.team.includes(actor.id, owner)) mine = true;
      if (!mine) throw new ForbiddenException("A Team Lead lifts a block only for their own team's people");
    }
    const lifted = await this.prisma.contactBlock.updateMany({
      where: { id: live.id, liftedAt: null },
      data: { liftedAt: this.clock.now(), liftedByStaffId: actor.id, liftReason: why.slice(0, 300), liveKey: null },
    });
    if (lifted.count !== 1) throw new NotFoundException('No live block of that kind for this person');
    await this.auditService.log({
      actorId: actor.id,
      action: 'call.contact_block_lifted',
      entityType: subjectType,
      entityCode: subjectId,
      before: { kind },
      after: { lifted: true },
      changedFields: ['contactBlock'],
      reason: why,
    });
    return { lifted: true, kind };
  }

  private async closeNotAttemptedFlags(subjectType: string, subjectId: string, callCode: string): Promise<void> {
    const open = await this.prisma.reviewFlag.findMany({
      where: { kind: 'signup_call_not_attempted', subjectType, subjectId, status: 'open' },
      select: { id: true },
    });
    for (const flag of open) {
      const done = await this.prisma.reviewFlag.updateMany({
        where: { id: flag.id, status: 'open' },
        data: { status: 'resolved', resolvedAt: this.clock.now(), resolution: `Call placed (${callCode})` },
      });
      if (done.count) await this.reviewFlags.refreshBell(flag.id).catch(() => undefined);
    }
  }

  private async ownersOf(subjectType: string, subjectId: string): Promise<string[]> {
    if (subjectType === 'job_seeker' || subjectType === 'referral') {
      const row =
        subjectType === 'job_seeker'
          ? await this.prisma.jobSeeker.findUnique({ where: { id: subjectId }, select: { assignedStaffId: true, registeredByStaffId: true } })
          : await this.prisma.referral.findUnique({ where: { id: subjectId }, select: { assignedStaffId: true, registeredByStaffId: true } });
      const owner = row?.assignedStaffId ?? row?.registeredByStaffId;
      return owner ? [owner] : [];
    }
    if (subjectType === 'business') {
      const b = await this.prisma.business.findUnique({ where: { id: subjectId }, select: { accountAgentId: true, leadCreatedByStaffId: true } });
      const owner = b?.accountAgentId ?? b?.leadCreatedByStaffId;
      return owner ? [owner] : [];
    }
    return [];
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
    return actor.role === 'team_lead' && this.team.includes(actor.id, row.staffId);
  }

  private async canListen(actor: CallActor, row: CallRecord): Promise<boolean> {
    if (actor.role === 'ceo' || actor.role === 'manager') {
      return true;
    }
    if (actor.role !== 'team_lead' || !row.staffId) {
      return false;
    }
    // A Team Lead listens to their team's calls (OwnTeam), not their own.
    if (row.staffId === actor.id) return false;
    return this.team.includes(actor.id, row.staffId);
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
    subject: { id: string; accountAgentId: string | null },
  ) {
    const rule = RBAC_MATRIX[actor.role as Role]?.[subjectType]?.read;
    if (!rule?.allowed) {
      throw new ForbiddenException('You cannot call this record');
    }
    if (actor.role === 'field_agent' && subjectType === 'business') {
      if (subject.accountAgentId !== actor.id && !(await this.fieldAgentWorksOn(actor.id, subject.id))) {
        throw new ForbiddenException('Field agents may only call their account businesses');
      }
    }
  }

  /**
   * 21 Nov (Laboura Field): besides his account businesses a field agent may call the owner of
   * a business he has an open visit to (a verification visit's "Call owner"), a follow-up task
   * on, or open work of handed over to him on a teammate's leave.
   */
  private async fieldAgentWorksOn(staffId: string, businessId: string): Promise<boolean> {
    const [visit, task, cover] = await Promise.all([
      this.prisma.visitAssignment.findFirst({ where: { businessId, assignedStaffId: staffId, status: 'assigned' }, select: { id: true } }),
      this.prisma.followUpTask.findFirst({ where: { subjectType: 'business', subjectId: businessId, assignedStaffId: staffId, status: 'pending' }, select: { id: true } }),
      coversPieceAt(this.prisma, staffId, businessId, ['revisit', 'joining', 'interview', 'visit_assignment'], this.clock.now()),
    ]);
    return Boolean(visit || task || cover);
  }

  private async visibleStaffIds(actor: CallActor): Promise<string[] | null> {
    if (actor.role === 'ceo' || actor.role === 'manager') {
      return null;
    }
    if (actor.role === 'call_agent' || actor.role === 'field_agent') {
      return [actor.id];
    }
    if (actor.role === 'team_lead') {
      return this.team.memberIds(actor.id);
    }
    return [];
  }
}
