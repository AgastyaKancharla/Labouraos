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
import { CustomerHomeService } from './customer-home.service';

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
/** Open vacancy drafts one account may keep. */
export const MAX_OPEN_DRAFTS = 20;
/** Links issued to the app per profile per hour. */
export const MAX_LINKS_PER_HOUR = 10;

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
    private readonly homes: CustomerHomeService,
  ) {}

  /** An account being deleted can only look, cancel the deletion or sign out (security review M4). */
  private async assertNotDeleting(accountId: string): Promise<void> {
    const account = await this.prisma.customerAccount.findUniqueOrThrow({ where: { id: accountId }, select: { status: true } });
    if (account.status === 'deletion_requested') {
      throw new CustomerApiError(HttpStatus.CONFLICT, CUSTOMER_ERROR_CODES.DELETION_PENDING, 'This account is being deleted. Cancel the deletion first.');
    }
  }

  // ─── Links ────────────────────────────────────────────────────────────

  async issueLink(accountId: string, profileId: string, body: Body) {
    await this.assertNotDeleting(accountId);
    const profile = await this.scope.profile(accountId, profileId);
    const subjectId = profile.jobSeekerId ?? profile.referralId ?? profile.businessId!;
    const recent = await this.prisma.publicLink.count({
      where: { subjectId, createdAt: { gt: new Date(this.clock.now().getTime() - 60 * 60 * 1000) }, metadata: { path: ['issuedTo'], equals: `customer:${accountId}` } },
    });
    if (recent >= MAX_LINKS_PER_HOUR) {
      throw new CustomerApiError(HttpStatus.TOO_MANY_REQUESTS, CUSTOMER_ERROR_CODES.LIMIT_REACHED, 'Too many links in an hour. Try again later.');
    }
    const account = await this.prisma.customerAccount.findUniqueOrThrow({ where: { id: accountId }, select: { language: true } });
    const issuedTo = `customer:${accountId}`;
    const purpose = body?.purpose;
    if (purpose === 'registration') {
      if (profile.kind !== 'job_seeker') throw this.kindMismatch('job_seeker');
      const link = await this.consentLinks.createLink(profile.jobSeekerId!, { sms: false, issuedTo, revokeOthers: false });
      return { url: publicPageLink('registration', link.token), purpose, expiresAt: link.expiresAt };
    }
    if (purpose === 'referral_registration') {
      if (profile.kind !== 'referral') throw this.kindMismatch('referral');
      const link = await this.consentLinks.createReferralTermsLink(profile.referralId!, null, account.language, { sms: false, issuedTo, revokeOthers: false });
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

  /** A refund owed and not yet paid on one of my job seeker profiles: it is still paid, then the deletion completes. */
  private async refundOwed(accountId: string): Promise<boolean> {
    const profiles = await this.prisma.customerProfile.findMany({
      where: { accountId, status: 'active', kind: 'job_seeker' },
      select: { id: true, accountId: true, kind: true, role: true, jobSeekerId: true, businessId: true, branchId: true, referralId: true },
    });
    for (const profile of profiles) {
      const home = await this.homes.jobSeekerHome(profile as Parameters<CustomerHomeService['jobSeekerHome']>[0]);
      if (home.refund.state === 'due' || home.refund.state === 'with_finance') return true;
    }
    return false;
  }

  async deletionInfo(accountId: string) {
    const [running, owed, account, open] = await Promise.all([
      this.guaranteeRunning(accountId),
      this.refundOwed(accountId),
      this.prisma.customerAccount.findUniqueOrThrow({ where: { id: accountId }, select: { phone: true, phoneVerifiedAt: true, identities: { select: { provider: true } } } }),
      this.prisma.customerDeletionRequest.findFirst({
        where: { accountId, status: { in: ['requested', 'in_progress'] } },
        select: { id: true, status: true, createdAt: true },
      }),
    ]);
    const proof = account.phone && account.phoneVerifiedAt ? 'otp' : account.identities.some((i) => i.provider === 'apple') && !account.identities.some((i) => i.provider === 'google') ? 'apple' : 'google';
    return {
      guaranteeRunning: running,
      endsRefund: running,
      refundOwed: owed,
      // An owed refund is still paid; the account is deleted only after it is paid (rule for now, the owner may change it).
      completesAfterRefund: owed,
      warningRequired: running || owed,
      proof,
      keptByLaw: ['payments', 'invoices', 'refunds', 'payouts'],
      openRequest: open,
    };
  }

  async requestDeletion(accountId: string, sessionId: string, body: Body) {
    const open = await this.prisma.customerDeletionRequest.findFirst({
      where: { accountId, status: { in: ['requested', 'in_progress'] } },
      select: { id: true },
    });
    if (open) throw new CustomerApiError(HttpStatus.CONFLICT, CUSTOMER_ERROR_CODES.DELETION_PENDING, 'A deletion request is already open', { id: open.id });
    const info = await this.deletionInfo(accountId);
    const acknowledged = body?.refundLossAcknowledged === true;
    // The warning comes before the proof is used up, so a person who changes their mind keeps nothing half done.
    if (info.warningRequired && !acknowledged) {
      throw new CustomerApiError(HttpStatus.CONFLICT, CUSTOMER_ERROR_CODES.GUARANTEE_WARNING_REQUIRED,
        info.guaranteeRunning
          ? 'Deleting your account now ends your ₹499 refund guarantee'
          : 'Your refund is still owed: it will be paid first, and your account is deleted after it is paid',
        { guaranteeRunning: info.guaranteeRunning, refundOwed: info.refundOwed });
    }
    const reason = typeof body?.reason === 'string' && body.reason.trim() ? body.reason.trim().slice(0, 300) : null;
    let proof: string = 'otp';
    if (info.proof === 'otp') {
      await this.signIn.consumeStepUp(sessionId, 'delete_account');
    } else {
      // A Google- or Apple-only account has no mobile to send a code to: a fresh sign-in is the proof.
      proof = await this.signIn.assertFreshExternalProof(accountId, (body?.proof ?? {}) as { provider?: unknown; idToken?: unknown; nonce?: unknown });
    }
    const now = this.clock.now();
    const created = await this.prisma.$transaction(async (tx) => {
      const request = await tx.customerDeletionRequest.create({
        data: {
          accountId, reason, proof,
          guaranteeRunning: info.guaranteeRunning,
          refundOwedAtRequest: info.refundOwed,
          refundLossAcknowledged: info.warningRequired && acknowledged,
          otpVerifiedAt: now,
        },
        select: { id: true, status: true, createdAt: true },
      });
      await tx.customerAccount.update({ where: { id: accountId }, data: { status: 'deletion_requested' } });
      // Other phones are signed out; this one stays signed in so the person can see or cancel the request.
      await tx.customerSession.updateMany({ where: { accountId, revokedAt: null, id: { not: sessionId } }, data: { revokedAt: now, endedReason: 'deleted' } });
      // No phone of an account being deleted keeps a push token, this one included (owner rule;
      // notification privacy review H2). Cancelling the deletion lets the app save it again.
      await tx.customerDevice.updateMany({ where: { accountId, pushToken: { not: null } }, data: { pushToken: null, pushTokenUpdatedAt: now } });
      return request;
    });
    await this.audit.log({
      actorId: `customer:${accountId}`, action: 'customer.deletion_requested', entityType: 'customer_account', entityCode: accountId,
      after: { guaranteeRunning: info.guaranteeRunning, refundOwed: info.refundOwed, proof },
    });
    return { ...created, completesAfterRefund: info.refundOwed };
  }

  /** POST /me/deletion/cancel: before the back office has started on it. */
  async cancelDeletion(accountId: string) {
    const open = await this.prisma.customerDeletionRequest.findFirst({
      where: { accountId, status: 'requested' },
      select: { id: true },
    });
    if (!open) {
      throw new CustomerApiError(HttpStatus.CONFLICT, CUSTOMER_ERROR_CODES.NOT_ALLOWED, 'There is no deletion request that can still be cancelled');
    }
    const now = this.clock.now();
    await this.prisma.$transaction([
      this.prisma.customerDeletionRequest.update({ where: { id: open.id }, data: { status: 'cancelled', cancelledAt: now } }),
      this.prisma.customerAccount.update({ where: { id: accountId }, data: { status: 'active' } }),
    ]);
    await this.audit.log({ actorId: `customer:${accountId}`, action: 'customer.deletion_cancelled', entityType: 'customer_account', entityCode: accountId });
    return { id: open.id, status: 'cancelled' };
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
    await this.assertNotDeleting(accountId);
    const profile = await this.businessProfile(accountId, profileId);
    const open = await this.prisma.customerVacancyDraft.count({ where: { accountId, status: 'draft' } });
    if (open >= MAX_OPEN_DRAFTS) {
      throw new CustomerApiError(HttpStatus.CONFLICT, CUSTOMER_ERROR_CODES.LIMIT_REACHED, `At most ${MAX_OPEN_DRAFTS} vacancy drafts at a time. Post or delete one first.`);
    }
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
    await this.assertNotDeleting(accountId);
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
    await this.assertNotDeleting(accountId);
    const { draft } = await this.ownDraft(accountId, profileId, draftId);
    const form = draft.form as Record<string, unknown>;
    const dto = { ...form, ownerToldMinimumWage: body?.ownerToldMinimumWage === true } as unknown as CreateVacancyDto;
    // Everything that can be checked is checked before the fresh code is used up.
    try {
      this.vacancies.validateCreateInput(dto);
    } catch (error) {
      throw this.asValidation(error);
    }
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
    // One confirmation per draft, even with two taps at once.
    const claimed = await this.prisma.customerVacancyDraft.updateMany({ where: { id: draft.id, status: 'draft' }, data: { status: 'confirming' } });
    if (claimed.count !== 1) throw new CustomerApiError(HttpStatus.CONFLICT, CUSTOMER_ERROR_CODES.VALIDATION, 'This draft is already being posted');
    let vacancyId: string | null = null;
    try {
      await this.signIn.consumeStepUp(sessionId, 'confirm_vacancy');
      const vacancy = await this.vacancies.create(draft.businessId, dto, `customer:${accountId}`, { selfRegisteredByAccountId: accountId });
      vacancyId = vacancy.id;
      const confirmed = await this.vacancyConfirmation.confirmInApp(vacancy.id, account.phone, `customer:${accountId}`, vacancy.updatedAt);
      await this.prisma.customerVacancyDraft.update({ where: { id: draft.id }, data: { status: 'confirmed', vacancyId: vacancy.id, confirmedAt: this.clock.now() } });
      return { vacancy: { code: confirmed.code, status: confirmed.status } };
    } catch (error) {
      // Undo: a vacancy that was created but not confirmed is cancelled, and the draft is a draft again.
      if (vacancyId) {
        await this.prisma.vacancy.updateMany({ where: { id: vacancyId, status: 'awaiting_confirmation' }, data: { status: 'cancelled' } });
      }
      await this.prisma.customerVacancyDraft.updateMany({ where: { id: draft.id, status: 'confirming' }, data: { status: 'draft' } });
      throw this.asValidation(error);
    }
  }

  private asValidation(error: unknown): unknown {
    if (error instanceof HttpException && error.getStatus() === HttpStatus.BAD_REQUEST && !(error instanceof CustomerApiError)) {
      const response = error.getResponse();
      const message = typeof response === 'string' ? response : String((response as { message?: unknown }).message ?? error.message);
      return validation(message);
    }
    return error;
  }
}
