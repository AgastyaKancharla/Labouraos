import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { CustomerAuthClock } from '../../common/customer-auth/customer-auth.clock';
import {
  CUSTOMER_BUSINESS_ROLES,
  CUSTOMER_PROFILE_KINDS,
  CustomerProfileKind,
  HEARD_FROM_LABOURA_APP,
  VISIT_PURPOSE_BUSINESS_SIGNUP,
} from '../../common/customer-auth/customer-app.constants';
import { CUSTOMER_ERROR_CODES, CustomerApiError } from '../../common/customer-auth/customer-auth.errors';
import { sameIndianMobile } from '../../common/phone/indian-mobile';
import { JobSeekerService } from '../job-seeker/job-seeker.service';
import { calculateAge } from '../job-seeker/job-seeker.validator';
import { BusinessService } from '../business/business.service';
import { ReferralService } from '../referral/referral.service';
import { PricingService } from '../pricing/pricing.service';
import { CreateJobSeekerDto } from '../job-seeker/dto/create-job-seeker.dto';
import { CreateBusinessDto } from '../business/dto/create-business.dto';
import { CreateReferralDto } from '../referral/dto/create-referral.dto';
import { CustomerAccountService } from '../customer-account/customer-account.service';
import { CustomerLinkingService } from '../customer-account/customer-linking.service';
import { CustomerSignInService, RequestContext } from '../customer-account/customer-sign-in.service';

type Body = Record<string, unknown>;

const SIGNUP_SOURCES = ['store', 'referral_link', 'ad', 'organic', 'agent_link'] as const;

/** Fields of the agent's job seeker form the app may send (guide, "What is recorded"). */
const JOB_SEEKER_FIELDS = [
  'name', 'messageLanguage', 'bestTimeToCall', 'dateOfBirth', 'gender', 'locality', 'pincode', 'latitude',
  'longitude', 'travelDistanceKm', 'trades', 'availableFrom', 'lookingSince', 'minSalary', 'maxSalary',
  'salaryPeriod', 'shiftPreference', 'jobType', 'spokenLanguages',
] as const;

/** Fields of the agent's business form a business may send about itself (no visit, selfie or branches). */
const BUSINESS_FIELDS = [
  'name', 'legalName', 'ownerName', 'address', 'locality', 'contactPersonName', 'contactPersonRole',
  'contactWhatsAppPhone', 'contactLanguage', 'gstNumber', 'businessType', 'employeeCount', 'employeeCountBand',
  'yearsInOperationBand', 'yearsInOperation', 'hiringFrequency', 'openingTime', 'closingTime', 'workingDays',
  'shopNumber', 'street', 'landmark', 'pincode', 'licenceNumber', 'shopEstablishmentNumber', 'udyamNumber', 'pan',
  'fssaiNumber', 'noDocuments', 'billingName', 'billingAddress', 'billingEmail', 'latitude', 'longitude',
  'staffNeededRows', 'staffNeeded',
] as const;

const REFERRAL_FIELDS = [
  'name', 'type', 'whatsappPhone', 'language', 'individualRole', 'partnerBusinessType', 'partnerBusinessName',
  'locality', 'pincode', 'latitude', 'longitude',
] as const;

function pick(body: Body, fields: readonly string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const field of fields) if (body[field] !== undefined) out[field] = body[field];
  return out;
}

function validation(message: string, extra: Record<string, unknown> = {}): CustomerApiError {
  return new CustomerApiError(HttpStatus.BAD_REQUEST, CUSTOMER_ERROR_CODES.VALIDATION, message, extra);
}

/**
 * The existing services answer in English with a 400 (or a 409 for "Already
 * registered"). The app gets the same message with a code it can act on.
 */
function asCustomerError(error: unknown): unknown {
  if (error instanceof CustomerApiError || !(error instanceof HttpException)) return error;
  const status = error.getStatus();
  const response = error.getResponse();
  const body = typeof response === 'string' ? { message: response } : (response as Record<string, unknown>);
  const message = Array.isArray(body.message) ? body.message.join('; ') : String(body.message ?? error.message);
  const extra: Record<string, unknown> = {};
  for (const key of ['field', 'legalMinimumPaise', 'matchedOn']) if (body[key] !== undefined) extra[key] = body[key];
  if (status === HttpStatus.CONFLICT) {
    return new CustomerApiError(HttpStatus.CONFLICT, CUSTOMER_ERROR_CODES.VALIDATION, message, extra);
  }
  if (status === HttpStatus.BAD_REQUEST || status === HttpStatus.UNPROCESSABLE_ENTITY) {
    return new CustomerApiError(HttpStatus.BAD_REQUEST, CUSTOMER_ERROR_CODES.VALIDATION, message, extra);
  }
  return error;
}

/**
 * Self-registration from the app (customer app proposal 2, 5; C2). Calls the
 * existing job seeker, business and referral services, so every rule of the
 * agent's forms applies: validation, duplicate check, 18+, OTP-verified
 * mobile, minimum wage on vacancies. The mobile is always the signed-in
 * account's verified mobile, never one sent in the body.
 */
@Injectable()
export class CustomerRegistrationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: CustomerAuthClock,
    private readonly pricing: PricingService,
    private readonly jobSeekers: JobSeekerService,
    private readonly businesses: BusinessService,
    private readonly referrals: ReferralService,
    private readonly accounts: CustomerAccountService,
    private readonly linking: CustomerLinkingService,
    private readonly signIn: CustomerSignInService,
  ) {}

  private async verifiedAccount(accountId: string) {
    const account = await this.prisma.customerAccount.findUniqueOrThrow({
      where: { id: accountId },
      select: { id: true, phone: true, phoneVerifiedAt: true, language: true, status: true, contactMeConsent: true },
    });
    if (!account.phone || !account.phoneVerifiedAt) {
      throw new CustomerApiError(HttpStatus.FORBIDDEN, CUSTOMER_ERROR_CODES.PHONE_REQUIRED, 'Verify your mobile number first');
    }
    if (account.status === 'deletion_requested') {
      throw new CustomerApiError(HttpStatus.CONFLICT, CUSTOMER_ERROR_CODES.DELETION_PENDING, 'This account is being deleted');
    }
    return account as typeof account & { phone: string };
  }

  private async existingProfile(accountId: string, kind: CustomerProfileKind) {
    return this.prisma.customerProfile.findFirst({ where: { accountId, kind, status: 'active' }, select: { id: true } });
  }

  private profileExists(profileId: string): CustomerApiError {
    return new CustomerApiError(HttpStatus.CONFLICT, CUSTOMER_ERROR_CODES.PROFILE_EXISTS, 'You already have this profile', { profileId });
  }

  // ─── Sign-up tracker (stage A and B only; the back office owns the rest) ──

  /** POST /me/signups: the role picker and "+ Add another". */
  async startSignup(accountId: string, body: Body) {
    const kind = body?.kind;
    if (typeof kind !== 'string' || !(CUSTOMER_PROFILE_KINDS as readonly string[]).includes(kind)) {
      throw validation('kind must be job_seeker, business or referral', { field: 'kind' });
    }
    const account = await this.verifiedAccount(accountId);
    const existing = await this.existingProfile(accountId, kind as CustomerProfileKind);
    if (existing) throw this.profileExists(existing.id);
    if (typeof body.contactMe === 'boolean') await this.accounts.setContactMe(accountId, body.contactMe);
    const { tracker, created } = await this.ensureTracker(accountId, kind as CustomerProfileKind, {
      source: typeof body.source === 'string' && (SIGNUP_SOURCES as readonly string[]).includes(body.source) ? body.source : null,
      sourceDetail: typeof body.sourceDetail === 'string' ? body.sourceDetail.trim().slice(0, 60) : null,
      referralCode: typeof body.referralCode === 'string' ? body.referralCode.trim().toUpperCase().slice(0, 20) : null,
      language: account.language,
    });
    return { created, body: { signupId: tracker.id, kind, stage: tracker.stage } };
  }

  private async ensureTracker(
    accountId: string,
    kind: CustomerProfileKind,
    extra: { source?: string | null; sourceDetail?: string | null; referralCode?: string | null; language?: string | null } = {},
  ) {
    const open = await this.prisma.signupTracker.findFirst({
      where: { accountId, profileKind: kind, outcome: 'open' },
      orderBy: { createdAt: 'desc' },
      select: { id: true, stage: true },
    });
    if (open) return { tracker: open, created: false };
    const account = await this.prisma.customerAccount.findUniqueOrThrow({ where: { id: accountId }, select: { contactMeConsent: true, language: true } });
    const now = this.clock.now();
    const tracker = await this.prisma.signupTracker.create({
      data: {
        accountId,
        profileKind: kind,
        stage: 'A',
        stageReachedAt: now,
        source: extra.source ?? null,
        sourceDetail: extra.sourceDetail ?? null,
        referralCode: extra.referralCode ?? null,
        language: extra.language ?? account.language,
        contactConsent: account.contactMeConsent,
        lastActivityAt: now,
        events: { create: { kind: 'stage', toStage: 'A', note: 'phone verified, role chosen in the app' } },
      },
      select: { id: true, stage: true },
    });
    return { tracker, created: true };
  }

  /** The record now exists: stage B, linked to it. */
  private async markRegistered(accountId: string, kind: CustomerProfileKind, subjectType: string, subjectId: string) {
    const { tracker } = await this.ensureTracker(accountId, kind);
    const now = this.clock.now();
    await this.prisma.signupTracker.update({
      where: { id: tracker.id },
      data: {
        subjectType,
        subjectId,
        ...(tracker.stage === 'A' ? { stage: 'B', stageReachedAt: now } : {}),
        lastActivityAt: now,
        events: tracker.stage === 'A' ? { create: { kind: 'stage', fromStage: 'A', toStage: 'B', note: 'details filled in the app' } } : undefined,
      },
    });
    return tracker.id;
  }

  private async newProfile(accountId: string, data: { kind: CustomerProfileKind; jobSeekerId?: string; businessId?: string; referralId?: string; role: string }) {
    const profile = await this.prisma.customerProfile.create({
      data: { accountId, linkedVia: 'self_registered', ...data },
      select: { id: true },
    });
    await this.prisma.customerAccount.update({ where: { id: accountId }, data: { lastProfileId: profile.id } });
    return profile.id;
  }

  /** An agent already made this record with my mobile: link it and say so. */
  private async linkExisting(accountId: string, phone: string, kind: CustomerProfileKind): Promise<never | void> {
    await this.linking.linkByVerifiedPhone(accountId, phone);
    const linked = await this.existingProfile(accountId, kind);
    if (linked) throw this.profileExists(linked.id);
  }

  private async resolveReferral(code: unknown, phone: string): Promise<{ id: string; code: string } | null> {
    if (code === undefined || code === null || code === '') return null;
    if (typeof code !== 'string') throw validation('referralCode is not valid', { field: 'referralCode' });
    const referral = await this.prisma.referral.findUnique({
      where: { code: code.trim().toUpperCase() },
      select: { id: true, code: true, phone: true, pausedAt: true, anonymisedAt: true },
    });
    if (!referral || referral.anonymisedAt) throw validation('This referral code is not known', { field: 'referralCode' });
    if (sameIndianMobile(referral.phone, phone)) {
      throw new CustomerApiError(HttpStatus.UNPROCESSABLE_ENTITY, CUSTOMER_ERROR_CODES.REFERRAL_SELF, 'A partner cannot refer themselves');
    }
    if (referral.pausedAt) {
      throw new CustomerApiError(HttpStatus.UNPROCESSABLE_ENTITY, CUSTOMER_ERROR_CODES.REFERRAL_PAUSED, 'This referral code is paused. Continue without it.');
    }
    return { id: referral.id, code: referral.code };
  }

  // ─── Age first ────────────────────────────────────────────────────────

  /** POST /me/register/age-check: under 18 stops here, before anything else is collected. Nothing stored. */
  async ageCheck(body: Body) {
    await this.assertAdult(body?.dateOfBirth);
    return { adult: true };
  }

  private async assertAdult(value: unknown): Promise<void> {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(new Date(`${value}T00:00:00.000Z`).getTime())) {
      throw validation('dateOfBirth must be a date (YYYY-MM-DD)', { field: 'dateOfBirth' });
    }
    const policy = await this.pricing.current();
    if (calculateAge(new Date(`${value}T00:00:00.000Z`), this.clock.now()) < policy.adultMinimumAge) {
      throw new CustomerApiError(HttpStatus.UNPROCESSABLE_ENTITY, CUSTOMER_ERROR_CODES.UNDER_18, `You must be ${policy.adultMinimumAge} or older to register`);
    }
  }

  // ─── Job seeker ───────────────────────────────────────────────────────

  async registerJobSeeker(accountId: string, body: Body, ctx: RequestContext) {
    // Age before any profile data is looked at (data law on minors).
    await this.assertAdult(body?.dateOfBirth);
    const account = await this.verifiedAccount(accountId);
    const existing = await this.existingProfile(accountId, 'job_seeker');
    if (existing) throw this.profileExists(existing.id);
    await this.linkExisting(accountId, account.phone, 'job_seeker');
    const referral = await this.resolveReferral(body.referralCode, account.phone);
    const otp = await this.signIn.checkRegistrationOtp(accountId, body.otp, ctx);
    const heardFrom = referral ? 'referral_partner' : this.heardFrom(body.heardFrom);
    const dto = {
      ...pick(body, JOB_SEEKER_FIELDS),
      phone: account.phone,
      otpRequestId: otp.requestId,
      heardFrom,
      ...(referral ? { referredById: referral.id } : {}),
    } as unknown as CreateJobSeekerDto;
    let created: { id: string; code: string; status: string };
    try {
      created = await this.jobSeekers.create(dto, `customer:${accountId}`, { selfRegisteredByAccountId: accountId });
    } catch (error) {
      throw asCustomerError(error);
    }
    const profileId = await this.newProfile(accountId, { kind: 'job_seeker', jobSeekerId: created.id, role: 'self' });
    await this.markRegistered(accountId, 'job_seeker', 'job_seeker', created.id);
    return { profileId, kind: 'job_seeker', code: created.code, status: created.status, next: 'registration_link' };
  }

  private heardFrom(value: unknown): string {
    return typeof value === 'string' && value.trim() ? value.trim() : HEARD_FROM_LABOURA_APP;
  }

  // ─── Business (a lead) ────────────────────────────────────────────────

  async registerBusiness(accountId: string, body: Body, ctx: RequestContext) {
    const account = await this.verifiedAccount(accountId);
    const existing = await this.existingProfile(accountId, 'business');
    if (existing) throw this.profileExists(existing.id);
    await this.linkExisting(accountId, account.phone, 'business');
    if (body.businessType === 'household') {
      // Households are hidden in the app until the guide decides (C24).
      throw validation('Households cannot register in the app yet', { field: 'businessType' });
    }
    let visitPreferredAt: Date | null = null;
    if (body.visitPreferredAt !== undefined && body.visitPreferredAt !== null) {
      const at = typeof body.visitPreferredAt === 'string' ? new Date(body.visitPreferredAt) : new Date(NaN);
      if (!Number.isFinite(at.getTime()) || at.getTime() < this.clock.now().getTime()) {
        throw validation('visitPreferredAt must be a time in the future', { field: 'visitPreferredAt' });
      }
      visitPreferredAt = at;
    }
    const referralCode = typeof body.referralCode === 'string' && body.referralCode.trim() ? body.referralCode : null;
    if (referralCode) await this.resolveReferral(referralCode, account.phone);
    const otp = await this.signIn.checkRegistrationOtp(accountId, body.otp, ctx);
    const dto = {
      ...pick(body, BUSINESS_FIELDS),
      phone: account.phone,
      otpRequestId: otp.requestId,
      heardFrom: referralCode ? 'referral_partner' : this.heardFrom(body.heardFrom),
      contactLanguage: typeof body.contactLanguage === 'string' ? body.contactLanguage : account.language,
    } as unknown as CreateBusinessDto;
    let created: { id: string; code: string; verificationStatus?: string | null };
    try {
      created = await this.businesses.create(dto, `customer:${accountId}`, { selfRegisteredByAccountId: accountId });
    } catch (error) {
      throw asCustomerError(error);
    }
    if (typeof body.contactMe === 'boolean') await this.accounts.setContactMe(accountId, body.contactMe);
    const role = typeof body.contactPersonRole === 'string' && (CUSTOMER_BUSINESS_ROLES as readonly string[]).includes(body.contactPersonRole)
      ? body.contactPersonRole
      : 'supervisor';
    const profileId = await this.newProfile(accountId, { kind: 'business', businessId: created.id, role });
    const trackerId = await this.markRegistered(accountId, 'business', 'business', created.id);
    if (referralCode) {
      await this.prisma.signupTracker.update({ where: { id: trackerId }, data: { referralCode: referralCode.trim().toUpperCase() } });
    }
    // The verification visit is required anyway (proposal 4.2): the request is
    // made now, with the time the owner picked. The back office suggests and
    // assigns the field agent.
    await this.prisma.visitAssignment.create({
      data: {
        businessId: created.id,
        purpose: VISIT_PURPOSE_BUSINESS_SIGNUP,
        status: 'pending',
        requestedFor: visitPreferredAt,
        signupTrackerId: trackerId,
      },
    });
    await this.prisma.signupTrackerEvent.create({ data: { trackerId, kind: 'visit_request', note: 'business sign-up visit requested' } });
    return { profileId, kind: 'business', code: created.code, verificationStatus: created.verificationStatus ?? 'lead', next: 'agreement' };
  }

  // ─── Referral partner ─────────────────────────────────────────────────

  async registerReferral(accountId: string, body: Body, ctx: RequestContext) {
    const account = await this.verifiedAccount(accountId);
    const existing = await this.existingProfile(accountId, 'referral');
    if (existing) throw this.profileExists(existing.id);
    await this.linkExisting(accountId, account.phone, 'referral');
    const otp = await this.signIn.checkRegistrationOtp(accountId, body.otp, ctx);
    const dto = {
      ...pick(body, REFERRAL_FIELDS),
      phone: account.phone,
      otpRequestId: otp.requestId,
      heardFrom: this.heardFrom(body.heardFrom),
    } as unknown as CreateReferralDto;
    let created: { id: string; code: string };
    try {
      created = await this.referrals.create(dto, `customer:${accountId}`, { selfRegisteredByAccountId: accountId });
    } catch (error) {
      throw asCustomerError(error);
    }
    const profileId = await this.newProfile(accountId, { kind: 'referral', referralId: created.id, role: 'self' });
    await this.markRegistered(accountId, 'referral', 'referral', created.id);
    return { profileId, kind: 'referral', code: created.code, next: 'registration_link' };
  }
}
