import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import { CustomerAuthClock } from '../../common/customer-auth/customer-auth.clock';
import { CustomerScopeService } from '../../common/customer-auth/customer-scope.service';
import { CUSTOMER_ERROR_CODES, CustomerApiError } from '../../common/customer-auth/customer-auth.errors';
import { refundGuaranteeDeadline } from '../../common/money/money';
import { publicPageLink } from '../../common/public-pages';
import { ConsentLinkService } from '../consent/consent-link.service';
import { PricingService } from '../pricing/pricing.service';
import { VacancyService } from '../vacancy/vacancy.service';
import { VacancyConfirmationService } from '../vacancy/vacancy-confirmation.service';
import { CreateVacancyDto } from '../vacancy/dto/create-vacancy.dto';
import { CustomerSignInService } from '../customer-account/customer-sign-in.service';

type Body = Record<string, unknown>;

const CALLBACK_TOPICS = ['signup', 'payment', 'interview', 'refund', 'payout', 'vacancy', 'other'] as const;
const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/;
/** Fields of the agent's vacancy form a business may write in the app. */
const VACANCY_FIELDS = [
  'tradeSkill', 'headcount', 'salaryMinPaise', 'salaryMaxPaise', 'salaryPeriod', 'roleTitle', 'description', 'extras',
  'workingHours', 'shift', 'weeklyOff', 'experienceRequiredYears', 'educationRequired', 'languagesRequired',
  'licencesRequired', 'ageMin', 'ageMax', 'genderRequirement', 'genderReason', 'startDate', 'urgency', 'probationDays',
  'interviewType', 'walkInDate', 'interviewSlots', 'interviewContactName', 'branchId',
] as const;
const ACTIVE_JOB_SEEKER_STATUSES_ENDED = ['placed', 'closed', 'deactivated', 'refunded'];

function validation(message: string, extra: Record<string, unknown> = {}): CustomerApiError {
  return new CustomerApiError(HttpStatus.BAD_REQUEST, CUSTOMER_ERROR_CODES.VALIDATION, message, extra);
}

function minutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return h! * 60 + m!;
}

/**
 * Link issuing for the secure browser sheet, vacancy drafts, call-me-back and
 * delete-my-account (docs/customer-app-api.md §6, §8, §10, §11). Every action is
 * on the caller's own profile, found through CustomerScopeService.
 */
@Injectable()
export class CustomerRequestsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: CustomerAuthClock,
    private readonly scope: CustomerScopeService,
    private readonly consentLinks: ConsentLinkService,
    private readonly pricing: PricingService,
    private readonly vacancies: VacancyService,
    private readonly vacancyConfirmation: VacancyConfirmationService,
    private readonly signIn: CustomerSignInService,
    private readonly audit: AuditService,
  ) {}

  // ─── Links ────────────────────────────────────────────────────────────

  async issueLink(accountId: string, profileId: string, body: Body) {
    const profile = await this.scope.profile(accountId, profileId);
    const account = await this.prisma.customerAccount.findUniqueOrThrow({ where: { id: accountId }, select: { language: true } });
    const issuedTo = `customer:${accountId}`;
    const purpose = body?.purpose;
    if (purpose === 'registration') {
      if (profile.kind !== 'job_seeker') throw this.kindMismatch('job_seeker');
      const link = await this.consentLinks.createLink(profile.jobSeekerId!, { sms: false, issuedTo });
      return { url: publicPageLink('registration', link.token), purpose, expiresAt: link.expiresAt };
    }
    if (purpose === 'referral_registration') {
      if (profile.kind !== 'referral') throw this.kindMismatch('referral');
      const link = await this.consentLinks.createReferralTermsLink(profile.referralId!, null, account.language, { sms: false, issuedTo });
      return { url: publicPageLink('referralRegistration', link.token), purpose, expiresAt: link.expiresAt };
    }
    if (purpose === 'business_agreement') {
      if (profile.kind !== 'business') throw this.kindMismatch('business');
      this.scope.assertBusinessOwner(profile);
      const link = await this.consentLinks.createAgreementLink(profile.businessId!, null, account.language, { sms: false, issuedTo });
      return { url: publicPageLink('businessAgreement', link.token), purpose, expiresAt: link.expiresAt };
    }
    throw validation('purpose must be registration, referral_registration or business_agreement', { field: 'purpose' });
  }

  private kindMismatch(kind: string): CustomerApiError {
    return new CustomerApiError(HttpStatus.BAD_REQUEST, CUSTOMER_ERROR_CODES.PROFILE_KIND_MISMATCH, `This is for a ${kind} profile`);
  }

  // ─── Call me back ─────────────────────────────────────────────────────

  async requestCallback(accountId: string, body: Body) {
    const topic = body?.topic;
    if (typeof topic !== 'string' || !(CALLBACK_TOPICS as readonly string[]).includes(topic)) {
      throw validation(`topic must be one of ${CALLBACK_TOPICS.join(', ')}`, { field: 'topic' });
    }
    let profileId: string | null = null;
    if (body.profileId !== undefined && body.profileId !== null) {
      profileId = (await this.scope.profile(accountId, String(body.profileId))).id;
    }
    const note = typeof body.note === 'string' && body.note.trim() ? body.note.trim() : null;
    if (note && note.length > 200) throw validation('note is too long (200 characters at most)', { field: 'note' });
    // No ID numbers in a free-text note (never a raw Aadhaar).
    if (note && /\d{9,}/.test(note.replace(/[\s-]/g, ''))) throw validation('Do not write ID or phone numbers in the note', { field: 'note' });
    const from = body.preferredFrom ?? null;
    const to = body.preferredTo ?? null;
    for (const [field, value] of [['preferredFrom', from], ['preferredTo', to]] as const) {
      if (value !== null && (typeof value !== 'string' || !HHMM.test(value) || minutes(value) < 9 * 60 || minutes(value) > 21 * 60)) {
        throw validation(`${field} must be a time between 09:00 and 21:00`, { field });
      }
    }
    if (typeof from === 'string' && typeof to === 'string' && minutes(from) >= minutes(to)) {
      throw validation('preferredFrom must be before preferredTo', { field: 'preferredFrom' });
    }
    const open = await this.prisma.customerCallbackRequest.findFirst({
      where: { accountId, status: { in: ['open', 'assigned'] } },
      select: { id: true, status: true, createdAt: true },
    });
    if (open) return { created: false, body: open };
    const created = await this.prisma.customerCallbackRequest.create({
      data: { accountId, profileId, topic, note, preferredFrom: from as string | null, preferredTo: to as string | null },
      select: { id: true, status: true, createdAt: true },
    });
    return { created: true, body: created };
  }

  async listCallbacks(accountId: string) {
    return this.prisma.customerCallbackRequest.findMany({
      where: { accountId },
      orderBy: { createdAt: 'desc' },
      take: 10,
      select: { id: true, topic: true, status: true, preferredFrom: true, preferredTo: true, createdAt: true, doneAt: true },
    });
  }

  // ─── Delete my account ────────────────────────────────────────────────

  /** True while a linked job seeker's 30-day guarantee is running (deleting ends the refund). */
  private async guaranteeRunning(accountId: string): Promise<boolean> {
    const profiles = await this.prisma.customerProfile.findMany({
      where: { accountId, status: 'active', kind: 'job_seeker' },
      select: { jobSeeker: { select: { paymentReceivedAt: true, status: true } } },
    });
    const policy = await this.pricing.current();
    const now = this.clock.now();
    return profiles.some(({ jobSeeker }) => {
      if (!jobSeeker?.paymentReceivedAt || ACTIVE_JOB_SEEKER_STATUSES_ENDED.includes(jobSeeker.status)) return false;
      return now.getTime() <= refundGuaranteeDeadline(jobSeeker.paymentReceivedAt, policy.jobSeekerGuaranteeDays).getTime();
    });
  }

  async deletionInfo(accountId: string) {
    const running = await this.guaranteeRunning(accountId);
    const open = await this.prisma.customerDeletionRequest.findFirst({
      where: { accountId, status: { in: ['requested', 'in_progress'] } },
      select: { id: true, status: true, createdAt: true },
    });
    return { guaranteeRunning: running, endsRefund: running, keptByLaw: ['payments', 'invoices', 'refunds', 'payouts'], openRequest: open };
  }

  async requestDeletion(accountId: string, sessionId: string, body: Body) {
    const open = await this.prisma.customerDeletionRequest.findFirst({
      where: { accountId, status: { in: ['requested', 'in_progress'] } },
      select: { id: true },
    });
    if (open) throw new CustomerApiError(HttpStatus.CONFLICT, CUSTOMER_ERROR_CODES.DELETION_PENDING, 'A deletion request is already open', { id: open.id });
    const running = await this.guaranteeRunning(accountId);
    const acknowledged = body?.refundLossAcknowledged === true;
    // The warning comes before the code is used up, so a person who changes their mind keeps nothing half done.
    if (running && !acknowledged) {
      throw new CustomerApiError(HttpStatus.CONFLICT, CUSTOMER_ERROR_CODES.GUARANTEE_WARNING_REQUIRED, 'Deleting your account now ends your ₹499 refund guarantee');
    }
    const reason = typeof body?.reason === 'string' && body.reason.trim() ? body.reason.trim().slice(0, 300) : null;
    await this.signIn.consumeStepUp(sessionId, 'delete_account');
    const now = this.clock.now();
    const created = await this.prisma.$transaction(async (tx) => {
      const request = await tx.customerDeletionRequest.create({
        data: { accountId, reason, guaranteeRunning: running, refundLossAcknowledged: running && acknowledged, otpVerifiedAt: now },
        select: { id: true, status: true, createdAt: true },
      });
      await tx.customerAccount.update({ where: { id: accountId }, data: { status: 'deletion_requested' } });
      // Other phones are signed out; this one stays so the person can see the request.
      await tx.customerSession.updateMany({
        where: { accountId, revokedAt: null, id: { not: sessionId } },
        data: { revokedAt: now, endedReason: 'deleted' },
      });
      return request;
    });
    await this.audit.log({
      actorId: `customer:${accountId}`, action: 'customer.deletion_requested', entityType: 'customer_account', entityCode: accountId,
      after: { guaranteeRunning: running, refundLossAcknowledged: running && acknowledged },
    });
    return created;
  }

  // ─── Vacancy drafts (business) ────────────────────────────────────────

  private async businessProfile(accountId: string, profileId: string) {
    return this.scope.profile(accountId, profileId, 'business');
  }

  private draftForm(profile: { branchId: string | null; businessId: string | null }, raw: unknown): Record<string, unknown> {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw validation('form is required', { field: 'form' });
    const form: Record<string, unknown> = {};
    for (const field of VACANCY_FIELDS) {
      const value = (raw as Record<string, unknown>)[field];
      if (value !== undefined) form[field] = value;
    }
    if (profile.branchId) form.branchId = profile.branchId;
    if (JSON.stringify(form).length > 20_000) throw validation('form is too large', { field: 'form' });
    return form;
  }

  private async assertBranch(profile: { businessId: string | null }, form: Record<string, unknown>) {
    if (form.branchId === undefined || form.branchId === null) return;
    const branch = typeof form.branchId === 'string'
      ? await this.prisma.businessBranch.findFirst({ where: { id: form.branchId, businessId: profile.businessId! }, select: { id: true } })
      : null;
    if (!branch) throw validation('branchId must be a branch of this business', { field: 'branchId' });
  }

  private async warnings(form: Record<string, unknown>) {
    if (typeof form.tradeSkill !== 'string' || typeof form.salaryMinPaise !== 'number') return { belowLegalMinimum: false, legalMinimumPaise: null };
    const check = await this.vacancyConfirmation.checkLegalMinimum(form.tradeSkill, form.salaryMinPaise, typeof form.salaryPeriod === 'string' ? form.salaryPeriod : null);
    return { belowLegalMinimum: check.below, legalMinimumPaise: check.legalMinimumPaise };
  }

  async createDraft(accountId: string, profileId: string, body: Body) {
    const profile = await this.businessProfile(accountId, profileId);
    const form = this.draftForm(profile, body?.form);
    await this.assertBranch(profile, form);
    const draft = await this.prisma.customerVacancyDraft.create({
      data: { accountId, profileId: profile.id, businessId: profile.businessId!, branchId: (form.branchId as string | undefined) ?? null, form: form as Prisma.InputJsonValue },
      select: { id: true, status: true, form: true, updatedAt: true },
    });
    return { ...draft, warnings: await this.warnings(form) };
  }

  private async ownDraft(accountId: string, profileId: string, draftId: string) {
    const profile = await this.businessProfile(accountId, profileId);
    const draft = typeof draftId === 'string' && draftId.length <= 64
      ? await this.prisma.customerVacancyDraft.findFirst({
          where: { id: draftId, businessId: profile.businessId!, status: 'draft', ...(profile.branchId ? { branchId: profile.branchId } : {}) },
        })
      : null;
    if (!draft) throw new CustomerApiError(HttpStatus.NOT_FOUND, CUSTOMER_ERROR_CODES.PROFILE_NOT_FOUND, 'Draft not found');
    return { profile, draft };
  }

  async updateDraft(accountId: string, profileId: string, draftId: string, body: Body) {
    const { profile, draft } = await this.ownDraft(accountId, profileId, draftId);
    const form = this.draftForm(profile, body?.form);
    await this.assertBranch(profile, form);
    const updated = await this.prisma.customerVacancyDraft.update({
      where: { id: draft.id },
      data: { form: form as Prisma.InputJsonValue, branchId: (form.branchId as string | undefined) ?? null },
      select: { id: true, status: true, form: true, updatedAt: true },
    });
    return { ...updated, warnings: await this.warnings(form) };
  }

  async discardDraft(accountId: string, profileId: string, draftId: string): Promise<void> {
    const { draft } = await this.ownDraft(accountId, profileId, draftId);
    await this.prisma.customerVacancyDraft.update({ where: { id: draft.id }, data: { status: 'discarded' } });
  }

  async confirmDraft(accountId: string, sessionId: string, profileId: string, draftId: string, body: Body) {
    const { draft } = await this.ownDraft(accountId, profileId, draftId);
    const form = draft.form as Record<string, unknown>;
    const warnings = await this.warnings(form);
    if (warnings.belowLegalMinimum && body?.ownerToldMinimumWage !== true) {
      throw new CustomerApiError(HttpStatus.CONFLICT, CUSTOMER_ERROR_CODES.BELOW_MINIMUM_WAGE_TICK_REQUIRED,
        'The salary is below the legal minimum wage. Tick that you know the legal minimum wage to post it.', { legalMinimumPaise: warnings.legalMinimumPaise });
    }
    const account = await this.prisma.customerAccount.findUniqueOrThrow({ where: { id: accountId }, select: { phone: true } });
    const contactPhone = draft.branchId
      ? (await this.prisma.businessBranch.findUniqueOrThrow({ where: { id: draft.branchId }, select: { contactPersonPhone: true } })).contactPersonPhone
      : (await this.prisma.business.findUniqueOrThrow({ where: { id: draft.businessId }, select: { phone: true } })).phone;
    if (!account.phone || account.phone.slice(-10) !== contactPhone.replace(/\D/g, '').slice(-10)) {
      // The OTP proof is the contact person's phone (C8): only they confirm.
      throw new CustomerApiError(HttpStatus.FORBIDDEN, CUSTOMER_ERROR_CODES.NOT_ALLOWED, 'Only the contact person for this vacancy can post it');
    }
    await this.signIn.consumeStepUp(sessionId, 'confirm_vacancy');
    let vacancy: { id: string; code: string };
    try {
      vacancy = await this.vacancies.create(
        draft.businessId,
        { ...form, ownerToldMinimumWage: body?.ownerToldMinimumWage === true } as unknown as CreateVacancyDto,
        `customer:${accountId}`,
        { selfRegisteredByAccountId: accountId },
      );
    } catch (error) {
      if (error instanceof HttpException && error.getStatus() === HttpStatus.BAD_REQUEST) {
        const response = error.getResponse();
        const message = typeof response === 'string' ? response : String((response as { message?: unknown }).message ?? error.message);
        throw validation(message);
      }
      throw error;
    }
    const confirmed = await this.vacancyConfirmation.confirmInApp(vacancy.id, account.phone);
    await this.prisma.customerVacancyDraft.update({ where: { id: draft.id }, data: { status: 'confirmed', vacancyId: vacancy.id, confirmedAt: this.clock.now() } });
    return { vacancy: { code: confirmed.code, status: confirmed.status } };
  }
}
