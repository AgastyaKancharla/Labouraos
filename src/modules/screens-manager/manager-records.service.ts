import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { DateRange, PageRequest } from '../ceo-portal/ceo-common';
import { CeoBusinessesService } from '../ceo-portal/ceo-businesses.service';
import { CeoJobSeekersService } from '../ceo-portal/ceo-job-seekers.service';
import { CeoMoneyService } from '../ceo-portal/ceo-money.service';
import { CeoPlacementsService } from '../ceo-portal/ceo-placements.service';
import {
  RecordScope,
  businessScope,
  interviewScope,
  placementScope,
  referralScope,
  seekerScope,
  vacancyScope,
} from '../ceo-portal/record-scope';
import { ManagerTreeService } from './manager-tree.service';

type Obj = Record<string, unknown>;

/** Removes keys (dotted paths for nested objects) from an answer, in place. */
function drop(target: unknown, paths: string[]): void {
  if (!target || typeof target !== 'object') return;
  for (const path of paths) {
    const parts = path.split('.');
    let node: unknown = target;
    for (const part of parts.slice(0, -1)) {
      node = node && typeof node === 'object' ? (node as Obj)[part] : undefined;
    }
    if (node && typeof node === 'object') delete (node as Obj)[parts[parts.length - 1]];
  }
}

function dropInRows(answer: unknown, key: string, paths: string[]): void {
  const rows = answer && typeof answer === 'object' ? (answer as Obj)[key] : undefined;
  if (Array.isArray(rows)) for (const row of rows) drop(row, paths);
}

export interface ManagerListQuery {
  range: Partial<DateRange>;
  page: PageRequest;
  search?: string;
  status?: string;
  trade?: string;
  kyc?: string;
  sort?: string;
  agent?: string;
  area?: string;
  type?: string;
  age?: string;
  stage?: string;
  checks?: string;
}

/**
 * The Manager's pipeline lists and profiles (job seekers, businesses,
 * vacancies, interviews, placements, referral partners). They reuse the CEO
 * portal's services, limited to the Manager's own reporting tree
 * (record-scope.ts), and leave out every payment, refund, payout, fee and GST
 * section. The controller's PII interceptor then masks phone numbers to the
 * last 4 digits and strips any money field that is left (stripMoney), so a
 * Manager never sees a rupee figure (Master Guide, reconfirmed 11 Nov).
 */
@Injectable()
export class ManagerRecordsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tree: ManagerTreeService,
    private readonly seekers: CeoJobSeekersService,
    private readonly businesses: CeoBusinessesService,
    private readonly placements: CeoPlacementsService,
    private readonly money: CeoMoneyService,
  ) {}

  /** The Manager and everyone in their reporting tree. */
  async scope(managerId: string): Promise<RecordScope> {
    const tree = await this.tree.load(managerId);
    return { staffIds: [managerId, ...tree.ids.filter((id) => id !== managerId)] };
  }

  private async assertFound(count: Promise<number>, what: string, id: string): Promise<void> {
    if ((await count) === 0) throw new NotFoundException(`${what} '${id}' not found`);
  }

  // Job seekers ------------------------------------------------------------

  async jobSeekers(managerId: string, q: ManagerListQuery) {
    const scope = await this.scope(managerId);
    return this.seekers.list({ range: q.range, page: q.page, search: q.search, status: q.status, trade: q.trade, kyc: q.kyc, sort: q.sort, scope: seekerScope(scope) });
  }

  async jobSeeker(managerId: string, id: string) {
    const scope = await this.scope(managerId);
    await this.assertFound(this.prisma.jobSeeker.count({ where: { AND: [{ OR: [{ id }, { code: id }] }, seekerScope(scope)] } }), 'Job seeker', id);
    const detail = await this.seekers.detail(id);
    drop(detail, ['activation', 'refunds']);
    detail.history = detail.history.filter((e) => !e.kind.startsWith('payment_'));
    return detail;
  }

  // Businesses, vacancies, interviews ---------------------------------------

  async businessList(managerId: string, q: ManagerListQuery) {
    const scope = await this.scope(managerId);
    return this.businesses.listBusinesses({ range: q.range, page: q.page, search: q.search, status: q.status, agent: q.agent, area: q.area, type: q.type, businessScope: businessScope(scope) });
  }

  async business(managerId: string, id: string) {
    const scope = await this.scope(managerId);
    await this.assertFound(this.prisma.business.count({ where: { AND: [{ OR: [{ id }, { code: id }] }, businessScope(scope)] } }), 'Business', id);
    const detail = await this.businesses.businessDetail(id);
    // Pricing terms of the agreement are money (fee and GST percentages, the no-bypass charge).
    drop(detail, ['agreement.feePercent', 'agreement.gstPercent', 'agreement.noBypassPenaltyPercent']);
    return detail;
  }

  async vacancies(managerId: string, q: ManagerListQuery) {
    const scope = await this.scope(managerId);
    // No status (or "all") means every vacancy, as on the Manager's list (the CEO service's own default is open).
    return this.businesses.listVacancies({ range: q.range, page: q.page, search: q.search, status: q.status ?? 'all', trade: q.trade, area: q.area, age: q.age, vacancyScope: vacancyScope(scope) });
  }

  async vacancy(managerId: string, id: string) {
    const scope = await this.scope(managerId);
    await this.assertFound(this.prisma.vacancy.count({ where: { AND: [{ OR: [{ id }, { code: id }] }, vacancyScope(scope)] } }), 'Vacancy', id);
    return this.businesses.vacancyDetail(id);
  }

  async interviews(managerId: string, range: DateRange, now: Date) {
    const scope = await this.scope(managerId);
    return this.businesses.interviews(range, now, interviewScope(scope));
  }

  // Placements -------------------------------------------------------------

  async placementList(managerId: string, q: ManagerListQuery) {
    const scope = await this.scope(managerId);
    const answer = await this.placements.list({ range: q.range, page: q.page, search: q.search, stage: q.stage, trade: q.trade, scope: placementScope(scope) });
    drop(answer, ['summary.feePercent', 'summary.gstPercent', 'replacements.refundsAfterSearchThisMonth']);
    dropInRows(answer, 'rows', ['paidAt', 'invoiceCode']);
    return answer;
  }

  async placement(managerId: string, id: string) {
    const scope = await this.scope(managerId);
    await this.assertFound(this.prisma.placement.count({ where: { AND: [{ OR: [{ id }, { code: id }] }, placementScope(scope)] } }), 'Placement', id);
    const detail = await this.placements.detail(id);
    drop(detail, ['paidAt', 'invoiceCode', 'feePayment', 'joiningReward', 'refund', 'referral.payment']);
    // The fee payment (with its invoice) and any refund are money: left out of the timeline too.
    detail.timeline = detail.timeline.filter((e) => e.text !== 'fee_paid' && !e.text.startsWith('refund_'));
    return detail;
  }

  // Referral partners --------------------------------------------------------

  async referrals(managerId: string, q: ManagerListQuery) {
    const scope = await this.scope(managerId);
    // The payout filter is money: never applied for a Manager.
    const answer = await this.money.referrals(q.range, q.page, { search: q.search, type: q.type, checks: q.checks, scope: referralScope(scope) });
    drop(answer, ['summary.payoutsDuePaise', 'summary.payoutsDueCount', 'summary.payoutsFailed', 'fraud']);
    dropInRows(answer, 'rows', ['payout']);
    return answer;
  }

  async partner(managerId: string, id: string) {
    const scope = await this.scope(managerId);
    await this.assertFound(this.prisma.referral.count({ where: { AND: [{ OR: [{ id }, { code: id }] }, referralScope(scope)] } }), 'Referral partner', id);
    const detail = await this.money.partner(id);
    drop(detail, ['payoutAccount', 'payouts']);
    return detail;
  }
}
