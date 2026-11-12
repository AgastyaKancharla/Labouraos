import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import { IdService } from '../../common/id/id.service';
import { formatINR } from '../../common/money/money';
import { PricingService } from '../pricing/pricing.service';
import { MonthLockService } from '../month-lock/month-lock.service';
import { UpiCollectionService } from '../payment/upi-collection.service';
import { invoiceGstSplit } from '../placement/invoice-gst-split';
import { bypassChargeAmounts } from './bypass-charge.money';

const PAID = ['succeeded', 'completed'];

export interface RaiseBypassChargeBody {
  jobSeekerId?: unknown;
  monthlySalaryPaise?: unknown;
  hiredOn?: unknown;
  reason?: unknown;
}

/**
 * The no-bypass charge (guide, "Stopping bypass" and the agreement clause): a
 * business that hires anyone Laboura introduced — a profile shown or an
 * interview booked — within the no-bypass months (12) pays the full fee plus
 * the penalty percent (50%), plus GST. Only the CEO raises it, with a reason;
 * it is collected through the same UPI payment request and link as a
 * placement fee and gets a number from the same GST invoice series. Money in
 * integer paise; the month it is raised in must be open; audited.
 */
@Injectable()
export class BypassChargeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly ids: IdService,
    private readonly pricing: PricingService,
    private readonly monthLock: MonthLockService,
    private readonly upi: UpiCollectionService,
  ) {}

  /** The latest introduction (profile shown or interview booked) of this person to this business. */
  private async lastIntroduction(businessId: string, jobSeekerId: string): Promise<Date | null> {
    const [shown, interview] = await Promise.all([
      this.prisma.candidateIntroduction.findFirst({ where: { businessId, jobSeekerId }, orderBy: { shownAt: 'desc' }, select: { shownAt: true } }),
      this.prisma.interview.findFirst({ where: { businessId, jobSeekerId }, orderBy: { createdAt: 'desc' }, select: { createdAt: true } }),
    ]);
    const dates = [shown?.shownAt, interview?.createdAt].filter((d): d is Date => Boolean(d));
    return dates.length ? new Date(Math.max(...dates.map((d) => d.getTime()))) : null;
  }

  /** People this business may owe a charge for: introduced within the no-bypass months, not placed and paid there. */
  async candidates(businessId: string, now: Date) {
    const policy = await this.pricing.current();
    const since = new Date(now.getTime());
    since.setUTCMonth(since.getUTCMonth() - policy.noBypassMonths);
    const [shown, interviews, placements] = await Promise.all([
      this.prisma.candidateIntroduction.findMany({ where: { businessId, shownAt: { gte: since } }, select: { jobSeekerId: true, shownAt: true } }),
      this.prisma.interview.findMany({ where: { businessId, createdAt: { gte: since } }, select: { jobSeekerId: true, createdAt: true } }),
      this.prisma.placement.findMany({ where: { businessId, paidAt: { not: null } }, select: { jobSeekerId: true } }),
    ]);
    const paid = new Set(placements.map((p) => p.jobSeekerId));
    const latest = new Map<string, Date>();
    for (const r of [...shown.map((s) => ({ id: s.jobSeekerId, at: s.shownAt })), ...interviews.map((i) => ({ id: i.jobSeekerId, at: i.createdAt }))]) {
      if (paid.has(r.id)) continue;
      const prev = latest.get(r.id);
      if (!prev || prev < r.at) latest.set(r.id, r.at);
    }
    const seekers = latest.size
      ? await this.prisma.jobSeeker.findMany({ where: { id: { in: [...latest.keys()] } }, select: { id: true, code: true, name: true } })
      : [];
    return {
      noBypassMonths: policy.noBypassMonths,
      penaltyPercent: policy.noBypassPenaltyPercent,
      feePercent: policy.placementFeePercent,
      gstPercent: policy.gstPercent,
      rows: seekers
        .map((s) => ({ jobSeeker: s, introducedAt: latest.get(s.id)!.toISOString() }))
        .sort((a, b) => b.introducedAt.localeCompare(a.introducedAt)),
    };
  }

  async list(businessId: string) {
    const rows = await this.prisma.bypassCharge.findMany({ where: { businessId }, orderBy: { raisedAt: 'desc' } });
    const payments = rows.length
      ? await this.prisma.payment.findMany({ where: { id: { in: rows.map((r) => r.paymentId).filter((x): x is string => Boolean(x)) } }, select: { id: true, code: true, status: true, confirmedAt: true } })
      : [];
    const seekers = rows.length ? await this.prisma.jobSeeker.findMany({ where: { id: { in: rows.map((r) => r.jobSeekerId) } }, select: { id: true, code: true, name: true } }) : [];
    const pay = new Map(payments.map((p) => [p.id, p]));
    const who = new Map(seekers.map((s) => [s.id, s]));
    return rows.map((r) => this.view(r, r.paymentId ? pay.get(r.paymentId) ?? null : null, who.get(r.jobSeekerId) ?? null));
  }

  private view(
    r: Awaited<ReturnType<PrismaService['bypassCharge']['findUniqueOrThrow']>>,
    payment: { code: string; status: string; confirmedAt: Date | null } | null,
    jobSeeker: { id: string; code: string; name: string } | null,
  ) {
    const paid = Boolean(payment && PAID.includes(payment.status));
    return {
      id: r.id,
      code: r.code,
      invoiceCode: r.invoiceCode,
      jobSeeker,
      hiredOn: r.hiredOn.toISOString().slice(0, 10),
      introducedAt: r.introducedAt.toISOString(),
      monthlySalaryPaise: r.monthlySalaryPaise,
      feePaise: r.feePaise,
      penaltyPaise: r.penaltyPaise,
      gstPaise: r.gstPaise,
      totalPaise: r.totalPaise,
      penaltyPercent: r.penaltyPercent,
      reason: r.reason,
      status: r.status === 'cancelled' ? 'cancelled' : paid ? 'paid' : 'waiting',
      payment: payment ? { id: r.paymentId, code: payment.code, status: payment.status } : null,
      raisedAt: r.raisedAt.toISOString(),
    };
  }

  async raise(actorId: string, businessId: string, body: RaiseBypassChargeBody, now: Date) {
    const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
    if (!reason) throw new BadRequestException('A reason is needed to raise a bypass charge');
    if (reason.length > 1000) throw new BadRequestException('Keep the reason under 1000 characters');
    const salary = body.monthlySalaryPaise;
    if (typeof salary !== 'number' || !Number.isSafeInteger(salary) || salary <= 0) {
      throw new BadRequestException('monthlySalaryPaise is the monthly salary in whole paise');
    }
    const jobSeekerId = typeof body.jobSeekerId === 'string' ? body.jobSeekerId : '';
    const business = await this.prisma.business.findUnique({ where: { id: businessId }, select: { id: true, code: true, name: true, city: true } });
    if (!business) throw new NotFoundException('Business not found');
    const seeker = jobSeekerId ? await this.prisma.jobSeeker.findUnique({ where: { id: jobSeekerId }, select: { id: true, code: true } }) : null;
    if (!seeker) throw new BadRequestException('Pick the job seeker the business hired');
    const hiredText = typeof body.hiredOn === 'string' && body.hiredOn ? body.hiredOn : now.toISOString().slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(hiredText)) throw new BadRequestException('hiredOn is a date (yyyy-mm-dd)');
    const hiredOn = new Date(`${hiredText}T00:00:00.000Z`);
    if (hiredOn.getTime() > now.getTime() + 24 * 3600 * 1000) throw new BadRequestException('hiredOn cannot be in the future');

    const policy = await this.pricing.current();
    const introducedAt = await this.lastIntroduction(business.id, seeker.id);
    if (!introducedAt) throw new BadRequestException('Laboura never introduced this person to this business: no bypass charge');
    const windowEnd = new Date(introducedAt.getTime());
    windowEnd.setUTCMonth(windowEnd.getUTCMonth() + policy.noBypassMonths);
    if (hiredOn.getTime() > windowEnd.getTime()) {
      throw new BadRequestException(`Hired more than ${policy.noBypassMonths} months after the introduction: the no-bypass clause no longer applies`);
    }
    const placedAndPaid = await this.prisma.placement.count({ where: { businessId: business.id, jobSeekerId: seeker.id, paidAt: { not: null } } });
    if (placedAndPaid) throw new ConflictException('This hire went through Laboura and the fee was paid: it is not a bypass');
    const open = await this.prisma.bypassCharge.count({ where: { businessId: business.id, jobSeekerId: seeker.id, status: 'raised' } });
    if (open) throw new ConflictException('A bypass charge for this person is already raised');
    await this.monthLock.assertOpenOn(now, 'a bypass charge');

    const amounts = bypassChargeAmounts(salary, policy.placementFeePercent, policy.noBypassPenaltyPercent, policy.gstPercent);
    const code = await this.ids.generateCode('BYP');
    const invoiceCode = await this.ids.generateCode('invoice');
    const charge = await this.prisma.bypassCharge.create({
      data: {
        code,
        businessId: business.id,
        jobSeekerId: seeker.id,
        hiredOn,
        introducedAt,
        monthlySalaryPaise: salary,
        feePercent: policy.placementFeePercent,
        penaltyPercent: policy.noBypassPenaltyPercent,
        gstPercent: policy.gstPercent,
        ...amounts,
        reason,
        invoiceCode,
        raisedByStaffId: actorId,
        raisedAt: now,
      },
    });
    const request = await this.upi.createRequest({
      type: 'bypass_charge',
      subjectType: 'bypass_charge',
      subjectId: charge.id,
      amountPaise: amounts.totalPaise,
      city: business.city,
      businessId: business.id,
      notifySubjectType: 'business',
      notifySubjectId: business.id,
    });
    const saved = await this.prisma.bypassCharge.update({ where: { id: charge.id }, data: { paymentId: request.paymentId } });
    await this.audit.log({
      actorId,
      action: 'business.bypass_charge_raised',
      entityType: 'business',
      entityCode: business.code,
      after: { charge: code, invoiceCode, jobSeeker: seeker.code, ...amounts, monthlySalaryPaise: salary, payment: request.paymentCode },
      reason,
    });
    return this.view(saved, { code: request.paymentCode, status: request.status, confirmedAt: null }, { id: seeker.id, code: seeker.code, name: '' });
  }

  /** The GST invoice for a charge, in the same shape as a placement fee invoice. */
  async invoice(chargeId: string) {
    const charge = await this.prisma.bypassCharge.findUnique({ where: { id: chargeId } });
    if (!charge) throw new NotFoundException('Bypass charge not found');
    const [business, seeker, payment, policy] = await Promise.all([
      this.prisma.business.findUniqueOrThrow({ where: { id: charge.businessId } }),
      this.prisma.jobSeeker.findUniqueOrThrow({ where: { id: charge.jobSeekerId }, select: { code: true, name: true } }),
      charge.paymentId ? this.prisma.payment.findUnique({ where: { id: charge.paymentId }, select: { confirmedAt: true } }) : null,
      this.pricing.current(),
    ]);
    const base = charge.feePaise + charge.penaltyPaise;
    const split = invoiceGstSplit(charge.gstPaise, charge.gstPercent);
    return {
      invoiceNumber: charge.invoiceCode,
      invoiceDate: (payment?.confirmedAt ?? charge.raisedAt).toISOString(),
      supplier: {
        legalName: policy.companyLegalName?.trim() || process.env.COMPANY_LEGAL_NAME?.trim() || 'Laboura Private Limited',
        gstin: policy.companyGstin?.trim() || process.env.COMPANY_GSTIN || 'GSTIN_PENDING_REGISTRATION',
        address: policy.companyAddress?.trim() || process.env.COMPANY_ADDRESS || 'Bengaluru, Karnataka, India',
        state: 'Karnataka',
        stateCode: '29',
      },
      customer: { businessId: business.id, businessCode: business.code, businessName: business.name, gstin: business.gstNumber ?? null, address: business.address, city: business.city, state: 'Karnataka', stateCode: '29' },
      charge: { code: charge.code, candidateCode: seeker.code, hiredOn: charge.hiredOn.toISOString().slice(0, 10), introducedAt: charge.introducedAt.toISOString(), monthlySalaryPaise: charge.monthlySalaryPaise },
      lineItems: [
        {
          itemNumber: 1,
          description: `No-bypass charge (agreement): placement fee ${charge.feePercent}% of monthly salary + ${charge.penaltyPercent}% of the fee`,
          sacCode: '9985',
          baseAmountPaise: base,
          taxRatePercent: charge.gstPercent,
          ...split,
          igstRatePercent: 0,
          igstAmountPaise: 0,
          totalAmountPaise: charge.totalPaise,
        },
      ],
      summary: { subtotalPaise: base, feePaise: charge.feePaise, penaltyPaise: charge.penaltyPaise, totalTaxPaise: charge.gstPaise, totalAmountPaise: charge.totalPaise, currency: 'INR', amountInWords: formatINR(charge.totalPaise) },
    };
  }
}
