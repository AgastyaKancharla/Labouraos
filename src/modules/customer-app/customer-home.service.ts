import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { CustomerAuthClock } from '../../common/customer-auth/customer-auth.clock';
import { CustomerScopeService, ScopedProfile } from '../../common/customer-auth/customer-scope.service';
import { refundGuaranteeDeadline } from '../../common/money/money';
import { publicLink } from '../../common/public-link';
import { PricingService } from '../pricing/pricing.service';
import { RegistrationJourneyService } from '../job-seeker/registration-journey.service';
import { firstName } from '../customer-account/customer-account.service';

const DAY_MS = 24 * 60 * 60 * 1000;
/** Hits that end the refund (guide, Hits): declining, not replying, not turning up. */
const REFUND_ENDING_HITS = ['offer_declined', 'offer_no_reply', 'interview_no_show'];
const PAID_STATUSES = ['succeeded', 'completed'];
const DONE_REFUND_STATUSES = ['rejected', 'cancelled', 'reversed'];
/** Withdrawing any of these after paying ends the refund (decided 7 Nov). */
const REFUND_ENDING_CONSENTS = ['job_matching', 'profile_sharing', 'call_recording'];

/**
 * The three Home screens (docs/customer-app-api.md §7). Read-only, and only
 * about the caller's own profile. What each side may see follows the guide:
 * a job seeker sees no business before an interview is booked; a business
 * sees no candidate here and never a phone number; a partner sees first
 * names and stages of the people they referred, nothing else.
 */
@Injectable()
export class CustomerHomeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: CustomerAuthClock,
    private readonly scope: CustomerScopeService,
    private readonly pricing: PricingService,
    private readonly journey: RegistrationJourneyService,
  ) {}

  async home(accountId: string, profileId: string) {
    const profile = await this.scope.profile(accountId, profileId);
    if (profile.kind === 'job_seeker') return this.jobSeekerHome(profile);
    if (profile.kind === 'business') return this.businessHome(profile);
    return this.referralHome(profile);
  }

  // ─── Job seeker ───────────────────────────────────────────────────────

  async jobSeekerHome(profile: ScopedProfile) {
    const id = profile.jobSeekerId!;
    const now = this.clock.now();
    const [seeker, policy, journey] = await Promise.all([
      this.prisma.jobSeeker.findUniqueOrThrow({
        where: { id },
        select: { code: true, name: true, status: true, hitCount: true, paymentReceivedAt: true },
      }),
      this.pricing.current(),
      this.journey.status(id, true),
    ]);
    const status = journey as Exclude<typeof journey, { otpRequired: true }>;
    const paidAt = seeker.paymentReceivedAt;
    const deadline = paidAt ? refundGuaranteeDeadline(paidAt, policy.jobSeekerGuaranteeDays) : null;

    const [refundEndingHit, withdrawn, refundPayment, interview] = await Promise.all([
      paidAt
        ? this.prisma.jobSeekerHit.findFirst({
            where: { jobSeekerId: id, reason: { in: REFUND_ENDING_HITS }, reversedAt: null, supersededAt: null },
            select: { id: true },
          })
        : null,
      paidAt
        ? this.prisma.consent.findFirst({
            where: { subjectType: 'job_seeker', subjectId: id, purpose: { in: REFUND_ENDING_CONSENTS }, withdrawnAt: { not: null } },
            select: { id: true },
          })
        : null,
      paidAt
        ? this.prisma.payment.findFirst({
            where: { jobSeekerId: id, type: 'refund', createdAt: { gte: paidAt } },
            orderBy: { createdAt: 'desc' },
            select: { status: true, paidAt: true, bankUtr: true, gatewayReference: true },
          })
        : null,
      this.prisma.interview.findFirst({
        where: { jobSeekerId: id, status: { in: ['offered', 'confirmed'] }, slotEndsAt: { gte: new Date(now.getTime() - DAY_MS) } },
        orderBy: { slotStartsAt: 'asc' },
        select: {
          status: true, slotStartsAt: true, replyDueAt: true, businessDetailsSentAt: true,
          business: { select: { name: true, address: true, latitude: true, longitude: true } },
          vacancy: { select: { locality: true } },
        },
      }),
    ]);

    const forfeited = ['placed', 'closed', 'deactivated', 'refunded'].includes(seeker.status) || Boolean(refundEndingHit) || Boolean(withdrawn);
    const guaranteeActive = Boolean(paidAt && deadline && now <= deadline && !forfeited);
    let refund: { state: string; dueOn: string | null; paidAt: Date | null; reference: string | null } = { state: 'none', dueOn: null, paidAt: null, reference: null };
    if (refundPayment && !DONE_REFUND_STATUSES.includes(refundPayment.status)) {
      refund = PAID_STATUSES.includes(refundPayment.status)
        ? { state: 'paid', dueOn: null, paidAt: refundPayment.paidAt, reference: refundPayment.bankUtr ?? refundPayment.gatewayReference ?? null }
        : { state: 'with_finance', dueOn: null, paidAt: null, reference: null };
    } else if (refundPayment && refundPayment.status === 'rejected') {
      refund = { state: 'not_owed', dueOn: null, paidAt: null, reference: null };
    } else if (paidAt && forfeited && seeker.status !== 'placed') {
      refund = { state: 'not_owed', dueOn: null, paidAt: null, reference: null };
    } else if (paidAt && deadline && !forfeited && now > deadline) {
      refund = { state: 'due', dueOn: deadline.toISOString().slice(0, 10), paidAt: null, reference: null };
    }

    // The business is named only once the interview is booked and its details
    // were sent (no-bypass rule); an offer waiting for a reply shows the time only.
    const booked = Boolean(interview?.businessDetailsSentAt);
    const interviewOut = interview
      ? {
          state: booked ? 'booked' : 'offered',
          at: interview.slotStartsAt,
          replyBy: interview.status === 'offered' ? interview.replyDueAt : null,
          area: booked ? (interview.vacancy.locality ?? null) : null,
          businessName: booked ? interview.business.name : null,
          address: booked ? interview.business.address : null,
          latitude: booked ? interview.business.latitude : null,
          longitude: booked ? interview.business.longitude : null,
        }
      : null;

    const hits = { count: seeker.hitCount, max: 3 };
    let nextAction = 'none';
    if (status.stopped) nextAction = 'none';
    else if (seeker.status === 'deactivated') nextAction = 'pay_again';
    else if (status.currentStep === 'id_check' && status.steps.selfie && status.idCheck.lastResult === 'none') nextAction = 'open_registration_link';
    else if (status.currentStep !== 'complete') {
      nextAction = status.currentStep === 'payment'
        ? (status.payment.state === 'confirming' ? 'wait_for_payment_confirmation' : 'pay')
        : 'open_registration_link';
    } else if (interviewOut?.state === 'offered') nextAction = 'reply_to_offer';
    else if (interviewOut?.state === 'booked') nextAction = 'go_to_interview';
    else if (guaranteeActive) nextAction = 'wait_for_offer';

    return {
      kind: 'job_seeker',
      profileId: profile.id,
      code: seeker.code,
      firstName: firstName(seeker.name),
      status: seeker.status,
      steps: {
        phone: true,
        profile: true,
        consent: status.steps.consent,
        selfie: status.steps.selfie,
        idCheck: status.steps.idCheck,
        terms: Boolean(status.termsAcceptedAt),
        payment: status.steps.payment,
      },
      currentStep: status.currentStep,
      stopped: status.stopped,
      idCheck: status.idCheck,
      payment: {
        state: status.payment.state,
        amountPaise: status.payment.amountPaise,
        confirmedAt: status.payment.confirmedAt,
      },
      guarantee: {
        active: guaranteeActive,
        day: paidAt && guaranteeActive ? Math.min(policy.jobSeekerGuaranteeDays, Math.floor((now.getTime() - paidAt.getTime()) / DAY_MS) + 1) : null,
        days: policy.jobSeekerGuaranteeDays,
        startedAt: paidAt,
        endsAt: deadline,
      },
      hits,
      interview: interviewOut,
      refund,
      nextAction,
    };
  }

  // ─── Business ─────────────────────────────────────────────────────────

  async businessHome(profile: ScopedProfile) {
    const businessId = profile.businessId!;
    const branchId = profile.branchId;
    const now = this.clock.now();
    const [business, branch, agreement, visit, doneVisit, vacancies, drafts] = await Promise.all([
      this.prisma.business.findUniqueOrThrow({
        where: { id: businessId },
        select: { code: true, name: true, verificationStatus: true, verifiedAt: true, inPersonOnboardedAt: true },
      }),
      branchId ? this.prisma.businessBranch.findUnique({ where: { id: branchId }, select: { name: true } }) : null,
      this.prisma.businessAgreement.findFirst({ where: { businessId }, select: { signedAt: true } }),
      this.prisma.visitAssignment.findFirst({
        where: { businessId, purpose: { in: ['business_signup', 'verification'] }, status: { notIn: ['cancelled'] } },
        orderBy: { createdAt: 'desc' },
        select: { status: true, requestedFor: true, assignedStaff: { select: { name: true } } },
      }),
      this.prisma.businessVisit.findFirst({ where: { businessId }, select: { id: true } }),
      this.prisma.vacancy.findMany({
        where: { businessId, ...(branchId ? { branchId } : {}), status: { notIn: ['cancelled'] } },
        orderBy: { createdAt: 'desc' },
        take: 50,
        select: {
          id: true, code: true, tradeSkill: true, headcount: true, status: true, belowLegalMinimum: true,
          _count: { select: { placements: true } },
          interviews: { where: { status: { in: ['offered', 'confirmed'] }, slotStartsAt: { gte: now } }, select: { id: true } },
        },
      }),
      this.prisma.customerVacancyDraft.findMany({
        where: { businessId, status: 'draft', ...(branchId ? { branchId } : {}) },
        orderBy: { updatedAt: 'desc' },
        select: { id: true, form: true, updatedAt: true },
      }),
    ]);
    const verified = business.verificationStatus === 'verified' || Boolean(business.verifiedAt);
    const visitDone = visit?.status === 'done' || Boolean(doneVisit) || Boolean(business.inPersonOnboardedAt);
    const vacancyRows = vacancies.map((v) => ({
      code: v.code,
      trade: v.tradeSkill,
      headcount: v.headcount,
      status: v.status,
      belowLegalMinimum: v.belowLegalMinimum,
      interviewsUpcoming: v.interviews.length,
      placements: v._count.placements,
    }));
    const nextAction = !agreement
      ? (profile.role === 'owner' && !branchId ? 'sign_agreement' : 'wait_for_approval')
      : !visitDone
        ? 'wait_for_visit'
        : !verified
          ? 'wait_for_approval'
          : vacancyRows.length === 0 ? 'add_vacancy' : 'none';
    return {
      kind: 'business',
      profileId: profile.id,
      code: business.code,
      name: business.name,
      role: profile.role,
      branch: branch ? { name: branch.name } : null,
      verificationStatus: business.verificationStatus ?? 'lead',
      tracker: {
        phoneVerified: true,
        agreement: Boolean(agreement),
        visitBooked: Boolean(visit) || visitDone,
        visitDone,
        approved: verified,
        verified,
      },
      visit: visit
        ? { state: visit.status === 'done' ? 'done' : visit.assignedStaff ? 'booked' : 'requested', requestedFor: visit.requestedFor, agentFirstName: firstName(visit.assignedStaff?.name) }
        : visitDone ? { state: 'done', requestedFor: null, agentFirstName: null } : null,
      vacancies: vacancyRows,
      drafts: drafts.map((d) => ({
        id: d.id,
        trade: typeof (d.form as Record<string, unknown> | null)?.tradeSkill === 'string' ? (d.form as Record<string, string>).tradeSkill : null,
        updatedAt: d.updatedAt,
      })),
      counts: {
        interviewsUpcoming: vacancyRows.reduce((sum, v) => sum + v.interviewsUpcoming, 0),
        placements: vacancyRows.reduce((sum, v) => sum + v.placements, 0),
      },
      nextAction,
    };
  }

  // ─── Referral partner ─────────────────────────────────────────────────

  async referralHome(profile: ScopedProfile) {
    const referralId = profile.referralId!;
    const now = this.clock.now();
    const yearStart = new Date(Date.UTC(now.getUTCMonth() >= 3 ? now.getUTCFullYear() : now.getUTCFullYear() - 1, 3, 1) - 330 * 60_000);
    const [referral, verification, payoutAccount, consent, referred, payouts] = await Promise.all([
      this.prisma.referral.findUniqueOrThrow({
        where: { id: referralId },
        select: { code: true, name: true, pausedAt: true, photoStoragePath: true },
      }),
      this.prisma.referralIdentityVerification.findFirst({ where: { referralId }, orderBy: { createdAt: 'desc' }, select: { status: true } }),
      this.prisma.payoutAccount.findFirst({ where: { ownerType: 'referral', ownerId: referralId }, select: { id: true } }),
      this.prisma.consent.findFirst({ where: { subjectType: 'referral', subjectId: referralId, granted: true, withdrawnAt: null }, select: { id: true } }),
      this.prisma.jobSeeker.findMany({
        where: { referredById: referralId, anonymisedAt: null },
        orderBy: { createdAt: 'desc' },
        take: 200,
        select: {
          name: true, createdAt: true, paymentReceivedAt: true,
          interviews: { where: { status: { in: ['confirmed', 'completed'] } }, select: { slotStartsAt: true }, take: 1 },
          placements: { where: { joinedDate: { not: null } }, select: { joinedDate: true }, take: 1 },
        },
      }),
      this.prisma.payment.findMany({
        where: { referralId, type: 'referral_payout' },
        orderBy: { createdAt: 'desc' },
        select: { amount: true, status: true, createdAt: true, paidAt: true, bankUtr: true, gatewayReference: true },
      }),
    ]);
    const link = publicLink(`/r/${referral.code}`);
    const statement = payouts
      .filter((p) => !['rejected', 'cancelled', 'reversed', 'failed'].includes(p.status))
      .map((p) => ({
        amountPaise: p.amount,
        status: PAID_STATUSES.includes(p.status) ? 'paid' : ['approved', 'processing'].includes(p.status) ? 'approved' : 'due',
        date: p.paidAt ?? p.createdAt,
        upiReference: PAID_STATUSES.includes(p.status) ? (p.bankUtr ?? p.gatewayReference ?? null) : null,
      }));
    const sum = (state: string) => statement.filter((s) => s.status === state).reduce((total, s) => total + s.amountPaise, 0);
    const steps = {
      terms: Boolean(consent),
      selfie: Boolean(referral.photoStoragePath),
      idCheck: verification?.status === 'verified',
      upi: Boolean(payoutAccount),
    };
    const nextAction = !steps.terms || !steps.selfie || !steps.idCheck || !steps.upi ? 'open_registration_link' : 'share_link';
    return {
      kind: 'referral',
      profileId: profile.id,
      code: referral.code,
      firstName: firstName(referral.name),
      paused: Boolean(referral.pausedAt),
      steps,
      share: {
        link,
        qrText: link,
        whatsappText: `Looking for a job in Bengaluru? Register with Laboura using my code ${referral.code}: ${link}`,
      },
      // First name and stage only (decided, question 18): never a phone, surname or workplace.
      referred: referred.map((r) => {
        const joined = r.placements[0]?.joinedDate ?? null;
        const interview = r.interviews[0]?.slotStartsAt ?? null;
        const stage = joined ? 'joined' : interview ? 'interview' : r.paymentReceivedAt ? 'paid' : 'registered';
        return { firstName: firstName(r.name), stage, since: joined ?? interview ?? r.paymentReceivedAt ?? r.createdAt };
      }),
      money: {
        duePaise: sum('due'),
        approvedPaise: sum('approved'),
        paidPaise: sum('paid'),
        yearTotalPaise: statement.filter((s) => s.status === 'paid' && s.date >= yearStart).reduce((t, s) => t + s.amountPaise, 0),
        statement,
      },
      nextAction,
    };
  }
}
