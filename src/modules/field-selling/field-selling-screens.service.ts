import { BadRequestException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { refundGuaranteeDeadline } from '../../common/money/money';
import { phoneLast4 } from '../../common/phone/indian-mobile';
import { ConsentClock } from '../consent/consent-clock';
import { PricingService } from '../pricing/pricing.service';
import { TELEPHONY_PROVIDER, TelephonyProvider } from '../telephony/telephony.interface';
import { MatchingService } from '../vacancy/matching.service';
import { InterviewService, NOT_SELECTED_REASONS } from '../vacancy/interview.service';
import { businessCandidateAccess } from '../business/business-candidate-access';
import { SellingActor } from './field-selling.service';

const DAY_MS = 24 * 60 * 60 * 1000;
const IST_OFFSET_MS = 330 * 60 * 1000;
const SEARCH_LIMIT = 8;
const MINE_LIMIT = 20;

function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] ?? name.trim();
}

function istDateKey(instant: Date): string {
  return new Date(instant.getTime() + IST_OFFSET_MS).toISOString().slice(0, 10);
}

function ageOn(dateOfBirth: Date, now: Date): number {
  let age = now.getUTCFullYear() - dateOfBirth.getUTCFullYear();
  if (now.getUTCMonth() < dateOfBirth.getUTCMonth() ||
    (now.getUTCMonth() === dateOfBirth.getUTCMonth() && now.getUTCDate() < dateOfBirth.getUTCDate())) age -= 1;
  return age;
}

/** Rough area only (about 1 km), never a home: the same rounding as the office map. */
function roughArea(value: number | null): number | null {
  return value === null ? null : Math.round(value * 100) / 100;
}

function kmBetween(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(lat2 - lat1);
  const dLon = rad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * Reads for Laboura Field's selling screens (FA15–FA19, FA11, FA14). Phone
 * numbers never leave here except as the last 4 digits; candidates are shown
 * as first name, photo, age, experience, distance and rough area only.
 */
@Injectable()
export class FieldSellingScreensService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: ConsentClock,
    private readonly pricing: PricingService,
    private readonly matching: MatchingService,
    private readonly interviews: InterviewService,
    @Inject(TELEPHONY_PROVIDER) private readonly telephony: TelephonyProvider,
  ) {}

  /** Fee calculator and booking settings, from Settings (PricingPolicy), never hard-coded. */
  async settings() {
    const policy = await this.pricing.current();
    return {
      feePercent: policy.placementFeePercent,
      gstPercent: policy.gstPercent,
      walkInStart: policy.walkInStart,
      walkInEnd: policy.walkInEnd,
      callingHoursStart: policy.callingHoursStart,
      callingHoursEnd: policy.callingHoursEnd,
      interviewResultDeadline: policy.interviewResultDeadline,
      placementPaymentDueHours: policy.placementPaymentDueHours,
      maxFreeReplacements: policy.maxFreeReplacements,
      replacementWindowDays: policy.replacementWindowDays,
      threeWayCalls: Boolean(this.telephony.supportsThreeWayCalls?.()),
      notSelectedReasons: NOT_SELECTED_REASONS,
    };
  }

  private async businessRows(where: Prisma.BusinessWhereInput, orderBy: Prisma.BusinessOrderByWithRelationInput[], take: number, actor: SellingActor) {
    const now = this.clock.now();
    const rows = await this.prisma.business.findMany({
      where: { ...where, anonymisedAt: null },
      orderBy,
      take,
      include: {
        agreements: { orderBy: { signedAt: 'desc' }, take: 1, select: { signedAt: true } },
        vacancies: {
          where: { status: { in: ['open', 'awaiting_confirmation', 'draft'] } },
          select: { id: true, tradeSkill: true, headcount: true, status: true },
          orderBy: { createdAt: 'asc' },
        },
      },
    });
    return rows.map((b) => {
      const signedAt = b.agreements[0]?.signedAt ?? null;
      const open = b.vacancies.filter((v) => v.status === 'open');
      return {
        id: b.id,
        code: b.code,
        name: b.name,
        locality: b.locality,
        verificationStatus: b.verificationStatus,
        agreementSigned: Boolean(signedAt),
        signedToday: signedAt ? istDateKey(signedAt) === istDateKey(now) : false,
        canShowCandidates: businessCandidateAccess(b).allowed,
        paused: Boolean(b.pausedAt),
        isMine: b.accountAgentId === actor.id,
        openVacancies: open.reduce((sum, v) => sum + v.headcount, 0),
        waitingForOtp: b.vacancies.filter((v) => v.status === 'awaiting_confirmation').length,
        vacancies: b.vacancies.map((v) => ({ id: v.id, trade: v.tradeSkill, headcount: v.headcount, status: v.status })),
      };
    });
  }

  /**
   * FA15/FA19 type-ahead: two letters or more match registered businesses by
   * name or BZ- code; with no query, the agent's own businesses, newest first.
   */
  async businesses(actor: SellingActor, q?: string) {
    const query = (q ?? '').trim();
    if (query.length === 0) {
      return {
        query: '',
        results: await this.businessRows(
          { accountAgentId: actor.id },
          [{ accountAgentAssignedAt: { sort: 'desc', nulls: 'last' } }, { createdAt: 'desc' }],
          MINE_LIMIT,
          actor,
        ),
      };
    }
    if (query.length < 2) return { query, results: [] };
    const where: Prisma.BusinessWhereInput = /^bz-\d+$/i.test(query)
      ? { code: query.toUpperCase() }
      : { OR: [{ name: { contains: query, mode: 'insensitive' } }, { legalName: { contains: query, mode: 'insensitive' } }] };
    const rows = await this.businessRows(where, [{ name: 'asc' }], SEARCH_LIMIT * 3, actor);
    const lower = query.toLowerCase();
    rows.sort((a, b) => Number(!a.name.toLowerCase().startsWith(lower)) - Number(!b.name.toLowerCase().startsWith(lower)) ||
      a.name.localeCompare(b.name));
    return { query, results: rows.slice(0, SEARCH_LIMIT) };
  }

  /** FA15b header / FA17 header: the business and its vacancies (with OTP state). */
  async business(actor: SellingActor, ref: string) {
    const business = await this.prisma.business.findFirst({
      where: ref.startsWith('BZ-') ? { code: ref } : { id: ref },
      include: {
        agreements: { orderBy: { signedAt: 'desc' }, take: 1, select: { signedAt: true } },
        vacancies: {
          where: { status: { in: ['open', 'awaiting_confirmation', 'draft'] } },
          orderBy: { createdAt: 'asc' },
          include: { branch: { select: { contactPersonName: true, contactPersonRole: true, contactPersonPhone: true } } },
        },
      },
    });
    if (!business) throw new NotFoundException('Business not found');
    const now = this.clock.now();
    const signedAt = business.agreements[0]?.signedAt ?? null;
    return {
      id: business.id,
      code: business.code,
      name: business.name,
      locality: business.locality,
      verificationStatus: business.verificationStatus,
      agreementSigned: Boolean(signedAt),
      signedToday: signedAt ? istDateKey(signedAt) === istDateKey(now) : false,
      canShowCandidates: businessCandidateAccess(business).allowed,
      paused: Boolean(business.pausedAt),
      isMine: business.accountAgentId === actor.id,
      latitude: business.latitude,
      longitude: business.longitude,
      contactName: business.additionalContactName ?? business.ownerName,
      contactRole: business.contactRole,
      contactPhoneLast4: phoneLast4(business.phone),
      contactLanguage: business.contactLanguage,
      vacancies: business.vacancies.map((v) => ({
        id: v.id,
        code: v.code,
        trade: v.tradeSkill,
        roleTitle: v.roleTitle,
        headcount: v.headcount,
        salaryMinPaise: v.salaryMinPaise,
        salaryMaxPaise: v.salaryMaxPaise,
        salaryPeriod: v.salaryPeriod,
        shift: v.shift,
        startDate: v.startDate,
        status: v.status,
        confirmedAt: v.confirmedAt,
        confirmedByName: v.confirmedByName,
        contactName: v.branch?.contactPersonName ?? business.additionalContactName ?? business.ownerName,
        contactRole: v.branch?.contactPersonRole ?? business.contactRole,
        contactPhoneLast4: phoneLast4(v.branch?.contactPersonPhone ?? business.phone),
      })),
    };
  }

  /**
   * FA15b/FA15c: the matching engine's best 3 (with Show next 3), the owner's
   * favourites, and each candidate's rough area around the business for the map.
   */
  async matches(actor: SellingActor, vacancyRef: string, page: number) {
    if (!Number.isInteger(page) || page < 1) throw new BadRequestException('page must be a positive integer');
    const vacancy = await this.prisma.vacancy.findFirst({
      where: vacancyRef.startsWith('VC-') ? { code: vacancyRef } : { id: vacancyRef },
      include: { business: { select: { id: true, name: true, latitude: true, longitude: true } } },
    });
    if (!vacancy) throw new NotFoundException('Vacancy not found');
    const result = await this.matching.match(vacancy.id, { page });
    const ids = result.matches.map((m) => m.jobSeekerId);
    const [favourites, seekers] = await Promise.all([
      this.prisma.ownerFavourite.findMany({ where: { vacancyId: vacancy.id }, select: { jobSeekerId: true } }),
      this.prisma.jobSeeker.findMany({ where: { id: { in: ids } }, select: { id: true, code: true, latitude: true, longitude: true, locality: true } }),
    ]);
    const liked = new Set(favourites.map((f) => f.jobSeekerId));
    const byId = new Map(seekers.map((s) => [s.id, s]));
    return {
      vacancyId: vacancy.id,
      business: {
        id: vacancy.business.id,
        name: vacancy.business.name,
        latitude: vacancy.latitude ?? vacancy.business.latitude,
        longitude: vacancy.longitude ?? vacancy.business.longitude,
      },
      page: result.page,
      pageSize: result.pageSize,
      total: result.total,
      likedCount: liked.size,
      matches: result.matches.map((m) => {
        const seeker = byId.get(m.jobSeekerId);
        return {
          jobSeekerId: m.jobSeekerId,
          code: seeker?.code ?? null,
          card: m.card,
          matchReasons: m.matchReasons,
          priority: m.priority ?? false,
          liked: liked.has(m.jobSeekerId),
          area: {
            locality: seeker?.locality ?? null,
            latitude: roughArea(seeker?.latitude ?? null),
            longitude: roughArea(seeker?.longitude ?? null),
          },
        };
      }),
    };
  }

  /** FA15x: why there are no more matches. */
  async noMore(vacancyRef: string) {
    const vacancy = await this.prisma.vacancy.findFirst({
      where: vacancyRef.startsWith('VC-') ? { code: vacancyRef } : { id: vacancyRef },
      include: { business: { select: { name: true } } },
    });
    if (!vacancy) throw new NotFoundException('Vacancy not found');
    const [why, firstPage] = await Promise.all([
      this.matching.whyNoMore(vacancy.id),
      this.matching.match(vacancy.id, { page: 1 }),
    ]);
    return {
      ...why,
      businessName: vacancy.business.name,
      headcount: vacancy.headcount,
      totalShown: firstPage.total,
    };
  }

  /** FA15d: the candidate card — nothing that would let the owner contact him directly. */
  async candidate(actor: SellingActor, jobSeekerRef: string, vacancyRef: string) {
    if (!vacancyRef) throw new BadRequestException('vacancyId is required');
    const vacancy = await this.prisma.vacancy.findFirst({
      where: vacancyRef.startsWith('VC-') ? { code: vacancyRef } : { id: vacancyRef },
      include: { business: true },
    });
    if (!vacancy) throw new NotFoundException('Vacancy not found');
    if (!businessCandidateAccess(vacancy.business).allowed) throw new ForbiddenException('Candidates are hidden until the business is verified');
    const seeker = await this.prisma.jobSeeker.findFirst({
      where: jobSeekerRef.startsWith('JS-') ? { code: jobSeekerRef } : { id: jobSeekerRef },
      include: {
        trades: true,
        languages: true,
        identityVerifications: { where: { status: 'verified' }, select: { id: true }, take: 1 },
      },
    });
    if (!seeker) throw new NotFoundException('Job seeker not found');
    const policy = await this.pricing.current();
    const now = this.clock.now();
    const jobs = await this.matching.jobsForSeeker(seeker.id, { page: 1, vacancyId: vacancy.id });
    const job = jobs.jobs.find((j) => j.vacancyId === vacancy.id) ?? null;
    const trade = seeker.trades.find((t) => t.trade.trim().toLowerCase() === vacancy.tradeSkill.trim().toLowerCase())
      ?? seeker.trades.find((t) => t.isPrimary) ?? seeker.trades[0] ?? null;
    const lat = vacancy.latitude ?? vacancy.business.latitude;
    const lon = vacancy.longitude ?? vacancy.business.longitude;
    const distanceKm = seeker.latitude !== null && seeker.longitude !== null && lat !== null && lon !== null
      ? Math.round(kmBetween(seeker.latitude, seeker.longitude, lat, lon)) : null;
    const days = policy.jobSeekerGuaranteeDays;
    const deadline = seeker.paymentReceivedAt ? refundGuaranteeDeadline(seeker.paymentReceivedAt, days) : null;
    const guaranteeDay = deadline
      ? Math.min(days, Math.max(1, days - Math.ceil((deadline.getTime() - now.getTime()) / DAY_MS))) : null;
    const liked = await this.prisma.ownerFavourite.findUnique({
      where: { vacancyId_jobSeekerId: { vacancyId: vacancy.id, jobSeekerId: seeker.id } }, select: { id: true },
    });
    const daily = seeker.salaryPeriod === 'daily';
    return {
      jobSeekerId: seeker.id,
      code: seeker.code,
      firstName: firstName(seeker.name),
      age: seeker.dateOfBirth ? ageOn(seeker.dateOfBirth, now) : null,
      trade: trade?.trade ?? null,
      yearsExperience: trade?.yearsExperience ?? null,
      distanceKm,
      locality: seeker.locality,
      expectedSalary: {
        minPaise: daily ? seeker.minSalary * policy.salaryDaysPerMonth : seeker.minSalary,
        maxPaise: daily ? seeker.maxSalary * policy.salaryDaysPerMonth : seeker.maxSalary,
      },
      languages: seeker.languages.filter((l) => l.speaks).map((l) => l.language),
      shift: seeker.shiftPreference,
      availableFrom: seeker.availableFrom,
      availableNow: !seeker.availableFrom || seeker.availableFrom.getTime() <= now.getTime(),
      lastRole: seeker.lastRole,
      lastEmployer: seeker.lastEmployer,
      idVerified: seeker.identityVerifications.length > 0,
      guaranteeDay,
      guaranteeDays: days,
      suitable: Boolean(job),
      liked: Boolean(liked),
      vacancy: { id: vacancy.id, trade: vacancy.tradeSkill, locality: vacancy.locality ?? vacancy.business.locality, shift: vacancy.shift,
        salaryMinPaise: job?.salaryMinPaise ?? vacancy.salaryMinPaise, salaryMaxPaise: job?.salaryMaxPaise ?? vacancy.salaryMaxPaise,
        businessName: vacancy.business.name, businessId: vacancy.businessId },
    };
  }

  /** FA15e–FA16 and FA15h: where an interview stands. */
  async interview(actor: SellingActor, interviewId: string) {
    const interview = await this.prisma.interview.findUnique({
      where: { id: interviewId },
      include: {
        business: true,
        jobSeeker: { select: { id: true, code: true, name: true } },
        vacancy: { include: { branch: { select: { contactPersonName: true, contactPersonRole: true, contactPersonPhone: true } } } },
        placement: { include: { payments: { where: { type: 'placement_fee' }, orderBy: { createdAt: 'desc' }, take: 1 } } },
        callRecord: { select: { id: true, answered: true, providerStatus: true, startedAt: true, answeredAt: true } },
      },
    });
    if (!interview) throw new NotFoundException('Interview not found');
    if (actor.role === 'field_agent' && interview.business.accountAgentId !== actor.id && interview.proposedByStaffId !== actor.id) {
      throw new ForbiddenException('This interview is for another agent\'s business');
    }
    const attendanceVisits = await this.prisma.interview.count({ where: { businessId: interview.businessId, id: { not: interview.id } } });
    const payment = interview.placement?.payments[0] ?? null;
    return {
      id: interview.id,
      code: interview.code,
      status: interview.status,
      interviewType: interview.interviewType,
      result: interview.result,
      resultReason: interview.resultReason,
      resultRecordedAt: interview.resultRecordedAt,
      resultDueAt: interview.resultDueAt,
      slotStartsAt: interview.slotStartsAt,
      slotEndsAt: interview.slotEndsAt,
      offerSentAt: interview.offerSentAt,
      replyDueAt: interview.replyDueAt,
      candidateRespondedAt: interview.candidateRespondedAt,
      offerMessagesSent: interview.offerMessageLogIds.length,
      businessDetailsSentAt: interview.businessDetailsSentAt,
      agentWillAttend: interview.agentWillAttend,
      agentAttendanceRequired: interview.agentAttendanceRequired,
      firstWithBusiness: attendanceVisits === 0,
      handedToOwnerAt: interview.handedToOwnerAt,
      candidateArrivedAt: interview.candidateArrivedAt,
      arrivalDistanceM: interview.arrivalDistanceM,
      candidateCheckAnswer: interview.candidateCheckAnswer,
      resultRequestSentAt: interview.resultRequestSentAt,
      selectedSalaryPaise: interview.selectedSalaryPaise,
      selectedJoiningDate: interview.selectedJoiningDate,
      call: interview.callRecord,
      candidate: { id: interview.jobSeeker.id, code: interview.jobSeeker.code, firstName: firstName(interview.jobSeeker.name) },
      business: {
        id: interview.business.id,
        name: interview.business.name,
        locality: interview.business.locality,
        latitude: interview.business.latitude,
        longitude: interview.business.longitude,
        contactName: interview.vacancy.branch?.contactPersonName ?? interview.business.additionalContactName ?? interview.business.ownerName,
        contactRole: interview.vacancy.branch?.contactPersonRole ?? interview.business.contactRole,
        contactPhoneLast4: phoneLast4(interview.vacancy.branch?.contactPersonPhone ?? interview.business.phone),
      },
      vacancy: {
        id: interview.vacancy.id,
        trade: interview.vacancy.tradeSkill,
        roleTitle: interview.vacancy.roleTitle,
        locality: interview.vacancy.locality ?? interview.business.locality,
        shift: interview.vacancy.shift,
        salaryMinPaise: interview.vacancy.salaryMinPaise,
        salaryMaxPaise: interview.vacancy.salaryMaxPaise,
        salaryPeriod: interview.vacancy.salaryPeriod,
      },
      placement: interview.placement ? {
        id: interview.placement.id,
        code: interview.placement.code,
        status: interview.placement.status,
        agreedSalaryPaise: interview.placement.agreedSalary,
        feePaise: interview.placement.placementFee,
        gstPaise: interview.placement.gstAmount,
        feePercent: interview.placement.feePercentAtCreation,
        gstPercent: interview.placement.gstPercentAtCreation,
        paymentDueAt: interview.placement.paymentDueAt,
        paidAt: interview.placement.paidAt,
        joiningDate: interview.placement.joiningDate,
        paymentStatus: payment?.status ?? null,
      } : null,
    };
  }

  /** FA15q / FA11: a placement's payment, joining and the steps after. */
  async placement(actor: SellingActor, ref: string) {
    const placement = await this.prisma.placement.findFirst({
      where: { OR: [{ id: ref }, { code: ref }] },
      include: {
        business: true,
        jobSeeker: { select: { id: true, code: true, name: true } },
        vacancy: { select: { id: true, tradeSkill: true, businessId: true } },
        payments: { where: { type: 'placement_fee' }, orderBy: { createdAt: 'desc' }, take: 1 },
      },
    });
    if (!placement) throw new NotFoundException('Placement not found');
    if (actor.role === 'field_agent' && placement.business.accountAgentId !== actor.id && placement.createdByStaffId !== actor.id) {
      throw new ForbiddenException('This placement is for another agent\'s business');
    }
    const policy = await this.pricing.current();
    const calls = await this.prisma.callRecord.findMany({
      where: { purpose: 'joining_confirmation', relatedId: placement.id },
      orderBy: { createdAt: 'desc' },
      select: { id: true, subjectType: true, answered: true, durationSec: true, agentOutcome: true, createdAt: true },
    });
    const latest = (type: string) => calls.find((c) => c.subjectType === type) ?? null;
    const payment = placement.payments[0] ?? null;
    const start = placement.joinedDate ?? placement.joiningDate;
    const after = (days: number) => (start ? new Date(start.getTime() + days * DAY_MS) : null);
    const otherOpen = await this.prisma.vacancy.findMany({
      where: { businessId: placement.businessId, status: 'open', id: { not: placement.vacancyId } },
      select: { id: true, tradeSkill: true, headcount: true },
      take: 3,
    });
    return {
      id: placement.id,
      code: placement.code,
      status: placement.status,
      candidate: { id: placement.jobSeeker.id, code: placement.jobSeeker.code, firstName: firstName(placement.jobSeeker.name) },
      business: { id: placement.business.id, name: placement.business.name, contactName: placement.business.additionalContactName ?? placement.business.ownerName },
      trade: placement.vacancy.tradeSkill,
      totalPaise: placement.placementFee + placement.gstAmount,
      paidAt: placement.paidAt,
      paymentStatus: payment?.status ?? null,
      paymentConfirmedAt: payment?.confirmedAt ?? null,
      joiningDate: placement.joiningDate,
      joinedDate: placement.joinedDate,
      joiningNoShowReportedAt: placement.joiningNoShowReportedAt,
      invoiceCode: placement.invoiceCode,
      workerCall: latest('job_seeker'),
      ownerCall: latest('business'),
      comingUp: {
        dayCheckIn7: after(7),
        dayCheckIn30: after(30),
        joiningRewardAfterDays: policy.joiningRewardAfterDays,
        completesAt: after(policy.replacementWindowDays),
      },
      nextVacancies: otherOpen.map((v) => ({ id: v.id, trade: v.tradeSkill, headcount: v.headcount })),
    };
  }

  /** FA19 "Recent": the agent's businesses with vacancies, and how many wait for the owner's OTP. */
  async recentVacancies(actor: SellingActor) {
    const recent = await this.prisma.vacancy.findMany({
      where: { capturedByStaffId: actor.id, status: { in: ['open', 'awaiting_confirmation'] } },
      orderBy: { createdAt: 'desc' },
      take: 40,
      select: { businessId: true },
    });
    const ids = [...new Set(recent.map((v) => v.businessId))].slice(0, 10);
    if (ids.length === 0) return { results: [] };
    const rows = await this.businessRows({ id: { in: ids } }, [{ updatedAt: 'desc' }], ids.length, actor);
    rows.sort((a, b) => ids.indexOf(a.id) - ids.indexOf(b.id));
    return { results: rows };
  }

  /** FA15g: whether the agent must attend (first interview with this business, "No documents", or a flag). */
  async bookingContext(vacancyRef: string, jobSeekerRef: string) {
    const vacancy = await this.prisma.vacancy.findFirst({
      where: vacancyRef.startsWith('VC-') ? { code: vacancyRef } : { id: vacancyRef },
      include: { business: true },
    });
    if (!vacancy) throw new NotFoundException('Vacancy not found');
    const seeker = await this.prisma.jobSeeker.findFirst({
      where: jobSeekerRef.startsWith('JS-') ? { code: jobSeekerRef } : { id: jobSeekerRef },
      select: { id: true, name: true },
    });
    if (!seeker) throw new NotFoundException('Job seeker not found');
    const settings = await this.settings();
    return {
      vacancyId: vacancy.id,
      trade: vacancy.tradeSkill,
      businessName: vacancy.business.name,
      candidateFirstName: firstName(seeker.name),
      attendanceRequired: await this.interviews.requiresAttendance(vacancy.business),
      walkInStart: settings.walkInStart,
      walkInEnd: settings.walkInEnd,
      threeWayCalls: settings.threeWayCalls,
    };
  }
}
