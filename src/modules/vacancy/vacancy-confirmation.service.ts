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
import { MinimumWageLevel, tradeNameKey } from '../trade/trade.service';
import { testModeFields } from '../../common/otp/otp-test-mode';

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
  below: boolean;
}

export function isUnconfirmedVacancyStatus(status: string | null | undefined): boolean {
  return (UNCONFIRMED_VACANCY_STATUSES as readonly string[]).includes(status ?? '');
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
  ) {}

  /**
   * Compares the vacancy's salary *from* with the legal minimum for the trade's level.
   * An unlisted trade is checked against the unskilled minimum (the lowest figure).
   */
  async checkLegalMinimum(tradeSkill: string, salaryMinPaise: number, salaryPeriod: string | null | undefined): Promise<LegalMinimumCheck> {
    const policy = await this.pricingService.current();
    const trade = await this.prisma.trade.findFirst({
      where: { active: true, nameKey: tradeNameKey(tradeSkill) },
      select: { minimumWageLevel: true },
    });
    const level = (trade?.minimumWageLevel ?? 'unskilled') as MinimumWageLevel;
    const wages: Record<MinimumWageLevel, number> = {
      unskilled: policy.legalMinimumWageUnskilledPaise,
      semi_skilled: policy.legalMinimumWageSemiSkilledPaise,
      skilled: policy.legalMinimumWageSkilledPaise,
      highly_skilled: policy.legalMinimumWageHighlySkilledPaise,
    };
    const monthlySalaryFromPaise = salaryPeriod === 'daily'
      ? salaryMinPaise * policy.salaryDaysPerMonth
      : salaryMinPaise;
    const legalMinimumPaise = wages[level];
    return { monthlySalaryFromPaise, legalMinimumPaise, level, below: monthlySalaryFromPaise < legalMinimumPaise };
  }

  /** Throws unless an owner-told tick accompanies a below-minimum salary; returns the fields to store. */
  async legalMinimumFields(tradeSkill: string, salaryMinPaise: number, salaryPeriod: string | null | undefined, ownerTold: unknown) {
    const check = await this.checkLegalMinimum(tradeSkill, salaryMinPaise, salaryPeriod);
    if (check.below && ownerTold !== true) {
      throw new BadRequestException({
        statusCode: 400,
        error: 'Bad Request',
        code: 'MINIMUM_WAGE_TICK_REQUIRED',
        message: 'The salary is below the legal minimum wage. Tell the owner and tick ownerToldMinimumWage to save.',
        legalMinimumPaise: check.legalMinimumPaise,
        monthlySalaryFromPaise: check.monthlySalaryFromPaise,
        level: check.level,
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
        language: vacancy.branch.contactLanguage ?? vacancy.business.contactLanguage ?? 'en',
        branchId: vacancy.branch.id,
      };
    }
    return {
      name: vacancy.business.additionalContactName ?? vacancy.business.ownerName,
      role: vacancy.business.contactRole,
      phone: vacancy.business.phone,
      language: vacancy.business.contactLanguage ?? 'en',
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
   * Sends (or resends) the confirmation code to the business's or branch's contact person, with the vacancy details.
   * Only a vacancy awaiting confirmation can be sent a code.
   */
  async sendCode(vacancyRef: string, actor: ConfirmationActor, otpRequestId?: string) {
    const vacancy = await this.loadForConfirmation(vacancyRef);
    if (vacancy.status !== 'awaiting_confirmation') {
      throw new BadRequestException(`Only a vacancy awaiting confirmation can be sent a code (this one is ${vacancy.status})`);
    }
    const contact = this.contactOf(vacancy);
    // M2: the code confirms this vacancy in its current confirmation round only; editing the
    // vacancy starts a new round, so a code the owner got for the old details stops working.
    const result = await this.otpService.sendBoundOtp(contact.phone, await this.codePurpose(vacancy.id), actor.id, otpRequestId);
    if (!otpRequestId) {
      await this.messagingService.send({
        channel: 'sms',
        template: 'vacancy_confirm_details',
        subjectType: 'business',
        subjectId: vacancy.businessId,
        relatedType: 'vacancy',
        relatedId: vacancy.id,
        recipientPhone: contact.phone,
        variables: this.detailsFor(vacancy),
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
  async sendLink(vacancyRef: string, actor: ConfirmationActor) {
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
    await this.messagingService.send({
      channel: 'sms',
      template: 'vacancy_confirm_link',
      subjectType: 'business',
      subjectId: vacancy.businessId,
      relatedType: 'vacancy',
      relatedId: vacancy.id,
      recipientPhone: contact.phone,
      // Rev 192 fix S3: the owner's phone page (P07-VacancyConfirm), like the agreement link.
      variables: { link: publicPageLink('vacancyConfirm', token), ...this.detailsFor(vacancy) },
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
    return { success: true, expiresAt, sentToLast4: last4(contact.phone) };
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
   * the business name, in the language the link was sent in.
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
      preferredLanguage: link.language ?? null,
      roleTitle: vacancy.roleTitle ?? null,
      headcountCount: vacancy.headcount,
      salaryMinPaise: vacancy.salaryMinPaise ?? null,
      salaryMaxPaise: vacancy.salaryMaxPaise ?? null,
      ...this.detailsFor(vacancy),
    };
  }

  async sendLinkOtp(token: string, otpRequestId?: string) {
    const link = await this.requireLink(token);
    // Every public "Send code" costs an SMS: limited per link and per phone on the server,
    // like the agreement page (rev 192 fix S3).
    await this.otpLimiter.claimSend(this.publicLinks.hashToken(token), link.phone!);
    // AC-3: a code bound to this link (a staff-sent vacancy_confirm code is for the
    // agent's own "code on call" route and never confirms on the owner's page).
    const purpose = publicPageOtpPurpose(token);
    const result = otpRequestId
      ? await this.otpService.getProvider().sendOtp(link.phone!, { purpose, requestId: otpRequestId })
      : await this.otpService.getProvider().sendOtp(link.phone!, { purpose });
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
          status: 'open',
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
        toStatus: 'open',
        changedByStaffId: recordedByStaffId,
        reason: `confirmed_by_contact:${method}`,
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
        status: 'open',
        confirmationMethod: method,
        confirmedByRole: contact.role,
        confirmedPhoneLast4: last4(contact.phone),
      },
      changedFields: ['status', 'confirmedAt', 'confirmationMethod'],
      city: vacancy.city,
    });
    // Customer app notification (Agent C).
    await this.customerNotifications?.vacancyConfirmed(vacancy.id);
    return confirmed;
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
