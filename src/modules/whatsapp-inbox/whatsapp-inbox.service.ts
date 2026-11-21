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
import { mobileLookupValues, phoneLast4 } from '../../common/phone/indian-mobile';
import { MessagingService } from '../message/messaging.service';
import { agentTemplates, renderTemplate, whatsappTemplate } from '../message/whatsapp-templates';
import { NotificationService } from '../notification/notification.service';
import { notificationLink } from '../notification/notification.constants';
import { ReportingScopeService } from '../staff/reporting-scope.service';
import { ConsentLinkService } from '../consent/consent-link.service';
import { canAdvanceMessageStatus } from '../message/message-status';
import { WhatsAppInboxClock } from './whatsapp-inbox.clock';
import { LeadAgent, loadLeadAgents, ownAgentsOf, pickLeadAgent } from './lead-assignment';
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
  ) {}

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
      if (s.status !== 'sent') await this.messaging.applyProviderStatus(s.providerMessageId, s.status);
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
    const conversation = await this.conversationFor(message.phone, message.profileName);
    try {
      await this.prisma.whatsAppMessage.create({
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
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') return false;
      throw error;
    }
    const reopening = conversation.status === 'closed';
    const subject = conversation.subjectId ? null : await this.matchByPhone(message.phone);
    const updated = await this.prisma.whatsAppConversation.update({
      where: { id: conversation.id },
      data: {
        profileName: message.profileName ?? conversation.profileName,
        lastInboundAt: message.receivedAt,
        waitingSince: conversation.waitingSince && !reopening ? conversation.waitingSince : message.receivedAt,
        waitCountedAt: conversation.waitingSince && !reopening ? conversation.waitCountedAt : now,
        waitingWorkSeconds: conversation.waitingSince && !reopening ? conversation.waitingWorkSeconds : 0,
        teamLeadAlertedAt: conversation.waitingSince && !reopening ? conversation.teamLeadAlertedAt : null,
        managerAlertedAt: conversation.waitingSince && !reopening ? conversation.managerAlertedAt : null,
        subjectType: subject ? subject.type : conversation.subjectType,
        subjectId: subject ? subject.id : conversation.subjectId,
        // A new message after closing opens the lead again.
        status: 'open',
        openedAt: reopening ? message.receivedAt : conversation.openedAt,
        outcome: reopening ? null : conversation.outcome,
        outcomeNote: reopening ? null : conversation.outcomeNote,
        closedAt: reopening ? null : conversation.closedAt,
        closedByStaffId: reopening ? null : conversation.closedByStaffId,
      },
    });
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
   * message, the person gets the "we will call you by 10 AM" reply.
   */
  private async assign(conversation: WhatsAppConversation, now: Date, options: { allowAutoReply: boolean; agents?: LeadAgent[] }) {
    const agents = options.agents ?? (await loadLeadAgents(this.prisma, now));
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

  /** "Thanks! An agent will call you by 10 AM." Free text inside the window (they just wrote), the template otherwise. */
  private async sendAutoReply(conversation: WhatsAppConversation, now: Date) {
    // An automatic message: never to a person with a wrong number / do not call block.
    if (await this.messaging.messagingBlocked(conversation.subjectType, conversation.subjectId)) return;
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
    const agents = await loadLeadAgents(this.prisma, now);
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
      where: { status: 'open' },
      orderBy: { createdAt: 'asc' },
      take: 500,
      select: { id: true, assignedStaffId: true, referralId: true, customerLeadId: true },
    });
    for (const lead of leads) {
      if (lead.assignedStaffId) continue;
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
    return { open: open.length, matched, assigned, leadsAssigned, appLeadsPicked, teamLeadBells, managerBells, anyOnShift };
  }

  /** Team Lead bell after 15 working minutes unanswered, the Manager after 2 hours. */
  private async escalate(conversation: WhatsAppConversation, waitedSeconds: number, now: Date) {
    const result = { teamLead: false, manager: false };
    const wantTeamLead = waitedSeconds >= TEAM_LEAD_ALERT_SECONDS && !conversation.teamLeadAlertedAt;
    const wantManager = waitedSeconds >= MANAGER_ALERT_SECONDS && !conversation.managerAlertedAt;
    if (!wantTeamLead && !wantManager) return result;
    const chain = conversation.assignedStaffId ? await this.scope.chainOf(conversation.assignedStaffId) : null;
    const who = await this.displayName(conversation);
    const holder = conversation.assignedStaffId
      ? await this.prisma.staff.findUnique({ where: { id: conversation.assignedStaffId }, select: { code: true, name: true } })
      : null;
    const body = holder ? `With ${holder.code} ${holder.name}` : 'Not assigned: nobody on shift took it yet';
    if (wantTeamLead) {
      const recipients = chain?.teamLead
        ? [chain.teamLead.id]
        : (await this.prisma.staff.findMany({ where: { role: 'team_lead', status: 'active' }, select: { id: true } })).map((s) => s.id);
      for (const recipientStaffId of recipients) {
        await this.notifications.open({
          recipientStaffId,
          kind: WAITING_NOTIFICATION_KIND,
          title: `WhatsApp unanswered 15 min · ${who}`,
          body,
          link: notificationLink('team_lead', WAITING_NOTIFICATION_KIND),
          subjectType: CONVERSATION_SUBJECT,
          subjectId: conversation.id,
        }, now);
      }
      result.teamLead = recipients.length > 0;
    }
    if (wantManager) {
      const recipients = chain?.manager
        ? [chain.manager.id]
        : (await this.prisma.staff.findMany({ where: { role: 'manager', status: 'active' }, select: { id: true } })).map((s) => s.id);
      for (const recipientStaffId of recipients) {
        await this.notifications.open({
          recipientStaffId,
          kind: WAITING_NOTIFICATION_KIND,
          title: `WhatsApp unanswered 2 hours · ${who}`,
          body,
          link: notificationLink('manager', WAITING_NOTIFICATION_KIND),
          subjectType: CONVERSATION_SUBJECT,
          subjectId: conversation.id,
        }, now);
      }
      result.manager = recipients.length > 0;
    }
    return result;
  }

  // ------------------------------------------------------------------ staff screens

  /** Assigned agents a Team Lead or Manager looks after (themselves and everyone under them). */
  private async teamIds(actor: InboxActor): Promise<string[] | null> {
    if (actor.role === 'ceo') return null;
    return [actor.id, ...(await this.scope.peopleUnder(actor.id))];
  }

  private async visibleWhere(actor: InboxActor): Promise<Prisma.WhatsAppConversationWhereInput> {
    if (actor.role === 'call_agent') return { assignedStaffId: actor.id };
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
    if (await this.messaging.messagingBlocked(conversation.subjectType, conversation.subjectId)) {
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
        providerMessageId: null,
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
    if (await this.messaging.messagingBlocked(subject.type, subject.id)) {
      throw codedError(HttpStatus.CONFLICT, 'DO_NOT_CONTACT', 'This person asked not to be contacted (or the number is wrong).');
    }
    const sentBy = await this.sendLinkFor(kind as LinkKind, subject.id, actor.id);
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
  async sendLinkFor(kind: LinkKind, subjectId: string, staffId: string): Promise<'whatsapp' | 'sms' | null> {
    if (kind === 'registration') return (await this.consentLinks.createLink(subjectId, { channel: 'whatsapp' })).sentBy;
    if (kind === 'agreement') return (await this.consentLinks.createAgreementLink(subjectId, staffId, undefined, { channel: 'whatsapp' })).sentBy;
    return (await this.consentLinks.createReferralTermsLink(subjectId, staffId, undefined, { channel: 'whatsapp' })).sentBy;
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
  async link(actor: InboxActor, id: string, code: unknown) {
    const conversation = await this.load(actor, id);
    await this.assertCanAct(actor, conversation);
    const value = typeof code === 'string' ? code.trim().toUpperCase() : '';
    let subject: Subject | null = null;
    if (value.startsWith('JS-')) {
      const row = await this.prisma.jobSeeker.findUnique({ where: { code: value }, select: { id: true, code: true, name: true, anonymisedAt: true } });
      if (row && !row.anonymisedAt) subject = { type: 'job_seeker', id: row.id, code: row.code, name: row.name };
    } else if (value.startsWith('BZ-')) {
      const row = await this.prisma.business.findUnique({ where: { code: value }, select: { id: true, code: true, name: true, anonymisedAt: true } });
      if (row && !row.anonymisedAt) subject = { type: 'business', id: row.id, code: row.code, name: row.name };
    } else if (value.startsWith('RF-')) {
      const row = await this.prisma.referral.findUnique({ where: { code: value }, select: { id: true, code: true, name: true, anonymisedAt: true } });
      if (row && !row.anonymisedAt) subject = { type: 'referral', id: row.id, code: row.code, name: row.name };
    }
    if (!subject) throw new NotFoundException('No record with that ID');
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
      after: { subjectType: subject.type, subjectId: subject.id },
    });
    await this.logHistory(updated, 'whatsapp_conversation', 'received');
    return { linked: true, person: subject };
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
    const agents = (await loadLeadAgents(this.prisma, now)).filter((a) => !team || team.includes(a.id));
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
