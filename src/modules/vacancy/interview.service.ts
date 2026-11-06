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
import { publicLink } from '../../common/public-link';
import { JobSeekerService } from '../job-seeker/job-seeker.service';
import { CallService } from '../call/call.service';
import { CANDIDATE_PHOTO_LINK_TTL_SECONDS, CANDIDATE_PHOTO_STORAGE, CandidatePhotoStorage } from '../job-seeker/photo-storage';
import { BusinessVerificationService } from '../business/business-verification.service';

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
    if (vacancy.replacementForPlacementId) {
      throw new BadRequestException('Interviews in this phase are only available for fresh vacancies');
    }
    if (vacancy.business.verificationStatus !== 'verified') {
      throw new BadRequestException('The business must be verified before an interview can be booked');
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
      return { interview, created: true };
    });

    if (!created.created) {
      return created.interview;
    }

    const replyToken = this.consentLinks.createInterviewActionToken(
      created.interview.id,
      'candidate_reply',
      seeker.phone,
      replyDueAt,
    );
    const link = publicLink(`/interviews/reply/${replyToken}`);
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

  async respondFromLink(token: string, answer: 'yes' | 'no') {
    if (!['yes', 'no'].includes(answer)) throw new BadRequestException('answer must be yes or no');
    const link = this.consentLinks.validateInterviewActionToken(token, 'candidate_reply');
    const result = await this.applyCandidateReply(link.interviewId, answer === 'yes', null, null);
    this.consentLinks.consumeInterviewActionToken(token, 'candidate_reply');
    return result;
  }

  validateCandidateReplyLink(token: string) {
    return this.consentLinks.validateInterviewActionToken(token, 'candidate_reply');
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
    if (changed && !accepted) {
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
    return { id: interview.id, status };
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
    const contactPerson = interview.business.additionalContactName || interview.business.ownerName || interview.business.contactName || '';
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
