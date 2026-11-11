import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
  Inject,
  Optional,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { isUnconfirmedVacancyStatus } from './vacancy-confirmation.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { IdService } from '../../common/id/id.service';
import { AuditService } from '../../common/audit/audit.service';
import { PricingService } from '../pricing/pricing.service';
import { ConsentClock } from '../consent/consent-clock';
import { ConsentLinkService } from '../consent/consent-link.service';
import { MessagingService } from '../message/messaging.service';
import { recordStatusChange } from '../../common/status-history/status-history.helper';
import { localCalendarToUtc, getCalendarPartsInTimezone } from '../../common/time/period-boundary';
import { formatINR } from '../../common/money/money';
import { MatchingService } from './matching.service';
import { publicPageLink } from '../../common/public-pages';
import { JobSeekerService } from '../job-seeker/job-seeker.service';
import { CallService } from '../call/call.service';
import { CANDIDATE_PHOTO_LINK_TTL_SECONDS, CANDIDATE_PHOTO_STORAGE, CandidatePhotoStorage } from '../job-seeker/photo-storage';
import { BusinessVerificationService } from '../business/business-verification.service';
import { ReviewFlagService } from '../review-flag/review-flag.service';
import { PlacementService } from '../placement/placement.service';
import { BUSINESS_PAUSED_MESSAGE, businessCandidateAccess } from '../business/business-candidate-access';
import { sameIndianMobile } from '../../common/phone/indian-mobile';

/** The fixed reasons an owner picks for "not selected" (P05). */
export const NOT_SELECTED_REASONS = ['skills', 'experience', 'communication', 'salary_expectation', 'not_suitable', 'other'] as const;

function firstNameOf(name: string): string {
  return name.trim().split(/\s+/)[0] ?? name.trim();
}

/**
 * The owner result as the public page returns it: the placement and its
 * payment, without the nested candidate, business and vacancy records — the
 * candidate's number and details reach the business only after it pays.
 */
export function publicOwnerResult<T extends { placement: unknown }>(result: T) {
  const placement = result.placement as (Record<string, unknown> & { jobSeeker?: { name?: string } }) | null;
  if (!placement) return { ...result, placement: null };
  const { jobSeeker, business: _business, vacancy: _vacancy, payments: _payments, ...rest } = placement;
  void _business; void _vacancy; void _payments;
  return {
    ...result,
    placement: { ...rest, candidateFirstName: jobSeeker?.name ? firstNameOf(jobSeeker.name) : null },
  };
}

interface BookInterviewDto {
  vacancyId: string;
  jobSeekerId: string;
  slotId: string;
}

interface MatchForBooking {
  jobSeekerId: string;
  score: number;
  matchReasons: string[];
  card: {
    trade: string;
    distanceKm: number;
    expectedSalary: { minPaise: number; maxPaise: number };
    matchReasons: string[];
  };
}

@Injectable()
export class InterviewService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly idService: IdService,
    private readonly auditService: AuditService,
    private readonly pricingService: PricingService,
    private readonly clock: ConsentClock,
    private readonly consentLinks: ConsentLinkService,
    private readonly messagingService: MessagingService,
    private readonly matchingService: MatchingService,
    private readonly jobSeekerService: JobSeekerService,
    private readonly calls: CallService,
    private readonly businessVerification: BusinessVerificationService,
    private readonly reviewFlags: ReviewFlagService,
    private readonly placements: PlacementService,
    @Optional() @Inject(CANDIDATE_PHOTO_STORAGE) private readonly photoStorage?: CandidatePhotoStorage,
  ) {}

  async book(dto: BookInterviewDto, staffId: string) {
    if (!dto?.vacancyId || !dto?.jobSeekerId || !dto?.slotId) {
      throw new BadRequestException('vacancyId, jobSeekerId and slotId are required');
    }

    const actor = await this.prisma.staff.findUnique({ where: { id: staffId } });
    if (!actor) throw new NotFoundException('Staff not found');
    if (!['call_agent', 'field_agent', 'team_lead', 'manager', 'ceo'].includes(actor.role)) {
      throw new ForbiddenException('This staff role cannot book interviews');
    }

    const vacancy = await this.prisma.vacancy.findFirst({
      where: dto.vacancyId.startsWith('VC-') ? { code: dto.vacancyId } : { id: dto.vacancyId },
      include: { business: true },
    });
    if (!vacancy) throw new NotFoundException(`Vacancy '${dto.vacancyId}' not found`);
    if (isUnconfirmedVacancyStatus(vacancy.status)) {
      throw new BadRequestException('An interview can only be booked once the contact person confirms the vacancy');
    }
    const businessAccess = businessCandidateAccess(vacancy.business);
    if (!businessAccess.allowed) {
      throw new BadRequestException(businessAccess.reason === 'paused'
        ? BUSINESS_PAUSED_MESSAGE
        : 'The business must be verified before an interview can be booked');
    }
    if (actor.role === 'field_agent' && vacancy.business.accountAgentId !== actor.id) {
      throw new ForbiddenException('Field agents may only book interviews for their account businesses');
    }
    if (actor.role === 'team_lead') {
      const businessStaffIds = [vacancy.business.accountAgentId, vacancy.business.leadCreatedByStaffId]
        .filter((id): id is string => Boolean(id));
      const belongsToTeam = businessStaffIds.length > 0 && await this.prisma.staff.findFirst({
        where: { id: { in: businessStaffIds }, teamLeadId: actor.id },
        select: { id: true },
      });
      if (!belongsToTeam) throw new ForbiddenException('This business is outside your team');
    }

    const seeker = await this.prisma.jobSeeker.findFirst({
      where: dto.jobSeekerId.startsWith('JS-')
        ? { code: dto.jobSeekerId }
        : { id: dto.jobSeekerId },
    });
    if (!seeker) throw new NotFoundException(`Job seeker '${dto.jobSeekerId}' not found`);

    const slot = await this.prisma.vacancyInterviewSlot.findUnique({ where: { id: dto.slotId } });
    if (!slot || slot.vacancyId !== vacancy.id) {
      throw new BadRequestException('The interview slot must belong to the selected vacancy');
    }
    const policy = await this.pricingService.current();
    const now = this.clock.now();
    if (slot.startsAt.getTime() <= now.getTime()) {
      throw new BadRequestException('The interview slot must be in the future');
    }
    if (slot.endsAt.getTime() <= slot.startsAt.getTime()) {
      throw new BadRequestException('The interview slot must end after it starts');
    }

    const match = await this.findMatchingCandidate(vacancy.id, seeker.id);
    if (!match) {
      throw new BadRequestException('The job seeker does not pass current matching rules for this vacancy');
    }

    const replyDueAt = new Date(now.getTime() + policy.offerReplyHours * 60 * 60 * 1000);
    const slotDay = getCalendarPartsInTimezone(slot.startsAt, 'Asia/Kolkata');
    const deadline = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(policy.interviewResultDeadline);
    if (!deadline) throw new Error('PricingPolicy interviewResultDeadline must be HH:mm');
    const resultDueAt = localCalendarToUtc(
      slotDay.year,
      slotDay.month,
      slotDay.day,
      Number(deadline[1]),
      Number(deadline[2]),
      0,
      0,
      'Asia/Kolkata',
    );
    const agentAttendanceRequired = await this.requiresAttendance(vacancy.business);

    const created = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw(Prisma.sql`
        SELECT "id" FROM "VacancyInterviewSlot" WHERE "id" = ${slot.id} FOR UPDATE
      `);
      const currentSlot = await tx.vacancyInterviewSlot.findUnique({ where: { id: slot.id } });
      if (!currentSlot || currentSlot.vacancyId !== vacancy.id) {
        throw new BadRequestException('The interview slot is no longer available for this vacancy');
      }
      if (currentSlot.startsAt.getTime() <= now.getTime()) {
        throw new BadRequestException('The interview slot must be in the future');
      }
      const existingOffer = await tx.interview.findFirst({
        where: {
          vacancyInterviewSlotId: slot.id,
          jobSeekerId: seeker.id,
          status: { in: ['offered', 'confirmed'] },
        },
      });
      if (existingOffer) return { interview: existingOffer, created: false };

      const occupied = await tx.interview.count({
        where: { vacancyInterviewSlotId: slot.id, status: { in: ['offered', 'confirmed'] } },
      });
      if (currentSlot.capacity !== null && occupied >= currentSlot.capacity) {
        throw new BadRequestException('The interview slot has no remaining capacity');
      }

      const code = await this.idService.generateCode('interview');
      const interview = await tx.interview.create({
        data: {
          code,
          vacancyId: vacancy.id,
          businessId: vacancy.businessId,
          jobSeekerId: seeker.id,
          vacancyInterviewSlotId: currentSlot.id,
          slotStartsAt: currentSlot.startsAt,
          slotEndsAt: currentSlot.endsAt,
          proposedByStaffId: actor.id,
          proposedAt: now,
          suitabilitySnapshot: {
            trade: { vacancy: vacancy.tradeSkill, matched: match.card.trade },
            salary: {
              vacancyMinPaise: vacancy.salaryMinPaise,
              vacancyMaxPaise: vacancy.salaryMaxPaise ?? vacancy.salaryMinPaise,
              vacancyPeriod: vacancy.salaryPeriod,
              candidateMinPaise: match.card.expectedSalary.minPaise,
              candidateMaxPaise: match.card.expectedSalary.maxPaise,
              passed: true,
            },
            distance: {
              distanceKm: match.card.distanceKm,
              travelDistanceKm: seeker.travelDistanceKm,
              passed: true,
            },
            shift: { candidate: seeker.shiftPreference, vacancy: vacancy.shift, passed: true },
            slot: {
              id: currentSlot.id,
              startsAt: currentSlot.startsAt.toISOString(),
              endsAt: currentSlot.endsAt.toISOString(),
              passed: true,
            },
          },
          status: 'offered',
          offerSentAt: now,
          replyDueAt,
          resultDueAt,
          agentAttendanceRequired,
        },
      });
      await recordStatusChange(tx, {
        subjectType: 'interview',
        subjectId: interview.id,
        fromStatus: null,
        toStatus: 'offered',
        changedByStaffId: actor.id,
        changedAt: now,
      });
      if (vacancy.replacementForPlacementId) {
        await tx.replacementCandidate.create({
          data: {
            placementId: vacancy.replacementForPlacementId,
            jobSeekerId: seeker.id,
            interviewId: interview.id,
            status: 'offered',
            offeredAt: now,
          },
        });
      }
      return { interview, created: true };
    });

    if (!created.created) {
      return created.interview;
    }

    const replyToken = await this.consentLinks.createInterviewActionToken(
      created.interview.id,
      'candidate_reply',
      seeker.phone,
      replyDueAt,
    );
    const link = publicPageLink('offerReply', replyToken);
    const interviewDay = new Intl.DateTimeFormat('en-IN', {
      timeZone: 'Asia/Kolkata',
      dateStyle: 'medium',
    }).format(slot.startsAt);
    const interviewTime = new Intl.DateTimeFormat('en-IN', {
      timeZone: 'Asia/Kolkata',
      timeStyle: 'short',
    }).format(slot.startsAt);
    const salaryMin = vacancy.salaryMinPaise;
    if (salaryMin === null) throw new BadRequestException('The vacancy must have a salary range before an offer is sent');
    const salaryMax = vacancy.salaryMaxPaise ?? salaryMin;
    const variables = {
      jobType: vacancy.roleTitle?.trim() || vacancy.tradeSkill,
      area: vacancy.locality || vacancy.business.locality || '',
      salaryRange: `${formatINR(salaryMin)}–${formatINR(salaryMax)}`,
      shift: vacancy.shift ?? '',
      interviewDay,
      interviewTime,
      link,
    };

    const messages = await Promise.all((['sms', 'whatsapp'] as const).map((channel) =>
      this.messagingService.send({
        channel,
        template: 'interview_offer',
        subjectType: 'job_seeker',
        subjectId: seeker.id,
        relatedType: 'interview',
        relatedId: created.interview.id,
        variables,
      }),
    ));
    if (messages.some((message) => message.status === 'failed')) {
      await this.cancelFailedOffer(created.interview.id, actor.id, now);
      throw new ServiceUnavailableException('The interview offer could not be delivered by SMS and WhatsApp');
    }

    const messageLogIds = messages.map((message) => message.id);
    await this.prisma.$transaction(async (tx) => {
      await tx.interview.update({
        where: { id: created.interview.id },
        data: { offerMessageLogIds: messageLogIds },
      });
      await tx.candidateIntroduction.create({
        data: {
          businessId: vacancy.businessId,
          vacancyId: vacancy.id,
          jobSeekerId: seeker.id,
          shownByStaffId: actor.id,
          shownAt: now,
          rank: match.rank,
          score: match.score,
          matchReasons: match.matchReasons as unknown as Prisma.InputJsonValue,
          channel: 'interview',
          messageLogId: messageLogIds[0],
        },
      });
    });
    await this.auditService.log({
      action: 'interview.offered',
      entityType: 'Interview',
      entityCode: created.interview.code,
      actorId: actor.id,
      city: vacancy.city,
      after: {
        status: 'offered',
        vacancyId: vacancy.id,
        businessId: vacancy.businessId,
        jobSeekerId: seeker.id,
        vacancyInterviewSlotId: slot.id,
        replyDueAt: replyDueAt.toISOString(),
      },
      changedFields: ['status', 'vacancyId', 'businessId', 'jobSeekerId', 'vacancyInterviewSlotId'],
      reason: 'Suitable candidate offered an interview slot',
    });
    return { ...created.interview, offerMessageLogIds: messageLogIds };
  }

  async list(staffId: string, filters: { vacancyId?: string; agentId?: string; status?: string } = {}) {
    const actor = await this.prisma.staff.findUnique({ where: { id: staffId } });
    if (!actor) throw new NotFoundException('Staff not found');
    if (!['call_agent', 'field_agent', 'team_lead', 'manager', 'ceo'].includes(actor.role)) {
      throw new ForbiddenException('This staff role cannot view interviews');
    }
    const where: Prisma.InterviewWhereInput = {};
    if (filters.status) where.status = filters.status;
    if (filters.vacancyId) {
      const vacancy = await this.prisma.vacancy.findFirst({
        where: filters.vacancyId.startsWith('VC-') ? { code: filters.vacancyId } : { id: filters.vacancyId },
        select: { id: true },
      });
      if (!vacancy) throw new NotFoundException('Vacancy not found');
      where.vacancyId = vacancy.id;
    }

    if (actor.role === 'call_agent' || actor.role === 'field_agent') {
      if (filters.agentId && filters.agentId !== actor.id) throw new ForbiddenException('You can only view your own interviews');
      where.proposedByStaffId = actor.id;
    } else if (actor.role === 'team_lead') {
      const team = await this.prisma.staff.findMany({
        where: { OR: [{ id: actor.id }, { teamLeadId: actor.id }] }, select: { id: true },
      });
      const teamIds = team.map(({ id }) => id);
      if (filters.agentId && !teamIds.includes(filters.agentId)) throw new ForbiddenException('You can only view interviews proposed by your team');
      where.proposedByStaffId = filters.agentId ?? { in: teamIds };
    } else if (filters.agentId) {
      where.proposedByStaffId = filters.agentId;
    }

    const rows = await this.prisma.interview.findMany({
      where,
      include: {
        jobSeeker: { select: { id: true, code: true, name: true } },
        vacancy: { select: { id: true, code: true, tradeSkill: true, roleTitle: true } },
        placement: { select: { id: true, code: true, status: true, paymentDueAt: true, paidAt: true } },
      },
      orderBy: { slotStartsAt: 'desc' },
    });
    return Promise.all(rows.map(async (interview) => {
      const answeredOfferCall = interview.status === 'offered'
        ? await this.prisma.callRecord.findFirst({
          where: {
            subjectType: 'job_seeker', subjectId: interview.jobSeekerId, purpose: 'offer', answered: true,
            OR: [
              { startedAt: { gte: interview.offerSentAt } },
              { startedAt: null, createdAt: { gte: interview.offerSentAt } },
            ],
          },
          orderBy: { createdAt: 'desc' }, select: { id: true },
        })
        : null;
      return { ...interview, answeredOfferCallId: answeredOfferCall?.id ?? null };
    }));
  }

  async listSlots(vacancyRef: string, staffId: string) {
    const actor = await this.prisma.staff.findUnique({ where: { id: staffId } });
    if (!actor) throw new NotFoundException('Staff not found');
    if (!['call_agent', 'field_agent', 'team_lead', 'manager', 'ceo'].includes(actor.role)) {
      throw new ForbiddenException('This staff role cannot view interview slots');
    }
    const vacancy = await this.prisma.vacancy.findFirst({
      where: vacancyRef.startsWith('VC-') ? { code: vacancyRef } : { id: vacancyRef },
      select: { id: true, replacementForPlacementId: true },
    });
    if (!vacancy) throw new NotFoundException('Vacancy not found');
    const slots = await this.prisma.vacancyInterviewSlot.findMany({
      where: { vacancyId: vacancy.id, startsAt: { gt: this.clock.now() } },
      orderBy: { startsAt: 'asc' },
    });
    return Promise.all(slots.map(async (slot) => {
      const booked = await this.prisma.interview.count({
        where: { vacancyInterviewSlotId: slot.id, status: { in: ['offered', 'confirmed'] } },
      });
      return { ...slot, booked, remainingCapacity: slot.capacity === null ? null : Math.max(0, slot.capacity - booked) };
    }));
  }

  async respondFromLink(token: string, answer: 'yes' | 'no') {
    if (!['yes', 'no'].includes(answer)) throw new BadRequestException('answer must be yes or no');
    const link = await this.consentLinks.validateInterviewActionToken(token, 'candidate_reply');
    const result = await this.applyCandidateReply(link.interviewId, answer === 'yes', null, null);
    await this.consentLinks.consumeInterviewActionToken(token, 'candidate_reply');
    return result;
  }

  async validateCandidateReplyLink(token: string) {
    return this.consentLinks.validateInterviewActionToken(token, 'candidate_reply');
  }

  /**
   * What the offer page (P03) shows before he replies: job, area, salary,
   * shift, interview time and the reply deadline — never the business name or
   * address (those come only after he says yes).
   */
  async candidateReplyDetails(token: string) {
    const link = await this.validateCandidateReplyLink(token);
    const interview = await this.prisma.interview.findUnique({
      where: { id: link.interviewId }, include: { business: true, jobSeeker: true, vacancy: true },
    });
    if (!interview) throw new NotFoundException('Interview not found');
    return {
      firstName: firstNameOf(interview.jobSeeker.name),
      job: interview.vacancy.roleTitle?.trim() || interview.vacancy.tradeSkill,
      area: interview.vacancy.locality || interview.business.locality || '',
      salaryMinPaise: interview.vacancy.salaryMinPaise,
      salaryMaxPaise: interview.vacancy.salaryMaxPaise ?? interview.vacancy.salaryMinPaise,
      salaryPeriod: interview.vacancy.salaryPeriod ?? 'monthly',
      shift: interview.vacancy.shift ?? null,
      slotStartsAt: interview.slotStartsAt,
      slotEndsAt: interview.slotEndsAt,
      replyDueAt: interview.replyDueAt,
      awaitingReply: interview.status === 'offered' && !interview.candidateRespondedAt,
      /** Saying no to an offer below his guaranteed salary floor is never a hit. */
      belowGuaranteeFloor: await this.offerIsBelowGuaranteeFloor(interview),
      language: interview.jobSeeker.messageLanguage ?? null,
    };
  }

  /** What the owner's result page (P05) shows: who, where, when, and the deadline. */
  async ownerResultDetails(token: string) {
    const link = await this.validateOwnerResultLink(token);
    const interview = await this.prisma.interview.findUnique({
      where: { id: link.interviewId }, include: { business: true, jobSeeker: true, vacancy: true },
    });
    if (!interview) throw new NotFoundException('Interview not found');
    return {
      candidateFirstName: firstNameOf(interview.jobSeeker.name),
      businessName: interview.business.name,
      job: interview.vacancy.roleTitle?.trim() || interview.vacancy.tradeSkill,
      slotStartsAt: interview.slotStartsAt,
      slotEndsAt: interview.slotEndsAt,
      resultDueAt: interview.resultDueAt,
      vacancySalaryMinPaise: interview.vacancy.salaryPeriod === 'daily' ? null : interview.vacancy.salaryMinPaise,
      maskedPhone: `******${link.phone.replace(/\D/g, '').slice(-4)}`,
      awaitingResult: interview.status === 'confirmed' && !interview.resultRecordedAt,
      reasons: NOT_SELECTED_REASONS,
      language: interview.business.contactLanguage ?? null,
    };
  }

  /** What "Did they offer you the job?" (P06) shows: his first name and the business. */
  async candidateCheckDetails(token: string) {
    const link = await this.validateCandidateCheckLink(token);
    const interview = await this.prisma.interview.findUnique({
      where: { id: link.interviewId }, include: { business: true, jobSeeker: true },
    });
    if (!interview) throw new NotFoundException('Interview not found');
    return {
      firstName: firstNameOf(interview.jobSeeker.name),
      businessName: interview.business.name,
      slotStartsAt: interview.slotStartsAt,
      answered: interview.candidateCheckAnswer === 'offered_yes' || interview.candidateCheckAnswer === 'offered_no',
      language: interview.jobSeeker.messageLanguage ?? null,
    };
  }

  async respondFromCall(
    interviewId: string,
    callRecordId: string,
    answer: 'accepted_offer' | 'rejected_offer',
    reason: string | undefined,
    staffId: string,
  ) {
    if (!['accepted_offer', 'rejected_offer'].includes(answer)) {
      throw new BadRequestException('answer must be accepted_offer or rejected_offer');
    }
    if (answer === 'rejected_offer' && !reason?.trim()) {
      throw new BadRequestException('A reason is required when declining an interview offer by call');
    }
    const interview = await this.prisma.interview.findUnique({ where: { id: interviewId } });
    if (!interview || interview.status !== 'offered') throw new BadRequestException('This interview is no longer awaiting a reply');
    const actor = await this.prisma.staff.findUnique({ where: { id: staffId } });
    if (!actor) throw new NotFoundException('Staff not found');
    await this.calls.recordOutcome(
      { id: staffId, role: actor.role },
      callRecordId,
      { agentOutcome: answer, reason },
    );
    const call = await this.prisma.callRecord.findUnique({ where: { id: callRecordId } });
    if (!call || call.purpose !== 'offer' || call.subjectType !== 'job_seeker' ||
        call.subjectId !== interview.jobSeekerId || !call.answered ||
        (call.startedAt ?? call.createdAt).getTime() < interview.offerSentAt.getTime()) {
      throw new BadRequestException('Reply must be recorded on an answered offer call to this candidate after the offer was sent');
    }
    return this.applyCandidateReply(interviewId, answer === 'accepted_offer', call.id, reason?.trim() ?? null);
  }

  async processDueReplies(now = this.clock.now()) {
    const due = await this.prisma.interview.findMany({
      where: { status: 'offered', replyDueAt: { lte: now } },
      orderBy: { replyDueAt: 'asc' },
    });
    let processed = 0;
    for (const interview of due) {
      const call = await this.prisma.callRecord.findFirst({
        where: {
          subjectType: 'job_seeker', subjectId: interview.jobSeekerId, purpose: 'offer',
          OR: [
            { startedAt: { gte: interview.offerSentAt } },
            { startedAt: null, createdAt: { gte: interview.offerSentAt } },
          ],
        },
        orderBy: { createdAt: 'asc' },
      });
      const sentMessages = await this.prisma.messageLog.findMany({
        where: { id: { in: interview.offerMessageLogIds }, status: { in: ['sent', 'delivered', 'read'] } },
        select: { channel: true },
      });
      const bothMessagesSent = ['sms', 'whatsapp'].every((channel) => sentMessages.some((message) => message.channel === channel));
      const nextStatus = call && bothMessagesSent ? 'no_reply' : 'cancelled';
      const updated = await this.prisma.$transaction(async (tx) => {
        const changed = await tx.interview.updateMany({
          where: { id: interview.id, status: 'offered' },
          data: {
            status: nextStatus,
            cancelReason: nextStatus === 'cancelled' ? 'offer_not_followed_up' : null,
          },
        });
        if (changed.count !== 1) return false;
        await recordStatusChange(tx, {
          subjectType: 'interview', subjectId: interview.id, fromStatus: 'offered', toStatus: nextStatus,
          changedByStaffId: null,
          reason: nextStatus === 'cancelled' ? 'offer_not_followed_up' : 'reply_deadline_elapsed_after_offer_attempt',
          changedAt: now,
        });
        return true;
      });
      if (!updated) continue;
      if (nextStatus === 'no_reply') {
        await this.jobSeekerService.recordHit(
          interview.jobSeekerId, 'offer_no_reply', 'Candidate did not reply by the offer deadline', 'system', undefined,
          { interviewId: interview.id, callRecordId: call?.id },
        );
      }
      processed += 1;
    }
    return { processed };
  }

  async processResultDeadlines(now = this.clock.now()) {
    const policy = await this.pricingService.current();
    const interviews = await this.prisma.interview.findMany({
      where: { status: 'confirmed' },
      include: { business: true, jobSeeker: true, vacancy: true },
      orderBy: { slotEndsAt: 'asc' },
    });
    let requestsSent = 0;
    let dueNotices = 0;
    let overdueFlags = 0;
    let closed = 0;
    for (const interview of interviews) {
      if (!interview.resultRequestSentAt && interview.slotEndsAt.getTime() <= now.getTime()) {
        await this.sendOwnerResultRequest(interview, now, policy.interviewResultCloseHours);
        requestsSent += 1;
      }
      if (!interview.resultRecordedAt && interview.resultDueAt.getTime() <= now.getTime()) {
        const agentId = interview.business.accountAgentId ?? interview.business.leadCreatedByStaffId;
        if (agentId && await this.raiseFlagOnce(
          'interview_result_due', 'interview', interview.id, agentId,
          { businessId: interview.businessId, interviewId: interview.id, action: 'Call the business owner to record the interview result' },
        )) dueNotices += 1;
      }
      const escalatesAt = interview.slotEndsAt.getTime() + policy.interviewResultEscalateHours * 60 * 60 * 1000;
      if (!interview.resultRecordedAt && escalatesAt <= now.getTime()) {
        const agentId = interview.business.accountAgentId ?? interview.business.leadCreatedByStaffId;
        if (agentId && await this.raiseFlagOnce(
          'interview_result_overdue', 'interview', interview.id, agentId,
          { businessId: interview.businessId, interviewId: interview.id, overdueHours: policy.interviewResultEscalateHours },
        )) overdueFlags += 1;
      }
      const closesAt = interview.slotEndsAt.getTime() + policy.interviewResultCloseHours * 60 * 60 * 1000;
      if (!interview.resultRecordedAt && closesAt <= now.getTime()) {
        const changed = await this.prisma.$transaction(async (tx) => {
          const result = await tx.interview.updateMany({
            where: { id: interview.id, status: 'confirmed', resultRecordedAt: null },
            data: { status: 'no_result', candidateCheckAnswer: interview.candidateCheckAnswer ?? 'no_answer' },
          });
          if (result.count !== 1) return false;
          await recordStatusChange(tx, {
            subjectType: 'interview', subjectId: interview.id, fromStatus: 'confirmed', toStatus: 'no_result',
            changedByStaffId: null, reason: 'Owner result window closed without a recorded result', changedAt: now,
          });
          return true;
        });
        if (changed) {
          await this.raiseFlagOnce(
            'interview_no_result', 'business', interview.businessId,
            interview.business.accountAgentId ?? interview.business.leadCreatedByStaffId,
            { interviewId: interview.id },
          );
          await this.raiseMismatchIfNeeded(interview.id, interview.business.accountAgentId ?? interview.business.leadCreatedByStaffId);
          closed += 1;
        }
      }
    }
    return { requestsSent, dueNotices, overdueFlags, closed };
  }

  async validateOwnerResultLink(token: string) {
    return this.consentLinks.validateInterviewActionToken(token, 'owner_result');
  }

  async sendOwnerResultOtp(token: string) {
    await this.validateOwnerResultLink(token);
    return this.consentLinks.sendOtp(token);
  }

  async validateCandidateCheckLink(token: string) {
    return this.consentLinks.validateInterviewActionToken(token, 'candidate_check');
  }

  async submitOwnerResult(token: string, input: {
    otpRequestId: string;
    otpCode: string;
    result: 'selected' | 'not_selected' | 'candidate_no_show';
    resultReason?: string;
    selectedSalaryPaise?: number;
    selectedJoiningDate?: string;
  }) {
    const link = await this.consentLinks.verifyInterviewOwnerOtp(token, input.otpRequestId, input.otpCode);
    if (!['selected', 'not_selected', 'candidate_no_show'].includes(input.result)) {
      throw new BadRequestException('result must be selected, not_selected or candidate_no_show');
    }
    if (input.result === 'not_selected' && !(NOT_SELECTED_REASONS as readonly string[]).includes(input.resultReason ?? '')) {
      throw new BadRequestException('resultReason must be from the not-selected reason list');
    }
    if (input.result === 'selected' && (!Number.isSafeInteger(input.selectedSalaryPaise) || (input.selectedSalaryPaise ?? 0) <= 0)) {
      throw new BadRequestException('selectedSalaryPaise must be a positive whole number of paise');
    }
    const joiningDate = input.selectedJoiningDate ? new Date(input.selectedJoiningDate) : null;
    if (input.result === 'selected' && (!joiningDate || !Number.isFinite(joiningDate.getTime()))) {
      throw new BadRequestException('selectedJoiningDate is required for a selected result');
    }
    const interview = await this.prisma.interview.findUnique({
      where: { id: link.interviewId }, include: { business: true, jobSeeker: true, vacancy: true },
    });
    if (!interview || interview.status !== 'confirmed' || interview.resultRecordedAt) {
      throw new BadRequestException('This interview is no longer awaiting an owner result');
    }
    const resultPhone = interview.vacancy.branchId
      ? (await this.prisma.businessBranch.findUnique({ where: { id: interview.vacancy.branchId } }))?.contactPersonPhone
      : interview.business.phone;
    if (!resultPhone || !sameIndianMobile(resultPhone, link.phone)) {
      throw new BadRequestException('The owner phone changed after this result link was issued');
    }
    const now = this.clock.now();
    const status = input.result === 'candidate_no_show' ? 'no_show' : 'completed';
    await this.prisma.$transaction(async (tx) => {
      const updated = await tx.interview.updateMany({
        where: { id: interview.id, status: 'confirmed', resultRecordedAt: null },
        data: {
          status,
          result: input.result,
          resultReason: input.result === 'not_selected' ? input.resultReason : null,
          resultOtpRequestId: input.otpRequestId,
          resultRecordedAt: now,
          selectedSalaryPaise: input.result === 'selected' ? input.selectedSalaryPaise : null,
          selectedJoiningDate: input.result === 'selected' ? joiningDate : null,
          // The candidate may have answered "Did they offer you the job?" first; keep that answer.
          candidateCheckAnswer: interview.candidateCheckAnswer === 'offered_yes' || interview.candidateCheckAnswer === 'offered_no'
            ? interview.candidateCheckAnswer
            : 'no_answer',
        },
      });
      if (updated.count !== 1) throw new BadRequestException('This interview is no longer awaiting an owner result');
      await recordStatusChange(tx, {
        subjectType: 'interview', subjectId: interview.id, fromStatus: 'confirmed', toStatus: status,
        changedByStaffId: null, reason: 'Owner recorded the interview result by OTP', changedAt: now,
      });
      if (interview.vacancy.replacementForPlacementId) {
        if (input.result === 'not_selected') {
          await tx.replacementCandidate.updateMany({
            where: { interviewId: interview.id },
            data: {
              status: 'rejected',
              rejectionReason: input.resultReason,
              rejectedAt: now,
            },
          });
          const droppedPlacement = await tx.placement.findUnique({
            where: { id: interview.vacancy.replacementForPlacementId },
          });
          if (droppedPlacement) {
            const rootId = droppedPlacement.rootPlacementId ?? droppedPlacement.id;
            const replacementVacancies = await tx.vacancy.findMany({
              where: {
                OR: [
                  { replacementForPlacementId: rootId },
                  { replacementForPlacement: { rootPlacementId: rootId } },
                ],
              },
              select: { id: true },
            });
            const vacancyIds = replacementVacancies.map((v) => v.id);
            const notSelectedCount = await tx.interview.count({
              where: {
                vacancyId: { in: vacancyIds },
                result: 'not_selected',
              },
            });
            const policy = await this.pricingService.current();
            if (notSelectedCount >= policy.maxReplacementRejections) {
              const root = await tx.placement.findUnique({ where: { id: rootId } });
              await tx.placement.update({
                where: { id: rootId },
                data: {
                  status: 'guarantee_ended',
                  guaranteeEndedReason: 'two_rejections',
                },
              });
              await recordStatusChange(tx, {
                subjectType: 'placement',
                subjectId: rootId,
                fromStatus: root?.status ?? 'dropped_out',
                toStatus: 'guarantee_ended',
                changedByStaffId: null,
                changedAt: now,
                reason: 'two_rejections',
              });
              await tx.vacancy.update({
                where: { id: interview.vacancyId },
                data: { status: 'closed' },
              });
            }
          }
        }
      }
    });
    await this.consentLinks.consumeInterviewActionToken(token, 'owner_result');
    await this.auditService.log({
      actorId: interview.proposedByStaffId, action: 'interview.result_recorded', entityType: 'Interview',
      entityCode: interview.code, city: interview.business.city,
      after: { status, result: input.result, resultReason: input.resultReason ?? null, selectedSalaryPaise: input.selectedSalaryPaise ?? null, selectedJoiningDate: joiningDate?.toISOString() ?? null },
      changedFields: ['status', 'result', 'resultReason', 'resultOtpRequestId', 'resultRecordedAt', 'selectedSalaryPaise', 'selectedJoiningDate'],
      reason: 'Business owner verified by OTP on the business phone',
    });
    if (input.result === 'not_selected') {
      await this.raiseMismatchIfNeeded(interview.id, interview.proposedByStaffId);
    }
    if (input.result === 'candidate_no_show') {
      await this.jobSeekerService.recordHit(interview.jobSeekerId, 'interview_no_show', undefined, 'system', undefined, { interviewId: interview.id });
    }
    const placement = input.result === 'selected'
      ? await this.placements.createAwaitingPaymentFromInterview(interview.id, now)
      : null;
    if (interview.vacancy.replacementForPlacementId && placement && joiningDate) {
      const joiningText = new Intl.DateTimeFormat('en-IN', {
        timeZone: 'Asia/Kolkata',
        dateStyle: 'medium',
      }).format(joiningDate);
      for (const channel of ['whatsapp', 'sms'] as const) {
        await this.messagingService.send({
          channel,
          template: 'joining_confirmed',
          subjectType: 'job_seeker',
          subjectId: interview.jobSeekerId,
          relatedType: 'placement',
          relatedId: placement.id,
          variables: {
            candidateName: interview.jobSeeker.name,
            businessName: interview.business.name,
            joiningDate: joiningText,
          },
        });
      }
    }
    return { id: interview.id, status, result: input.result, placement };
  }

  async submitCandidateOfferCheck(token: string, answer: 'yes' | 'no') {
    if (!['yes', 'no'].includes(answer)) throw new BadRequestException('answer must be yes or no');
    const link = await this.consentLinks.validateInterviewActionToken(token, 'candidate_check');
    const interview = await this.prisma.interview.findUnique({ where: { id: link.interviewId } });
    // He is asked at the same moment as the owner (Master Guide, "Stopping bypass"), so he may answer first.
    if (!interview || (!interview.resultRequestSentAt && !interview.resultRecordedAt)) {
      throw new BadRequestException('This interview is not waiting for your answer yet');
    }
    const now = this.clock.now();
    const updated = await this.prisma.interview.updateMany({
      where: { id: interview.id, candidateCheckAnswer: 'no_answer' },
      data: { candidateCheckAnswer: answer === 'yes' ? 'offered_yes' : 'offered_no', candidateCheckAt: now },
    });
    if (updated.count !== 1) throw new BadRequestException('This candidate check link has already been used');
    await this.consentLinks.consumeInterviewActionToken(token, 'candidate_check');
    await this.raiseMismatchIfNeeded(interview.id, null);
    return { id: interview.id, candidateCheckAnswer: answer === 'yes' ? 'offered_yes' : 'offered_no' };
  }

  private async sendOwnerResultRequest(
    interview: Prisma.InterviewGetPayload<{ include: { business: true; jobSeeker: true; vacancy: true } }>,
    now: Date,
    closeHours: number,
  ) {
    const claimed = await this.prisma.interview.updateMany({
      where: { id: interview.id, status: 'confirmed', resultRequestSentAt: null },
      data: { resultRequestSentAt: now, candidateCheckAnswer: 'no_answer' },
    });
    if (claimed.count !== 1) return;
    const linkExpiresAt = new Date(interview.slotEndsAt.getTime() + closeHours * 60 * 60 * 1000);
    const branch = interview.vacancy.branchId
      ? await this.prisma.businessBranch.findUnique({ where: { id: interview.vacancy.branchId } })
      : null;
    const contactPhone = branch?.contactPersonPhone ?? interview.business.phone;
    const token = await this.consentLinks.createInterviewActionToken(
      interview.id, 'owner_result', contactPhone, linkExpiresAt,
    );
    const link = publicPageLink('interviewResult', token);
    const interviewTime = new Intl.DateTimeFormat('en-IN', {
      timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short',
    }).format(interview.slotStartsAt);
    const [ownerMessages] = await Promise.all([
      Promise.all((['sms', 'whatsapp'] as const).map((channel) => this.messagingService.send({
        channel, template: 'interview_result_request', subjectType: 'business', subjectId: interview.businessId,
        recipientPhone: contactPhone,
        relatedType: 'interview', relatedId: interview.id, variables: { link, interviewTime },
      }))),
      this.sendCandidateOfferCheck(interview),
    ]);
    if (ownerMessages.some((message) => message.status === 'failed')) {
      throw new ServiceUnavailableException('The owner result request could not be delivered');
    }
  }

  private async sendCandidateOfferCheck(
    interview: Prisma.InterviewGetPayload<{ include: { business: true; jobSeeker: true; vacancy: true } }>,
  ) {
    const policy = await this.pricingService.current();
    const token = await this.consentLinks.createInterviewActionToken(
      interview.id, 'candidate_check', interview.jobSeeker.phone,
      new Date(interview.slotEndsAt.getTime() + policy.interviewResultCloseHours * 60 * 60 * 1000),
    );
    const link = publicPageLink('offerCheck', token);
    const messages = await Promise.all((['sms', 'whatsapp'] as const).map((channel) =>
      this.messagingService.send({
        channel, template: 'candidate_offer_check', subjectType: 'job_seeker', subjectId: interview.jobSeekerId,
        relatedType: 'interview', relatedId: interview.id, variables: { link },
      }),
    ));
    if (messages.some((message) => message.status === 'failed')) {
      throw new ServiceUnavailableException('The candidate offer check could not be delivered');
    }
  }

  private async raiseFlagOnce(
    kind: 'interview_result_due' | 'interview_result_overdue' | 'interview_no_result' | 'interview_result_mismatch',
    subjectType: string,
    subjectId: string,
    raisedForStaffId: string | null,
    details: Record<string, unknown>,
  ) {
    const existing = await this.prisma.reviewFlag.findFirst({
      where: { kind, subjectType, subjectId }, select: { id: true },
    });
    if (existing) return false;
    await this.reviewFlags.raise({ kind, subjectType, subjectId, raisedForStaffId, details });
    return true;
  }

  private async raiseMismatchIfNeeded(interviewId: string, fallbackStaffId: string | null) {
    const interview = await this.prisma.interview.findUnique({
      where: { id: interviewId }, include: { business: true },
    });
    if (!interview || !['not_selected', null].includes(interview.result) ||
        !['no_result', 'completed'].includes(interview.status) || interview.candidateCheckAnswer !== 'offered_yes') {
      return false;
    }
    return this.raiseFlagOnce(
      'interview_result_mismatch', 'interview', interview.id,
      interview.business.accountAgentId ?? interview.business.leadCreatedByStaffId ?? fallbackStaffId,
      { businessId: interview.businessId, interviewId: interview.id, ownerResult: interview.result ?? 'no_result', candidateAnswer: 'offered_yes' },
    );
  }

  private async applyCandidateReply(interviewId: string, accepted: boolean, callRecordId: string | null, reason: string | null) {
    const interview = await this.prisma.interview.findUnique({
      where: { id: interviewId },
      include: { business: true, jobSeeker: true, vacancy: true },
    });
    if (!interview) throw new NotFoundException('Interview not found');
    const now = this.clock.now();
    if (interview.status !== 'offered' || interview.candidateRespondedAt || now.getTime() > interview.replyDueAt.getTime()) {
      throw new BadRequestException('This interview is no longer awaiting a reply');
    }
    const status = accepted ? 'confirmed' : 'declined';
    const changed = await this.prisma.$transaction(async (tx) => {
      const update = await tx.interview.updateMany({
        where: { id: interview.id, status: 'offered', candidateRespondedAt: null },
        data: {
          status,
          candidateRespondedAt: now,
          callRecordId,
        },
      });
      if (update.count !== 1) throw new BadRequestException('This interview is no longer awaiting a reply');
      await recordStatusChange(tx, {
        subjectType: 'interview', subjectId: interview.id, fromStatus: 'offered', toStatus: status,
        changedByStaffId: null, reason: reason ?? undefined, changedAt: now,
      });
      return true;
    });
    const belowGuaranteeFloor = changed && !accepted
      ? await this.offerIsBelowGuaranteeFloor(interview)
      : false;
    if (changed && !accepted && !belowGuaranteeFloor) {
      await this.jobSeekerService.recordHit(interview.jobSeekerId, 'offer_declined', reason ?? undefined, 'system', undefined, {
        interviewId: interview.id, callRecordId: callRecordId ?? undefined,
      });
    }
    if (accepted && interview.agentAttendanceRequired) {
      await this.businessVerification.createInterviewAttendanceAssignment(
        interview.businessId,
        interview.id,
        interview.proposedByStaffId,
      );
    }
    if (accepted) await this.sendConfirmationDetails(interview, now);
    if (!accepted) return { id: interview.id, status };
    const branch = interview.vacancy.branchId
      ? await this.prisma.businessBranch.findUnique({ where: { id: interview.vacancy.branchId } })
      : null;
    // Only now, after he said yes, does he get the business name and address (P03b).
    return {
      id: interview.id,
      status,
      booked: {
        businessName: interview.business.name,
        address: interview.business.address ?? '',
        area: interview.vacancy.locality ?? interview.business.locality ?? '',
        slotStartsAt: interview.slotStartsAt,
        slotEndsAt: interview.slotEndsAt,
        contactPerson: branch?.contactPersonName || interview.business.additionalContactName || interview.business.ownerName || '',
      },
    };
  }

  private async offerIsBelowGuaranteeFloor(interview: {
    vacancy: { salaryMinPaise: number | null; salaryMaxPaise: number | null; salaryPeriod: string | null };
    jobSeeker: { guaranteeFloorPaise: number | null; minSalary: number; salaryPeriod: string | null };
  }): Promise<boolean> {
    const { salaryMinPaise, salaryMaxPaise, salaryPeriod } = interview.vacancy;
    if (salaryMinPaise === null) return false;
    const policy = await this.pricingService.current();
    const salaryAmount = salaryMaxPaise ?? salaryMinPaise;
    const monthlyOffer = salaryPeriod === 'daily'
      ? salaryAmount * policy.salaryDaysPerMonth
      : salaryAmount;
    const floor = interview.jobSeeker.guaranteeFloorPaise ?? (
      interview.jobSeeker.salaryPeriod === 'daily'
        ? interview.jobSeeker.minSalary * policy.salaryDaysPerMonth
        : interview.jobSeeker.minSalary
    );
    return monthlyOffer < floor;
  }

  private async requiresAttendance(business: { id: string; documentsStatus: string | null }) {
    if (business.documentsStatus === 'no_documents') return true;
    const [previousInterview, openFlag] = await Promise.all([
      this.prisma.interview.count({ where: { businessId: business.id } }),
      this.prisma.reviewFlag.findFirst({
        where: {
          subjectType: 'business', subjectId: business.id, status: 'open',
          kind: { in: ['business_many_rejections', 'business_stopped_after_interviews', 'interview_no_result'] },
        },
        select: { id: true },
      }),
    ]);
    return previousInterview === 0 || Boolean(openFlag);
  }

  private async sendConfirmationDetails(
    interview: Prisma.InterviewGetPayload<{ include: { business: true; jobSeeker: true; vacancy: true } }>,
    now: Date,
  ) {
    const time = new Intl.DateTimeFormat('en-IN', {
      timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short',
    }).format(interview.slotStartsAt);
    const branch = interview.vacancy.branchId
      ? await this.prisma.businessBranch.findUnique({ where: { id: interview.vacancy.branchId } })
      : null;
    const contactPerson = branch?.contactPersonName || interview.business.additionalContactName || interview.business.ownerName || '';
    const candidateMessages = await Promise.all((['sms', 'whatsapp'] as const).map((channel) =>
      this.messagingService.send({
        channel, template: 'interview_booked', subjectType: 'job_seeker', subjectId: interview.jobSeekerId,
        relatedType: 'interview', relatedId: interview.id,
        variables: {
          businessName: interview.business.name,
          address: interview.business.address ?? '',
          area: interview.vacancy.locality ?? interview.business.locality ?? '',
          interviewTime: time,
          contactPerson,
        },
      }),
    ));
    let photoLink = '';
    if (interview.jobSeeker.photoStoragePath && this.photoStorage) {
      photoLink = await this.photoStorage.signedUrl(interview.jobSeeker.photoStoragePath, CANDIDATE_PHOTO_LINK_TTL_SECONDS);
    }
    const ownerMessages = await Promise.all((['sms', 'whatsapp'] as const).map((channel) =>
      this.messagingService.send({
        channel, template: 'interview_candidate_for_owner', subjectType: 'business', subjectId: interview.businessId,
        ...(branch ? { recipientPhone: branch.contactPersonPhone } : {}),
        relatedType: 'interview', relatedId: interview.id,
        variables: { firstName: interview.jobSeeker.name.trim().split(/\s+/)[0], photoLink, interviewTime: time },
      }),
    ));
    if ([...candidateMessages, ...ownerMessages].some((message) => message.status === 'failed')) {
      throw new ServiceUnavailableException('Interview confirmation details could not be delivered');
    }
    await this.prisma.interview.update({ where: { id: interview.id }, data: { businessDetailsSentAt: now } });
  }

  private async findMatchingCandidate(vacancyId: string, jobSeekerId: string) {
    const firstPage = await this.matchingService.match(vacancyId, { page: 1 });
    const pageCount = Math.ceil(firstPage.total / firstPage.pageSize);
    for (let page = 1; page <= pageCount; page += 1) {
      const result = page === 1 ? firstPage : await this.matchingService.match(vacancyId, { page });
      const index = result.matches.findIndex((row) => row.jobSeekerId === jobSeekerId);
      if (index >= 0) {
        const match = result.matches[index] as MatchForBooking;
        return { ...match, rank: (page - 1) * result.pageSize + index + 1 };
      }
    }
    return null;
  }

  private async cancelFailedOffer(interviewId: string, actorId: string, now: Date) {
    await this.prisma.$transaction(async (tx) => {
      const updated = await tx.interview.update({
        where: { id: interviewId },
        data: { status: 'cancelled', cancelReason: 'offer_delivery_failed' },
      });
      await recordStatusChange(tx, {
        subjectType: 'interview',
        subjectId: interviewId,
        fromStatus: 'offered',
        toStatus: 'cancelled',
        changedByStaffId: actorId,
        reason: updated.cancelReason,
        changedAt: now,
      });
    });
  }
}
