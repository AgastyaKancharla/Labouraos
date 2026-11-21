import {
  BadRequestException,
  ForbiddenException,
  HttpStatus,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import { OtpService } from '../../common/otp/otp.service';
import { PublicOtpLimiter, publicOtpPhoneHash } from '../../common/public-otp-limiter.service';
import { testModeFields } from '../../common/otp/otp-test-mode';
import { codedError } from '../../common/http/coded-error';
import { mobileLookupValues, parseIndianMobile, sameIndianMobile } from '../../common/phone/indian-mobile';
import { MessagingService } from '../message/messaging.service';
import { inQuietHours } from '../message/quiet-hours';
import { ReportingScopeService } from '../staff/reporting-scope.service';
import { SHARE_SLUG_PATTERN, ensureShareSlug, shareLinkUrl, shareQrSvg } from './referral-share-link';
import { WhatsAppInboxClock } from '../whatsapp-inbox/whatsapp-inbox.clock';
import { WhatsAppInboxService } from '../whatsapp-inbox/whatsapp-inbox.service';
import { createHash } from 'crypto';
import { closeAppLead, markAppLeadContacted } from './referral-lead-sync';

/** What the person who sent the lead is after. */
export const LEAD_LOOKING_FOR = ['job', 'staff'] as const;
export type LeadLookingFor = (typeof LEAD_LOOKING_FOR)[number];
/** How an agent closes a partner's lead. */
export const REFERRAL_LEAD_OUTCOMES = ['registered', 'already_registered', 'not_interested', 'no_answer_3_tries', 'wrong_number'] as const;
/** Spam guards for one share link: leads and codes a day. */
export const LINK_LEADS_PER_DAY = 30;
/** Codes one share link sends in 24 hours (all visitors). */
export const LINK_CODES_PER_DAY = 20;
/** Codes one visitor address asks for in 24 hours, across every share link (checked first). */
export const IP_CODES_PER_DAY = 10;
/** Codes one number gets in 24 hours, across every share link. */
export const NUMBER_CODES_PER_DAY = 3;
/** The words of the link page's consent tick; a new wording means a new version. */
export const LINK_CONSENT_VERSION = 'ref-link-consent-1.0';
export const LINK_CONSENT_TEXT = 'Laboura may call me and send me WhatsApp messages about this.';
const DAY_MS = 24 * 60 * 60 * 1000;

export interface LeadActor {
  id: string;
  role: string;
}

export interface LeadInput {
  name?: unknown;
  phone?: unknown;
  lookingFor?: unknown;
  area?: unknown;
  note?: unknown;
}

function firstName(name: string | null | undefined): string {
  return (name ?? '').trim().split(/\s+/)[0] || '';
}

/** The page's OTP is bound to the share link (AC-3 style), never to a staff send. */
/** A visitor address, kept only as a keyed hash (never the address itself). */
function ipHash(ip: string | null | undefined): string {
  return createHash('sha256').update(`laboura:ref-link-ip:${process.env.JWT_SECRET ?? ''}:${ip ?? 'unknown'}`).digest('hex').slice(0, 32);
}

function linkToken(slug: string): string {
  return `ref-link:${slug}`;
}

/**
 * Referral partners' leads (Master Guide rev 202, 21 Nov): the partner's
 * personal share link and QR, the public page that takes a lead (the person's
 * own number, checked by OTP), and the agent's list (assigned by the WhatsApp
 * sweep like missed calls), which also holds the leads partners send from the
 * Laboura app (picked up from CustomerReferralLead, referral-lead-sync.ts).
 * Registering the lead fills "referred by" with the partner.
 */
@Injectable()
export class ReferralLeadService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly otp: OtpService,
    private readonly limiter: PublicOtpLimiter,
    private readonly messaging: MessagingService,
    private readonly scope: ReportingScopeService,
    private readonly clock: WhatsAppInboxClock,
    private readonly inbox: WhatsAppInboxService,
  ) {}

  now(): Date {
    return this.clock.now();
  }

  // ------------------------------------------------------------------ share link

  async shareLink(referralId: string) {
    const partner = await this.prisma.referral.findUnique({ where: { id: referralId }, select: { id: true, code: true, anonymisedAt: true, pausedAt: true } });
    if (!partner || partner.anonymisedAt) throw new NotFoundException('Referral partner not found');
    const slug = await ensureShareSlug(this.prisma, partner.id);
    const url = shareLinkUrl(slug);
    return { code: partner.code, url, qrSvg: shareQrSvg(url), paused: Boolean(partner.pausedAt) };
  }

  /** A live partner behind a slug, or null (unknown, paused or anonymised all look the same). */
  private async partnerForSlug(slug: string) {
    if (typeof slug !== 'string' || !SHARE_SLUG_PATTERN.test(slug)) return null;
    const partner = await this.prisma.referral.findUnique({
      where: { shareSlug: slug },
      select: { id: true, code: true, name: true, phone: true, pausedAt: true, anonymisedAt: true },
    });
    if (!partner || partner.pausedAt || partner.anonymisedAt) return null;
    return partner;
  }

  /** What the public page shows: the partner's first name and code only. */
  async publicPage(slug: string) {
    const partner = await this.partnerForSlug(slug);
    if (!partner) throw codedError(HttpStatus.NOT_FOUND, 'LINK_NOT_ACTIVE', 'This link is not active. You can still call Laboura or register in the Laboura app.');
    // The partner's first name only (never the RF code: the page is shared widely).
    return { valid: true, partnerFirstName: firstName(partner.name) };
  }

  /**
   * "Send code" on the share link page: to the number the person typed (their own).
   * Limits, in this order so one abuser cannot use up a partner's link: per visitor
   * address (all links), per number (all links), then per link; then the usual
   * public-page limits per number (one code every 30 seconds).
   */
  async sendCode(slug: string, rawPhone: unknown, ip?: string | null) {
    const partner = await this.partnerForSlug(slug);
    if (!partner) throw codedError(HttpStatus.NOT_FOUND, 'LINK_NOT_ACTIVE', 'This link is not active.');
    const phone = parseIndianMobile(rawPhone);
    if (!phone) throw new BadRequestException('Enter a 10-digit mobile number');
    const now = this.now();
    const since = new Date(now.getTime() - DAY_MS);
    const ipKey = `ref-ip:${ipHash(ip)}`;
    const fromAddress = await this.prisma.publicOtpSend.count({ where: { linkKey: ipKey, sentAt: { gt: since } } });
    if (fromAddress >= IP_CODES_PER_DAY) {
      throw codedError(HttpStatus.TOO_MANY_REQUESTS, 'LIMIT_REACHED', 'Too many codes from this connection today. Try again later, or call Laboura.');
    }
    const toNumber = await this.prisma.publicOtpSend.count({ where: { phoneHash: publicOtpPhoneHash(phone), linkKey: { startsWith: 'ref-link:' }, sentAt: { gt: since } } });
    if (toNumber >= NUMBER_CODES_PER_DAY) {
      throw codedError(HttpStatus.TOO_MANY_REQUESTS, 'LIMIT_REACHED', 'Too many codes to this number today. Try again later, or call Laboura.');
    }
    const codesToday = await this.prisma.publicOtpSend.count({ where: { linkKey: { startsWith: `${linkToken(slug)}:` }, sentAt: { gt: since } } });
    if (codesToday >= LINK_CODES_PER_DAY) {
      throw codedError(HttpStatus.TOO_MANY_REQUESTS, 'LIMIT_REACHED', 'This link has been used a lot today. Try again later, or call Laboura.');
    }
    await this.limiter.claimSend(`${linkToken(slug)}:${publicOtpPhoneHash(phone).slice(0, 16)}`, phone, now);
    // Counted for the address only (no number on this row, so it never touches the per-number wait).
    await this.prisma.publicOtpSend.create({ data: { linkKey: ipKey, phoneHash: 'address', sentAt: now } });
    await this.prisma.publicOtpSend.deleteMany({ where: { linkKey: ipKey, sentAt: { lt: since } } });
    const sent = await this.otp.sendPublicPageOtp(phone, linkToken(slug));
    return { success: true, requestId: sent.requestId, ...testModeFields(sent) };
  }

  /** The page's form: name, number (checked by the code), job or staff, area. Always the same answer. */
  async submitFromLink(slug: string, body: LeadInput & { requestId?: unknown; code?: unknown; consent?: unknown }) {
    const partner = await this.partnerForSlug(slug);
    if (!partner) throw codedError(HttpStatus.NOT_FOUND, 'LINK_NOT_ACTIVE', 'This link is not active.');
    const input = this.validate(body);
    if (body.consent !== true) throw new BadRequestException('Tick the box so Laboura may call you');
    const requestId = typeof body.requestId === 'string' ? body.requestId : '';
    const code = typeof body.code === 'string' ? body.code.trim() : '';
    const ok = Boolean(requestId && code) && (await this.otp.verifyOtp(requestId, code)) && (await this.otp.consumeVerifiedForPage(requestId, input.phone, linkToken(slug)));
    if (!ok) throw codedError(HttpStatus.BAD_REQUEST, 'OTP_INVALID', 'The code is wrong or has expired. Ask for a new code.');
    const now = this.now();
    const today = await this.prisma.referralLead.count({ where: { referralId: partner.id, source: 'link', createdAt: { gt: new Date(now.getTime() - DAY_MS) } } });
    if (today >= LINK_LEADS_PER_DAY) {
      throw codedError(HttpStatus.TOO_MANY_REQUESTS, 'LIMIT_REACHED', 'This link has been used a lot today. Try again tomorrow, or call Laboura.');
    }
    await this.createLead(partner, input, 'link', now, { consentAt: now, consentVersion: LINK_CONSENT_VERSION });
    // Never says whether the number is already registered (no oracle).
    return { received: true };
  }

  private validate(body: LeadInput): { name: string; phone: string; lookingFor: LeadLookingFor; area: string | null; note: string | null } {
    const name = typeof body.name === 'string' ? body.name.trim().replace(/\s+/g, ' ') : '';
    if (name.length < 2 || name.length > 80) throw new BadRequestException('Enter the person\'s name');
    const phone = parseIndianMobile(body.phone);
    if (!phone) throw new BadRequestException('Enter a 10-digit mobile number');
    const lookingFor = body.lookingFor;
    if (typeof lookingFor !== 'string' || !(LEAD_LOOKING_FOR as readonly string[]).includes(lookingFor)) {
      throw new BadRequestException('lookingFor must be job or staff');
    }
    const area = typeof body.area === 'string' && body.area.trim() ? body.area.trim().slice(0, 80) : null;
    const note = typeof body.note === 'string' && body.note.trim() ? body.note.trim().slice(0, 300) : null;
    return { name, phone, lookingFor: lookingFor as LeadLookingFor, area, note };
  }

  /** One open lead per partner and number: a second send of the same person changes nothing. */
  private async createLead(
    partner: { id: string; name: string; phone: string },
    input: { name: string; phone: string; lookingFor: LeadLookingFor; area: string | null; note: string | null },
    source: 'link' | 'app',
    now: Date,
    consent: { consentAt: Date | null; consentVersion: string | null } = { consentAt: null, consentVersion: null },
  ) {
    if (sameIndianMobile(partner.phone, input.phone)) return null;
    const open = await this.prisma.referralLead.findFirst({
      where: { referralId: partner.id, phone: { in: mobileLookupValues(input.phone) }, status: 'open' },
      select: { id: true },
    });
    if (open) return open;
    const lead = await this.prisma.referralLead.create({
      data: {
        referralId: partner.id,
        name: input.name,
        phone: input.phone,
        lookingFor: input.lookingFor,
        area: input.area,
        note: input.note,
        source,
        status: 'open',
        consentAt: consent.consentAt,
        consentVersion: consent.consentVersion,
        createdAt: now,
      },
    });
    // The partner is told the lead arrived (WhatsApp, SMS as fallback). Not a contact attempt.
    // In quiet hours (9 PM–9 AM) the WhatsApp sweep sends it in the morning instead.
    if (!inQuietHours(now)) await this.messaging.sendPreferWhatsApp({
      template: 'referral_lead_received',
      subjectType: 'referral',
      subjectId: partner.id,
      relatedType: 'referral_lead',
      relatedId: lead.id,
      variables: { firstName: firstName(partner.name) || 'there', leadFirstName: firstName(input.name) },
      contactAttempt: false,
    }).catch(() => undefined);
    return lead;
  }

  // ------------------------------------------------------------------ agents

  private async teamIds(actor: LeadActor): Promise<string[] | null> {
    if (actor.role === 'ceo') return null;
    return [actor.id, ...(await this.scope.peopleUnder(actor.id))];
  }

  private async visibleWhere(actor: LeadActor): Promise<Prisma.ReferralLeadWhereInput> {
    // A call agent sees his own and the unassigned ones (to take one); never another agent's.
    if (actor.role === 'call_agent') return { OR: [{ assignedStaffId: actor.id }, { assignedStaffId: null }] };
    if (!['team_lead', 'manager', 'ceo'].includes(actor.role)) throw new ForbiddenException('Not allowed');
    const team = await this.teamIds(actor);
    return team ? { OR: [{ assignedStaffId: null }, { assignedStaffId: { in: team } }] } : {};
  }

  async list(actor: LeadActor, status: string | undefined) {
    const rows = await this.prisma.referralLead.findMany({
      where: { AND: [{ status: status === 'closed' ? 'closed' : 'open' }, await this.visibleWhere(actor)] },
      orderBy: { createdAt: 'asc' },
      take: 200,
    });
    const partnerIds = [...new Set(rows.map((r) => r.referralId))];
    const staffIds = [...new Set(rows.map((r) => r.assignedStaffId).filter((v): v is string => Boolean(v)))];
    const [partners, staff, registered] = await Promise.all([
      this.prisma.referral.findMany({ where: { id: { in: partnerIds } }, select: { id: true, code: true, name: true } }),
      staffIds.length ? this.prisma.staff.findMany({ where: { id: { in: staffIds } }, select: { id: true, code: true, name: true } }) : Promise.resolve([]),
      this.registeredMatches(rows.map((r) => r.phone)),
    ]);
    return {
      rows: rows.map((r) => ({
        id: r.id,
        name: r.name,
        phone: r.phone,
        lookingFor: r.lookingFor,
        area: r.area,
        note: r.note,
        source: r.source,
        status: r.status,
        outcome: r.outcome,
        createdAt: r.createdAt.toISOString(),
        partner: partners.find((p) => p.id === r.referralId) ?? null,
        assignedTo: staff.find((s) => s.id === r.assignedStaffId) ?? null,
        alreadyRegistered: registered.get(r.phone) ?? null,
      })),
    };
  }

  /** Numbers already on a job seeker or business: the agent opens it instead of registering again. */
  private async registeredMatches(phones: string[]): Promise<Map<string, { type: string; id: string; code: string }>> {
    const out = new Map<string, { type: string; id: string; code: string }>();
    if (phones.length === 0) return out;
    const [seekers, businesses] = await Promise.all([
      this.prisma.jobSeeker.findMany({ where: { phone: { in: phones }, anonymisedAt: null }, select: { id: true, code: true, phone: true } }),
      this.prisma.business.findMany({ where: { phone: { in: phones }, anonymisedAt: null }, select: { id: true, code: true, phone: true } }),
    ]);
    for (const b of businesses) out.set(b.phone, { type: 'business', id: b.id, code: b.code });
    for (const s of seekers) out.set(s.phone, { type: 'job_seeker', id: s.id, code: s.code });
    return out;
  }

  private async loadForAction(actor: LeadActor, id: string) {
    const row = typeof id === 'string' && id.length <= 64
      ? await this.prisma.referralLead.findFirst({ where: { AND: [{ id }, await this.visibleWhere(actor)] } })
      : null;
    if (!row) throw new NotFoundException('Lead not found');
    return row;
  }

  async take(actor: LeadActor, id: string) {
    if (actor.role !== 'call_agent') throw new ForbiddenException('Only a call agent takes a lead');
    const row = typeof id === 'string' && id.length <= 64 ? await this.prisma.referralLead.findUnique({ where: { id }, select: { assignedStaffId: true, status: true } }) : null;
    // Another agent's lead is not his to see (404, like the list).
    if (!row || row.status !== 'open' || (row.assignedStaffId && row.assignedStaffId !== actor.id)) throw new NotFoundException('Lead not found');
    const done = await this.prisma.referralLead.updateMany({
      where: { id, assignedStaffId: null, status: 'open' },
      data: { assignedStaffId: actor.id, assignedAt: this.now() },
    });
    if (done.count === 0) throw codedError(HttpStatus.CONFLICT, 'ALREADY_TAKEN', 'Another agent already has it.');
    const lead = await this.prisma.referralLead.findUnique({ where: { id }, select: { customerLeadId: true } });
    await markAppLeadContacted(this.prisma, lead?.customerLeadId);
    return { taken: true };
  }

  async assign(actor: LeadActor, id: string, staffId: unknown) {
    if (!['team_lead', 'manager', 'ceo'].includes(actor.role)) throw new ForbiddenException('Not allowed');
    const lead = await this.loadForAction(actor, id);
    if (typeof staffId !== 'string' || !staffId) throw new BadRequestException('staffId is required');
    const target = await this.prisma.staff.findFirst({ where: { id: staffId, role: 'call_agent', status: 'active' }, select: { id: true, code: true } });
    if (!target) throw new BadRequestException('Pick an active call agent');
    const team = await this.teamIds(actor);
    if (team && !team.includes(target.id)) throw new ForbiddenException('That agent is not in your team');
    await this.prisma.referralLead.update({ where: { id: lead.id }, data: { assignedStaffId: target.id, assignedAt: this.now() } });
    await markAppLeadContacted(this.prisma, lead.customerLeadId);
    await this.audit.log({
      actorId: actor.id,
      action: 'referral_lead.assigned',
      entityType: 'referral_lead',
      entityCode: lead.id,
      before: { assignedStaffId: lead.assignedStaffId },
      after: { assignedStaffId: target.id },
    });
    return { assigned: true, staffCode: target.code };
  }

  /** Close with an outcome. "registered" needs the record (found by the lead's number, or given by its ID). */
  async close(actor: LeadActor, id: string, body: { outcome?: unknown; note?: unknown; code?: unknown }) {
    const lead = await this.loadForAction(actor, id);
    if (actor.role === 'call_agent' && lead.assignedStaffId !== actor.id) throw new ForbiddenException('This lead is with another agent');
    if (lead.status !== 'open') throw codedError(HttpStatus.CONFLICT, 'ALREADY_CLOSED', 'This lead is already closed.');
    const outcome = body?.outcome;
    if (typeof outcome !== 'string' || !(REFERRAL_LEAD_OUTCOMES as readonly string[]).includes(outcome)) {
      throw new BadRequestException(`outcome must be one of ${REFERRAL_LEAD_OUTCOMES.join(', ')}`);
    }
    let subject: { type: string; id: string } | null = null;
    if (outcome === 'registered' || outcome === 'already_registered') {
      const code = typeof body.code === 'string' ? body.code.trim().toUpperCase() : '';
      if (code.startsWith('JS-')) {
        const row = await this.prisma.jobSeeker.findUnique({ where: { code }, select: { id: true } });
        if (row) subject = { type: 'job_seeker', id: row.id };
      } else if (code.startsWith('BZ-')) {
        const row = await this.prisma.business.findUnique({ where: { code }, select: { id: true } });
        if (row) subject = { type: 'business', id: row.id };
      } else {
        const found = (await this.registeredMatches([lead.phone])).get(lead.phone);
        if (found) subject = { type: found.type, id: found.id };
      }
      if (!subject) throw codedError(HttpStatus.CONFLICT, 'NOT_REGISTERED_YET', 'No record found. Register them first (with "referred by" this partner), or give the record\'s ID.');
    }
    const note = typeof body.note === 'string' ? body.note.trim().slice(0, 500) : '';
    const now = this.now();
    await this.prisma.referralLead.update({
      where: { id: lead.id },
      data: {
        status: 'closed',
        outcome,
        outcomeNote: note || null,
        closedAt: now,
        closedByStaffId: actor.id,
        subjectType: subject?.type ?? null,
        subjectId: subject?.id ?? null,
      },
    });
    await closeAppLead(this.prisma, lead.customerLeadId, outcome, subject);
    await this.inbox.leadHandled(lead.id, actor.id, 'closed', now);
    await this.audit.log({
      actorId: actor.id,
      action: 'referral_lead.closed',
      entityType: 'referral_lead',
      entityCode: lead.id,
      after: { outcome, subjectType: subject?.type ?? null, subjectId: subject?.id ?? null },
      reason: note || null,
    });
    return { closed: true, outcome };
  }
}
