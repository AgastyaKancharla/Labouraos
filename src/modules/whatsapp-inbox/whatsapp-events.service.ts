import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { publicPageLink } from '../../common/public-pages';
import { getCalendarPartsInTimezone } from '../../common/time/period-boundary';
import { MessagingService } from '../message/messaging.service';
import { STEP_WORDS } from '../message/whatsapp-templates';
import { ConsentLinkService } from '../consent/consent-link.service';
import { SignupFactsService } from '../signup-tracker/signup-facts.service';
import { ensureShareSlug, shareLinkUrl } from '../referral/referral-share-link';
import { WhatsAppInboxClock } from './whatsapp-inbox.clock';

/**
 * Automatic WhatsApp messages on registration events (Master Guide rev 202,
 * 21 Nov), SMS when WhatsApp is not available or fails:
 *
 * - registration done: a job seeker's ₹499 arrived, a partner finished every
 *   step (terms, selfie, ID, UPI), a business was verified;
 * - stopped part-way: a job seeker with a registration link has made no
 *   progress for STOPPED_AFTER_MS at a step before the payment;
 * - stuck at payment: only the payment is left and nothing happened for
 *   PAYMENT_STUCK_AFTER_MS.
 *
 * Each message goes at most once per person and step; at most
 * MAX_NUDGES_PER_PERSON nudges per person, a day apart; only between 9 AM and
 * 9 PM (the customer app's quiet hours); never to anyone whose calls ended in
 * "do not call" or "wrong number". Sign-ups made in the Laboura app are left to
 * the sign-up tracker's own reminders. Nudges carry a fresh registration link
 * (the earlier link keeps working). None of these is a contact attempt.
 */
export const STOPPED_AFTER_MS = 2 * 60 * 60 * 1000;
export const PAYMENT_STUCK_AFTER_MS = 60 * 60 * 1000;
export const MAX_NUDGES_PER_PERSON = 3;
const NUDGE_GAP_MS = 20 * 60 * 60 * 1000;
/** Only events this recent get a "done" message (so a first deploy never messages old registrations). */
export const DONE_LOOKBACK_MS = 48 * 60 * 60 * 1000;
const STUCK_STATUSES = ['lead', 'consented', 'pending_activation'];
const QUIET_START_HOUR = 21;
const QUIET_END_HOUR = 9;
const NUDGE_TEMPLATES = ['registration_stopped', 'payment_stuck'];

export function inQuietHours(now: Date): boolean {
  const hour = getCalendarPartsInTimezone(now, 'Asia/Kolkata').hour;
  return hour >= QUIET_START_HOUR || hour < QUIET_END_HOUR;
}

function firstName(name: string | null | undefined): string {
  return (name ?? '').trim().split(/\s+/)[0] || 'there';
}

@Injectable()
export class WhatsAppEventsService {
  private readonly logger = new Logger(WhatsAppEventsService.name);
  private readonly facts: SignupFactsService;

  constructor(
    private readonly prisma: PrismaService,
    private readonly messaging: MessagingService,
    private readonly consentLinks: ConsentLinkService,
    private readonly clock: WhatsAppInboxClock,
  ) {
    this.facts = new SignupFactsService(prisma);
  }

  async sweep(now: Date = this.clock.now()) {
    if (inQuietHours(now)) return { quietHours: true, done: 0, stopped: 0, payment: 0 };
    const done = (await this.seekersDone(now)) + (await this.partnersDone(now)) + (await this.businessesDone(now));
    const nudges = await this.nudges(now);
    return { quietHours: false, done, ...nudges };
  }

  private async alreadySent(subjectType: string, subjectId: string, templates: string[]) {
    return this.prisma.messageLog.findMany({
      where: { subjectType, subjectId, template: { in: templates }, status: { not: 'failed' } },
      select: { template: true, relatedId: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  private async seekersDone(now: Date): Promise<number> {
    const rows = await this.prisma.jobSeeker.findMany({
      where: { paymentReceivedAt: { gte: new Date(now.getTime() - DONE_LOOKBACK_MS) }, anonymisedAt: null },
      select: { id: true, code: true, name: true },
      take: 200,
    });
    let sent = 0;
    for (const s of rows) {
      if ((await this.alreadySent('job_seeker', s.id, ['registration_done'])).length) continue;
      const result = await this.messaging.sendPreferWhatsApp({
        template: 'registration_done',
        subjectType: 'job_seeker',
        subjectId: s.id,
        variables: { firstName: firstName(s.name), code: s.code },
        contactAttempt: false,
      });
      if (result.status === 'sent') sent += 1;
    }
    return sent;
  }

  private async partnersDone(now: Date): Promise<number> {
    const accounts = await this.prisma.payoutAccount.findMany({
      where: { ownerType: 'referral', updatedAt: { gte: new Date(now.getTime() - DONE_LOOKBACK_MS) } },
      select: { ownerId: true },
      take: 200,
    });
    let sent = 0;
    for (const id of [...new Set(accounts.map((a) => a.ownerId))]) {
      const partner = await this.prisma.referral.findUnique({ where: { id }, select: { id: true, code: true, name: true, anonymisedAt: true } });
      if (!partner || partner.anonymisedAt) continue;
      if ((await this.alreadySent('referral', id, ['partner_registration_done'])).length) continue;
      const stage = await this.facts.stageOf('referral', { subjectType: 'referral', subjectId: id });
      if (stage.stage !== 'done') continue;
      const slug = await ensureShareSlug(this.prisma, id);
      const result = await this.messaging.sendPreferWhatsApp({
        template: 'partner_registration_done',
        subjectType: 'referral',
        subjectId: id,
        variables: { firstName: firstName(partner.name), code: partner.code, link: shareLinkUrl(slug) },
        contactAttempt: false,
      });
      if (result.status === 'sent') sent += 1;
    }
    return sent;
  }

  private async businessesDone(now: Date): Promise<number> {
    const rows = await this.prisma.business.findMany({
      where: { verificationStatus: 'verified', verifiedAt: { gte: new Date(now.getTime() - DONE_LOOKBACK_MS) }, anonymisedAt: null },
      select: { id: true, code: true, name: true, ownerName: true },
      take: 200,
    });
    let sent = 0;
    for (const b of rows) {
      if ((await this.alreadySent('business', b.id, ['business_registration_done'])).length) continue;
      const result = await this.messaging.sendPreferWhatsApp({
        template: 'business_registration_done',
        subjectType: 'business',
        subjectId: b.id,
        variables: { firstName: firstName(b.ownerName), businessName: b.name, code: b.code },
        contactAttempt: false,
      });
      if (result.status === 'sent') sent += 1;
    }
    return sent;
  }

  /** Job seekers whose registration link journey stopped (agent registrations; app sign-ups have the tracker). */
  private async nudges(now: Date): Promise<{ stopped: number; payment: number }> {
    const links = await this.prisma.publicLink.findMany({
      where: { purpose: 'registration', subjectType: 'job_seeker', createdAt: { gte: new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000) } },
      select: { subjectId: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
      take: 1000,
    });
    const latestLink = new Map<string, Date>();
    for (const l of links) if (!latestLink.has(l.subjectId)) latestLink.set(l.subjectId, l.createdAt);
    let stopped = 0;
    let payment = 0;
    for (const [seekerId, linkAt] of latestLink) {
      const seeker = await this.prisma.jobSeeker.findUnique({
        where: { id: seekerId },
        select: { id: true, name: true, status: true, paymentReceivedAt: true, anonymisedAt: true, photoTakenAt: true },
      });
      if (!seeker || seeker.anonymisedAt || seeker.paymentReceivedAt || !STUCK_STATUSES.includes(seeker.status)) continue;
      const appSignup = await this.prisma.signupTracker.findFirst({
        where: { subjectType: 'job_seeker', subjectId: seekerId, outcome: 'open' },
        select: { id: true },
      });
      if (appSignup) continue;
      const stage = await this.facts.stageOf('job_seeker', { subjectType: 'job_seeker', subjectId: seekerId });
      if (stage.step === 'complete') continue;
      // The Team Lead still has to look at the ID: nothing for the person to do.
      const idv = await this.prisma.identityVerification.findFirst({
        where: { jobSeekerId: seekerId },
        orderBy: { createdAt: 'desc' },
        select: { status: true, updatedAt: true },
      });
      if (stage.step === 'id_check' && idv?.status === 'pending') continue;
      const atPayment = stage.step === 'payment' || stage.step === 'payment_failed';
      const lastProgress = await this.lastProgressAt(seekerId, linkAt, seeker.photoTakenAt, idv?.updatedAt ?? null);
      if (now.getTime() - lastProgress.getTime() < (atPayment ? PAYMENT_STUCK_AFTER_MS : STOPPED_AFTER_MS)) continue;
      const step = atPayment ? 'payment' : stage.step;
      const earlier = await this.alreadySent('job_seeker', seekerId, NUDGE_TEMPLATES);
      if (earlier.length >= MAX_NUDGES_PER_PERSON) continue;
      if (earlier.some((m) => m.relatedId === step)) continue;
      if (earlier[0] && now.getTime() - earlier[0].createdAt.getTime() < NUDGE_GAP_MS) continue;
      if (await this.messaging.messagingBlocked('job_seeker', seekerId)) continue;
      // A fresh link that resumes at the same step; the one sent before keeps working.
      const issued = await this.consentLinks.createLink(seekerId, { sms: false, revokeOthers: false, issuedTo: 'whatsapp_nudge' });
      const template = atPayment ? 'payment_stuck' : 'registration_stopped';
      const result = await this.messaging.sendPreferWhatsApp({
        template,
        subjectType: 'job_seeker',
        subjectId: seekerId,
        relatedType: 'registration_step',
        relatedId: step,
        variables: atPayment
          ? { firstName: firstName(seeker.name), link: publicPageLink('registration', issued.token) }
          : { firstName: firstName(seeker.name), step: STEP_WORDS[step] ?? step.replace(/_/g, ' '), link: publicPageLink('registration', issued.token) },
        contactAttempt: false,
      });
      if (result.status === 'sent') {
        if (atPayment) payment += 1;
        else stopped += 1;
      }
    }
    return { stopped, payment };
  }

  /** The last time anything moved in the journey: link, consent, selfie, ID check, payment. */
  private async lastProgressAt(seekerId: string, linkAt: Date, photoAt: Date | null, idAt: Date | null): Promise<Date> {
    const [consent, payment] = await Promise.all([
      this.prisma.consent.findFirst({ where: { subjectType: 'job_seeker', subjectId: seekerId }, orderBy: { updatedAt: 'desc' }, select: { updatedAt: true } }),
      this.prisma.payment.findFirst({ where: { jobSeekerId: seekerId, type: 'activation' }, orderBy: { updatedAt: 'desc' }, select: { updatedAt: true } }),
    ]);
    const times = [linkAt, photoAt, idAt, consent?.updatedAt ?? null, payment?.updatedAt ?? null].filter((d): d is Date => Boolean(d));
    return new Date(Math.max(...times.map((d) => d.getTime())));
  }
}
