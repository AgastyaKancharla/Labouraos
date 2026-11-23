import '../_lib/console.css';
import './lists.css';
import { useInfiniteQuery } from '@tanstack/react-query';
import { api } from '../../../lib/api/client';

/**
 * Data for the call agent console lists (Master Guide rev 210, "Call agent console lists,
 * decided 23 Nov"): GET /call-work/my/job-seekers | businesses | referrals — his own people
 * only, each with one plain status line and its row state (Done, Waiting for the Team Lead, or
 * ONE next-step button), needs action first. The rows and their rules are Laboura Field's
 * (PR #184). Phone numbers arrive as the last 4 digits; there are no rupee amounts.
 */
export type ListGroup = 'needs_action' | 'waiting_tl' | 'active' | 'done';
export type ListFilter = 'all' | ListGroup;
export const LIST_FILTERS: ListFilter[] = ['all', 'needs_action', 'waiting_tl', 'active', 'done'];

export interface RowState<S extends string = string, A extends string = string> {
  status: S;
  action: A | null;
  vacancyId: string | null;
  waiting: boolean;
  done: boolean;
  group: ListGroup;
}

export type SeekerRowState = RowState<string, 'registration_link' | 'payment_link' | 'book_interview' | 'scan_aadhaar'>;
export type BusinessRowState = RowState<string, 'agreement_link' | 'confirm_vacancy' | 'add_vacancy' | 'add_shifts' | 'show_candidates' | 'record_visit'>;
export type PartnerRowState = RowState<string, 'partner_terms_link'>;

export interface MySeeker {
  id: string;
  code: string;
  name: string;
  phoneLast4: string | null;
  status: string;
  photoUrl: string | null;
  trade: string | null;
  yearsExperience: number | null;
  locality: string | null;
  hits: number;
  guarantee: { day: number; days: number; endsAt: string } | null;
  nextInterviewAt: string | null;
  row: SeekerRowState;
}

export interface MyBusiness {
  id: string;
  code: string;
  name: string;
  locality: string | null;
  businessType: string | null;
  businessTypeOther: string | null;
  openVacancies: number;
  candidatesShown: number;
  interviewsToday: number;
  row: BusinessRowState;
}

export interface MyPartner {
  id: string;
  code: string;
  name: string;
  phoneLast4: string | null;
  partnerType: 'individual' | 'business';
  locality: string | null;
  referred: number;
  row: PartnerRowState;
}

export interface ListPage<T> {
  query: string;
  filter: ListFilter;
  counts: Record<ListFilter, number>;
  total: number;
  results: T[];
  nextOffset: number | null;
}

export type ListKind = 'job-seekers' | 'businesses' | 'referrals';
export const PAGE_SIZE = 25;
/** The server works out at most this many of the newest (call-people.service.ts CAP). */
export const LIST_CAP = 200;

export function myListKey(kind: ListKind) {
  return ['call-work', 'my', kind] as const;
}

export function useMyList<T>(kind: ListKind, q: string, filter: ListFilter) {
  return useInfiniteQuery({
    queryKey: [...myListKey(kind), q, filter],
    queryFn: ({ pageParam }) =>
      api.get<ListPage<T>>(`/call-work/my/${kind}`, { query: { q: q || undefined, filter, offset: pageParam, limit: PAGE_SIZE } }),
    initialPageParam: 0,
    getNextPageParam: (last) => last.nextOffset ?? undefined,
    placeholderData: (previous) => previous,
  });
}
