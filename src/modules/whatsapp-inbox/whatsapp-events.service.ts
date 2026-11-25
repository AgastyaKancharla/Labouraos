import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { publicPageLink } from '../../common/public-pages';
import { inQuietHours } from '../message/quiet-hours';
import { MessagingService, PreferWhatsAppResult } from '../message/messaging.service';
import { STEP_WORDS } from '../message/whatsapp-templates';
import { ConsentLinkService } from '../consent/consent-link.service';
import { SignupFactsService } from '../signup-tracker/signup-facts.service';
import { ensureShareSlug, shareLinkUrl } from '../referral/referral-share-link';
import { WhatsAppInboxClock } from './whatsapp-inbox.clock';

/**
 * Automatic WhatsApp messages on registration events (Master Guide rev 202,
 * 21 Nov), SMS when WhatsApp is not available or fails:
 *
 * - registration done: a partner finished every step (terms, selfie, ID, UPI),
 *   a business was verified (a job seeker's is retired, rev 211: the payment
 *   and the ID check send their own messages);
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
const NUDGE_TEMPLATES = ['registration_stopped', 'payment_stuck'];
/** Automatic event messages (an SMS goes once when WhatsApp fails one later). */
export const EVENT_TEMPLATES = ['registration_done', 'partner_registration_done', 'business_registration_done', 'registration_stopped', 'payment_stuck', 'referral_lead_received'];

/** Automatic messages: at most this many tries (WhatsApp, then SMS) per person and template (and step). */
export const MAX_SEND_TRIES = 3;
/** Wait after the 1st and the 2nd failed try. */
export const RETRY_GAPS_MS = [10 * 60 * 1000, 60 * 60 * 1000] as const;

export type SendPlan = 'sent' | 'wait' | 'try' | 'gave_up';

/**
 * One try is one WhatsApp attempt (with its SMS fallback). Anything that went
 * out (or is still queued) means done; failed tries wait 10 minutes, then an
 * hour; after MAX_SEND_TRIES nothing more is tried.
 */
export function planSend(rows: Array<{ channel: string; status: string; createdAt: Date }>, now: Date): SendPlan {
  if (rows.some((r) => r.status !== 'failed' && r.status !== 'blocked')) return 'sent';
  const failed = rows.filter((r) => r.channel === 'whatsapp' && r.status === 'failed').sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  if (failed.length >= MAX_SEND_TRIES) return 'gave_up';
  if (failed.length === 0) return 'try';
  const last = failed[failed.length - 1].createdAt.getTime();
  return now.getTime() - last >= RETRY_GAPS_MS[failed.length - 1] ? 'try' : 'wait';
}

export { inQuietHours };

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
    if (inQuietHours(now)) return { quietHours: true, done: 0, stopped: 0, payment: 0, leadNotices: 0 };
    // Rev 211: a job seeker's "registration done" is retired — the payment and the ID check send their own
    // messages (payment_received_id_left, guarantee_started; job-seeker-flow.service.ts).
    const done = (await this.partnersDone(now)) + (await this.businessesDone(now));
    const nudges = await this.nudges(now);
    const leadNotices = await this.leadNotices(now);
    return { quietHours: false, done, ...nudges, leadNotices };
  }

  /** WhatsApp first (rev 211): the SMS backups that are due (MessagingService.sweepSmsBackups). */
  async sweepSmsBackups(now: Date = this.clock.now()) {
    return this.messaging.sweepSmsBackups(now);
  }

  private async alreadySent(subjectType: string, subjectId: string, templates: string[]) {
    return this.prisma.messageLog.findMany({
      where: { subjectType, subjectId, template: { in: templates }, status: { notIn: ['failed', 'blocked'] } },
      select: { template: true, relatedId: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  /** Where one automatic message stands for one person (and step): every try is counted, failed ones too. */
  private async plan(subjectType: string, subjectId: string, template: string, now: Date, relatedId?: string): Promise<SendPlan> {
    const rows = await this.prisma.messageLog.findMany({
      where: { subjectType, subjectId, template, ...(relatedId ? { relatedId } : {}) },
      select: { channel: true, status: true, createdAt: true },
    });
    return planSend(rows, now);
  }

  /** Sends once the plan says so; after the last failed try it stops and says so in the log (no phone, no text). */
  private async attempt(subjectType: string, subjectId: string, template: string, now: Date, relatedId: string | undefined, send: () => Promise<PreferWhatsAppResult>): Promise<boolean> {
    const before = await this.plan(subjectType, subjectId, template, now, relatedId);
    if (before !== 'try') return false;
    const result = await send();
    if (result.status === 'sent') return true;
    if ((await this.plan(subjectType, subjectId, template, now, relatedId)) === 'gave_up') {
      this.logger.warn(`Automatic ${template} to ${subjectType} ${subjectId} failed ${MAX_SEND_TRIES} times on WhatsApp and SMS; no more tries.`);
    }
    return false;
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
      if ((await this.plan('referral', id, 'partner_registration_done', now)) !== 'try') continue;
      const stage = await this.facts.stageOf('referral', { subjectType: 'referral', subjectId: id });
      if (stage.stage !== 'done') continue;
      const slug = await ensureShareSlug(this.prisma, id);
      const ok = await this.attempt('referral', id, 'partner_registration_done', now, undefined, () => this.messaging.sendPreferWhatsApp({
        template: 'partner_registration_done',
        subjectType: 'referral',
        subjectId: id,
        variables: { firstName: firstName(partner.name), code: partner.code, link: shareLinkUrl(slug) },
        contactAttempt: false,
      }));
      if (ok) sent += 1;
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
      const ok = await this.attempt('business', b.id, 'business_registration_done', now, undefined, () => this.messaging.sendPreferWhatsApp({
        template: 'business_registration_done',
        subjectType: 'business',
        subjectId: b.id,
        variables: { firstName: firstName(b.ownerName), businessName: b.name, code: b.code },
        contactAttempt: false,
      }));
      if (ok) sent += 1;
    }
    return sent;
  }

  /** "We received your lead": the ones held back by quiet hours (or a failed try) go now. */
  private async leadNotices(now: Date): Promise<number> {
    const leads = await this.prisma.referralLead.findMany({
      where: { source: 'link', createdAt: { gte: new Date(now.getTime() - 24 * 60 * 60 * 1000) } },
      select: { id: true, referralId: true, name: true },
      take: 200,
    });
    let sent = 0;
    for (const lead of leads) {
      const partner = await this.prisma.referral.findUnique({ where: { id: lead.referralId }, select: { name: true, anonymisedAt: true } });
      if (!partner || partner.anonymisedAt) continue;
      const ok = await this.attempt('referral', lead.referralId, 'referral_lead_received', now, lead.id, () => this.messaging.sendPreferWhatsApp({
        template: 'referral_lead_received',
        subjectType: 'referral',
        subjectId: lead.referralId,
        relatedType: 'referral_lead',
        relatedId: lead.id,
        variables: { firstName: firstName(partner.name), leadFirstName: firstName(lead.name) },
        contactAttempt: false,
      }));
      if (ok) sent += 1;
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
      const template = atPayment ? 'payment_stuck' : 'registration_stopped';
      // Failed tries count too (at most MAX_SEND_TRIES, a growing gap); decided before any link is made.
      if ((await this.plan('job_seeker', seekerId, template, now, step)) !== 'try') continue;
      const ok = await this.attempt('job_seeker', seekerId, template, now, step, async () => {
        // A fresh link that resumes at the same step; the one sent before keeps working.
        const issued = await this.consentLinks.createLink(seekerId, { sms: false, revokeOthers: false, issuedTo: 'whatsapp_nudge' });
        const link = publicPageLink('registration', issued.token);
        return this.messaging.sendPreferWhatsApp({
          template,
          subjectType: 'job_seeker',
          subjectId: seekerId,
          relatedType: 'registration_step',
          relatedId: step,
          variables: atPayment
            ? { firstName: firstName(seeker.name), link }
            : { firstName: firstName(seeker.name), step: STEP_WORDS[step] ?? step.replace(/_/g, ' '), link },
          contactAttempt: false,
        });
      });
      if (ok) {
        if (atPayment) payment += 1;
        else stopped += 1;
      }
    }
    return { stopped, payment };
  }

  /**
   * WhatsApp took an event message and failed it later (the person has no
   * WhatsApp): the same message goes once by SMS, rebuilt from the records (the
   * variables are not stored). Never a contact attempt; never again on WhatsApp.
   */
  async smsFallbackForFailed(row: { id: string; template: string; subjectType: string; subjectId: string; relatedType: string | null; relatedId: string | null; createdAt: Date }): Promise<boolean> {
    if (!EVENT_TEMPLATES.includes(row.template)) return false;
    const already = await this.prisma.messageLog.findFirst({
      where: { subjectType: row.subjectType, subjectId: row.subjectId, template: row.template, channel: 'sms', relatedId: row.relatedId, createdAt: { gte: row.createdAt } },
      select: { id: true },
    });
    if (already) return false;
    const variables = await this.variablesFor(row);
    if (!variables) return false;
    const sent = await this.messaging.send({
      channel: 'sms',
      template: row.template,
      subjectType: row.subjectType,
      subjectId: row.subjectId,
      relatedType: row.relatedType,
      relatedId: row.relatedId,
      variables,
      contactAttempt: false,
    });
    return sent.status === 'sent';
  }

  private async variablesFor(row: { template: string; subjectType: string; subjectId: string; relatedId: string | null }): Promise<Record<string, string> | null> {
    if (row.template === 'registration_done') {
      const s = await this.prisma.jobSeeker.findUnique({ where: { id: row.subjectId }, select: { name: true, code: true } });
      return s ? { firstName: firstName(s.name), code: s.code } : null;
    }
    if (row.template === 'registration_stopped' || row.template === 'payment_stuck') {
      const s = await this.prisma.jobSeeker.findUnique({ where: { id: row.subjectId }, select: { name: true, paymentReceivedAt: true } });
      if (!s || s.paymentReceivedAt) return null;
      const issued = await this.consentLinks.createLink(row.subjectId, { sms: false, revokeOthers: false, issuedTo: 'whatsapp_nudge' });
      const link = publicPageLink('registration', issued.token);
      const step = row.relatedId ?? '';
      return row.template === 'payment_stuck'
        ? { firstName: firstName(s.name), link }
        : { firstName: firstName(s.name), step: STEP_WORDS[step] ?? step.replace(/_/g, ' '), link };
    }
    if (row.template === 'partner_registration_done') {
      const r = await this.prisma.referral.findUnique({ where: { id: row.subjectId }, select: { name: true, code: true } });
      return r ? { firstName: firstName(r.name), code: r.code, link: shareLinkUrl(await ensureShareSlug(this.prisma, row.subjectId)) } : null;
    }
    if (row.template === 'business_registration_done') {
      const b = await this.prisma.business.findUnique({ where: { id: row.subjectId }, select: { name: true, code: true, ownerName: true } });
      return b ? { firstName: firstName(b.ownerName), businessName: b.name, code: b.code } : null;
    }
    if (row.template === 'referral_lead_received' && row.relatedId) {
      const [r, lead] = await Promise.all([
        this.prisma.referral.findUnique({ where: { id: row.subjectId }, select: { name: true } }),
        this.prisma.referralLead.findUnique({ where: { id: row.relatedId }, select: { name: true } }),
      ]);
      return r && lead ? { firstName: firstName(r.name), leadFirstName: firstName(lead.name) } : null;
    }
    return null;
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
