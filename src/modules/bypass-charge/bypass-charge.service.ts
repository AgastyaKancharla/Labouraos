import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { recordStatusChange } from '../../common/status-history/status-history.helper';
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

  /** The first and the latest introduction (profile shown or interview booked) of this person to this business. */
  private async introductions(businessId: string, jobSeekerId: string): Promise<{ first: Date; last: Date } | null> {
    const [firstShown, lastShown, firstInterview, lastInterview] = await Promise.all([
      this.prisma.candidateIntroduction.findFirst({ where: { businessId, jobSeekerId }, orderBy: { shownAt: 'asc' }, select: { shownAt: true } }),
      this.prisma.candidateIntroduction.findFirst({ where: { businessId, jobSeekerId }, orderBy: { shownAt: 'desc' }, select: { shownAt: true } }),
      this.prisma.interview.findFirst({ where: { businessId, jobSeekerId }, orderBy: { createdAt: 'asc' }, select: { createdAt: true } }),
      this.prisma.interview.findFirst({ where: { businessId, jobSeekerId }, orderBy: { createdAt: 'desc' }, select: { createdAt: true } }),
    ]);
    const firsts = [firstShown?.shownAt, firstInterview?.createdAt].filter((d): d is Date => Boolean(d));
    const lasts = [lastShown?.shownAt, lastInterview?.createdAt].filter((d): d is Date => Boolean(d));
    if (!firsts.length) return null;
    return {
      first: new Date(Math.min(...firsts.map((d) => d.getTime()))),
      last: new Date(Math.max(...lasts.map((d) => d.getTime()))),
    };
  }

  /**
   * The business's signed agreement in force at a moment (B2, 12 Nov): the
   * latest one signed on or before it. Its fee, GST, no-bypass months and
   * penalty are the terms the charge uses, not today's Settings.
   */
  private agreementAt(businessId: string, at: Date) {
    return this.prisma.businessAgreement.findFirst({
      where: { businessId, signedAt: { lte: at } },
      orderBy: { signedAt: 'desc' },
      select: { id: true, version: true, signedAt: true, feePercent: true, gstPercent: true, noBypassMonths: true, noBypassPenaltyPercent: true },
    });
  }

  /** People this business may owe a charge for: introduced within the no-bypass months, not placed and paid there. */
  async candidates(businessId: string, now: Date) {
    const policy = await this.pricing.current();
    const agreement = await this.agreementAt(businessId, now);
    const terms = agreement ?? {
      noBypassMonths: policy.noBypassMonths,
      noBypassPenaltyPercent: policy.noBypassPenaltyPercent,
      feePercent: policy.placementFeePercent,
      gstPercent: policy.gstPercent,
    };
    const since = new Date(now.getTime());
    since.setUTCMonth(since.getUTCMonth() - terms.noBypassMonths);
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
      agreementSigned: Boolean(agreement),
      noBypassMonths: terms.noBypassMonths,
      penaltyPercent: terms.noBypassPenaltyPercent,
      feePercent: terms.feePercent,
      gstPercent: terms.gstPercent,
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

    // Nothing is saved if UPI collection is not set up (B5).
    this.upi.assertConfigured();

    const intro = await this.introductions(business.id, seeker.id);
    if (!intro) throw new BadRequestException('Laboura never introduced this person to this business: no bypass charge');
    const introducedAt = intro.last;
    if (hiredText < intro.first.toISOString().slice(0, 10)) {
      throw new BadRequestException('hiredOn is before Laboura first introduced this person to this business');
    }
    const agreement = await this.agreementAt(business.id, introducedAt);
    if (!agreement) {
      throw new BadRequestException('This business had no signed agreement when the person was introduced: no bypass charge');
    }
    const windowEnd = new Date(introducedAt.getTime());
    windowEnd.setUTCMonth(windowEnd.getUTCMonth() + agreement.noBypassMonths);
    if (hiredOn.getTime() > windowEnd.getTime()) {
      throw new BadRequestException(`Hired more than ${agreement.noBypassMonths} months after the introduction: the no-bypass clause no longer applies`);
    }
    const placedAndPaid = await this.prisma.placement.count({ where: { businessId: business.id, jobSeekerId: seeker.id, paidAt: { not: null } } });
    if (placedAndPaid) throw new ConflictException('This hire went through Laboura and the fee was paid: it is not a bypass');
    await this.monthLock.assertOpenOn(now, 'a bypass charge');

    const amounts = bypassChargeAmounts(salary, agreement.feePercent, agreement.noBypassPenaltyPercent, agreement.gstPercent);
    const requestInput = {
      type: 'bypass_charge' as const,
      subjectType: 'bypass_charge' as const,
      amountPaise: amounts.totalPaise,
      city: business.city,
      businessId: business.id,
      notifySubjectType: 'business' as const,
      notifySubjectId: business.id,
    };

    // The charge and its payment request are saved together, under a lock on
    // this business and person, so two clicks never raise two (B4, B5). The
    // partial unique index on open charges is the last guard.
    let saved: Awaited<ReturnType<PrismaService['bypassCharge']['findUniqueOrThrow']>>;
    let payment: Awaited<ReturnType<UpiCollectionService['createRequestRecord']>>;
    try {
      ({ saved, payment } = await this.prisma.$transaction(async (tx) => {
        await tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${`bypass:${business.id}:${seeker.id}`}))`);
        const open = await tx.bypassCharge.count({ where: { businessId: business.id, jobSeekerId: seeker.id, status: 'raised' } });
        if (open) throw new ConflictException('A bypass charge for this person is already raised');
        const code = await this.ids.generateCode('BYP');
        const invoiceCode = await this.ids.generateCode('invoice');
        const charge = await tx.bypassCharge.create({
          data: {
            code,
            businessId: business.id,
            jobSeekerId: seeker.id,
            hiredOn,
            introducedAt,
            monthlySalaryPaise: salary,
            feePercent: agreement.feePercent,
            penaltyPercent: agreement.noBypassPenaltyPercent,
            gstPercent: agreement.gstPercent,
            ...amounts,
            reason,
            invoiceCode,
            raisedByStaffId: actorId,
            raisedAt: now,
          },
        });
        const created = await this.upi.createRequestRecord(tx, { ...requestInput, subjectId: charge.id });
        const row = await tx.bypassCharge.update({ where: { id: charge.id }, data: { paymentId: created.id } });
        return { saved: row, payment: created };
      }));
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new ConflictException('A bypass charge for this person is already raised');
      }
      throw err;
    }
    const request = await this.upi.deliverRequest(payment, { ...requestInput, subjectId: saved.id });
    await this.audit.log({
      actorId,
      action: 'business.bypass_charge_raised',
      entityType: 'business',
      entityCode: business.code,
      after: {
        charge: saved.code,
        invoiceCode: saved.invoiceCode,
        jobSeeker: seeker.code,
        ...amounts,
        monthlySalaryPaise: salary,
        payment: request.paymentCode,
        agreement: { id: agreement.id, version: agreement.version, signedAt: agreement.signedAt.toISOString() },
      },
      reason,
    });
    return this.view(saved, { code: request.paymentCode, status: request.status, confirmedAt: null }, { id: seeker.id, code: seeker.code, name: '' });
  }

  /**
   * CEO only, with a reason (B5): cancels a raised charge that is not paid and
   * closes its pending payment request, in one transaction; audited. A paid
   * charge is not cancelled here (that is a refund).
   */
  async cancel(actorId: string, chargeId: string, body: { reason?: unknown }, now: Date) {
    const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
    if (!reason) throw new BadRequestException('A reason is needed to cancel a bypass charge');
    if (reason.length > 1000) throw new BadRequestException('Keep the reason under 1000 characters');
    const result = await this.prisma.$transaction(async (tx) => {
      const charge = await tx.bypassCharge.findUnique({ where: { id: chargeId } });
      if (!charge) throw new NotFoundException('Bypass charge not found');
      await tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${`bypass:${charge.businessId}:${charge.jobSeekerId}`}))`);
      const payment = charge.paymentId ? await tx.payment.findUnique({ where: { id: charge.paymentId }, select: { id: true, status: true } }) : null;
      if (payment && PAID.includes(payment.status)) throw new ConflictException('This charge is paid: refund it instead of cancelling');
      const moved = await tx.bypassCharge.updateMany({ where: { id: charge.id, status: 'raised' }, data: { status: 'cancelled', cancelledAt: now, cancelReason: reason } });
      if (!moved.count) throw new ConflictException('This charge is already cancelled');
      let closed = false;
      if (payment && payment.status === 'pending') {
        const shut = await tx.payment.updateMany({ where: { id: payment.id, status: 'pending' }, data: { status: 'cancelled' } });
        if (shut.count) {
          closed = true;
          await recordStatusChange(tx, { subjectType: 'payment', subjectId: payment.id, fromStatus: 'pending', toStatus: 'cancelled', changedByStaffId: actorId, reason: 'bypass_charge_cancelled' });
        }
      }
      const business = await tx.business.findUnique({ where: { id: charge.businessId }, select: { code: true } });
      return { charge, closed, businessCode: business?.code ?? charge.businessId };
    });
    await this.audit.log({
      actorId,
      action: 'business.bypass_charge_cancelled',
      entityType: 'business',
      entityCode: result.businessCode,
      before: { charge: result.charge.code, status: 'raised' },
      after: { charge: result.charge.code, status: 'cancelled', invoiceCode: result.charge.invoiceCode, paymentClosed: result.closed },
      reason,
    });
    return { id: result.charge.id, code: result.charge.code, status: 'cancelled', paymentClosed: result.closed };
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
