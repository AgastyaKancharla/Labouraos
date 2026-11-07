import { BadRequestException, Injectable, NotFoundException, Optional } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { Prisma } from '@prisma/client';
import * as qrcode from 'qrcode-generator';
import { publicLink } from '../../common/public-link';
import { PrismaService } from '../../common/prisma/prisma.service';
import { IdService } from '../../common/id/id.service';
import { recordStatusChange } from '../../common/status-history/status-history.helper';
import { MessagingService } from '../message/messaging.service';
import { PaymentService } from './payment.service';

export interface CreateUpiRequestInput {
  type: string;
  subjectType: 'job_seeker' | 'placement';
  subjectId: string;
  amountPaise: number;
  city?: string;
  jobSeekerId?: string;
  businessId?: string;
  placementId?: string;
  notifySubjectType?: 'job_seeker' | 'business';
  notifySubjectId?: string;
  reactivation?: boolean;
}

export interface QrMatrix {
  size: number;
  darkModules: boolean[];
  svg: string;
}

export function buildUpiQr(link: string): QrMatrix {
  const qr = qrcode(0, 'M');
  qr.addData(link);
  qr.make();
  const size = qr.getModuleCount();
  const darkModules: boolean[] = [];
  for (let row = 0; row < size; row += 1) {
    for (let column = 0; column < size; column += 1) {
      darkModules.push(qr.isDark(row, column));
    }
  }
  return { size, darkModules, svg: qr.createSvgTag({ cellSize: 5, margin: 4, scalable: true }) };
}

function amountInRupees(amountPaise: number): string {
  return `${Math.floor(amountPaise / 100)}.${String(amountPaise % 100).padStart(2, '0')}`;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character]!);
}

@Injectable()
export class UpiCollectionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly idService: IdService,
    private readonly messagingService: MessagingService,
    @Optional() private readonly paymentService?: PaymentService,
  ) {}

  private getConfiguration() {
    const vpa = process.env.COMPANY_UPI_VPA?.trim();
    const payeeName = process.env.COMPANY_UPI_PAYEE_NAME?.trim();
    if (!vpa || !payeeName) {
      throw new BadRequestException('UPI collection is not configured. Set COMPANY_UPI_VPA and COMPANY_UPI_PAYEE_NAME.');
    }
    return { vpa, payeeName };
  }

  private buildUpiUri(payment: { code: string; upiReference: string; expectedAmountPaise: number }) {
    const { vpa, payeeName } = this.getConfiguration();
    const note = payment.code;
    const params = new URLSearchParams({
      pa: vpa,
      pn: payeeName,
      am: amountInRupees(payment.expectedAmountPaise),
      tn: note,
      tr: payment.upiReference,
      cu: 'INR',
    });
    return { uri: `upi://pay?${params.toString()}`, payeeName };
  }

  async createRequest(input: CreateUpiRequestInput) {
    this.getConfiguration();
    if (!Number.isSafeInteger(input.amountPaise) || input.amountPaise <= 0) {
      throw new BadRequestException('amountPaise must be a positive integer');
    }
    const lockKey = `payment:${input.type}:${input.subjectType}:${input.subjectId}`;
    const payment = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${lockKey}))`);
      const existing = await tx.payment.findFirst({
        where: {
          type: input.type,
          subjectType: input.subjectType,
          subjectId: input.subjectId,
          status: 'pending',
          method: 'upi_direct',
          gatewayReference: null,
          upiReference: { not: null },
          expectedAmountPaise: { not: null },
          reactivation: input.reactivation ?? false,
        },
      });
      if (existing) return existing;

      const code = await this.idService.generateCode('payment');
      const upiReference = `${code}-${randomBytes(4).toString('hex')}`;
      const created = await tx.payment.create({
        data: {
          code,
          city: input.city ?? 'Bengaluru',
          type: input.type,
          amount: input.amountPaise,
          expectedAmountPaise: input.amountPaise,
          status: 'pending',
          method: 'upi_direct',
          upiReference,
          subjectType: input.subjectType,
          subjectId: input.subjectId,
          jobSeekerId: input.jobSeekerId ?? null,
          businessId: input.businessId ?? null,
          placementId: input.placementId ?? null,
          reactivation: input.reactivation ?? false,
        },
      });
      await recordStatusChange(tx, {
        subjectType: 'payment', subjectId: created.id, fromStatus: null, toStatus: 'pending',
        reason: 'upi_payment_request_created',
      });
      return created;
    });
    const { uri, payeeName } = this.buildUpiUri({
      code: payment.code,
      upiReference: payment.upiReference!,
      expectedAmountPaise: payment.expectedAmountPaise!,
    });
    const link = publicLink(`/payments/request/${encodeURIComponent(payment.upiReference!)}`);
    const notifySubjectType = input.notifySubjectType ?? (input.subjectType === 'job_seeker' ? 'job_seeker' : undefined);
    const notifySubjectId = input.notifySubjectId ?? (input.subjectType === 'job_seeker' ? input.subjectId : undefined);
    if (notifySubjectType && notifySubjectId) {
      await this.sendPaymentLink(payment, notifySubjectType, notifySubjectId, link, payeeName);
    }
    return {
      paymentId: payment.id,
      paymentCode: payment.code,
      amountPaise: payment.expectedAmountPaise,
      upiReference: payment.upiReference,
      upiUri: uri,
      paymentLink: link,
      payeeName,
      status: payment.status,
    };
  }

  async resendRequest(paymentId: string, notifySubjectType: 'job_seeker' | 'business', notifySubjectId: string) {
    const payment = await this.prisma.payment.findUnique({ where: { id: paymentId } });
    if (!payment || payment.method !== 'upi_direct' || payment.gatewayReference !== null || payment.status !== 'pending' || !payment.upiReference || payment.expectedAmountPaise === null) {
      throw new NotFoundException('Pending UPI payment request not found');
    }
    const { payeeName } = this.buildUpiUri({
      code: payment.code, upiReference: payment.upiReference, expectedAmountPaise: payment.expectedAmountPaise,
    });
    const link = publicLink(`/payments/request/${encodeURIComponent(payment.upiReference)}`);
    await this.sendPaymentLink(payment, notifySubjectType, notifySubjectId, link, payeeName);
    return { paymentId: payment.id, paymentLink: link, upiReference: payment.upiReference };
  }

  private async sendPaymentLink(
    payment: { id: string; expectedAmountPaise: number | null },
    subjectType: 'job_seeker' | 'business',
    subjectId: string,
    link: string,
    payeeName: string,
  ) {
    const variables = {
      link,
      amount: amountInRupees(payment.expectedAmountPaise ?? 0),
      payeeName,
    };
    await Promise.all((['sms', 'whatsapp'] as const).map((channel) => this.messagingService.send({
      channel, template: 'payment_request', subjectType, subjectId,
      relatedType: 'payment', relatedId: payment.id, variables,
    })));
  }

  async getPaymentPage(token: string) {
    const payment = await this.prisma.payment.findUnique({ where: { upiReference: token } });
    if (!payment || payment.method !== 'upi_direct' || payment.status !== 'pending' || payment.expectedAmountPaise === null) {
      throw new NotFoundException('Payment request not found or already used');
    }
    const { uri, payeeName } = this.buildUpiUri({
      code: payment.code, upiReference: payment.upiReference!, expectedAmountPaise: payment.expectedAmountPaise,
    });
    return {
      type: payment.type,
      description: payment.type === 'activation' ? 'Job seeker registration' : 'Placement fee',
      amountPaise: payment.expectedAmountPaise,
      amount: amountInRupees(payment.expectedAmountPaise),
      payeeName,
      upiReference: payment.upiReference,
      upiUri: uri,
      qrSvg: buildUpiQr(uri).svg,
    };
  }

  async renderPaymentPage(token: string) {
    const details = await this.getPaymentPage(token);
    return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Pay Laboura</title><style>body{font:16px system-ui,sans-serif;max-width:34rem;margin:0 auto;padding:1rem;color:#172033}main{border:1px solid #d9dfeb;border-radius:1rem;padding:1.25rem}h1{font-size:1.5rem}svg{display:block;width:min(80vw,20rem);height:auto;margin:1rem auto}button,a{display:block;width:100%;box-sizing:border-box;padding:.85rem;margin:.6rem 0;border:0;border-radius:.5rem;background:#155eef;color:white;text-align:center;font:inherit;text-decoration:none}input{box-sizing:border-box;width:100%;padding:.75rem;margin:.5rem 0}small{color:#526078}</style></head><body><main><h1>Pay Laboura</h1><p>${escapeHtml(details.description)}</p><p><strong>₹${escapeHtml(details.amount)}</strong></p><p>Pay to ${escapeHtml(details.payeeName)}</p>${details.qrSvg}<a href="${escapeHtml(details.upiUri)}">Pay with a UPI app</a><form method="post" action="/payments/request/${encodeURIComponent(token)}/card"><button type="submit">Pay by card</button></form><form method="post" action="/payments/request/${encodeURIComponent(token)}/utr-hint"><label for="utr">Paid already? Enter your UPI reference number (12 digits) to help us find it faster</label><input id="utr" name="utr" inputmode="numeric" pattern="[0-9]{12}" maxlength="12"><button type="submit">Send reference hint</button></form><small>Payment is confirmed once it reaches Laboura's bank. A UTR hint does not confirm payment.</small></main></body></html>`;
  }

  async saveUtrHint(token: string, utr: unknown) {
    if (typeof utr !== 'string' || !/^\d{12}$/.test(utr)) {
      throw new BadRequestException('UPI reference number must contain 12 digits');
    }
    const payment = await this.prisma.payment.findUnique({ where: { upiReference: token } });
    if (!payment || payment.status !== 'pending' || payment.method !== 'upi_direct') {
      throw new NotFoundException('Pending UPI payment request not found');
    }
    await this.prisma.payment.update({ where: { id: payment.id }, data: { payerUtrHint: utr } });
    return { saved: true, status: 'pending' };
  }

  async payByCard(token: string) {
    if (!this.paymentService) {
      throw new BadRequestException('PaymentService is not injected in UpiCollectionService');
    }
    return this.paymentService.payByCard(token);
  }
}
