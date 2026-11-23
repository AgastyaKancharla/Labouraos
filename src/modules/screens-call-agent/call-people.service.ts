import { BadRequestException, Injectable } from '@nestjs/common';
import { JwtPayload } from '../../common/auth/jwt-payload.interface';
import { agentOwnedWheres } from '../profile-stuck/profile-stuck.service';
import { FieldPeopleService, ListGroup } from '../screens-field/field-people.service';

export type ListFilter = 'all' | ListGroup;
const FILTERS: readonly ListFilter[] = ['all', 'needs_action', 'waiting_tl', 'active', 'done'];
/** The newest this many of each kind are worked out and sorted (needs action first). */
const CAP = 200;
const PAGE_DEFAULT = 25;
const PAGE_MAX = 100;

export interface ListQuery {
  q?: string;
  filter?: string;
  offset?: string;
  limit?: string;
}

/**
 * The call agent console lists (Master Guide rev 210, "Call agent console lists, decided 23 Nov"):
 * My job seekers, My businesses and My referral partners. The rows and their rules are Laboura
 * Field's (FieldPeopleService, PR #184) with the call agent as viewer; whose people are listed is
 * the owner rule of the "Stuck registrations" list (agentOwnedWheres): a job seeker or partner
 * assigned to him, else registered by him; a business whose account agent he is, else whose lead
 * he created. Each answer has the counts for the filter chips (All · Needs action · Waiting for
 * Team Lead · Active · Done), needs-action rows first, and one page of rows ("Load more" asks for
 * the next offset). Phone numbers leave as their last 4 digits; no rupee amounts.
 */
@Injectable()
export class CallPeopleService {
  constructor(private readonly people: FieldPeopleService) {}

  async jobSeekers(user: JwtPayload, query: ListQuery) {
    const owned = agentOwnedWheres(user.sub);
    const list = await this.people.jobSeekers({ sub: user.sub, role: user.role }, query.q, { viewer: 'call_agent', seekers: owned.seeker, take: CAP });
    return page(list, query);
  }

  async businesses(user: JwtPayload, query: ListQuery) {
    const owned = agentOwnedWheres(user.sub);
    const list = await this.people.businesses({ sub: user.sub, role: user.role }, query.q, { viewer: 'call_agent', businesses: owned.business, take: CAP });
    return page(list, query);
  }

  async referrals(user: JwtPayload, query: ListQuery) {
    const owned = agentOwnedWheres(user.sub);
    const list = await this.people.referrals(query.q, { viewer: 'call_agent', referrals: owned.referral, take: CAP });
    return page(list, query);
  }
}

/** One page of rows under a filter chip, with every chip's count. */
export function page<T extends { row: { group: ListGroup } }>(list: { query: string; results: T[] }, query: ListQuery) {
  const filter = (query.filter ?? 'all') as ListFilter;
  if (!FILTERS.includes(filter)) throw new BadRequestException('filter must be all, needs_action, waiting_tl, active or done');
  const offset = whole(query.offset, 0, 'offset');
  const limit = Math.min(PAGE_MAX, Math.max(1, whole(query.limit, PAGE_DEFAULT, 'limit')));
  const counts: Record<ListFilter, number> = { all: list.results.length, needs_action: 0, waiting_tl: 0, active: 0, done: 0 };
  for (const r of list.results) counts[r.row.group] += 1;
  const under = filter === 'all' ? list.results : list.results.filter((r) => r.row.group === filter);
  const results = under.slice(offset, offset + limit);
  return {
    query: list.query,
    filter,
    counts,
    total: under.length,
    results,
    nextOffset: offset + limit < under.length ? offset + limit : null,
  };
}

function whole(value: string | undefined, fallback: number, name: string): number {
  if (value === undefined || value === '') return fallback;
  if (!/^\d{1,5}$/.test(value)) throw new BadRequestException(`${name} must be a whole number`);
  return Number(value);
}
