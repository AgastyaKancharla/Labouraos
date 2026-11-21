import { HttpStatus, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { CustomerAuthClock } from '../../common/customer-auth/customer-auth.clock';
import { CustomerScopeService } from '../../common/customer-auth/customer-scope.service';
import { CUSTOMER_ERROR_CODES, CustomerApiError } from '../../common/customer-auth/customer-auth.errors';
import { firstName } from '../customer-account/customer-account.service';
import { referralLeadsOpen } from '../../common/customer-auth/customer-app.constants';

export { referralLeadsOpen };

type Body = Record<string, unknown>;

export const REFERRAL_LEAD_KINDS = ['job_seeker', 'business'] as const;
/** At most this many leads a partner may send in one Indian day (to confirm with Agastya). */
export const REFERRAL_LEADS_PER_DAY = 20;
const IST_OFFSET_MS = 330 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

/** What the partner sees of a lead: never the phone, never whether the number was known to Laboura. */
export type LeadStage = 'with_team' | 'registered' | 'closed';

function stageOf(status: string): LeadStage {
  if (status === 'registered') return 'registered';
  if (status === 'new' || status === 'contacted') return 'with_team';
  return 'closed';
}

function validation(message: string, field: string): CustomerApiError {
  return new CustomerApiError(HttpStatus.BAD_REQUEST, CUSTOMER_ERROR_CODES.VALIDATION, message, { field });
}

/** "9876543210", "+91 98765 43210" → "+919876543210"; null when it is not an Indian mobile. */
export function indianMobile(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const digits = value.replace(/[\s-]/g, '').replace(/^\+91/, '').replace(/^0/, '');
  return /^[6-9]\d{9}$/.test(digits) ? `+91${digits}` : null;
}

/**
 * A referral partner's "Send a lead" (Master Guide, 21 Nov: a submit-a-lead
 * form in the customer app). Only the caller's own partner profile. The lead
 * waits for the call team; the partner sees first name, kind and a stage
 * only. The answer is the same whether or not the number is already known to
 * Laboura (no oracle, as for sign-ups — security rule AC-6).
 */
@Injectable()
export class CustomerReferralLeadsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: CustomerAuthClock,
    private readonly scope: CustomerScopeService,
  ) {}

  private async partner(accountId: string, profileId: string) {
    const profile = await this.scope.profile(accountId, profileId, 'referral');
    const referral = await this.prisma.referral.findUniqueOrThrow({
      where: { id: profile.referralId! },
      select: { id: true, code: true, phone: true, pausedAt: true },
    });
    return { profile, referral };
  }

  /** GET /me/profiles/:profileId/referral-leads */
  async list(accountId: string, profileId: string) {
    const { referral } = await this.partner(accountId, profileId);
    const leads = await this.prisma.customerReferralLead.findMany({
      where: { referralId: referral.id },
      orderBy: { createdAt: 'desc' },
      take: 50,
      select: { id: true, name: true, kind: true, status: true, createdAt: true },
    });
    return {
      open: referralLeadsOpen() && !referral.pausedAt,
      perDay: REFERRAL_LEADS_PER_DAY,
      leads: leads.map((l) => ({ id: l.id, firstName: firstName(l.name), kind: l.kind, stage: stageOf(l.status), sentAt: l.createdAt })),
    };
  }

  /**
   * POST /me/profiles/:profileId/referral-leads
   * Body: { kind: "job_seeker" | "business", name, phone, area, personAgreed: true }
   */
  async send(accountId: string, profileId: string, body: Body) {
    if (!referralLeadsOpen()) {
      throw new CustomerApiError(HttpStatus.NOT_IMPLEMENTED, CUSTOMER_ERROR_CODES.NOT_IMPLEMENTED, 'Sending leads is not switched on yet');
    }
    const { profile, referral } = await this.partner(accountId, profileId);
    if (referral.pausedAt) throw new CustomerApiError(HttpStatus.FORBIDDEN, CUSTOMER_ERROR_CODES.REFERRAL_PAUSED, 'Your referral account is paused');

    const kind = body?.kind;
    if (typeof kind !== 'string' || !(REFERRAL_LEAD_KINDS as readonly string[]).includes(kind)) throw validation('kind must be job_seeker or business', 'kind');
    const name = typeof body?.name === 'string' ? body.name.trim().replace(/\s+/g, ' ') : '';
    if (name.length < 2 || name.length > 80 || /\d/.test(name)) throw validation('Give the person’s name (2 to 80 letters, no numbers)', 'name');
    const phone = indianMobile(body?.phone);
    if (!phone) throw validation('Give a 10-digit Indian mobile number', 'phone');
    if (indianMobile(referral.phone) === phone) throw validation('This is your own number', 'phone');
    const area = typeof body?.area === 'string' ? body.area.trim() : '';
    const known = area && area.length <= 80 ? await this.prisma.area.findFirst({ where: { name: area, active: true, mergedIntoId: null }, select: { name: true } }) : null;
    if (!known) throw validation('Pick an area from the list', 'area');
    if (body?.personAgreed !== true) throw validation('Tick that this person agreed Laboura may call them', 'personAgreed');

    // The same number from the same partner: the lead already sent (one answer either way).
    const mine = await this.prisma.customerReferralLead.findUnique({
      where: { referralId_phone: { referralId: referral.id, phone } },
      select: { id: true, status: true },
    });
    if (mine) return { created: false, body: { leadId: mine.id, stage: stageOf(mine.status) } };

    const now = this.clock.now();
    const dayStart = new Date(Math.floor((now.getTime() + IST_OFFSET_MS) / DAY_MS) * DAY_MS - IST_OFFSET_MS);
    const today = await this.prisma.customerReferralLead.count({ where: { referralId: referral.id, createdAt: { gte: dayStart } } });
    if (today >= REFERRAL_LEADS_PER_DAY) {
      throw new CustomerApiError(HttpStatus.TOO_MANY_REQUESTS, CUSTOMER_ERROR_CODES.LIMIT_REACHED, `At most ${REFERRAL_LEADS_PER_DAY} leads a day`);
    }
    try {
      const lead = await this.prisma.customerReferralLead.create({
        data: { accountId, profileId: profile.id, referralId: referral.id, referralCode: referral.code, kind, name, phone, area: known.name, personAgreed: true },
        select: { id: true, status: true },
      });
      return { created: true, body: { leadId: lead.id, stage: stageOf(lead.status) } };
    } catch (error) {
      // Sent twice at once: the unique (partner, phone) keeps one.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const again = await this.prisma.customerReferralLead.findUnique({ where: { referralId_phone: { referralId: referral.id, phone } }, select: { id: true, status: true } });
        if (again) return { created: false, body: { leadId: again.id, stage: stageOf(again.status) } };
      }
      throw error;
    }
  }
}
