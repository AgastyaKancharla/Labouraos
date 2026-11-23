import type { ListFilter, ListPage, MyBusiness, MyPartner, MySeeker } from './api';

/** Test data for the console lists (rev 210, 23 Nov). */
export function seeker(over: Partial<MySeeker> = {}): MySeeker {
  return {
    id: 'js1', code: 'JS-00101', name: 'Ravi Kumar', phoneLast4: '4321', status: 'lead', photoUrl: null,
    trade: 'Cook', yearsExperience: 1, locality: 'Bommanahalli', hits: 0, guarantee: null, nextInterviewAt: null,
    row: { status: 'link_not_sent', action: 'registration_link', vacancyId: null, waiting: false, done: false, group: 'needs_action' },
    ...over,
  };
}

export function business(over: Partial<MyBusiness> = {}): MyBusiness {
  return {
    id: 'b1', code: 'BZ-00201', name: 'Sri Sweets', locality: 'Bellandur', businessType: 'sweet_shop', businessTypeOther: null,
    openVacancies: 0, candidatesShown: 0, interviewsToday: 0,
    row: { status: 'agreement_not_sent', action: 'agreement_link', vacancyId: null, waiting: false, done: false, group: 'needs_action' },
    ...over,
  };
}

export function partner(over: Partial<MyPartner> = {}): MyPartner {
  return {
    id: 'rf1', code: 'RF-00301', name: 'Antony George', phoneLast4: '7788', partnerType: 'individual', locality: 'HSR Layout', referred: 0,
    row: { status: 'terms_not_signed', action: 'partner_terms_link', vacancyId: null, waiting: false, done: false, group: 'needs_action' },
    ...over,
  };
}

export function listPage<T extends { row: { group: Exclude<ListFilter, 'all'> } }>(rows: T[], over: Partial<ListPage<T>> = {}): ListPage<T> {
  const counts: Record<ListFilter, number> = { all: rows.length, needs_action: 0, waiting_tl: 0, active: 0, done: 0 };
  for (const r of rows) counts[r.row.group] += 1;
  return { query: '', filter: 'all', counts, total: rows.length, results: rows, nextOffset: null, ...over };
}
