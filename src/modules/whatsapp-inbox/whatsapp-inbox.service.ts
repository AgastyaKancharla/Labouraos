import {
  BadRequestException,
  ForbiddenException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, WhatsAppConversation } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import { codedError } from '../../common/http/coded-error';
import { FREE_TEXT_TEMPLATE, WHATSAPP_PROVIDER, WhatsAppProvider } from '../../common/whatsapp/whatsapp.interface';
import { mobileLookupValues, normaliseIndianMobile, phoneLast4 } from '../../common/phone/indian-mobile';
import { MessagingService } from '../message/messaging.service';
import { agentTemplates, renderTemplate, whatsappTemplate } from '../message/whatsapp-templates';
import { NotificationService } from '../notification/notification.service';
import { notificationLink } from '../notification/notification.constants';
import { ReportingScopeService } from '../staff/reporting-scope.service';
import { ConsentLinkService, LINK_SENT_BY_STAFF } from '../consent/consent-link.service';
import { canAdvanceMessageStatus } from '../message/message-status';
import { WhatsAppInboxClock } from './whatsapp-inbox.clock';
import { LeadCallService, issueRegistrationPrefill } from './lead-call.service';
import { WhatsAppEventsService } from './whatsapp-events.service';
import { OwnTeam } from '../../common/rbac/own-team';
import { LeadAgent, loadLeadAgents, ownAgentsOf, pickLeadAgent } from './lead-assignment';
import { PricingService } from '../pricing/pricing.service';
import { InboundWhatsAppMessage, ParsedWhatsAppWebhook } from './meta-webhook';
import { markAppLeadContacted, pickUpAppLeads } from '../referral/referral-lead-sync';

/** WhatsApp lets a business reply freely for 24 hours after the person's last message; after that only templates. */
export const REPLY_WINDOW_MS = 24 * 60 * 60 * 1000;
/** Team Lead bell after 15 working minutes unanswered; the Manager after 2 hours (rev 202). */
export const TEAM_LEAD_ALERT_SECONDS = 15 * 60;
export const MANAGER_ALERT_SECONDS = 2 * 60 * 60;
/** The off-shift reply goes at most once in this time per conversation. */
export const AUTO_REPLY_GAP_MS = 12 * 60 * 60 * 1000;
/** One sweep adds at most this much waiting time (the sweep runs every 2 minutes; a stalled worker never jumps the clock). */
const MAX_WAIT_STEP_SECONDS = 10 * 60;

export const CONVERSATION_SUBJECT = 'whatsapp_conversation';
export const WAITING_NOTIFICATION_KIND = 'whatsapp_waiting' as const;
export const LINK_FAILED_NOTIFICATION_KIND = 'whatsapp_link_failed' as const;
export const LEAD_WAITING_NOTIFICATION_KIND = 'referral_lead_waiting' as const;
export const REFERRAL_LEAD_SUBJECT = 'referral_lead';
/** "Send on WhatsApp": live links one person may get in 24 hours. */
export const WHATSAPP_LINKS_PER_DAY = 3;

/** Link templates "Send on WhatsApp" uses, and which link each is. */
const LINK_TEMPLATE_KIND: Record<string, LinkKind> = {
  consent_link: 'registration',
  agreement_link: 'agreement',
  referral_terms_link: 'referral_terms',
};

/** How an agent closes a WhatsApp lead. */
export const CONVERSATION_OUTCOMES = [
  'registered',
  'call_booked',
  'answered_question',
  'not_interested',
  'wrong_number',
  'spam',
] as const;
export type ConversationOutcome = (typeof CONVERSATION_OUTCOMES)[number];

export type LinkKind = 'registration' | 'agreement' | 'referral_terms';

export interface InboxActor {
  id: string;
  role: string;
}

type Subject = { type: 'job_seeker' | 'business' | 'referral'; id: string; code: string; name: string };

const OFFICE_ROLES = new Set(['team_lead', 'manager', 'ceo']);

function firstName(name: string | null | undefined): string {
  return (name ?? '').trim().split(/\s+/)[0] || 'there';
}

@Injectable()
export class WhatsAppInboxService {
  private readonly logger = new Logger(WhatsAppInboxService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly messaging: MessagingService,
    private readonly notifications: NotificationService,
    private readonly scope: ReportingScopeService,
    private readonly consentLinks: ConsentLinkService,
    private readonly clock: WhatsAppInboxClock,
    @Inject(WHATSAPP_PROVIDER) private readonly provider: WhatsAppProvider,
    private readonly leadCalls: LeadCallService,
    private readonly events: WhatsAppEventsService,
    private readonly pricing: PricingService,
  ) {}

  /** Every call agent with whether they are on shift now (their own shift, 21 Nov). */
  private async leadAgentsAt(now: Date): Promise<LeadAgent[]> {
    return loadLeadAgents(this.prisma, now, await this.pricing.current());
  }

  // ------------------------------------------------------------------ inbound

  /** Everything one webhook delivery carried. A message seen before (same provider id) adds nothing. */
  async receive(parsed: ParsedWhatsAppWebhook): Promise<{ received: number; duplicates: number; statuses: number }> {
    let received = 0;
    let duplicates = 0;
    for (const message of parsed.messages) {
      if (await this.receiveOne(message)) received += 1;
      else duplicates += 1;
    }
    let statuses = 0;
    for (const s of parsed.statuses) {
      if (s.status !== 'sent') {
        const applied = await this.messaging.applyProviderStatus(s.providerMessageId, s.status);
        if (applied && !applied.unchanged && s.status === 'failed') await this.onLinkMessageFailed(applied.id);
      }
      const row = await this.prisma.whatsAppMessage.findUnique({ where: { providerMessageId: s.providerMessageId }, select: { id: true, status: true } });
      if (row && canAdvanceMessageStatus(row.status, s.status)) {
        await this.prisma.whatsAppMessage.update({ where: { id: row.id }, data: { status: s.status } });
        statuses += 1;
      }
    }
    return { received, duplicates, statuses };
  }

  private async receiveOne(message: InboundWhatsAppMessage): Promise<boolean> {
    const now = this.clock.now();
    const first = await this.conversationFor(message.phone, message.profileName);
    const subject = first.subjectId ? null : await this.matchByPhone(message.phone);
    // The message row and the conversation change in one transaction, under a row lock
    // (two deliveries for one number never interleave); a repeat delivery changes nothing.
    const updated = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "WhatsAppConversation" WHERE "id" = ${first.id} FOR UPDATE`;
      const conversation = await tx.whatsAppConversation.findUniqueOrThrow({ where: { id: first.id } });
      const seen = await tx.whatsAppMessage.findUnique({ where: { providerMessageId: message.providerMessageId }, select: { id: true } });
      if (seen) return null;
      await tx.whatsAppMessage.create({
        data: {
          conversationId: conversation.id,
          direction: 'in',
          kind: message.kind,
          body: message.body,
          providerMessageId: message.providerMessageId,
          status: 'received',
          createdAt: message.receivedAt,
        },
      });
      const reopening = conversation.status === 'closed';
      const keepsWaiting = Boolean(conversation.waitingSince) && !reopening;
      // Deliveries can arrive out of order: the last inbound time never moves backwards.
      const lastInboundAt = conversation.lastInboundAt && conversation.lastInboundAt > message.receivedAt ? conversation.lastInboundAt : message.receivedAt;
      return tx.whatsAppConversation.update({
        where: { id: conversation.id },
        data: {
          profileName: message.profileName ?? conversation.profileName,
          lastInboundAt,
          waitingSince: keepsWaiting ? conversation.waitingSince : message.receivedAt,
          waitCountedAt: keepsWaiting ? conversation.waitCountedAt : now,
          waitingWorkSeconds: keepsWaiting ? conversation.waitingWorkSeconds : 0,
          teamLeadAlertedAt: keepsWaiting ? conversation.teamLeadAlertedAt : null,
          managerAlertedAt: keepsWaiting ? conversation.managerAlertedAt : null,
          subjectType: !conversation.subjectId && subject ? subject.type : conversation.subjectType,
          subjectId: !conversation.subjectId && subject ? subject.id : conversation.subjectId,
          // A new message after closing opens the lead again.
          status: 'open',
          openedAt: reopening ? message.receivedAt : conversation.openedAt,
          outcome: reopening ? null : conversation.outcome,
          outcomeNote: reopening ? null : conversation.outcomeNote,
          closedAt: reopening ? null : conversation.closedAt,
          closedByStaffId: reopening ? null : conversation.closedByStaffId,
        },
      });
    });
    if (!updated) return false;
    if (updated.subjectType && updated.subjectId) {
      await this.logHistory(updated, 'whatsapp_inbound', 'received');
    }
    await this.assign(updated, now, { allowAutoReply: true });
    return true;
  }

  /** The one conversation for a phone number (made on the first message). */
  private async conversationFor(phone: string, profileName: string | null): Promise<WhatsAppConversation> {
    const existing = await this.prisma.whatsAppConversation.findUnique({ where: { phone } });
    if (existing) return existing;
    try {
      return await this.prisma.whatsAppConversation.create({
        data: { phone, profileName, status: 'open', openedAt: this.clock.now() },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        return this.prisma.whatsAppConversation.findUniqueOrThrow({ where: { phone } });
      }
      throw error;
    }
  }

  /** The record this number belongs to: a job seeker first, then a business, then a referral partner. */
  async matchByPhone(phone: string): Promise<Subject | null> {
    const values = mobileLookupValues(phone);
    const seeker = await this.prisma.jobSeeker.findFirst({
      where: { anonymisedAt: null, OR: [{ phone: { in: values } }, { whatsappPhone: { in: values } }] },
      orderBy: { createdAt: 'desc' },
      select: { id: true, code: true, name: true },
    });
    if (seeker) return { type: 'job_seeker', ...seeker };
    const business = await this.prisma.business.findFirst({
      where: { anonymisedAt: null, OR: [{ phone: { in: values } }, { contactWhatsAppPhone: { in: values } }] },
      orderBy: { createdAt: 'desc' },
      select: { id: true, code: true, name: true },
    });
    if (business) return { type: 'business', ...business };
    const partner = await this.prisma.referral.findFirst({
      where: { anonymisedAt: null, OR: [{ phone: { in: values } }, { whatsappPhone: { in: values } }] },
      orderBy: { createdAt: 'desc' },
      select: { id: true, code: true, name: true },
    });
    if (partner) return { type: 'referral', ...partner };
    return null;
  }

  /**
   * Hands the conversation to an agent (rev 202, like missed calls): the
   * person's own agent if on shift, else the on-shift agent with the fewest
   * open items. A conversation already with an agent who is on shift stays.
   * With nobody on shift it waits for the next shift and, on an inbound
   * message, the person gets the "an agent will call you when our next shift starts" reply.
   */
  private async assign(conversation: WhatsAppConversation, now: Date, options: { allowAutoReply: boolean; agents?: LeadAgent[] }) {
    const agents = options.agents ?? (await this.leadAgentsAt(now));
    const current = conversation.assignedStaffId ? agents.find((a) => a.id === conversation.assignedStaffId) : undefined;
    if (current?.onShift) return conversation;
    const own = await ownAgentsOf(this.prisma, conversation.subjectType, conversation.subjectId);
    const pick = pickLeadAgent(agents, [...own, conversation.assignedStaffId]);
    if (pick) {
      const updated = await this.prisma.whatsAppConversation.update({
        where: { id: conversation.id },
        data: { assignedStaffId: pick.staffId, assignedAt: now, assignmentReason: pick.reason },
      });
      const agent = agents.find((a) => a.id === pick.staffId);
      if (agent) {
        agent.openItems += conversation.assignedStaffId === pick.staffId ? 0 : 1;
        agent.lastAssignedAt = now;
      }
      return updated;
    }
    if (options.allowAutoReply && (!conversation.autoReplyAt || now.getTime() - conversation.autoReplyAt.getTime() >= AUTO_REPLY_GAP_MS)) {
      await this.sendAutoReply(conversation, now);
    }
    return conversation;
  }

  /** The off-shift reply ("…an agent will call you when our next shift starts"). Free text inside the window (they just wrote), the template otherwise. */
  private async sendAutoReply(conversation: WhatsAppConversation, now: Date) {
    // An automatic message: never to a person with a wrong number / do not call block.
    if (await this.messaging.messagingBlocked(conversation.subjectType, conversation.subjectId)) return;
    if (await this.leadCalls.messagesBlockedOnNumber(conversation.phone)) return;
    const text = renderTemplate('whatsapp_off_shift_reply');
    const result = this.provider.sendTextMessage
      ? await this.provider.sendTextMessage(conversation.phone, text)
      : await this.provider.sendTemplateMessage(conversation.phone, 'whatsapp_off_shift_reply', {});
    await this.prisma.whatsAppMessage.create({
      data: {
        conversationId: conversation.id,
        direction: 'out',
        kind: 'auto',
        body: text,
        templateName: 'whatsapp_off_shift_reply',
        providerMessageId: result.status === 'sent' && result.messageId ? result.messageId : null,
        status: result.status,
        createdAt: now,
      },
    });
    await this.prisma.whatsAppConversation.update({
      where: { id: conversation.id },
      data: { autoReplyAt: now, lastOutboundAt: result.status === 'sent' ? now : conversation.lastOutboundAt },
    });
  }

  // ------------------------------------------------------------------ sweep

  /**
   * Every couple of minutes: link new leads that have since been registered,
   * hand out waiting conversations and partner leads to agents on shift,
   * count working waiting time and ring the Team Lead / Manager bells.
   */
  async sweep(now: Date = this.clock.now()) {
    const agents = await this.leadAgentsAt(now);
    const anyOnShift = agents.some((a) => a.onShift);
    let matched = 0;
    let assigned = 0;
    let leadsAssigned = 0;
    let teamLeadBells = 0;
    let managerBells = 0;

    const open = await this.prisma.whatsAppConversation.findMany({
      where: { status: 'open' },
      orderBy: [{ waitingSince: 'asc' }, { openedAt: 'asc' }],
      take: 500,
    });
    for (let conversation of open) {
      if (!conversation.subjectId) {
        const subject = await this.matchByPhone(conversation.phone);
        if (subject) {
          conversation = await this.prisma.whatsAppConversation.update({
            where: { id: conversation.id },
            data: { subjectType: subject.type, subjectId: subject.id },
          });
          matched += 1;
        }
      }
      const before = conversation.assignedStaffId;
      const holderOnShift = before ? agents.some((a) => a.id === before && a.onShift) : false;
      if (!holderOnShift && (conversation.waitingSince || !before)) {
        conversation = await this.assign(conversation, now, { allowAutoReply: false, agents });
        if (conversation.assignedStaffId !== before) assigned += 1;
      }
      if (conversation.waitingSince) {
        const from = (conversation.waitCountedAt ?? conversation.waitingSince).getTime();
        const step = anyOnShift ? Math.min(MAX_WAIT_STEP_SECONDS, Math.max(0, Math.floor((now.getTime() - from) / 1000))) : 0;
        const waited = conversation.waitingWorkSeconds + step;
        const bells = await this.escalate(conversation, waited, now);
        teamLeadBells += bells.teamLead ? 1 : 0;
        managerBells += bells.manager ? 1 : 0;
        await this.prisma.whatsAppConversation.update({
          where: { id: conversation.id },
          data: {
            waitingWorkSeconds: waited,
            waitCountedAt: now,
            teamLeadAlertedAt: bells.teamLead ? now : conversation.teamLeadAlertedAt,
            managerAlertedAt: bells.manager ? now : conversation.managerAlertedAt,
          },
        });
      }
    }

    // Referral partners' leads (share link page and the app's "Send a lead"): same rule
    // (the partner's assigned or registering agent if on shift).
    const appLeadsPicked = await pickUpAppLeads(this.prisma, now);
    const leads = await this.prisma.referralLead.findMany({
      where: { status: 'open', assignedStaffId: null },
      orderBy: { createdAt: 'asc' },
      take: 500,
      select: { id: true, assignedStaffId: true, referralId: true, customerLeadId: true },
    });
    for (const lead of leads) {
      const own = await ownAgentsOf(this.prisma, 'referral', lead.referralId);
      const pick = pickLeadAgent(agents, own);
      if (!pick) continue;
      const done = await this.prisma.referralLead.updateMany({
        where: { id: lead.id, assignedStaffId: null, status: 'open' },
        data: { assignedStaffId: pick.staffId, assignedAt: now },
      });
      if (done.count > 0) {
        leadsAssigned += 1;
        await markAppLeadContacted(this.prisma, lead.customerLeadId);
        const agent = agents.find((a) => a.id === pick.staffId);
        if (agent) {
          agent.openItems += 1;
          agent.lastAssignedAt = now;
        }
      }
    }
    const leadFollowUp = await this.followUpLeads(agents, anyOnShift, now);
    return { open: open.length, matched, assigned, leadsAssigned, appLeadsPicked, leadsMoved: leadFollowUp.moved, leadBells: leadFollowUp.bells, teamLeadBells, managerBells, anyOnShift };
  }

  /** Team Lead bell after 15 working minutes unanswered, the Manager after 2 hours. */
  private async escalate(conversation: WhatsAppConversation, waitedSeconds: number, now: Date) {
    return this.escalateItem(conversation, waitedSeconds, now, {
      kind: WAITING_NOTIFICATION_KIND,
      subjectType: CONVERSATION_SUBJECT,
      who: await this.displayName(conversation),
      what: 'WhatsApp unanswered',
    });
  }

  /** The same bells for anything that waits (a conversation, a partner's lead). */
  private async escalateItem(
    item: { id: string; assignedStaffId: string | null; teamLeadAlertedAt: Date | null; managerAlertedAt: Date | null },
    waitedSeconds: number,
    now: Date,
    opts: { kind: typeof WAITING_NOTIFICATION_KIND | typeof LEAD_WAITING_NOTIFICATION_KIND; subjectType: string; who: string; what: string },
  ) {
    const result = { teamLead: false, manager: false };
    const wantTeamLead = waitedSeconds >= TEAM_LEAD_ALERT_SECONDS && !item.teamLeadAlertedAt;
    const wantManager = waitedSeconds >= MANAGER_ALERT_SECONDS && !item.managerAlertedAt;
    if (!wantTeamLead && !wantManager) return result;
    const chain = item.assignedStaffId ? await this.scope.chainOf(item.assignedStaffId) : null;
    const holder = item.assignedStaffId
      ? await this.prisma.staff.findUnique({ where: { id: item.assignedStaffId }, select: { code: true, name: true } })
      : null;
    const body = holder ? `With ${holder.code} ${holder.name}` : 'Not assigned: nobody on shift took it yet';
    const ring = async (role: 'team_lead' | 'manager', boss: { id: string } | null | undefined, title: string) => {
      const recipients = boss
        ? [boss.id]
        : (await this.prisma.staff.findMany({ where: { role, status: 'active' }, select: { id: true } })).map((r) => r.id);
      for (const recipientStaffId of recipients) {
        await this.notifications.open({
          recipientStaffId,
          kind: opts.kind,
          title,
          body,
          link: notificationLink(role, opts.kind),
          subjectType: opts.subjectType,
          subjectId: item.id,
        }, now);
      }
      return recipients.length > 0;
    };
    if (wantTeamLead) result.teamLead = await ring('team_lead', chain?.teamLead, `${opts.what} 15 min · ${opts.who}`);
    if (wantManager) result.manager = await ring('manager', chain?.manager, `${opts.what} 2 hours · ${opts.who}`);
    return result;
  }

  /**
   * Partner leads (21 Nov review S8): one whose agent went off shift (or on
   * leave) moves to an agent on shift, like a waiting conversation; until the
   * first call it counts working waiting time and rings the Team Lead after 15
   * minutes, the Manager after 2 hours.
   */
  private async followUpLeads(agents: LeadAgent[], anyOnShift: boolean, now: Date) {
    let moved = 0;
    let bells = 0;
    const leads = await this.prisma.referralLead.findMany({
      where: { status: 'open' },
      orderBy: { createdAt: 'asc' },
      take: 500,
    });
    for (let lead of leads) {
      const holder = lead.assignedStaffId ? agents.find((a) => a.id === lead.assignedStaffId) : undefined;
      if (lead.assignedStaffId && !holder?.onShift && !lead.firstCalledAt) {
        const own = await ownAgentsOf(this.prisma, 'referral', lead.referralId);
        const pick = pickLeadAgent(agents, own.filter((id) => id !== lead.assignedStaffId));
        if (pick) {
          lead = await this.prisma.referralLead.update({ where: { id: lead.id }, data: { assignedStaffId: pick.staffId, assignedAt: now } });
          moved += 1;
          const agent = agents.find((a) => a.id === pick.staffId);
          if (agent) {
            agent.openItems += 1;
            agent.lastAssignedAt = now;
          }
        }
      }
      if (lead.firstCalledAt) continue;
      const from = (lead.waitCountedAt ?? lead.createdAt).getTime();
      const step = anyOnShift ? Math.min(MAX_WAIT_STEP_SECONDS, Math.max(0, Math.floor((now.getTime() - from) / 1000))) : 0;
      const waited = lead.waitingWorkSeconds + step;
      const rang = await this.escalateItem(lead, waited, now, {
        kind: LEAD_WAITING_NOTIFICATION_KIND,
        subjectType: REFERRAL_LEAD_SUBJECT,
        who: lead.name,
        what: 'Partner lead not called',
      });
      bells += (rang.teamLead ? 1 : 0) + (rang.manager ? 1 : 0);
      await this.prisma.referralLead.update({
        where: { id: lead.id },
        data: {
          waitingWorkSeconds: waited,
          waitCountedAt: now,
          teamLeadAlertedAt: rang.teamLead ? now : lead.teamLeadAlertedAt,
          managerAlertedAt: rang.manager ? now : lead.managerAlertedAt,
        },
      });
    }
    return { moved, bells };
  }

  /** A lead was called or closed: its wait stops and its bells clear. */
  async leadHandled(leadId: string, byStaffId: string, reason: string, now: Date = this.clock.now()) {
    await this.notifications.clear({ kind: LEAD_WAITING_NOTIFICATION_KIND, subjectType: REFERRAL_LEAD_SUBJECT, subjectId: leadId }, { byStaffId, reason }, now);
  }

  /** Call a partner's lead (the number never reaches the screen); the first call stops its wait. */
  async callLead(actor: InboxActor, leadId: string) {
    const lead = typeof leadId === 'string' && leadId.length <= 64 ? await this.prisma.referralLead.findUnique({ where: { id: leadId } }) : null;
    if (!lead || lead.status !== 'open' || lead.assignedStaffId !== actor.id) throw new NotFoundException('Lead not found');
    const placed = await this.leadCalls.call(actor, lead.phone, { type: REFERRAL_LEAD_SUBJECT, id: lead.id });
    const now = this.clock.now();
    await this.prisma.referralLead.updateMany({ where: { id: lead.id, firstCalledAt: null }, data: { firstCalledAt: now } });
    await this.leadHandled(lead.id, actor.id, 'called', now);
    return placed;
  }

  /** Register a partner's lead: name, "referred by" and a prefill reference for the number (never the number). */
  async leadRegistrationPrefill(actor: InboxActor, leadId: string) {
    const lead = typeof leadId === 'string' && leadId.length <= 64 ? await this.prisma.referralLead.findUnique({ where: { id: leadId } }) : null;
    if (!lead || lead.status !== 'open' || lead.assignedStaffId !== actor.id) throw new NotFoundException('Lead not found');
    const partner = await this.prisma.referral.findUnique({ where: { id: lead.referralId }, select: { id: true, code: true, name: true } });
    return {
      name: lead.name,
      heardFrom: 'referral_partner',
      referredBy: partner,
      lookingFor: lead.lookingFor,
      maskedPhone: `******${phoneLast4(lead.phone)}`,
      prefillRef: issueRegistrationPrefill(lead.phone, actor.id, this.clock.now()),
    };
  }

  // ------------------------------------------------------------------ staff screens

  /** Assigned agents a Team Lead or Manager looks after (themselves and everyone under them). */
  private async teamIds(actor: InboxActor): Promise<string[] | null> {
    if (actor.role === 'ceo') return null;
    return [actor.id, ...(await this.scope.peopleUnder(actor.id))];
  }

  private async visibleWhere(actor: InboxActor): Promise<Prisma.WhatsAppConversationWhereInput> {
    // A call agent sees his own and the unassigned ones (to take one); never another agent's.
    if (actor.role === 'call_agent') return { OR: [{ assignedStaffId: actor.id }, { assignedStaffId: null }] };
    if (!OFFICE_ROLES.has(actor.role)) throw new ForbiddenException('Not allowed');
    const team = await this.teamIds(actor);
    if (!team) return {};
    return { OR: [{ assignedStaffId: null }, { assignedStaffId: { in: team } }] };
  }

  private async load(actor: InboxActor, id: string): Promise<WhatsAppConversation> {
    const row = typeof id === 'string' && id.length <= 64
      ? await this.prisma.whatsAppConversation.findFirst({ where: { AND: [{ id }, await this.visibleWhere(actor)] } })
      : null;
    if (!row) throw new NotFoundException('Conversation not found');
    return row;
  }

  /** Who may write in it: the agent it is assigned to, or a Team Lead / Manager over that agent, or the CEO. */
  private async assertCanAct(actor: InboxActor, conversation: WhatsAppConversation) {
    if (actor.role === 'call_agent') {
      if (conversation.assignedStaffId !== actor.id) {
        throw codedError(HttpStatus.FORBIDDEN, 'NOT_YOURS', 'This conversation is with another agent.');
      }
      return;
    }
    if (!OFFICE_ROLES.has(actor.role)) throw new ForbiddenException('Not allowed');
  }

  private async subjectOf(conversation: Pick<WhatsAppConversation, 'subjectType' | 'subjectId'>): Promise<Subject | null> {
    const { subjectType, subjectId } = conversation;
    if (!subjectType || !subjectId) return null;
    if (subjectType === 'job_seeker') {
      const row = await this.prisma.jobSeeker.findUnique({ where: { id: subjectId }, select: { id: true, code: true, name: true } });
      return row ? { type: 'job_seeker', ...row } : null;
    }
    if (subjectType === 'business') {
      const row = await this.prisma.business.findUnique({ where: { id: subjectId }, select: { id: true, code: true, name: true } });
      return row ? { type: 'business', ...row } : null;
    }
    if (subjectType === 'referral') {
      const row = await this.prisma.referral.findUnique({ where: { id: subjectId }, select: { id: true, code: true, name: true } });
      return row ? { type: 'referral', ...row } : null;
    }
    return null;
  }

  private async displayName(conversation: WhatsAppConversation): Promise<string> {
    const subject = await this.subjectOf(conversation);
    if (subject) return `${subject.name} (${subject.code})`;
    return conversation.profileName ? `${conversation.profileName} (new)` : `New contact ···${phoneLast4(conversation.phone)}`;
  }

  private windowOf(conversation: WhatsAppConversation, now: Date) {
    const endsAt = conversation.lastInboundAt ? new Date(conversation.lastInboundAt.getTime() + REPLY_WINDOW_MS) : null;
    return { windowOpen: Boolean(endsAt && endsAt > now), windowEndsAt: endsAt?.toISOString() ?? null };
  }

  async list(actor: InboxActor, status: string | undefined) {
    const now = this.clock.now();
    const wanted = status === 'closed' ? 'closed' : 'open';
    const rows = await this.prisma.whatsAppConversation.findMany({
      where: { AND: [{ status: wanted }, await this.visibleWhere(actor)] },
      orderBy: wanted === 'open' ? [{ waitingSince: { sort: 'asc', nulls: 'last' } }, { lastInboundAt: 'desc' }] : [{ closedAt: 'desc' }],
      take: 200,
    });
    const staffIds = [...new Set(rows.map((r) => r.assignedStaffId).filter((v): v is string => Boolean(v)))];
    const staff = staffIds.length
      ? await this.prisma.staff.findMany({ where: { id: { in: staffIds } }, select: { id: true, code: true, name: true } })
      : [];
    const last = rows.length
      ? await this.prisma.whatsAppMessage.findMany({
          where: { conversationId: { in: rows.map((r) => r.id) } },
          orderBy: { createdAt: 'desc' },
          distinct: ['conversationId'],
          select: { conversationId: true, body: true, direction: true, createdAt: true },
        })
      : [];
    const out = [];
    for (const r of rows) {
      const subject = await this.subjectOf(r);
      const message = last.find((m) => m.conversationId === r.id);
      out.push({
        id: r.id,
        name: subject?.name ?? r.profileName ?? null,
        subjectType: subject?.type ?? null,
        subjectId: subject?.id ?? null,
        subjectCode: subject?.code ?? null,
        isNew: !subject,
        phone: r.phone,
        status: r.status,
        outcome: r.outcome,
        lastMessage: message ? { text: (message.body ?? '').slice(0, 120), direction: message.direction, at: message.createdAt.toISOString() } : null,
        lastInboundAt: r.lastInboundAt?.toISOString() ?? null,
        waitingSince: r.waitingSince?.toISOString() ?? null,
        waitingWorkMinutes: Math.floor(r.waitingWorkSeconds / 60),
        ...this.windowOf(r, now),
        assignedTo: staff.find((s) => s.id === r.assignedStaffId) ?? null,
        autoReplied: Boolean(r.autoReplyAt && r.waitingSince && r.autoReplyAt >= r.waitingSince),
      });
    }
    return { rows: out };
  }

  async thread(actor: InboxActor, id: string) {
    let conversation = await this.load(actor, id);
    const now = this.clock.now();
    if (!conversation.subjectId) {
      const subject = await this.matchByPhone(conversation.phone);
      if (subject) {
        conversation = await this.prisma.whatsAppConversation.update({ where: { id: conversation.id }, data: { subjectType: subject.type, subjectId: subject.id } });
      }
    }
    const [subject, messages, holder] = await Promise.all([
      this.subjectOf(conversation),
      this.prisma.whatsAppMessage.findMany({ where: { conversationId: conversation.id }, orderBy: { createdAt: 'asc' }, take: 300 }),
      conversation.assignedStaffId
        ? this.prisma.staff.findUnique({ where: { id: conversation.assignedStaffId }, select: { id: true, code: true, name: true } })
        : Promise.resolve(null),
    ]);
    const senders = [...new Set(messages.map((m) => m.sentByStaffId).filter((v): v is string => Boolean(v)))];
    const staff = senders.length ? await this.prisma.staff.findMany({ where: { id: { in: senders } }, select: { id: true, name: true } }) : [];
    const mine = actor.role !== 'call_agent' || conversation.assignedStaffId === actor.id;
    const window = this.windowOf(conversation, now);
    return {
      id: conversation.id,
      name: subject?.name ?? conversation.profileName ?? null,
      profileName: conversation.profileName,
      phone: conversation.phone,
      person: subject ? { type: subject.type, id: subject.id, code: subject.code, name: subject.name } : null,
      status: conversation.status,
      outcome: conversation.outcome,
      outcomeNote: conversation.outcomeNote,
      openedAt: conversation.openedAt.toISOString(),
      waitingSince: conversation.waitingSince?.toISOString() ?? null,
      waitingWorkMinutes: Math.floor(conversation.waitingWorkSeconds / 60),
      ...window,
      assignedTo: holder,
      canAct: mine && conversation.status === 'open',
      canTake: actor.role === 'call_agent' && !conversation.assignedStaffId,
      links: {
        registration: subject?.type === 'job_seeker',
        agreement: subject?.type === 'business',
        referral_terms: subject?.type === 'referral',
      },
      templates: agentTemplates().map((t) => ({ name: t.name, label: t.label, text: renderTemplate(t.name, { firstName: firstName(subject?.name ?? conversation.profileName) }) })),
      outcomes: CONVERSATION_OUTCOMES,
      messages: messages.map((m) => ({
        id: m.id,
        direction: m.direction,
        kind: m.kind,
        text: m.body ?? '',
        templateName: m.templateName,
        status: m.status,
        at: m.createdAt.toISOString(),
        by: m.sentByStaffId ? staff.find((s) => s.id === m.sentByStaffId)?.name ?? null : m.direction === 'out' ? 'Laboura' : null,
      })),
    };
  }

  /** A free-text reply, only inside the 24-hour window. */
  async reply(actor: InboxActor, id: string, text: unknown) {
    const conversation = await this.load(actor, id);
    await this.assertCanAct(actor, conversation);
    const body = typeof text === 'string' ? text.trim() : '';
    if (!body) throw new BadRequestException('Type a reply');
    if (body.length > 1000) throw new BadRequestException('A reply is at most 1000 characters');
    const now = this.clock.now();
    if (!this.windowOf(conversation, now).windowOpen) {
      throw codedError(HttpStatus.CONFLICT, 'WINDOW_CLOSED', 'More than 24 hours since their last message: send a template instead.');
    }
    if (!this.provider.sendTextMessage) {
      throw codedError(HttpStatus.SERVICE_UNAVAILABLE, 'TEXT_NOT_SUPPORTED', 'WhatsApp replies are not set up yet.');
    }
    const result = await this.provider.sendTextMessage(conversation.phone, body);
    await this.prisma.whatsAppMessage.create({
      data: {
        conversationId: conversation.id,
        direction: 'out',
        kind: 'text',
        body,
        templateName: FREE_TEXT_TEMPLATE,
        providerMessageId: result.status === 'sent' && result.messageId ? result.messageId : null,
        status: result.status,
        sentByStaffId: actor.id,
        createdAt: now,
      },
    });
    if (result.status !== 'sent') {
      throw codedError(HttpStatus.BAD_GATEWAY, 'SEND_FAILED', 'WhatsApp did not take the message. Try again, or call them.');
    }
    await this.answered(conversation, actor, now, 'whatsapp_reply');
    return { sent: true };
  }

  /** A template (after the window, or any time): the person can answer and the window opens again. */
  async sendTemplate(actor: InboxActor, id: string, name: unknown) {
    const conversation = await this.load(actor, id);
    await this.assertCanAct(actor, conversation);
    const def = typeof name === 'string' ? whatsappTemplate(name) : null;
    if (!def || !def.agentPickable) throw new BadRequestException('Pick one of the templates');
    if (await this.blockedConversation(conversation)) {
      throw codedError(HttpStatus.CONFLICT, 'DO_NOT_CONTACT', 'This person asked not to be contacted (or the number is wrong).');
    }
    const subject = await this.subjectOf(conversation);
    const variables = { firstName: firstName(subject?.name ?? conversation.profileName) };
    const now = this.clock.now();
    const row = await this.messaging.send({
      channel: 'whatsapp',
      template: def.name,
      subjectType: subject?.type ?? CONVERSATION_SUBJECT,
      subjectId: subject?.id ?? conversation.id,
      recipientPhone: conversation.phone,
      variables,
      contactAttempt: false,
    });
    await this.prisma.whatsAppMessage.create({
      data: {
        conversationId: conversation.id,
        direction: 'out',
        kind: 'template',
        body: renderTemplate(def.name, variables),
        templateName: def.name,
        providerMessageId: row.status === 'sent' ? row.providerMessageId : null,
        status: row.status === 'sent' ? 'sent' : 'failed',
        sentByStaffId: actor.id,
        createdAt: now,
      },
    });
    if (row.status !== 'sent') {
      throw codedError(HttpStatus.BAD_GATEWAY, 'SEND_FAILED', 'WhatsApp did not take the message. Try again, or call them.');
    }
    await this.answered(conversation, actor, now, null);
    return { sent: true };
  }

  /** Quick button: send the person's link (registration, agreement, partner terms) on WhatsApp. */
  async sendLink(actor: InboxActor, id: string, kind: unknown) {
    const conversation = await this.load(actor, id);
    await this.assertCanAct(actor, conversation);
    const subject = await this.subjectOf(conversation);
    const need: Record<LinkKind, Subject['type']> = { registration: 'job_seeker', agreement: 'business', referral_terms: 'referral' };
    if (typeof kind !== 'string' || !(kind in need)) throw new BadRequestException('kind must be registration, agreement or referral_terms');
    if (!subject || subject.type !== need[kind as LinkKind]) {
      throw codedError(HttpStatus.CONFLICT, 'REGISTER_FIRST', 'Register them first: this link needs their record.');
    }
    if ((await this.messaging.messagingBlocked(subject.type, subject.id)) || (await this.leadCalls.messagesBlockedOnNumber(conversation.phone))) {
      throw codedError(HttpStatus.CONFLICT, 'DO_NOT_CONTACT', 'This person asked not to be contacted (or the number is wrong).');
    }
    // To the number the person wrote from only when it is the record's own phone or WhatsApp
    // number; a record a Team Lead linked with another number gets it on its own number.
    const recipient = (await this.recordNumbers(subject.type, subject.id)).some((p) => mobileLookupValues(conversation.phone).includes(p))
      ? conversation.phone
      : undefined;
    const sentBy = await this.sendLinkFor(kind as LinkKind, subject.id, actor.id, recipient);
    const now = this.clock.now();
    const label = kind === 'registration' ? 'Registration link' : kind === 'agreement' ? 'Agreement link' : 'Partner terms link';
    // The link itself is never stored here (it opens the person's page).
    await this.prisma.whatsAppMessage.create({
      data: {
        conversationId: conversation.id,
        direction: 'out',
        kind: 'template',
        body: `${label} sent${sentBy === 'sms' ? ' by SMS (WhatsApp did not take it)' : ''}`,
        templateName: kind === 'registration' ? 'consent_link' : kind === 'agreement' ? 'agreement_link' : 'referral_terms_link',
        status: sentBy ? 'sent' : 'failed',
        sentByStaffId: actor.id,
        createdAt: now,
      },
    });
    if (!sentBy) throw codedError(HttpStatus.BAD_GATEWAY, 'SEND_FAILED', 'Neither WhatsApp nor SMS took the link. Try again.');
    await this.answered(conversation, actor, now, null);
    return { sent: true, sentBy };
  }

  /** "Send on WhatsApp" for a record (next to Resend): WhatsApp first, SMS as fallback. */
  async sendLinkFor(kind: LinkKind, subjectId: string, staffId: string, recipientPhone?: string): Promise<'whatsapp' | 'sms' | null> {
    // At most WHATSAPP_LINKS_PER_DAY links on WhatsApp for one person in 24 hours.
    const template = Object.keys(LINK_TEMPLATE_KIND).find((t) => LINK_TEMPLATE_KIND[t] === kind)!;
    const sentToday = await this.prisma.messageLog.count({
      where: { subjectId, template, channel: 'whatsapp', relatedType: LINK_SENT_BY_STAFF, status: { notIn: ['failed', 'blocked'] }, createdAt: { gte: new Date(this.clock.now().getTime() - 24 * 60 * 60 * 1000) } },
    });
    if (sentToday >= WHATSAPP_LINKS_PER_DAY) {
      throw codedError(HttpStatus.TOO_MANY_REQUESTS, 'WHATSAPP_LINK_LIMIT', `At most ${WHATSAPP_LINKS_PER_DAY} links on WhatsApp a day for one person. Use Resend (SMS) or call them.`);
    }
    const extras = { channel: 'whatsapp' as const, sentByStaffId: staffId, ...(recipientPhone ? { recipientPhone } : {}) };
    if (kind === 'registration') return (await this.consentLinks.createLink(subjectId, extras)).sentBy;
    if (kind === 'agreement') return (await this.consentLinks.createAgreementLink(subjectId, staffId, undefined, extras)).sentBy;
    return (await this.consentLinks.createReferralTermsLink(subjectId, staffId, undefined, extras)).sentBy;
  }

  /**
   * WhatsApp took a link and failed it later (no WhatsApp on that number, 21 Nov
   * review S4): a fresh link goes by SMS at once (the earlier link keeps working)
   * and the agent who sent it gets a bell. Runs once per message (a repeated
   * "failed" status changes nothing).
   */
  private async onLinkMessageFailed(messageLogId: string) {
    // The webhook must always answer 200: anything that goes wrong here is logged, never thrown.
    try {
      const row = await this.prisma.messageLog.findUnique({ where: { id: messageLogId } });
      if (!row || row.channel !== 'whatsapp' || !row.subjectId) return;
      const kind = LINK_TEMPLATE_KIND[row.template];
      if (!kind) {
        // An automatic event message to someone without WhatsApp: once by SMS (never again on WhatsApp).
        await this.events.smsFallbackForFailed(row);
        return;
      }
      const staffId = row.relatedType === LINK_SENT_BY_STAFF ? row.relatedId : null;
      // A fresh link by SMS; the earlier links keep working; not a contact attempt (hit rule).
      const fallback = { revokeOthers: false, contactAttempt: false } as const;
      let sms: 'sms' | 'whatsapp' | null = null;
      if (kind === 'registration') sms = (await this.consentLinks.createLink(row.subjectId, fallback)).sentBy;
      else if (kind === 'agreement') sms = (await this.consentLinks.createAgreementLink(row.subjectId, staffId, undefined, { contactAttempt: false })).sentBy;
      else sms = (await this.consentLinks.createReferralTermsLink(row.subjectId, staffId, undefined, fallback)).sentBy;
      if (!staffId) return;
      const subject = await this.subjectOf({ subjectType: row.subjectType, subjectId: row.subjectId });
      const staff = await this.prisma.staff.findUnique({ where: { id: staffId }, select: { role: true } });
      await this.notifications.open({
        recipientStaffId: staffId,
        kind: LINK_FAILED_NOTIFICATION_KIND,
        title: sms ? `WhatsApp did not reach ${subject?.code ?? 'them'}: the link went by SMS` : `WhatsApp did not reach ${subject?.code ?? 'them'}, and SMS failed too`,
        body: sms ? 'A fresh link was sent by SMS; the earlier one still works.' : 'Call them and resend the link.',
        link: staff ? notificationLink(staff.role, LINK_FAILED_NOTIFICATION_KIND) : null,
        subjectType: 'message_log',
        subjectId: row.id,
        once: true,
      });
    } catch (error) {
      this.logger.warn(`SMS fallback for failed WhatsApp message ${messageLogId} did not go: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /** The record's own phone and WhatsApp numbers (stored form). */
  private async recordNumbers(subjectType: string, subjectId: string): Promise<string[]> {
    const row = subjectType === 'job_seeker'
      ? await this.prisma.jobSeeker.findUnique({ where: { id: subjectId }, select: { phone: true, whatsappPhone: true } }).then((r) => r && [r.phone, r.whatsappPhone])
      : subjectType === 'business'
        ? await this.prisma.business.findUnique({ where: { id: subjectId }, select: { phone: true, contactWhatsAppPhone: true } }).then((r) => r && [r.phone, r.contactWhatsAppPhone])
        : subjectType === 'referral'
          ? await this.prisma.referral.findUnique({ where: { id: subjectId }, select: { phone: true, whatsappPhone: true } }).then((r) => r && [r.phone, r.whatsappPhone])
          : null;
    return (row ?? []).filter((p): p is string => Boolean(p)).map((p) => normaliseIndianMobile(p)!);
  }

  /** A live wrong number / do not call on the linked record, or on any record with this number. */
  private async blockedConversation(conversation: WhatsAppConversation): Promise<boolean> {
    if (await this.messaging.messagingBlocked(conversation.subjectType, conversation.subjectId)) return true;
    return this.leadCalls.messagesBlockedOnNumber(conversation.phone);
  }

  /** Call a new person (no record yet) from the conversation: the number never reaches the screen. */
  async callConversation(actor: InboxActor, id: string) {
    const conversation = await this.load(actor, id);
    await this.assertCanAct(actor, conversation);
    // A linked record is called through its own Call (consent and calling window checks).
    if (conversation.subjectType && conversation.subjectId) {
      throw codedError(HttpStatus.CONFLICT, 'USE_RECORD_CALL', 'Use Call on their record.', { subjectType: conversation.subjectType, subjectId: conversation.subjectId });
    }
    return this.leadCalls.call(actor, conversation.phone, { type: CONVERSATION_SUBJECT, id: conversation.id });
  }

  /** Register a new person from the conversation: name, heard from WhatsApp and a prefill reference for the number. */
  async registrationPrefill(actor: InboxActor, id: string) {
    const conversation = await this.load(actor, id);
    await this.assertCanAct(actor, conversation);
    return {
      name: conversation.profileName ?? '',
      heardFrom: 'whatsapp',
      maskedPhone: `******${phoneLast4(conversation.phone)}`,
      prefillRef: issueRegistrationPrefill(conversation.phone, actor.id, this.clock.now()),
    };
  }

  /** A person answered: the wait stops, the bells clear. */
  private async answered(conversation: WhatsAppConversation, actor: InboxActor, now: Date, historyTemplate: string | null) {
    const updated = await this.prisma.whatsAppConversation.update({
      where: { id: conversation.id },
      data: {
        lastOutboundAt: now,
        waitingSince: null,
        waitCountedAt: null,
        waitingWorkSeconds: 0,
        teamLeadAlertedAt: null,
        managerAlertedAt: null,
      },
    });
    await this.notifications.clear(
      { kind: WAITING_NOTIFICATION_KIND, subjectType: CONVERSATION_SUBJECT, subjectId: conversation.id },
      { byStaffId: actor.id, reason: 'answered' },
      now,
    );
    if (historyTemplate && updated.subjectType && updated.subjectId) await this.logHistory(updated, historyTemplate, 'sent');
  }

  /** Close the lead with an outcome (every WhatsApp lead ends with one). */
  async close(actor: InboxActor, id: string, outcome: unknown, note: unknown) {
    const conversation = await this.load(actor, id);
    await this.assertCanAct(actor, conversation);
    if (typeof outcome !== 'string' || !(CONVERSATION_OUTCOMES as readonly string[]).includes(outcome)) {
      throw new BadRequestException(`outcome must be one of ${CONVERSATION_OUTCOMES.join(', ')}`);
    }
    const text = typeof note === 'string' ? note.trim().slice(0, 500) : '';
    let subjectType = conversation.subjectType;
    let subjectId = conversation.subjectId;
    if (outcome === 'registered' && !subjectId) {
      const subject = await this.matchByPhone(conversation.phone);
      if (!subject) {
        throw codedError(HttpStatus.CONFLICT, 'NOT_REGISTERED_YET', 'No record has this WhatsApp number yet. Register them with this number first, or link the record by its ID.');
      }
      subjectType = subject.type;
      subjectId = subject.id;
    }
    const now = this.clock.now();
    const updated = await this.prisma.whatsAppConversation.update({
      where: { id: conversation.id },
      data: {
        status: 'closed',
        outcome,
        outcomeNote: text || null,
        closedAt: now,
        closedByStaffId: actor.id,
        waitingSince: null,
        waitCountedAt: null,
        waitingWorkSeconds: 0,
        subjectType,
        subjectId,
      },
    });
    await this.notifications.clear(
      { kind: WAITING_NOTIFICATION_KIND, subjectType: CONVERSATION_SUBJECT, subjectId: conversation.id },
      { byStaffId: actor.id, reason: 'closed' },
      now,
    );
    await this.audit.log({
      actorId: actor.id,
      action: 'whatsapp.conversation_closed',
      entityType: 'whatsapp_conversation',
      entityCode: conversation.id,
      after: { outcome, subjectType, subjectId },
      reason: text || null,
    });
    if (updated.subjectType && updated.subjectId) await this.logHistory(updated, `whatsapp_outcome_${outcome}`, 'sent');
    return { closed: true, outcome };
  }

  /** Link a new lead to the record made for them (by its ID, e.g. JS-00012). */
  async link(actor: InboxActor, id: string, code: unknown, reason?: unknown) {
    const conversation = await this.load(actor, id);
    await this.assertCanAct(actor, conversation);
    const value = typeof code === 'string' ? code.trim().toUpperCase() : '';
    type Found = Subject & { phones: Array<string | null> };
    let subject: Found | null = null;
    if (value.startsWith('JS-')) {
      const row = await this.prisma.jobSeeker.findUnique({ where: { code: value }, select: { id: true, code: true, name: true, anonymisedAt: true, phone: true, whatsappPhone: true } });
      if (row && !row.anonymisedAt) subject = { type: 'job_seeker', id: row.id, code: row.code, name: row.name, phones: [row.phone, row.whatsappPhone] };
    } else if (value.startsWith('BZ-')) {
      const row = await this.prisma.business.findUnique({ where: { code: value }, select: { id: true, code: true, name: true, anonymisedAt: true, phone: true, contactWhatsAppPhone: true } });
      if (row && !row.anonymisedAt) subject = { type: 'business', id: row.id, code: row.code, name: row.name, phones: [row.phone, row.contactWhatsAppPhone] };
    } else if (value.startsWith('RF-')) {
      const row = await this.prisma.referral.findUnique({ where: { code: value }, select: { id: true, code: true, name: true, anonymisedAt: true, phone: true, whatsappPhone: true } });
      if (row && !row.anonymisedAt) subject = { type: 'referral', id: row.id, code: row.code, name: row.name, phones: [row.phone, row.whatsappPhone] };
    }
    if (!subject) throw new NotFoundException('No record with that ID');
    // Only a record with this WhatsApp number links by itself; anything else is a Team Lead's decision.
    const sameNumber = subject.phones.some((p) => p && mobileLookupValues(conversation.phone).includes(normaliseIndianMobile(p)!));
    const why = typeof reason === 'string' ? reason.trim().slice(0, 300) : '';
    if (!sameNumber) {
      if (!OFFICE_ROLES.has(actor.role)) {
        throw codedError(HttpStatus.CONFLICT, 'NUMBER_DOES_NOT_MATCH', "That record has another number. Ask your Team Lead to link it.");
      }
      if (!why) throw new BadRequestException('Linking a record with another number needs a reason');
      if (!(await this.recordInScope(actor, subject.type, subject.id))) throw new NotFoundException('No record with that ID');
    }
    const updated = await this.prisma.whatsAppConversation.update({
      where: { id: conversation.id },
      data: { subjectType: subject.type, subjectId: subject.id },
    });
    await this.audit.log({
      actorId: actor.id,
      action: 'whatsapp.conversation_linked',
      entityType: 'whatsapp_conversation',
      entityCode: conversation.id,
      before: { subjectType: conversation.subjectType, subjectId: conversation.subjectId },
      after: { subjectType: subject.type, subjectId: subject.id, sameNumber },
      reason: why || null,
    });
    // History rows already written stay with whoever they were written for; from now on this record's.
    await this.logHistory(updated, 'whatsapp_conversation', 'received');
    return { linked: true, person: { type: subject.type, id: subject.id, code: subject.code, name: subject.name } };
  }

  /** A Team Lead links only records of their team (or with no owner); a Manager those under them; the CEO any. */
  private async recordInScope(actor: InboxActor, subjectType: string, subjectId: string): Promise<boolean> {
    if (actor.role === 'ceo') return true;
    const owners = await ownAgentsOf(this.prisma, subjectType, subjectId);
    if (owners.length === 0) return true;
    if (actor.role === 'team_lead') return new OwnTeam(this.prisma).includesAny(actor.id, owners);
    const under = await this.scope.peopleUnder(actor.id);
    return owners.some((o) => o === actor.id || under.includes(o));
  }

  /** A call agent takes an unassigned conversation, for himself only. */
  async take(actor: InboxActor, id: string) {
    if (actor.role !== 'call_agent') throw new ForbiddenException('Only a call agent takes a conversation');
    const row = typeof id === 'string' && id.length <= 64 ? await this.prisma.whatsAppConversation.findUnique({ where: { id } }) : null;
    // Another agent's conversation is not his to see (404, like the thread).
    if (!row || row.status !== 'open' || (row.assignedStaffId && row.assignedStaffId !== actor.id)) throw new NotFoundException('Conversation not found');
    const now = this.clock.now();
    const done = await this.prisma.whatsAppConversation.updateMany({
      where: { id, assignedStaffId: null, status: 'open' },
      data: { assignedStaffId: actor.id, assignedAt: now, assignmentReason: 'taken' },
    });
    if (done.count === 0) throw codedError(HttpStatus.CONFLICT, 'ALREADY_TAKEN', 'Another agent already has it.');
    return { taken: true };
  }

  /** Team Lead (own team), Manager (people under them) or CEO hands a conversation to a call agent. */
  async reassign(actor: InboxActor, id: string, staffId: unknown) {
    if (!OFFICE_ROLES.has(actor.role)) throw new ForbiddenException('Not allowed');
    const conversation = await this.load(actor, id);
    if (typeof staffId !== 'string' || !staffId) throw new BadRequestException('staffId is required');
    const target = await this.prisma.staff.findFirst({ where: { id: staffId, role: 'call_agent', status: 'active' }, select: { id: true, code: true } });
    if (!target) throw new BadRequestException('Pick an active call agent');
    const team = await this.teamIds(actor);
    if (team && !team.includes(target.id)) throw new ForbiddenException('That agent is not in your team');
    const now = this.clock.now();
    await this.prisma.whatsAppConversation.update({
      where: { id: conversation.id },
      data: { assignedStaffId: target.id, assignedAt: now, assignmentReason: 'manual' },
    });
    await this.audit.log({
      actorId: actor.id,
      action: 'whatsapp.conversation_assigned',
      entityType: 'whatsapp_conversation',
      entityCode: conversation.id,
      before: { assignedStaffId: conversation.assignedStaffId },
      after: { assignedStaffId: target.id },
    });
    return { assigned: true, staffCode: target.code };
  }

  /**
   * Leave / no-show handover hook (for the leave approval, Builder B): moves an
   * agent's open WhatsApp conversations and partner leads to the teammate the
   * Team Lead picked, or (toStaffId null) leaves them unassigned so the next
   * sweep spreads them across the agents on shift (fewest open first).
   * Audited by the caller's approval; returns how many moved.
   */
  async handOver(fromStaffId: string, toStaffId: string | null, now: Date = this.clock.now()) {
    const conversations = await this.prisma.whatsAppConversation.updateMany({
      where: { assignedStaffId: fromStaffId, status: 'open' },
      data: { assignedStaffId: toStaffId, assignedAt: toStaffId ? now : null, assignmentReason: toStaffId ? 'manual' : null },
    });
    const leads = await this.prisma.referralLead.updateMany({
      where: { assignedStaffId: fromStaffId, status: 'open' },
      data: { assignedStaffId: toStaffId, assignedAt: toStaffId ? now : null },
    });
    return { conversations: conversations.count, referralLeads: leads.count };
  }

  /** The Team Lead's WhatsApp widget: what waits, for how long, with whom. */
  async overview(actor: InboxActor) {
    if (!OFFICE_ROLES.has(actor.role)) throw new ForbiddenException('Not allowed');
    const now = this.clock.now();
    const where = await this.visibleWhere(actor);
    const rows = await this.prisma.whatsAppConversation.findMany({
      where: { AND: [{ status: 'open' }, where] },
      orderBy: [{ waitingSince: { sort: 'asc', nulls: 'last' } }],
      take: 500,
    });
    const team = await this.teamIds(actor);
    const agents = (await this.leadAgentsAt(now)).filter((a) => !team || team.includes(a.id));
    const staff = agents.length
      ? await this.prisma.staff.findMany({ where: { id: { in: agents.map((a) => a.id) } }, select: { id: true, code: true, name: true } })
      : [];
    const todayStart = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const [closedToday, leadsOpen, leadsUnassigned] = await Promise.all([
      this.prisma.whatsAppConversation.count({ where: { AND: [{ status: 'closed', closedAt: { gte: todayStart } }, where] } }),
      this.prisma.referralLead.count({ where: { status: 'open', ...(team ? { OR: [{ assignedStaffId: null }, { assignedStaffId: { in: team } }] } : {}) } }),
      this.prisma.referralLead.count({ where: { status: 'open', assignedStaffId: null } }),
    ]);
    const waiting = rows.filter((r) => r.waitingSince);
    const waitingList = [];
    for (const r of waiting.slice(0, 20)) {
      waitingList.push({
        id: r.id,
        name: await this.displayName(r),
        waitingWorkMinutes: Math.floor(r.waitingWorkSeconds / 60),
        waitingSince: r.waitingSince!.toISOString(),
        assignedTo: staff.find((s) => s.id === r.assignedStaffId) ?? (r.assignedStaffId ? { id: r.assignedStaffId, code: '', name: '' } : null),
      });
    }
    return {
      open: rows.length,
      waiting: waiting.length,
      waitingOver15: waiting.filter((r) => r.waitingWorkSeconds >= TEAM_LEAD_ALERT_SECONDS).length,
      unassigned: rows.filter((r) => !r.assignedStaffId).length,
      closedLast24h: closedToday,
      referralLeadsOpen: leadsOpen,
      referralLeadsUnassigned: leadsUnassigned,
      onShift: agents.filter((a) => a.onShift).length,
      agents: agents.map((a) => ({
        ...staff.find((s) => s.id === a.id)!,
        onShift: a.onShift,
        open: rows.filter((r) => r.assignedStaffId === a.id).length,
        waiting: waiting.filter((r) => r.assignedStaffId === a.id).length,
      })),
      waitingList,
    };
  }

  /** Every conversation is a tracked lead: it shows in the person's message history. */
  private async logHistory(conversation: WhatsAppConversation, template: string, status: string) {
    await this.prisma.messageLog.create({
      data: {
        channel: 'whatsapp',
        template,
        subjectType: conversation.subjectType!,
        subjectId: conversation.subjectId!,
        relatedType: CONVERSATION_SUBJECT,
        relatedId: conversation.id,
        status,
        sentAt: status === 'sent' ? this.clock.now() : null,
      },
    });
  }
}
