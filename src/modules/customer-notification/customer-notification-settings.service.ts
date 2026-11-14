import { HttpStatus, Injectable } from '@nestjs/common';
import { CustomerNotificationSetting } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { DEFAULT_NOTICE_VERSION } from '../consent/consent.constants';
import { CustomerNotificationClock } from './customer-notification.clock';
import { notificationError, validationFailed } from './customer-notification.errors';

export interface NotificationSettingsView {
  service: boolean;
  jobUpdates: boolean;
  promotions: boolean;
  quietStart: string;
  quietEnd: string;
  dailyCap: number;
  serviceLocked: boolean;
}

export interface ProfileSubject {
  subjectType: 'job_seeker' | 'business' | 'referral';
  subjectId: string;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The three notification switches (proposal 5.4): Service, Job updates and
 * Promotions. Quiet hours (9 PM to 9 AM) and the cap (3 non-urgent a day) are
 * fixed in v1 (Q21).
 *
 * Consent (Q22, contract section 9):
 * - Promotions is the optional `promotions` consent. Turning it on grants it
 *   (method in_app) for every record the account acts for; turning it off
 *   withdraws it. It has no effect on any guarantee.
 * - Job updates turns on the app's job alerts. Turning it on grants the
 *   job seeker's `job_updates` consent if it is not already given. Turning it
 *   off only stops app job alerts: `job_updates` is one of the consents given
 *   at registration, and the guide lets it be withdrawn only on an answered,
 *   recorded call with an agent (ConsentWithdrawalService), so the app never
 *   withdraws it by itself.
 * - Service cannot be switched off while a guarantee is running, because the
 *   person would miss offers (409 SERVICE_LOCKED).
 */
@Injectable()
export class CustomerNotificationSettingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: CustomerNotificationClock,
  ) {}

  /** The records an account may act for (active links only). */
  async subjectsOf(accountId: string): Promise<ProfileSubject[]> {
    const profiles = await this.prisma.customerProfile.findMany({
      where: { accountId, status: 'active' },
      select: { jobSeekerId: true, businessId: true, referralId: true },
    });
    const out: ProfileSubject[] = [];
    for (const p of profiles) {
      if (p.jobSeekerId) out.push({ subjectType: 'job_seeker', subjectId: p.jobSeekerId });
      if (p.businessId) out.push({ subjectType: 'business', subjectId: p.businessId });
      if (p.referralId) out.push({ subjectType: 'referral', subjectId: p.referralId });
    }
    return out;
  }

  /** Purposes (job_updates, promotions) with a live grant for one record. */
  async liveConsents(subject: ProfileSubject): Promise<Set<string>> {
    const rows = await this.prisma.consent.findMany({
      where: {
        subjectType: subject.subjectType,
        subjectId: subject.subjectId,
        purpose: { in: ['job_updates', 'promotions'] },
        granted: true,
        withdrawnAt: null,
      },
      select: { purpose: true },
    });
    return new Set(rows.map((r) => r.purpose));
  }

  /** The account's switches, made on first use from the consents already given. */
  async getOrCreate(accountId: string): Promise<CustomerNotificationSetting> {
    const existing = await this.prisma.customerNotificationSetting.findUnique({ where: { accountId } });
    if (existing) return existing;
    const subjects = await this.subjectsOf(accountId);
    let jobUpdates = false;
    let promotions = false;
    for (const subject of subjects) {
      const live = await this.liveConsents(subject);
      if (subject.subjectType === 'job_seeker' && live.has('job_updates')) jobUpdates = true;
      if (live.has('promotions')) promotions = true;
    }
    try {
      return await this.prisma.customerNotificationSetting.create({
        data: { accountId, service: true, jobUpdates, promotions },
      });
    } catch (error: unknown) {
      if ((error as { code?: string })?.code === 'P2002') {
        return this.prisma.customerNotificationSetting.findUniqueOrThrow({ where: { accountId } });
      }
      throw error;
    }
  }

  /**
   * True while a guarantee is running for a record the account acts for: a job
   * seeker's 30-day guarantee (status active, paid inside the PricingPolicy's
   * jobSeekerGuaranteeDays) or a business placement that is confirmed or active
   * (inside its 60-day replacement guarantee).
   */
  async serviceLocked(accountId: string, now: Date = this.clock.now()): Promise<boolean> {
    const subjects = await this.subjectsOf(accountId);
    const jobSeekerIds = subjects.filter((s) => s.subjectType === 'job_seeker').map((s) => s.subjectId);
    const businessIds = subjects.filter((s) => s.subjectType === 'business').map((s) => s.subjectId);
    if (jobSeekerIds.length > 0) {
      const policy = await this.prisma.pricingPolicy.findFirst({
        where: { effectiveFrom: { lte: now } },
        orderBy: [{ effectiveFrom: 'desc' }, { createdAt: 'desc' }],
        select: { jobSeekerGuaranteeDays: true },
      });
      const running = await this.prisma.jobSeeker.count({
        where: {
          id: { in: jobSeekerIds },
          status: 'active',
          paymentReceivedAt: policy
            ? { not: null, gt: new Date(now.getTime() - policy.jobSeekerGuaranteeDays * DAY_MS) }
            : { not: null },
        },
      });
      if (running > 0) return true;
    }
    if (businessIds.length > 0) {
      const running = await this.prisma.placement.count({
        where: { businessId: { in: businessIds }, status: { in: ['confirmed', 'active'] } },
      });
      if (running > 0) return true;
    }
    return false;
  }

  async view(accountId: string): Promise<NotificationSettingsView> {
    const [row, serviceLocked] = await Promise.all([this.getOrCreate(accountId), this.serviceLocked(accountId)]);
    return {
      // While locked, Service is on whatever the row says (it cannot be off then).
      service: serviceLocked ? true : row.service,
      jobUpdates: row.jobUpdates,
      promotions: row.promotions,
      quietStart: row.quietStart,
      quietEnd: row.quietEnd,
      dailyCap: row.dailyCap,
      serviceLocked,
    };
  }

  async update(accountId: string, body: unknown): Promise<NotificationSettingsView> {
    const input = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
    const changes: { service?: boolean; jobUpdates?: boolean; promotions?: boolean } = {};
    for (const field of ['service', 'jobUpdates', 'promotions'] as const) {
      if (input[field] === undefined) continue;
      if (typeof input[field] !== 'boolean') throw validationFailed(field, `${field} must be true or false`);
      changes[field] = input[field] as boolean;
    }
    const current = await this.getOrCreate(accountId);
    if (changes.service === false && (await this.serviceLocked(accountId))) {
      throw notificationError(
        HttpStatus.CONFLICT,
        'SERVICE_LOCKED',
        'Service notifications cannot be switched off while a guarantee is running',
      );
    }
    await this.prisma.customerNotificationSetting.update({ where: { accountId }, data: changes });

    const account = await this.prisma.customerAccount.findUnique({ where: { id: accountId }, select: { language: true } });
    const language = account?.language ?? 'en';
    const subjects = await this.subjectsOf(accountId);
    if (changes.promotions !== undefined && changes.promotions !== current.promotions) {
      for (const subject of subjects) {
        if (changes.promotions) await this.grant(subject, 'promotions', language);
        else await this.withdraw(subject, 'promotions');
      }
    }
    if (changes.jobUpdates === true) {
      for (const subject of subjects.filter((s) => s.subjectType === 'job_seeker')) {
        const live = await this.liveConsents(subject);
        if (!live.has('job_updates')) await this.grant(subject, 'job_updates', language);
      }
    }
    return this.view(accountId);
  }

  /**
   * Grants one consent purpose from the app (method in_app). A purpose an
   * agent withdrew on a recorded call is left withdrawn: the job seeker gives
   * it again through a consent link, as the withdrawal SMS tells them.
   */
  private async grant(subject: ProfileSubject, purpose: 'promotions' | 'job_updates', language: string): Promise<void> {
    const now = this.clock.now();
    const key = { subjectType: subject.subjectType, subjectId: subject.subjectId, purpose, noticeVersion: DEFAULT_NOTICE_VERSION };
    const existing = await this.prisma.consent.findUnique({ where: { subjectType_subjectId_purpose_noticeVersion: key } });
    if (existing?.withdrawnByStaffId) return;
    await this.prisma.consent.upsert({
      where: { subjectType_subjectId_purpose_noticeVersion: key },
      create: { ...key, granted: true, language, method: 'in_app', grantedAt: now },
      update: { granted: true, language, method: 'in_app', grantedAt: now, withdrawnAt: null, withdrawnMethod: null },
    });
  }

  private async withdraw(subject: ProfileSubject, purpose: 'promotions'): Promise<void> {
    await this.prisma.consent.updateMany({
      where: { subjectType: subject.subjectType, subjectId: subject.subjectId, purpose, granted: true, withdrawnAt: null },
      data: { granted: false, withdrawnAt: this.clock.now(), withdrawnMethod: 'in_app' },
    });
  }
}
