import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import { NotificationService } from '../notification/notification.service';
import { notificationLink } from '../notification/notification.constants';

/** Placement fees still waiting for the bank. */
const UNPAID = ['pending', 'failed'];

/**
 * FN-Invoices "Tell the account agent" on an unpaid placement fee: a bell to
 * the business's account agent (the field agent who looks after it) to call
 * the owner. Agents never see rupees (guide, money at risk as counts only),
 * so the bell names the business and placement and how long it has waited —
 * no amount. Audited.
 */
@Injectable()
export class FinanceInvoiceActionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationService,
  ) {}

  async tellAccountAgent(actorId: string, paymentId: string, now = new Date()) {
    const payment = await this.prisma.payment.findUnique({
      where: { id: paymentId },
      select: {
        id: true,
        code: true,
        type: true,
        status: true,
        createdAt: true,
        placement: { select: { id: true, code: true, business: { select: { id: true, code: true, name: true, accountAgentId: true } } } },
        business: { select: { id: true, code: true, name: true, accountAgentId: true } },
      },
    });
    if (!payment || !['placement_fee', 'bypass_charge'].includes(payment.type)) throw new NotFoundException('Placement fee not found');
    if (!UNPAID.includes(payment.status)) throw new BadRequestException('This fee is not waiting for payment');
    const business = payment.placement?.business ?? payment.business;
    if (!business) throw new BadRequestException('This fee is not linked to a business');
    if (!business.accountAgentId) throw new BadRequestException(`${business.name} has no account agent yet: ask the Team Lead to give it one`);
    const agent = await this.prisma.staff.findUnique({ where: { id: business.accountAgentId }, select: { id: true, code: true, name: true, role: true, status: true } });
    if (!agent || agent.status !== 'active') throw new BadRequestException(`${business.name}'s account agent is not active: ask the Team Lead to move the business`);
    const days = Math.max(0, Math.floor((now.getTime() - payment.createdAt.getTime()) / 86_400_000));
    const placementCode = payment.placement?.code ?? null;
    await this.notifications.open(
      {
        recipientStaffId: agent.id,
        kind: 'fee_unpaid_reminder',
        title: `${business.name} has not paid the ${payment.type === 'bypass_charge' ? 'no-bypass charge' : 'placement fee'}${placementCode ? ` for ${placementCode}` : ''}`,
        body: `Waiting ${days === 1 ? '1 day' : `${days} days`} · please call the owner (Finance asked)`,
        link: notificationLink(agent.role, 'fee_unpaid_reminder', { id: business.id }),
        subjectType: 'payment',
        subjectId: payment.id,
      },
      now,
    );
    await this.audit.log({
      actorId,
      action: 'finance.account_agent_told',
      entityType: 'payment',
      entityCode: payment.code,
      after: { business: business.code, accountAgent: agent.code, waitingDays: days },
    });
    return { told: { id: agent.id, code: agent.code, name: agent.name }, business: { code: business.code, name: business.name } };
  }
}
