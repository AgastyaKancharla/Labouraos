import { PRODUCT_LANGUAGE } from '../../common/language/english-only';
import { OwnTeam, businessesOwnedBy } from '../../common/rbac/own-team';
import { BadRequestException, ForbiddenException, Injectable, NotFoundException, Optional } from '@nestjs/common';
import { CustomerNotificationHooks } from '../customer-notification/customer-notification-hooks.service';
import { Prisma, Vacancy } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import { OtpService } from '../../common/otp/otp.service';
import { publicPageOtpPurpose } from '../../common/otp/public-page-otp';
import { PublicLinkStoreService } from '../../common/public-link-store.service';
import { PublicOtpLimiter } from '../../common/public-otp-limiter.service';
import { publicPageLink } from '../../common/public-pages';
import { recordStatusChange } from '../../common/status-history/status-history.helper';
import { MessagingService } from '../message/messaging.service';
import { PricingService } from '../pricing/pricing.service';
import { tradeNameKey } from '../trade/trade.service';
import { DEFAULT_MINIMUM_WAGE_ZONE, isMinimumWageZone, legalMinimumFor, MinimumWageLevel, MinimumWageZone } from '../trade/minimum-wage';
import { testModeFields } from '../../common/otp/otp-test-mode';
import { formatINR } from '../../common/money/money';
import { ReviewFlagService } from '../review-flag/review-flag.service';
import { VACANCY_PENDING_TL_CHECK, vacancyCheckReasons } from './vacancy-tl-check';

/** A vacancy may only be matched, introduced or interviewed for once it is `open`. */
export const UNCONFIRMED_VACANCY_STATUSES = ['draft', 'awaiting_confirmation'] as const;
// in_app: the contact person confirmed in the Laboura app with a fresh OTP on their own verified mobile (customer app, C8).
export const VACANCY_CONFIRMATION_METHODS = ['code_on_call', 'code_on_visit', 'sms_link', 'in_app'] as const;
export type VacancyConfirmationMethod = (typeof VACANCY_CONFIRMATION_METHODS)[number];

const LINK_VALID_HOURS = 48;

export interface ConfirmationActor {
  id: string;
  role: string;
}

export interface VacancyContact {
  name: string | null;
  role: string | null;
  phone: string;
  language: string;
  branchId: string | null;
}

export interface LegalMinimumCheck {
  monthlySalaryFromPaise: number;
  legalMinimumPaise: number;
  level: MinimumWageLevel;
  zone: MinimumWageZone;
  below: boolean;
}

/**
 * Where the job is, for the legal minimum (rev 193): the business (its
 * `minimumWageZone`) or a zone already known (a business not saved yet).
 */
export type WagePlace = { businessId: string } | { zone: MinimumWageZone };

export function isUnconfirmedVacancyStatus(status: string | null | undefined): boolean {
  return (UNCONFIRMED_VACANCY_STATUSES as readonly string[]).includes(status ?? '');
}

/** 25 Nov (rev 211, B4): confirmed, but an unusual vacancy waits for the Team Lead before candidates. */
export const VACANCY_WAITS_FOR_TEAM_LEAD_MESSAGE = 'This vacancy waits for the Team Lead’s check (unusual salary or many openings): no candidates until it is approved';

export function isVacancyWaitingForTeamLead(status: string | null | undefined): boolean {
  return status === 'pending_tl_check';
}

function last4(phone: string): string {
  return phone.replace(/\D/g, '').slice(-4);
}

@Injectable()
export class VacancyConfirmationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly otpService: OtpService,
    private readonly publicLinks: PublicLinkStoreService,
    private readonly messagingService: MessagingService,
    private readonly pricingService: PricingService,
    private readonly otpLimiter: PublicOtpLimiter,
    @Optional() private readonly customerNotifications?: CustomerNotificationHooks,
    @Optional() private readonly reviewFlags?: ReviewFlagService,
  ) {}

  /**
   * Compares the vacancy's salary *from* with the legal minimum for the
   * business's zone and the trade's skill level (rev 193). An unlisted trade
   * is checked against the unskilled figure of that zone.
   */
  async checkLegalMinimum(tradeSkill: string, salaryMinPaise: number, salaryPeriod: string | null | undefined, place: WagePlace): Promise<LegalMinimumCheck> {
    const policy = await this.pricingService.current();
    const trade = await this.prisma.trade.findFirst({
      where: { active: true, nameKey: tradeNameKey(tradeSkill) },
      select: { minimumWageLevel: true },
    });
    const level = (trade?.minimumWageLevel ?? 'unskilled') as MinimumWageLevel;
    const zone = await this.zoneOf(place);
    const monthlySalaryFromPaise = salaryPeriod === 'daily'
      ? salaryMinPaise * policy.salaryDaysPerMonth
      : salaryMinPaise;
    const legalMinimumPaise = legalMinimumFor(policy, zone, level);
    return { monthlySalaryFromPaise, legalMinimumPaise, level, zone, below: monthlySalaryFromPaise < legalMinimumPaise };
  }

  private async zoneOf(place: WagePlace): Promise<MinimumWageZone> {
    if ('zone' in place) return isMinimumWageZone(place.zone) ? place.zone : DEFAULT_MINIMUM_WAGE_ZONE;
    const business = await this.prisma.business.findUnique({ where: { id: place.businessId }, select: { minimumWageZone: true } });
    return isMinimumWageZone(business?.minimumWageZone) ? business!.minimumWageZone as MinimumWageZone : DEFAULT_MINIMUM_WAGE_ZONE;
  }

  /** Throws unless an owner-told tick accompanies a below-minimum salary; returns the fields to store. */
  async legalMinimumFields(tradeSkill: string, salaryMinPaise: number, salaryPeriod: string | null | undefined, ownerTold: unknown, place: WagePlace) {
    const check = await this.checkLegalMinimum(tradeSkill, salaryMinPaise, salaryPeriod, place);
    if (check.below && ownerTold !== true) {
      throw new BadRequestException({
        statusCode: 400,
        error: 'Bad Request',
        code: 'MINIMUM_WAGE_TICK_REQUIRED',
        message: 'The salary is below the legal minimum wage. Tell the owner and tick “Owner told about the legal minimum wage” to save.',
        legalMinimumPaise: check.legalMinimumPaise,
        monthlySalaryFromPaise: check.monthlySalaryFromPaise,
        level: check.level,
        zone: check.zone,
      });
    }
    return {
      belowLegalMinimum: check.below,
      ownerToldMinimumWage: check.below ? true : ownerTold === true,
      legalMinimumPaise: check.legalMinimumPaise,
    };
  }

  async contactFor(vacancyId: string): Promise<VacancyContact> {
    const vacancy = await this.prisma.vacancy.findUnique({
      where: { id: vacancyId },
      include: { business: true, branch: true },
    });
    if (!vacancy) throw new NotFoundException(`Vacancy '${vacancyId}' not found`);
    return this.contactOf(vacancy);
  }

  private contactOf(vacancy: Vacancy & {
    business: { phone: string; additionalContactName: string | null; ownerName: string | null; contactRole: string | null; contactLanguage: string | null };
    branch: { id: string; contactPersonName: string; contactPersonRole: string; contactPersonPhone: string; contactLanguage: string | null } | null;
  }): VacancyContact {
    if (vacancy.branch) {
      return {
        name: vacancy.branch.contactPersonName,
        role: vacancy.branch.contactPersonRole,
        phone: vacancy.branch.contactPersonPhone,
        language: PRODUCT_LANGUAGE,
        branchId: vacancy.branch.id,
      };
    }
    return {
      name: vacancy.business.additionalContactName ?? vacancy.business.ownerName,
      role: vacancy.business.contactRole,
      phone: vacancy.business.phone,
      language: PRODUCT_LANGUAGE,
      branchId: null,
    };
  }

  private async loadForConfirmation(vacancyRef: string) {
    const vacancy = await this.prisma.vacancy.findFirst({
      where: vacancyRef.startsWith('VC-') ? { code: vacancyRef } : { id: vacancyRef },
      include: { business: true, branch: true },
    });
    if (!vacancy) throw new NotFoundException(`Vacancy '${vacancyRef}' not found`);
    return vacancy;
  }

  private detailsFor(vacancy: Vacancy & { business: { name: string } }) {
    return {
      business: vacancy.business.name,
      trade: vacancy.tradeSkill,
      headcount: String(vacancy.headcount),
      salaryFromPaise: String(vacancy.salaryMinPaise ?? ''),
      salaryUpToPaise: String(vacancy.salaryMaxPaise ?? ''),
      salaryPeriod: vacancy.salaryPeriod ?? 'monthly',
      shift: vacancy.shift ?? '',
      startDate: vacancy.startDate ? vacancy.startDate.toISOString().slice(0, 10) : '',
    };
  }

  /**
   * The vacancy details a message carries: the raw values (the SMS) plus the
   * WhatsApp text's words (rev 211) — salary in rupees, and no empty value
   * (Meta refuses an empty parameter).
   */
  private messageDetailsFor(vacancy: Vacancy & { business: { name: string } }) {
    const from = vacancy.salaryMinPaise;
    const upTo = vacancy.salaryMaxPaise ?? from;
    const period = vacancy.salaryPeriod === 'daily' ? 'a day' : 'a month';
    const salary = from === null || from === undefined
      ? 'not set'
      : `${formatINR(from)}${upTo !== null && upTo !== undefined && upTo !== from ? `–${formatINR(upTo)}` : ''} ${period}`;
    const details = this.detailsFor(vacancy);
    return { ...details, salary, shift: details.shift || 'any', startDate: details.startDate || 'as soon as possible' };
  }


  /**
   * Sends (or resends) the confirmation code to the business's or branch's contact person, with the vacancy details.
   * Only a vacancy awaiting confirmation can be sent a code.
   */
  async sendCode(vacancyRef: string, actor: ConfirmationActor, otpRequestId?: string, channel?: 'whatsapp' | 'sms') {
    const vacancy = await this.loadForConfirmation(vacancyRef);
    if (vacancy.status !== 'awaiting_confirmation') {
      throw new BadRequestException(`Only a vacancy awaiting confirmation can be sent a code (this one is ${vacancy.status})`);
    }
    const contact = this.contactOf(vacancy);
    // M2: the code confirms this vacancy in its current confirmation round only; editing the
    // vacancy starts a new round, so a code the owner got for the old details stops working.
    const result = await this.otpService.sendBoundOtp(contact.phone, await this.codePurpose(vacancy.id), actor.id, otpRequestId, channel);
    if (!otpRequestId) {
      // WhatsApp first, SMS as backup (rev 211).
      await this.messagingService.sendPreferWhatsApp({
        template: 'vacancy_confirm_details',
        subjectType: 'business',
        subjectId: vacancy.businessId,
        relatedType: 'vacancy',
        relatedId: vacancy.id,
        recipientPhone: contact.phone,
        variables: this.messageDetailsFor(vacancy),
      });
    }
    return {
      otpRequestId: result.requestId,
      sentToLast4: last4(contact.phone),
      contactName: contact.name,
      resendAvailableAt: result.resendAvailableAt,
      resendsLeft: result.resendsLeft,
      ...testModeFields(result),
    };
  }

  /** The agent types the code the contact person reads out on the call or at the visit. */
  async confirmWithCode(
    vacancyRef: string,
    body: { otpRequestId?: string; code?: string; method?: string },
    actor: ConfirmationActor,
  ) {
    const method = body.method ?? 'code_on_call';
    if (method !== 'code_on_call' && method !== 'code_on_visit') {
      throw new BadRequestException('method must be code_on_call or code_on_visit');
    }
    if (!body.otpRequestId || !body.code) throw new BadRequestException('otpRequestId and code are required');
    const vacancy = await this.loadForConfirmation(vacancyRef);
    if (vacancy.status !== 'awaiting_confirmation') {
      throw new BadRequestException(`This vacancy is not awaiting confirmation (it is ${vacancy.status})`);
    }
    const contact = this.contactOf(vacancy);
    // M2-R1: the round the code is checked against; the confirm below holds only if it is still current.
    const round = await this.currentRound(vacancy.id);
    const valid = await this.otpService.verifyOtp(body.otpRequestId, body.code, actor.id);
    if (!valid) throw new BadRequestException('Wrong or expired code');
    if (!(await this.otpService.consumeVerified(body.otpRequestId, contact.phone, await this.codePurpose(vacancy.id, round)))) {
      throw new BadRequestException("This code was not sent to the vacancy's contact person for these details. Send a new code.");
    }
    return this.markConfirmed(vacancy, contact, method, actor.id, undefined, round);
  }

  /**
   * M2: the vacancy's current confirmation round: the id of its latest move to
   * awaiting_confirmation (every details change past the draft writes a new one).
   */
  async currentRound(vacancyId: string, client: Pick<Prisma.TransactionClient, 'statusHistory'> = this.prisma): Promise<string> {
    const round = typeof client.statusHistory?.findFirst === 'function'
      ? await client.statusHistory.findFirst({
        where: { subjectType: 'vacancy', subjectId: vacancyId, toStatus: 'awaiting_confirmation' },
        orderBy: { changedAt: 'desc' },
        select: { id: true },
      })
      : null;
    return round?.id ?? 'first';
  }

  /** M2: the OTP purpose of a confirmation round (by default the current one). */
  async codePurpose(vacancyId: string, round?: string): Promise<string> {
    return `vacancy_confirm:${vacancyId}:${round ?? (await this.currentRound(vacancyId))}`;
  }

  /** M2: after a details change, no earlier link confirms the vacancy (earlier codes die with the round). */
  async revokeLiveConfirmations(vacancyId: string, now: Date = new Date()): Promise<void> {
    await this.publicLinks.revokeActive('vacancy_confirm', 'vacancy', vacancyId, now);
  }

  /** Sends a 48-hour link so the contact person can confirm later; the vacancy stays awaiting confirmation. */
  async sendLink(vacancyRef: string, actor: ConfirmationActor, channel?: 'whatsapp' | 'sms') {
    const vacancy = await this.loadForConfirmation(vacancyRef);
    if (vacancy.status !== 'awaiting_confirmation') {
      throw new BadRequestException(`Only a vacancy awaiting confirmation can be sent a link (this one is ${vacancy.status})`);
    }
    const contact = this.contactOf(vacancy);
    const now = new Date();
    await this.publicLinks.revokeActive('vacancy_confirm', 'vacancy', vacancy.id, now);
    const expiresAt = new Date(now.getTime() + LINK_VALID_HOURS * 60 * 60 * 1000);
    const { token } = await this.publicLinks.create({
      purpose: 'vacancy_confirm',
      subjectType: 'vacancy',
      subjectId: vacancy.id,
      phone: contact.phone,
      language: contact.language,
      expiresAt,
      createdByStaffId: actor.id,
      // M2-R1: the link confirms the details of this round only.
      metadata: { round: await this.currentRound(vacancy.id) },
    });
    // "Send on WhatsApp" (SMS as backup) or "Send by SMS" (rev 211).
    const sent = await this.messagingService.sendOn(channel, {
      template: 'vacancy_confirm_link',
      subjectType: 'business',
      subjectId: vacancy.businessId,
      relatedType: 'vacancy',
      relatedId: vacancy.id,
      recipientPhone: contact.phone,
      // Rev 192 fix S3: the owner's phone page (P07-VacancyConfirm), like the agreement link.
      variables: { link: publicPageLink('vacancyConfirm', token), ...this.messageDetailsFor(vacancy) },
    });
    await this.auditService.log({
      actorId: actor.id,
      action: 'vacancy.confirmation_link_sent',
      entityType: 'vacancy',
      entityCode: vacancy.code,
      after: { expiresAt: expiresAt.toISOString(), sentToLast4: last4(contact.phone) },
      changedFields: ['confirmationLink'],
      city: vacancy.city,
    });
    return { success: true, expiresAt, sentToLast4: last4(contact.phone), sentBy: sent.channel };
  }

  private async requireLink(token: string) {
    const link = await this.publicLinks.findByToken(token);
    if (link.purpose !== 'vacancy_confirm' || link.subjectType !== 'vacancy' || !link.phone) {
      throw new BadRequestException('A valid vacancy confirmation link is required');
    }
    return link;
  }

  /**
   * What the contact person sees when they open the link: the vacancy details only, never personal data.
   * The phone page (P07-VacancyConfirm) shows role, how many people, salary range, shift, start date and
   * the business name, in English (rev 193).
   */
  async linkDetails(token: string) {
    const link = await this.requireLink(token);
    const vacancy = await this.loadForConfirmation(link.subjectId);
    return {
      vacancyCode: vacancy.code,
      status: vacancy.status,
      sentToLast4: last4(link.phone!),
      maskedPhone: `******${last4(link.phone!)}`,
      expiresAt: link.expiresAt,
      preferredLanguage: PRODUCT_LANGUAGE,
      roleTitle: vacancy.roleTitle ?? null,
      headcountCount: vacancy.headcount,
      salaryMinPaise: vacancy.salaryMinPaise ?? null,
      salaryMaxPaise: vacancy.salaryMaxPaise ?? null,
      ...this.detailsFor(vacancy),
    };
  }

  async sendLinkOtp(token: string, otpRequestId?: string, channel?: 'whatsapp' | 'sms') {
    const link = await this.requireLink(token);
    // Every public "Send code" costs an SMS: limited per link and per phone on the server,
    // like the agreement page (rev 192 fix S3).
    await this.otpLimiter.claimSend(this.publicLinks.hashToken(token), link.phone!);
    // AC-3: a code bound to this link (a staff-sent vacancy_confirm code is for the
    // agent's own "code on call" route and never confirms on the owner's page).
    const purpose = publicPageOtpPurpose(token);
    const result = otpRequestId
      ? await this.otpService.getProvider().sendOtp(link.phone!, { purpose, requestId: otpRequestId, ...(channel ? { channel } : {}) })
      : await this.otpService.getProvider().sendOtp(link.phone!, { purpose, ...(channel ? { channel } : {}) });
    return {
      otpRequestId: result.requestId,
      // The phone page's code box reads these two (same answer as the agreement page's send-otp).
      requestId: result.requestId,
      phone: `******${last4(link.phone!)}`,
      sentToLast4: last4(link.phone!),
      resendAvailableAt: result.resendAvailableAt,
      resendsLeft: result.resendsLeft,
      ...testModeFields(result),
    };
  }

  async confirmFromLink(
    token: string,
    body: { otpRequestId?: string; code?: string },
    context: { userAgent?: string; ipHash?: string } = {},
  ) {
    if (!body.otpRequestId || !body.code) throw new BadRequestException('otpRequestId and code are required');
    const link = await this.requireLink(token);
    const vacancy = await this.loadForConfirmation(link.subjectId);
    if (vacancy.status !== 'awaiting_confirmation') {
      throw new BadRequestException(`This vacancy is not awaiting confirmation (it is ${vacancy.status})`);
    }
    // M2-R1: the link confirms the round it was sent for; any change since refuses the confirm.
    const round = (link.metadata as { round?: unknown } | null)?.round;
    if (typeof round !== 'string') {
      throw new BadRequestException('This confirmation link is out of date. Ask Laboura for a new link.');
    }
    const valid = await this.otpService.verifyOtp(body.otpRequestId, body.code);
    if (!valid) throw new BadRequestException('Wrong or expired code');
    if (!(await this.otpService.consumeVerifiedForPage(body.otpRequestId, link.phone!, token))) {
      throw new BadRequestException('This code was not sent to the number this link was sent to');
    }
    await this.publicLinks.markUsed(token, new Date(), context);
    const contact = this.contactOf(vacancy);
    return this.markConfirmed(vacancy, contact, 'sms_link', null, undefined, round);
  }

  /**
   * Customer app (C8): the signed-in contact person confirmed with a fresh OTP on
   * their own verified mobile. The caller checks that the mobile is this
   * vacancy's contact; refused otherwise.
   */
  async confirmInApp(vacancyId: string, verifiedPhone: string, auditActorId: string, expectedUpdatedAt?: Date) {
    const vacancy = await this.prisma.vacancy.findUnique({ where: { id: vacancyId }, include: { business: true, branch: true } });
    if (!vacancy) throw new NotFoundException(`Vacancy '${vacancyId}' not found`);
    // M2-R1: the details the contact person confirmed in the app are the ones just created.
    if (expectedUpdatedAt && vacancy.updatedAt.getTime() !== expectedUpdatedAt.getTime()) {
      throw new BadRequestException('The vacancy details changed. Open it again.');
    }
    const round = await this.currentRound(vacancy.id);
    const contact = this.contactOf(vacancy);
    if (last4(contact.phone) !== last4(verifiedPhone) || contact.phone.replace(/\D/g, '').slice(-10) !== verifiedPhone.replace(/\D/g, '').slice(-10)) {
      throw new ForbiddenException('Only the vacancy contact person can confirm it');
    }
    return this.markConfirmed(vacancy, contact, 'in_app', null, auditActorId, round);
  }

  private async markConfirmed(
    vacancy: Vacancy,
    contact: VacancyContact,
    method: VacancyConfirmationMethod,
    recordedByStaffId: string | null,
    auditActorId: string | undefined,
    expectedRound: string,
  ) {
    const now = new Date();
    // 25 Nov (rev 211, B4): an unusual vacancy (salary far above its trade's usual range, or more
    // than 5 openings) waits for the Team Lead before any candidate is shown; replacements never do.
    const policy = await this.pricingService.current();
    const trade = await this.prisma.trade.findUnique({ where: { nameKey: tradeNameKey(vacancy.tradeSkill) }, select: { salaryMaxPaise: true, active: true } });
    const heldReasons = vacancy.replacementForPlacementId ? [] : vacancyCheckReasons({
      headcount: vacancy.headcount,
      salaryMinPaise: vacancy.salaryMinPaise,
      salaryMaxPaise: vacancy.salaryMaxPaise,
      salaryPeriod: vacancy.salaryPeriod,
      tradeSalaryMaxPaise: trade?.active ? trade.salaryMaxPaise : null,
      salaryDaysPerMonth: policy.salaryDaysPerMonth,
    });
    const held = heldReasons.length > 0;
    const nextStatus = held ? VACANCY_PENDING_TL_CHECK : 'open';
    const confirmed = await this.prisma.$transaction(async (tx) => {
      // M2-R1: lock the row (an edit locks it too), then check that the details are still the
      // ones the code or link was for: same round, unchanged since they were loaded.
      await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "Vacancy" WHERE "id" = ${vacancy.id} FOR UPDATE`);
      if ((await this.currentRound(vacancy.id, tx)) !== expectedRound) {
        throw new BadRequestException('The vacancy details changed after this code or link was sent. Send the owner a new code or link.');
      }
      const changed = await tx.vacancy.updateMany({
        where: { id: vacancy.id, status: 'awaiting_confirmation', updatedAt: vacancy.updatedAt },
        data: {
          status: nextStatus,
          tlCheckReasons: held ? (heldReasons as unknown as Prisma.InputJsonValue) : Prisma.DbNull,
          tlCheckedAt: null,
          tlCheckedByStaffId: null,
          tlCheckDecision: null,
          confirmedAt: now,
          confirmationMethod: method,
          confirmedByName: contact.name,
          confirmedByRole: contact.role,
          confirmedPhoneLast4: last4(contact.phone),
          confirmationRecordedByStaffId: recordedByStaffId,
        },
      });
      if (changed.count !== 1) {
        throw new BadRequestException('This vacancy was already confirmed, or its details changed. Open it again.');
      }
      await recordStatusChange(tx as Prisma.TransactionClient, {
        subjectType: 'vacancy',
        subjectId: vacancy.id,
        fromStatus: 'awaiting_confirmation',
        toStatus: nextStatus,
        changedByStaffId: recordedByStaffId,
        reason: held ? `confirmed_by_contact:${method}; waits for the Team Lead: ${heldReasons.map((r) => r.code).join(', ')}` : `confirmed_by_contact:${method}`,
      });
      return tx.vacancy.findUniqueOrThrow({ where: { id: vacancy.id }, include: { business: true, branch: true } });
    });
    await this.auditService.log({
      actorId: recordedByStaffId ?? auditActorId ?? 'system',
      action: 'vacancy.confirmed',
      entityType: 'vacancy',
      entityCode: vacancy.code,
      before: { status: 'awaiting_confirmation' },
      after: {
        status: nextStatus,
        ...(held ? { tlCheckReasons: heldReasons.map((r) => r.code) } : {}),
        confirmationMethod: method,
        confirmedByRole: contact.role,
        confirmedPhoneLast4: last4(contact.phone),
      },
      changedFields: ['status', 'confirmedAt', 'confirmationMethod'],
      city: vacancy.city,
    });
    if (held) {
      await this.reviewFlags?.raise({
        kind: 'vacancy_tl_check',
        subjectType: 'vacancy',
        subjectId: vacancy.id,
        raisedForStaffId: vacancy.capturedByStaffId ?? confirmed.business.accountAgentId ?? confirmed.business.leadCreatedByStaffId,
        details: { vacancyCode: vacancy.code, businessId: vacancy.businessId, reasons: heldReasons },
      });
    }
    // Customer app notification (Agent C).
    await this.customerNotifications?.vacancyConfirmed(vacancy.id);
    return confirmed;
  }

  /**
   * 25 Nov (rev 211, B4): the Team Lead (of the vacancy's team; the route's vacancy write scope),
   * a Manager or the CEO decides a vacancy held for an unusual salary or many openings:
   * approve → open (candidates can be shown); reject → cancelled, with a reason. Audited.
   */
  async decideTeamLeadCheck(vacancyId: string, actor: ConfirmationActor, decision: 'approve' | 'reject', reason: string | undefined) {
    if (!['team_lead', 'manager', 'ceo'].includes(actor.role)) throw new ForbiddenException('Only a Team Lead, Manager or the CEO checks a vacancy');
    if (decision !== 'approve' && decision !== 'reject') throw new BadRequestException('decision must be approve or reject');
    const trimmed = reason?.trim() ?? '';
    if (decision === 'reject' && !trimmed) throw new BadRequestException('A reason is required to reject a vacancy');
    const vacancy = await this.prisma.vacancy.findUnique({ where: { id: vacancyId } });
    if (!vacancy) throw new NotFoundException(`Vacancy '${vacancyId}' not found`);
    if (vacancy.status !== 'pending_tl_check') throw new BadRequestException('This vacancy is not waiting for the Team Lead’s check');
    const now = new Date();
    const next = decision === 'approve' ? 'open' : 'cancelled';
    await this.prisma.$transaction(async (tx) => {
      const changed = await tx.vacancy.updateMany({
        where: { id: vacancy.id, status: 'pending_tl_check' },
        data: { status: next, tlCheckedAt: now, tlCheckedByStaffId: actor.id, tlCheckDecision: decision },
      });
      if (changed.count !== 1) throw new BadRequestException('This vacancy was already decided');
      await recordStatusChange(tx as Prisma.TransactionClient, {
        subjectType: 'vacancy',
        subjectId: vacancy.id,
        fromStatus: 'pending_tl_check',
        toStatus: next,
        changedByStaffId: actor.id,
        reason: decision === 'approve' ? `Team Lead approved the vacancy check${trimmed ? `: ${trimmed}` : ''}` : `Team Lead rejected the vacancy: ${trimmed}`,
      });
    });
    await this.auditService.log({
      actorId: actor.id,
      action: decision === 'approve' ? 'vacancy.tl_check_approved' : 'vacancy.tl_check_rejected',
      entityType: 'vacancy',
      entityCode: vacancy.code,
      before: { status: 'pending_tl_check' },
      after: { status: next, tlCheckDecision: decision },
      changedFields: ['status', 'tlCheckedAt', 'tlCheckedByStaffId', 'tlCheckDecision'],
      reason: trimmed || 'Vacancy check approved',
      city: vacancy.city,
    });
    const flag = await this.prisma.reviewFlag.findFirst({ where: { kind: 'vacancy_tl_check', subjectType: 'vacancy', subjectId: vacancy.id, status: 'open' }, select: { id: true } });
    if (flag && this.reviewFlags) {
      await this.reviewFlags.resolve(flag.id, actor, { status: 'resolved', resolution: decision === 'approve' ? 'Vacancy approved by the Team Lead' : `Vacancy rejected: ${trimmed}` }, { closedByOwnWork: true });
    }
    return this.prisma.vacancy.findUniqueOrThrow({ where: { id: vacancy.id } });
  }

  /** Below-minimum vacancies for Team Leads (their team's businesses), Managers and the CEO. */
  async belowLegalMinimum(actor: ConfirmationActor) {
    if (!['team_lead', 'manager', 'ceo'].includes(actor.role)) {
      throw new ForbiddenException('Only Team Leads, Managers and the CEO see this list');
    }
    const where: Prisma.VacancyWhereInput = { belowLegalMinimum: true, status: { notIn: ['cancelled'] } };
    if (actor.role === 'team_lead') {
      const teamIds = await new OwnTeam(this.prisma).memberIds(actor.id);
      where.OR = [
        { capturedByStaffId: { in: teamIds } },
        { business: businessesOwnedBy(teamIds) },
      ];
    }
    const rows = await this.prisma.vacancy.findMany({
      where,
      include: { business: { select: { id: true, code: true, name: true } } },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map((row) => ({
      id: row.id,
      code: row.code,
      status: row.status,
      business: row.business,
      tradeSkill: row.tradeSkill,
      salaryMinPaise: row.salaryMinPaise,
      salaryPeriod: row.salaryPeriod,
      legalMinimumPaise: row.legalMinimumPaise,
      ownerToldMinimumWage: row.ownerToldMinimumWage,
      capturedByStaffId: row.capturedByStaffId,
      createdAt: row.createdAt,
    }));
  }
}
