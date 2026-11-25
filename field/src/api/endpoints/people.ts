import type { ApiClient } from '../client';

/**
 * Laboura Field lists (Master Guide, "Laboura Field lists, decided 22 Nov
 * evening"): each business and job seeker row carries one plain status, ONE
 * next-step button (or "Waiting" for the Team Lead, or "Done") and the filter
 * group; needs-action rows come first. Worked out on the server
 * (src/modules/screens-field/field-people.service.ts).
 */
export type ListGroup = 'needs_action' | 'waiting_tl' | 'active' | 'done';

export type BusinessRowAction = 'agreement_link' | 'confirm_vacancy' | 'add_shifts' | 'add_vacancy' | 'show_candidates' | 'record_visit';
export type BusinessRowStatus =
  | 'suspended'
  | 'paused'
  | 'agreement_not_sent'
  | 'agreement_waiting'
  | 'agreement_expired'
  | 'vacancy_to_confirm'
  | 'vacancy_to_send'
  | 'waiting_tl'
  | 'visit_outside_area'
  | 'not_verified'
  | 'no_shifts'
  | 'no_vacancy'
  | 'ready'
  | 'candidates_shown'
  | 'all_good';

export interface BusinessRowState {
  status: BusinessRowStatus;
  action: BusinessRowAction | null;
  vacancyId: string | null;
  waiting: boolean;
  done: boolean;
  group: ListGroup;
}

export type SeekerRowAction = 'registration_link' | 'payment_link' | 'scan_aadhaar' | 'book_interview';
export type SeekerRowStatus =
  | 'link_not_sent'
  | 'link_not_finished'
  | 'waiting_tl'
  | 'id_check_needed'
  | 'id_stopped'
  | 'stuck_payment'
  | 'trade_waiting'
  | 'active'
  | 'interview_booked'
  | 'placed'
  | 'closed';

export interface SeekerRowState {
  status: SeekerRowStatus;
  action: SeekerRowAction | null;
  vacancyId: string | null;
  waiting: boolean;
  done: boolean;
  group: ListGroup;
}

/** "Day X of 30" once he has paid (no amounts on field agent screens). */
export interface GuaranteeDay {
  day: number;
  days: number;
  endsAt: string;
}

/** "Where they're stuck" (the office profiles' box): the step, its state and the buttons it allows. */
export interface StuckBoxView {
  step: string;
  state: string;
  reason: string | null;
  waitingForTeamLead: boolean;
  actions: ('registration_link' | 'payment_link' | 'someone_else_pays')[];
}

/** GET /field-work/job-seekers/:ref/page — FA10e, one of my job seekers. */
export interface SeekerPage {
  id: string;
  code: string;
  name: string;
  phoneLast4: string | null;
  photoUrl: string | null;
  status: string;
  registeredAt: string;
  registeredByMe: boolean;
  trade: string | null;
  yearsExperience: number | null;
  otherTrades: string[];
  locality: string | null;
  details: {
    gender: string | null;
    age: number | null;
    languages: string[];
    shift: string | null;
    jobType: string | null;
    travelDistanceKm: number | null;
    lastRole: string | null;
    lastEmployer: string | null;
    availableFrom: string | null;
  };
  stuck: StuckBoxView;
  row: SeekerRowState;
  hits: number;
  guarantee: GuaranteeDay | null;
  /** Rev 211: paid, and the ID check has not passed — "Paid, waiting for ID" (older servers leave it out). */
  paidWaitingForId?: boolean;
  nextInterviewAt: string | null;
  interviews: { id: string; code: string; startsAt: string; status: string; result: string | null; businessName: string; trade: string }[];
  placements: { id: string; code: string; status: string; joiningDate: string | null; businessName: string; trade: string }[];
  history: { at: string; kind: string; detail: string | null }[];
}

const enc = encodeURIComponent;

export const peopleApi = (api: ApiClient) => ({
  seekerPage: (ref: string) => api.get<SeekerPage>(`/field-work/job-seekers/${enc(ref)}/page`),
  /** "Send payment link": a new ₹499 request sent to his phone (POST /job-seekers/:id/resend-payment, the office's button). */
  sendPaymentLink: (jobSeekerId: string, channel?: 'whatsapp' | 'sms') =>
    api.post<{ paymentId?: string; sentBy?: 'whatsapp' | 'sms' | null }>(`/job-seekers/${enc(jobSeekerId)}/resend-payment`, channel ? { channel } : {}),
});
