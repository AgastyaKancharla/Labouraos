import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { IdService } from '../../common/id/id.service';
import { AuditService } from '../../common/audit/audit.service';
import { OtpService } from '../../common/otp/otp.service';
import { OtpSendResult } from '../../common/otp/otp.interface';
import { recordStatusChange } from '../../common/status-history/status-history.helper';
import { getCalendarPartsInTimezone, localCalendarToUtc } from '../../common/time/period-boundary';
import { formatINR } from '../../common/money/money';
import { normaliseIndianMobile, phoneLast4 } from '../../common/phone/indian-mobile';
import { ConsentClock } from '../consent/consent-clock';
import { PricingService } from '../pricing/pricing.service';
import { CallService } from '../call/call.service';
import { CALL_ANNOUNCEMENT } from '../call/call-announcement';
import { JobSeekerService } from '../job-seeker/job-seeker.service';
import { MessagingService } from '../message/messaging.service';
import { ReviewFlagService } from '../review-flag/review-flag.service';
import { TELEPHONY_PROVIDER, TelephonyProvider } from '../telephony/telephony.interface';
import { MatchingService } from '../vacancy/matching.service';
import { InterviewService, NOT_SELECTED_REASONS } from '../vacancy/interview.service';
import { isUnconfirmedVacancyStatus } from '../vacancy/vacancy-confirmation.service';
import { BUSINESS_PAUSED_MESSAGE, businessCandidateAccess } from '../business/business-candidate-access';
import { FieldVisitService } from '../field-visit/field-visit.service';
import { testModeFields } from '../../common/otp/otp-test-mode';

export interface SellingActor {
  id: string;
  role: string;
}

/** How an interview booked from the field app happens (FA15g). */
export const BOOKED_INTERVIEW_TYPES = ['at_shop', 'walk_in', 'phone'] as const;
export type BookedInterviewType = (typeof BOOKED_INTERVIEW_TYPES)[number];

/** The owner's answer on the joining call (FA11) besides "he joined" (POST /placements/:id/joined). */
export const OWNER_JOINING_ANSWERS = ['didnt_come', 'moved'] as const;

/** What the owner said on a call from the field agent (FA18). */
export const OWNER_CALL_OUTCOMES = ['needs_staff', 'happy', 'callback', 'complaint'] as const;

const SELLING_ROLES = ['field_agent', 'team_lead', 'manager', 'ceo'];
/** An in-shop phone talk gets a 30-minute slot; a booked interview at the shop or by phone one hour. */
const IN_SHOP_SLOT_MINUTES = 30;
const BOOKED_SLOT_MINUTES = 60;
const PHONE_SLOT_MINUTES = 30;
/** "Candidate arrived" may be marked from an hour before the slot. */
const ARRIVAL_EARLY_MINUTES = 60;

const DATE_KEY = /^(\d{4})-(\d{2})-(\d{2})$/;
const CLOCK = /^([01]\d|2[0-3]):([0-5]\d)$/;

function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] ?? name.trim();
}

function metresBetween(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(lat2 - lat1);
  const dLon = rad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLon / 2) ** 2;
  return Math.round(6_371_000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}

function parseClock(value: string): number | null {
  const m = CLOCK.exec(value);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

/** "2026-11-16" + "11:00" in IST → UTC instant. */
export function istInstant(dateKey: string, clock: string): Date {
  const d = DATE_KEY.exec(dateKey ?? '');
  const c = CLOCK.exec(clock ?? '');
  if (!d || !c) throw new BadRequestException('Pick the date and time from the pickers');
  return localCalendarToUtc(Number(d[1]), Number(d[2]), Number(d[3]), Number(c[1]), Number(c[2]), 0, 0, 'Asia/Kolkata');
}

function istDateKey(instant: Date): string {
  const p = getCalendarPartsInTimezone(instant, 'Asia/Kolkata');
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
}

function istDayText(instant: Date): string {
  return new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium' }).format(instant);
}

/**
 * Laboura Field's on-the-spot matching and selling (Master Guide, "The field
 * agent app" and "Confirming in the shop", decided 9 Nov):
 * - the masked, recorded call to a liked candidate ("we found a job for you"),
 *   where a no is a hit and a yes makes the phone talk the first interview;
 * - "Handing phone to owner" on the same call, then the owner's decision —
 *   Selected now (salary and joining date confirmed by the owner's OTP → the
 *   fee link straight away), Wants to meet (book an interview), Not selected
 *   (reason by OTP, no hit);
 * - booking an interview with a picked date and time (at the shop, walk-in
 *   window or a phone interview where Laboura rings both), "I will attend";
 * - interview day: "candidate arrived" with GPS, or didn't come (a hit);
 * - the owner's favourite (heart), the owner call outcome and the joining call.
 * Seeker-first suitability comes from MatchingService; results and placements
 * go through InterviewService and PlacementService.
 */
@Injectable()
export class FieldSellingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ids: IdService,
    private readonly audit: AuditService,
    private readonly otp: OtpService,
    private readonly clock: ConsentClock,
    private readonly pricing: PricingService,
    private readonly calls: CallService,
    private readonly jobSeekers: JobSeekerService,
    private readonly messaging: MessagingService,
    private readonly reviewFlags: ReviewFlagService,
    private readonly matching: MatchingService,
    private readonly interviews: InterviewService,
    private readonly fieldVisits: FieldVisitService,
    @Inject(TELEPHONY_PROVIDER) private readonly telephony: TelephonyProvider,
  ) {}

  // ---------------------------------------------------------------- access

  private async staff(actor: SellingActor) {
    if (!SELLING_ROLES.includes(actor.role)) throw new ForbiddenException('This role cannot sell in the field');
    const row = await this.prisma.staff.findUnique({ where: { id: actor.id }, select: { id: true, role: true, teamLeadId: true } });
    if (!row) throw new NotFoundException('Staff not found');
    return row;
  }

  /** Field agents act only on their own account businesses; a Team Lead on the team's. */
  private async assertActsOnBusiness(
    actor: SellingActor,
    business: { accountAgentId: string | null; leadCreatedByStaffId: string | null },
  ) {
    await this.staff(actor);
    if (actor.role === 'field_agent' && business.accountAgentId !== actor.id) {
      throw new ForbiddenException('Field agents act only on their own account businesses');
    }
    if (actor.role === 'team_lead') {
      const ids = [business.accountAgentId, business.leadCreatedByStaffId].filter((id): id is string => Boolean(id));
      const inTeam = ids.length > 0 && await this.prisma.staff.findFirst({
        where: { id: { in: ids }, OR: [{ teamLeadId: actor.id }, { id: actor.id }] }, select: { id: true },
      });
      if (!inTeam) throw new ForbiddenException('This business is outside your team');
    }
  }

  private async vacancyFor(actor: SellingActor, vacancyRef: string) {
    const vacancy = await this.prisma.vacancy.findFirst({
      where: vacancyRef.startsWith('VC-') ? { code: vacancyRef } : { id: vacancyRef },
      include: { business: true, branch: true },
    });
    if (!vacancy) throw new NotFoundException(`Vacancy '${vacancyRef}' not found`);
    await this.assertActsOnBusiness(actor, vacancy.business);
    return vacancy;
  }

  private async interviewFor(actor: SellingActor, interviewId: string) {
    const interview = await this.prisma.interview.findUnique({
      where: { id: interviewId },
      include: { business: true, jobSeeker: true, vacancy: { include: { branch: true } } },
    });
    if (!interview) throw new NotFoundException('Interview not found');
    await this.assertActsOnBusiness(actor, interview.business);
    return interview;
  }

  private assertCandidatesAllowed(vacancy: { status: string; business: Parameters<typeof businessCandidateAccess>[0] }) {
    if (isUnconfirmedVacancyStatus(vacancy.status)) {
      throw new BadRequestException('The contact person must confirm this vacancy by OTP first');
    }
    const access = businessCandidateAccess(vacancy.business);
    if (!access.allowed) {
      throw new BadRequestException(access.reason === 'paused' ? BUSINESS_PAUSED_MESSAGE : 'The business must be verified (or onboarded in person) first');
    }
  }

  /** Seeker-first check (MatchingService.jobsForSeeker): does this vacancy suit him on every count right now? */
  private async suitableJob(jobSeekerId: string, vacancyId: string) {
    const result = await this.matching.jobsForSeeker(jobSeekerId, { page: 1, vacancyId });
    return result.jobs.find((job) => job.vacancyId === vacancyId) ?? null;
  }

  private contactOf(vacancy: {
    branch: { contactPersonPhone: string; contactPersonName: string; contactPersonRole: string } | null;
    business: { phone: string; additionalContactName: string | null; ownerName: string | null; contactRole: string | null };
  }) {
    return vacancy.branch
      ? { phone: vacancy.branch.contactPersonPhone, name: vacancy.branch.contactPersonName, role: vacancy.branch.contactPersonRole }
      : {
        phone: vacancy.business.phone,
        name: vacancy.business.additionalContactName ?? vacancy.business.ownerName,
        role: vacancy.business.contactRole,
      };
  }

  private async resultDueAt(day: Date): Promise<Date> {
    const policy = await this.pricing.current();
    const deadline = CLOCK.exec(policy.interviewResultDeadline);
    if (!deadline) throw new Error('PricingPolicy interviewResultDeadline must be HH:mm');
    const p = getCalendarPartsInTimezone(day, 'Asia/Kolkata');
    return localCalendarToUtc(p.year, p.month, p.day, Number(deadline[1]), Number(deadline[2]), 0, 0, 'Asia/Kolkata');
  }

  // ------------------------------------------------- calling the candidate

  /** FA15e: the masked, recorded call from the agent's own phone to a candidate who suits the vacancy. */
  async callCandidate(actor: SellingActor, body: { vacancyId?: string; jobSeekerId?: string }) {
    if (!body?.vacancyId || !body?.jobSeekerId) throw new BadRequestException('vacancyId and jobSeekerId are required');
    const vacancy = await this.vacancyFor(actor, body.vacancyId);
    this.assertCandidatesAllowed(vacancy);
    const seeker = await this.prisma.jobSeeker.findFirst({
      where: body.jobSeekerId.startsWith('JS-') ? { code: body.jobSeekerId } : { id: body.jobSeekerId },
      select: { id: true },
    });
    if (!seeker) throw new NotFoundException('Job seeker not found');
    if (!(await this.suitableJob(seeker.id, vacancy.id))) {
      throw new BadRequestException('This job seeker no longer suits the vacancy on every count');
    }
    return this.calls.place(actor, {
      subjectType: 'job_seeker', subjectId: seeker.id, purpose: 'offer', relatedType: 'vacancy', relatedId: vacancy.id,
    });
  }

  /**
   * FA15e "His answer", on an answered call (answered comes only from the phone
   * system). Yes → the phone talk becomes the first interview (an in-shop
   * interview, confirmed). No → a hit, because the job suited him on every
   * count; the interview is recorded as declined.
   */
  async recordCandidateAnswer(actor: SellingActor, callRecordId: string, body: { answer?: string; reason?: string }) {
    const answer = body?.answer;
    if (answer !== 'yes' && answer !== 'no') throw new BadRequestException('answer must be yes or no');
    const reason = body.reason?.trim() || null;
    if (answer === 'no' && !reason) throw new BadRequestException('Pick the reason he said no');
    const call = await this.prisma.callRecord.findUnique({ where: { id: callRecordId } });
    if (!call) throw new NotFoundException('Call not found');
    if (call.staffId !== actor.id) throw new ForbiddenException('Only the agent who made the call records his answer');
    if (call.purpose !== 'offer' || call.subjectType !== 'job_seeker' || call.relatedType !== 'vacancy' || !call.relatedId || !call.subjectId) {
      throw new BadRequestException('This is not a call about a vacancy');
    }
    const existing = await this.prisma.interview.findUnique({ where: { callRecordId: call.id } });
    if (existing) return { interviewId: existing.id, status: existing.status };
    if (!call.answered) {
      throw new BadRequestException('The phone system has not reported this call as answered. Pick "No answer" or wait a moment.');
    }
    const vacancy = await this.vacancyFor(actor, call.relatedId);
    this.assertCandidatesAllowed(vacancy);
    const job = await this.suitableJob(call.subjectId, vacancy.id);
    if (!job) throw new BadRequestException('This job seeker no longer suits the vacancy on every count');
    const seeker = await this.prisma.jobSeeker.findUniqueOrThrow({ where: { id: call.subjectId } });

    await this.calls.recordOutcome(actor, call.id, {
      agentOutcome: answer === 'yes' ? 'accepted_offer' : 'rejected_offer',
      reason: reason ?? undefined,
    });

    const now = this.clock.now();
    const status = answer === 'yes' ? 'confirmed' : 'declined';
    const resultDueAt = await this.resultDueAt(now);
    const interview = await this.prisma.$transaction(async (tx) => {
      const slot = await tx.vacancyInterviewSlot.create({
        data: { vacancyId: vacancy.id, startsAt: now, endsAt: new Date(now.getTime() + IN_SHOP_SLOT_MINUTES * 60_000), capacity: 1 },
      });
      const created = await tx.interview.create({
        data: {
          code: await this.ids.generateCode('interview'),
          vacancyId: vacancy.id,
          businessId: vacancy.businessId,
          jobSeekerId: seeker.id,
          vacancyInterviewSlotId: slot.id,
          slotStartsAt: slot.startsAt,
          slotEndsAt: slot.endsAt,
          proposedByStaffId: actor.id,
          proposedAt: now,
          suitabilitySnapshot: {
            channel: 'in_shop_call',
            trade: { vacancy: vacancy.tradeSkill, passed: true },
            salary: { vacancyMinPaise: job.salaryMinPaise, vacancyMaxPaise: job.salaryMaxPaise, passed: true },
            distance: { distanceKm: job.distanceKm, travelDistanceKm: seeker.travelDistanceKm, passed: true },
            shift: { candidate: seeker.shiftPreference, vacancy: vacancy.shift, passed: true },
          } as Prisma.InputJsonValue,
          status,
          offerSentAt: now,
          replyDueAt: now,
          candidateRespondedAt: now,
          callRecordId: call.id,
          resultDueAt,
          interviewType: 'in_shop_call',
          // The agent is in the shop: no separate attendance visit.
          agentAttendanceRequired: false,
        },
      });
      await recordStatusChange(tx, {
        subjectType: 'interview', subjectId: created.id, fromStatus: null, toStatus: status,
        changedByStaffId: actor.id, changedAt: now,
        reason: answer === 'yes' ? 'Candidate said yes on the in-shop call' : 'Candidate said no on the in-shop call',
      });
      await tx.candidateIntroduction.create({
        data: {
          businessId: vacancy.businessId, vacancyId: vacancy.id, jobSeekerId: seeker.id, shownByStaffId: actor.id,
          shownAt: now, rank: 1, score: 0, matchReasons: [] as unknown as Prisma.InputJsonValue, channel: 'in_person',
        },
      });
      return created;
    });
    if (answer === 'no') {
      await this.jobSeekers.recordHit(seeker.id, 'offer_declined', reason ?? undefined, 'system', undefined, {
        interviewId: interview.id, callRecordId: call.id,
      });
    }
    await this.audit.log({
      actorId: actor.id, action: answer === 'yes' ? 'interview.in_shop_confirmed' : 'interview.in_shop_declined',
      entityType: 'Interview', entityCode: interview.code, city: vacancy.city,
      after: { status, interviewType: 'in_shop_call', vacancyId: vacancy.id, jobSeekerId: seeker.id, callRecordId: call.id },
      changedFields: ['status', 'interviewType'], reason: reason ?? 'Candidate answered on the in-shop call',
    });
    return { interviewId: interview.id, status, hit: answer === 'no' };
  }

  /** FA15e → FA15f: the agent hands his phone to the owner — the same recorded call. */
  async handOver(actor: SellingActor, interviewId: string) {
    const interview = await this.interviewFor(actor, interviewId);
    if (interview.interviewType !== 'in_shop_call' || interview.status !== 'confirmed') {
      throw new BadRequestException('Only an in-shop call the candidate said yes to can be handed to the owner');
    }
    if (interview.handedToOwnerAt) return { interviewId, handedToOwnerAt: interview.handedToOwnerAt };
    const at = this.clock.now();
    await this.prisma.interview.update({ where: { id: interviewId }, data: { handedToOwnerAt: at } });
    return { interviewId, handedToOwnerAt: at };
  }

  // ------------------------------------------------- the owner's decision

  private validateDecision(body: {
    decision?: string; salaryPaise?: number; joiningDate?: string; reason?: string;
  }, now: Date) {
    if (body?.decision !== 'selected' && body?.decision !== 'not_selected') {
      throw new BadRequestException('decision must be selected or not_selected');
    }
    if (body.decision === 'selected') {
      if (!Number.isSafeInteger(body.salaryPaise) || (body.salaryPaise ?? 0) <= 0) {
        throw new BadRequestException('The monthly salary must be a positive whole number of paise');
      }
      if (!DATE_KEY.test(body.joiningDate ?? '')) throw new BadRequestException('Pick the joining date from the calendar');
      if ((body.joiningDate as string) < istDateKey(now)) throw new BadRequestException('The joining date cannot be in the past');
    } else if (!(NOT_SELECTED_REASONS as readonly string[]).includes(body.reason ?? '')) {
      throw new BadRequestException('Pick the reason from the list');
    }
    return body.decision;
  }

  private assertAwaitingDecision(interview: { interviewType: string | null; status: string; resultRecordedAt: Date | null }) {
    if (interview.status !== 'confirmed' || interview.resultRecordedAt) {
      throw new BadRequestException('This interview is no longer waiting for the owner\'s decision');
    }
  }

  /**
   * FA15f/FA15s: sends the owner's OTP to the contact person's phone with what
   * he is confirming (selected: salary and joining date; not selected: the
   * reason). Needs signal — the owner reads the code out in the shop.
   */
  async sendDecisionOtp(actor: SellingActor, interviewId: string, body: {
    decision?: string; salaryPaise?: number; joiningDate?: string; reason?: string; otpRequestId?: string;
  }) {
    const interview = await this.interviewFor(actor, interviewId);
    this.assertAwaitingDecision(interview);
    const decision = this.validateDecision(body, this.clock.now());
    const contact = this.contactOf({ branch: interview.vacancy.branch, business: interview.business });
    const result = await this.otp.sendOtp(contact.phone, 'interview_result', actor.id, actor.role, body.otpRequestId) as OtpSendResult;
    if (!body.otpRequestId) {
      await this.messaging.send({
        channel: 'sms',
        template: 'interview_result_confirm_details',
        subjectType: 'business',
        subjectId: interview.businessId,
        relatedType: 'interview',
        relatedId: interview.id,
        recipientPhone: contact.phone,
        variables: decision === 'selected'
          ? {
            candidateFirstName: firstName(interview.jobSeeker.name),
            decision: 'selected',
            salary: formatINR(body.salaryPaise as number),
            joiningDate: istDayText(istInstant(body.joiningDate as string, '00:00')),
          }
          : { candidateFirstName: firstName(interview.jobSeeker.name), decision: 'not_selected', reason: body.reason as string },
      });
    }
    return {
      otpRequestId: result.requestId,
      sentToLast4: phoneLast4(contact.phone),
      contactName: contact.name,
      contactRole: contact.role,
      resendAvailableAt: result.resendAvailableAt,
      resendsLeft: result.resendsLeft,
      ...testModeFields(result),
    };
  }

  /**
   * FA15f/FA15s: the owner's code is checked against his phone, then the
   * result is recorded exactly as the owner's result link does. Selected →
   * the placement with the fee + GST link straight away; Not selected → no
   * hit for the candidate.
   */
  async recordDecision(actor: SellingActor, interviewId: string, body: {
    decision?: string; salaryPaise?: number; joiningDate?: string; reason?: string; otpRequestId?: string; code?: string;
  }) {
    const interview = await this.interviewFor(actor, interviewId);
    this.assertAwaitingDecision(interview);
    const decision = this.validateDecision(body, this.clock.now());
    if (!body.otpRequestId || !body.code) throw new BadRequestException('Type the code the owner reads out');
    const contact = this.contactOf({ branch: interview.vacancy.branch, business: interview.business });
    const verified = await this.otp.verifyOtp(body.otpRequestId, body.code, actor.id);
    if (!verified || !(await this.otp.consumeVerified(body.otpRequestId, normaliseIndianMobile(contact.phone)))) {
      throw new BadRequestException('That code is not right for the owner\'s phone. Check it, or resend.');
    }
    const result = await this.interviews.applyOwnerResult(interview.id, {
      result: decision,
      resultReason: decision === 'not_selected' ? body.reason : undefined,
      selectedSalaryPaise: decision === 'selected' ? body.salaryPaise : undefined,
      selectedJoiningDate: decision === 'selected' ? `${body.joiningDate}T00:00:00.000Z` : undefined,
    }, {
      otpRequestId: body.otpRequestId,
      recordedByStaffId: actor.id,
      reason: 'Owner confirmed in the shop by OTP on his own phone',
    });
    const placement = result.placement as { id: string; code: string; placementFee: number; gstAmount: number; status: string } | null;
    return {
      interviewId: interview.id,
      decision,
      placement: placement
        ? { id: placement.id, code: placement.code, status: placement.status, feePaise: placement.placementFee, gstPaise: placement.gstAmount }
        : null,
    };
  }

  /** FA15f "Wants to meet him in person first": the in-shop talk ends and an interview is booked. */
  async wantsToMeet(actor: SellingActor, interviewId: string, body: BookBody) {
    const interview = await this.interviewFor(actor, interviewId);
    this.assertAwaitingDecision(interview);
    if (interview.interviewType !== 'in_shop_call') throw new BadRequestException('Only an in-shop call can turn into a meeting');
    this.validateBooking(body, await this.pricing.current(), this.clock.now());
    const now = this.clock.now();
    const cancelled = await this.prisma.interview.updateMany({
      where: { id: interview.id, status: 'confirmed', resultRecordedAt: null },
      data: { status: 'cancelled', cancelReason: 'owner_wants_to_meet' },
    });
    if (cancelled.count !== 1) throw new BadRequestException('This interview is no longer waiting for the owner\'s decision');
    await recordStatusChange(this.prisma, {
      subjectType: 'interview', subjectId: interview.id, fromStatus: 'confirmed', toStatus: 'cancelled',
      changedByStaffId: actor.id, changedAt: now, reason: 'owner_wants_to_meet',
    });
    try {
      return await this.book(actor, { ...body, vacancyId: interview.vacancyId, jobSeekerId: interview.jobSeekerId });
    } catch (error) {
      // Booking failed: the in-shop interview is still waiting for the owner.
      await this.prisma.interview.update({ where: { id: interview.id }, data: { status: 'confirmed', cancelReason: null } });
      await recordStatusChange(this.prisma, {
        subjectType: 'interview', subjectId: interview.id, fromStatus: 'cancelled', toStatus: 'confirmed',
        changedByStaffId: actor.id, changedAt: this.clock.now(), reason: 'booking_failed',
      });
      throw error;
    }
  }

  // ---------------------------------------------------------------- booking

  private validateBooking(body: BookBody, policy: { walkInStart: string; walkInEnd: string; callingHoursStart: string; callingHoursEnd: string }, now: Date) {
    if (!(BOOKED_INTERVIEW_TYPES as readonly string[]).includes(body?.type ?? '')) {
      throw new BadRequestException('type must be at_shop, walk_in or phone');
    }
    const type = body.type as BookedInterviewType;
    if (type === 'phone' && !this.telephony.supportsThreeWayCalls?.()) {
      throw new BadRequestException('Phone interviews need 3-way calls from the calling company, which are not switched on yet');
    }
    let startsAt: Date;
    let endsAt: Date;
    if (type === 'walk_in') {
      startsAt = istInstant(body.date ?? '', policy.walkInStart);
      endsAt = istInstant(body.date ?? '', policy.walkInEnd);
    } else {
      startsAt = istInstant(body.date ?? '', body.time ?? '');
      endsAt = new Date(startsAt.getTime() + (type === 'phone' ? PHONE_SLOT_MINUTES : BOOKED_SLOT_MINUTES) * 60_000);
    }
    if (startsAt.getTime() <= now.getTime()) throw new BadRequestException('The interview must be in the future');
    if (type === 'phone') {
      const minute = parseClock(body.time ?? '');
      const start = parseClock(policy.callingHoursStart);
      const end = parseClock(policy.callingHoursEnd);
      if (minute === null || start === null || end === null || minute < start || minute + PHONE_SLOT_MINUTES > end) {
        throw new BadRequestException(`Phone interviews are between ${policy.callingHoursStart} and ${policy.callingHoursEnd}`);
      }
    }
    return { type, startsAt, endsAt };
  }

  /**
   * FA15g: an interview at a picked date and time (no pre-made slot needed).
   * The offer goes to the candidate by SMS and WhatsApp through the usual
   * booking (he has 48 hours to reply); "I will attend" is recorded, and is
   * forced on for a first interview with the business.
   */
  async book(actor: SellingActor, body: BookBody & { vacancyId?: string; jobSeekerId?: string }) {
    if (!body?.vacancyId || !body?.jobSeekerId) throw new BadRequestException('vacancyId and jobSeekerId are required');
    const vacancy = await this.vacancyFor(actor, body.vacancyId);
    this.assertCandidatesAllowed(vacancy);
    const policy = await this.pricing.current();
    const { type, startsAt, endsAt } = this.validateBooking(body, policy, this.clock.now());
    const attendanceRequired = await this.interviews.requiresAttendance(vacancy.business);
    const willAttend = attendanceRequired || body.agentWillAttend === true;
    const slot = await this.prisma.vacancyInterviewSlot.create({
      data: { vacancyId: vacancy.id, startsAt, endsAt, capacity: 1 },
    });
    let booked: { id: string; code: string };
    try {
      booked = await this.interviews.book({ vacancyId: vacancy.id, jobSeekerId: body.jobSeekerId, slotId: slot.id }, actor.id);
    } catch (error) {
      await this.prisma.vacancyInterviewSlot.deleteMany({ where: { id: slot.id, interviews: { none: {} } } });
      throw error;
    }
    await this.prisma.interview.update({
      where: { id: booked.id },
      data: { interviewType: type, agentWillAttend: willAttend, agentAttendanceRequired: willAttend },
    });
    await this.audit.log({
      actorId: actor.id, action: 'interview.booked_in_field', entityType: 'Interview', entityCode: booked.code,
      city: vacancy.city, after: { interviewType: type, agentWillAttend: willAttend, slotStartsAt: startsAt.toISOString() },
      changedFields: ['interviewType', 'agentWillAttend'],
    });
    return { interviewId: booked.id, type, slotStartsAt: startsAt, slotEndsAt: endsAt, agentWillAttend: willAttend };
  }

  // ------------------------------------------------------- interview day

  /**
   * FA16: the attending agent marks whether the candidate came, with GPS.
   * Arrived → recorded with the distance from the shop's pin. Didn't come
   * (only once the slot is over) → a no-show, which is a hit for him.
   */
  async markArrival(actor: SellingActor, interviewId: string, body: {
    arrived?: boolean; latitude?: number; longitude?: number; accuracyM?: number;
  }) {
    const interview = await this.interviewFor(actor, interviewId);
    if (typeof body?.arrived !== 'boolean') throw new BadRequestException('arrived must be true or false');
    if (typeof body.latitude !== 'number' || typeof body.longitude !== 'number' ||
      !Number.isFinite(body.latitude) || !Number.isFinite(body.longitude)) {
      throw new BadRequestException('Your GPS location is needed to mark this');
    }
    if (interview.status !== 'confirmed') throw new BadRequestException('This interview is not waiting for the candidate');
    if (interview.interviewType === 'phone' || interview.interviewType === 'in_shop_call') {
      throw new BadRequestException('Arrival is marked only for interviews at the shop');
    }
    const now = this.clock.now();
    const distance = interview.business.latitude !== null && interview.business.longitude !== null
      ? metresBetween(body.latitude, body.longitude, interview.business.latitude, interview.business.longitude)
      : null;
    if (body.arrived) {
      if (now.getTime() < interview.slotStartsAt.getTime() - ARRIVAL_EARLY_MINUTES * 60_000 ||
        istDateKey(now) !== istDateKey(interview.slotStartsAt)) {
        throw new BadRequestException('Arrival can be marked only on the interview day, from an hour before');
      }
      // The field visits module owns "candidate arrived" (GPS at the shop, distance from the pin).
      return this.fieldVisits.candidateArrived(actor.id, interviewId, {
        latitude: body.latitude, longitude: body.longitude, accuracy: body.accuracyM,
      });
    }
    if (interview.candidateArrivedAt) throw new BadRequestException('He was already marked as arrived');
    if (now.getTime() < interview.slotEndsAt.getTime()) {
      throw new BadRequestException('"Didn\'t come" can be marked once the interview time is over');
    }
    const changed = await this.prisma.interview.updateMany({
      where: { id: interviewId, status: 'confirmed', resultRecordedAt: null },
      data: {
        status: 'no_show', result: 'candidate_no_show', resultRecordedAt: now, resultRecordedByStaffId: actor.id,
      },
    });
    if (changed.count !== 1) throw new BadRequestException('This interview already has a result');
    await recordStatusChange(this.prisma, {
      subjectType: 'interview', subjectId: interviewId, fromStatus: 'confirmed', toStatus: 'no_show',
      changedByStaffId: actor.id, changedAt: now, reason: 'Attending field agent: candidate did not come',
    });
    await this.jobSeekers.recordHit(interview.jobSeekerId, 'interview_no_show', undefined, 'system', undefined, { interviewId });
    await this.audit.log({
      actorId: actor.id, action: 'interview.no_show_marked', entityType: 'Interview', entityCode: interview.code,
      city: interview.business.city, after: { status: 'no_show', distanceFromShopMeters: distance }, changedFields: ['status', 'result'],
    });
    return { interviewId, noShow: true, distanceM: distance };
  }

  /**
   * Phone interviews (FA15g): at the set time Laboura rings the owner and the
   * candidate and joins them, recorded. Run by the interview sweep every minute.
   */
  async processDuePhoneInterviews(now = this.clock.now()) {
    if (!this.telephony.supportsThreeWayCalls?.() || !this.telephony.initiateThreeWayCall) return { dialled: 0 };
    const due = await this.prisma.interview.findMany({
      where: {
        status: 'confirmed', interviewType: 'phone', phoneInterviewDialledAt: null,
        slotStartsAt: { lte: now }, slotEndsAt: { gt: now },
      },
      include: { business: true, jobSeeker: true, vacancy: { include: { branch: true } } },
    });
    let dialled = 0;
    for (const interview of due) {
      const claimed = await this.prisma.interview.updateMany({
        where: { id: interview.id, phoneInterviewDialledAt: null },
        data: { phoneInterviewDialledAt: now },
      });
      if (claimed.count !== 1) continue;
      const owner = this.contactOf({ branch: interview.vacancy.branch, business: interview.business });
      const code = await this.ids.generateCode('call');
      const vendor = this.telephony.getCapacity().vendor;
      const record = await this.prisma.callRecord.create({
        data: {
          code, provider: vendor, providerCallId: `pending-${code}`, direction: 'outbound',
          staffId: interview.proposedByStaffId, subjectType: 'job_seeker', subjectId: interview.jobSeekerId,
          purpose: 'phone_interview', relatedType: 'interview', relatedId: interview.id,
          providerStatus: 'initiated', answered: false, announcementPlayed: true,
        },
      });
      const result = await this.telephony.initiateThreeWayCall({
        firstPhone: normaliseIndianMobile(owner.phone),
        secondPhone: normaliseIndianMobile(interview.jobSeeker.phone),
        recordCall: true,
        announcement: CALL_ANNOUNCEMENT,
        metadata: { callRecordId: record.id },
      });
      await this.prisma.callRecord.update({
        where: { id: record.id },
        data: {
          providerCallId: result.callId || record.providerCallId,
          ...(result.status === 'failed' ? { providerStatus: 'failed' } : {}),
        },
      });
      await this.prisma.interview.update({ where: { id: interview.id }, data: { phoneInterviewCallRecordId: record.id } });
      dialled += 1;
    }
    return { dialled };
  }

  // ---------------------------------------------------- owner's favourite

  /** FA15b/FA15d: the owner likes this candidate (the heart). */
  async setFavourite(actor: SellingActor, vacancyRef: string, jobSeekerId: string, liked: boolean) {
    const vacancy = await this.vacancyFor(actor, vacancyRef);
    const seeker = await this.prisma.jobSeeker.findUnique({ where: { id: jobSeekerId }, select: { id: true } });
    if (!seeker) throw new NotFoundException('Job seeker not found');
    if (liked) {
      await this.prisma.ownerFavourite.upsert({
        where: { vacancyId_jobSeekerId: { vacancyId: vacancy.id, jobSeekerId } },
        create: { vacancyId: vacancy.id, jobSeekerId, markedByStaffId: actor.id },
        update: {},
      });
    } else {
      await this.prisma.ownerFavourite.deleteMany({ where: { vacancyId: vacancy.id, jobSeekerId } });
    }
    return { vacancyId: vacancy.id, jobSeekerId, liked };
  }

  // ---------------------------------------------------------- owner call

  /**
   * FA18: what the owner said on the agent's masked call. A complaint goes to
   * the agent's Team Lead with the call (and so its recording).
   */
  async recordOwnerCallOutcome(actor: SellingActor, callRecordId: string, body: { outcome?: string; callbackAt?: string; note?: string }) {
    if (!(OWNER_CALL_OUTCOMES as readonly string[]).includes(body?.outcome ?? '')) {
      throw new BadRequestException('outcome must be needs_staff, happy, callback or complaint');
    }
    const staff = await this.staff(actor);
    const call = await this.prisma.callRecord.findUnique({ where: { id: callRecordId } });
    if (!call) throw new NotFoundException('Call not found');
    if (call.subjectType !== 'business' || !call.subjectId) throw new BadRequestException('This call is not to a business');
    const note = body.note?.trim() || null;
    const mapped = {
      needs_staff: { agentOutcome: 'interested', reason: 'needs_more_staff' },
      happy: { agentOutcome: 'other', reason: 'happy_nothing_needed' },
      callback: { agentOutcome: 'callback_requested', reason: note ?? undefined },
      complaint: { agentOutcome: 'other', reason: note ? `complaint: ${note}` : 'complaint' },
    }[body.outcome as (typeof OWNER_CALL_OUTCOMES)[number]];
    const saved = await this.calls.recordOutcome(actor, call.id, { ...mapped, callbackAt: body.callbackAt });
    if (body.outcome === 'complaint') {
      await this.reviewFlags.raise({
        kind: 'owner_complaint', subjectType: 'business', subjectId: call.subjectId,
        raisedForStaffId: staff.teamLeadId ?? null,
        details: { callRecordId: call.id, raisedByStaffId: actor.id, note },
      });
    }
    return { ...saved, outcome: body.outcome };
  }

  // ------------------------------------------------------------ joining

  /**
   * FA11 "Owner says", on an answered joining call to the owner: he didn't
   * come (the worker is called and the Team Lead is told; if he isn't joining
   * the business claims a free replacement), or joining moved to another date
   * (both are told the new date). "He joined" is POST /placements/:id/joined.
   */
  async ownerJoiningAnswer(actor: SellingActor, placementRef: string, body: { answer?: string; newJoiningDate?: string }) {
    if (!(OWNER_JOINING_ANSWERS as readonly string[]).includes(body?.answer ?? '')) {
      throw new BadRequestException('answer must be didnt_come or moved');
    }
    const staff = await this.staff(actor);
    const placement = await this.prisma.placement.findFirst({
      where: { OR: [{ id: placementRef }, { code: placementRef }] },
      include: { business: true, jobSeeker: true },
    });
    if (!placement) throw new NotFoundException('Placement not found');
    await this.assertActsOnBusiness(actor, placement.business);
    if (placement.status !== 'confirmed' || !placement.joiningDate) {
      throw new BadRequestException('Joining is confirmed only after the fee is paid');
    }
    const ownerCall = await this.prisma.callRecord.findFirst({
      where: {
        subjectType: 'business', subjectId: placement.businessId, purpose: 'joining_confirmation', answered: true,
        relatedId: placement.id,
      },
      orderBy: { createdAt: 'desc' },
    });
    if (!ownerCall) throw new BadRequestException('Call the owner first: his answer is recorded on an answered joining call');
    const now = this.clock.now();
    if (body.answer === 'didnt_come') {
      if (placement.joiningNoShowReportedAt) return { placementId: placement.id, answer: 'didnt_come' };
      await this.prisma.placement.update({ where: { id: placement.id }, data: { joiningNoShowReportedAt: now } });
      await this.prisma.callTask.upsert({
        where: { sourceCallRecordId_kind: { sourceCallRecordId: ownerCall.id, kind: 'callback' } },
        create: {
          staffId: actor.id, subjectType: 'job_seeker', subjectId: placement.jobSeekerId, kind: 'callback',
          dueAt: now, sourceCallRecordId: ownerCall.id,
        },
        update: {},
      });
      await this.reviewFlags.raise({
        kind: 'joining_no_show', subjectType: 'placement', subjectId: placement.id,
        raisedForStaffId: staff.teamLeadId ?? null, details: { callRecordId: ownerCall.id },
      });
      await this.audit.log({
        actorId: actor.id, action: 'placement.joining_no_show_reported', entityType: 'Placement', entityCode: placement.code,
        city: placement.city, after: { joiningNoShowReportedAt: now.toISOString() }, changedFields: ['joiningNoShowReportedAt'],
      });
      return { placementId: placement.id, answer: 'didnt_come' };
    }
    const newDate = body.newJoiningDate ?? '';
    if (!DATE_KEY.test(newDate)) throw new BadRequestException('Pick the new joining date from the calendar');
    if (newDate <= istDateKey(now)) throw new BadRequestException('The new joining date must be after today');
    const before = placement.joiningDate.toISOString();
    const joiningDate = new Date(`${newDate}T00:00:00.000Z`);
    await this.prisma.placement.update({
      where: { id: placement.id },
      data: { joiningDate, joiningMovedCount: { increment: 1 } },
    });
    const dayText = istDayText(istInstant(newDate, '12:00'));
    for (const channel of ['sms', 'whatsapp'] as const) {
      await this.messaging.send({
        channel, template: 'joining_confirmed', subjectType: 'job_seeker', subjectId: placement.jobSeekerId,
        relatedType: 'placement', relatedId: placement.id,
        variables: { candidateName: placement.jobSeeker.name, businessName: placement.business.name, joiningDate: dayText },
      });
    }
    await this.messaging.send({
      channel: 'sms', template: 'joining_date_moved', subjectType: 'business', subjectId: placement.businessId,
      relatedType: 'placement', relatedId: placement.id,
      variables: { candidateFirstName: firstName(placement.jobSeeker.name), joiningDate: dayText },
    });
    await this.audit.log({
      actorId: actor.id, action: 'placement.joining_moved', entityType: 'Placement', entityCode: placement.code,
      city: placement.city, before: { joiningDate: before }, after: { joiningDate: joiningDate.toISOString() },
      changedFields: ['joiningDate'], reason: 'Owner moved the joining date on the joining call',
    });
    return { placementId: placement.id, answer: 'moved', joiningDate: newDate };
  }
}

export interface BookBody {
  date?: string;
  time?: string;
  type?: string;
  agentWillAttend?: boolean;
}
