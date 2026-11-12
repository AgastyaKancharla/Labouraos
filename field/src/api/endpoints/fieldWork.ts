import type { ApiClient } from '../client';

/** Types copied from src/modules/screens-field/screens-field.service.ts. */
export type When = 'overdue' | 'today' | 'tomorrow';
export type ShopStatus = 'onboarded' | 'revisit_due' | 'interested' | 'not_interested' | 'lead';

export interface BusinessRef {
  id: string;
  code: string;
  name: string;
}

export type HomeAlert =
  | { kind: 'agreement_signed'; at: string; business: BusinessRef; canShowCandidates: boolean }
  | { kind: 'interview_result'; at: string; business: BusinessRef; interviewId: string; result: string | null };

export type HomeTodo =
  | { kind: 'revisit'; due: string; when: When; visitId: string; businessId: string | null; name: string; outcome: string | null }
  | { kind: 'joining'; due: string; when: When; placementId: string; code: string; candidateFirstName: string; businessId: string; name: string }
  | {
      kind: 'check_in';
      due: string;
      when: When;
      taskId: string;
      code: string;
      taskKind: string;
      name: string;
      subjectType: string;
      subjectId: string;
      relatedType: string | null;
      relatedId: string | null;
    };

/** GET /field-work/home */
export interface FieldHome {
  now: string;
  today: { shopsVisited: number; onboarded: number; vacanciesAdded: number; candidatesShown: number; interviewsBooked: number };
  alerts: HomeAlert[];
  todos: HomeTodo[];
  checkIn: { latitude: number; longitude: number; accuracyMeters: number; at: string } | null;
}

export interface RevisitDue {
  visitId: string;
  businessId: string | null;
  name: string;
  locality: string | null;
  outcome: string | null;
  revisitOn: string | null;
  note: string | null;
  latitude: number;
  longitude: number;
  lastVisitAt: string;
  when: 'overdue' | 'today';
}

/** GET /field-work/visits */
export interface FieldVisits {
  now: string;
  planned: {
    assignmentId: string;
    purpose: string;
    business: { id: string; code: string; name: string; locality: string | null; latitude: number | null; longitude: number | null };
    interview: { id: string; startsAt: string; candidateName: string; candidateArrivedAt: string | null } | null;
  }[];
  revisitsDue: RevisitDue[];
  doneToday: {
    id: string;
    name: string | null;
    business: BusinessRef | null;
    purpose: string | null;
    startedAt: string;
    durationSeconds: number | null;
    hasBoardPhoto: boolean;
    hasSelfie: boolean;
    outcome: string | null;
    needsOutcome: boolean;
    needsProof: boolean;
  }[];
}

export interface ShopPoint {
  kind: 'business' | 'prospect';
  id: string;
  businessId: string | null;
  visitId: string | null;
  code: string | null;
  name: string;
  latitude: number;
  longitude: number;
  status: ShopStatus;
  revisitOn: string | null;
  lastVisitAt: string | null;
  isMine: boolean;
  distanceMeters?: number;
}

/** GET /field-work/map */
export interface FieldMap {
  me: { latitude: number; longitude: number };
  radiusMeters: number;
  duplicateRadiusMeters: number;
  shops: ShopPoint[];
  revisitsDue: ShopPoint[];
}

/** GET /field-work/businesses/:ref */
export interface FieldBusiness {
  id: string;
  code: string;
  name: string;
  businessType: string | null;
  locality: string | null;
  latitude: number | null;
  longitude: number | null;
  verificationStatus: string | null;
  documentsStatus: string | null;
  paused: boolean;
  inPersonOnboardedAt: string | null;
  canShowCandidates: boolean;
  isMine: boolean;
  agreement: { signedAt: string; signedName: string | null } | null;
  contact: { name: string | null; role: string | null; phone: string } | null;
  branches: { id: string; name: string; locality: string | null; contactPersonName: string; contactPersonRole: string }[];
  vacancies: {
    id: string;
    code: string;
    trade: string;
    headcount: number;
    status: string;
    salaryMinPaise: number | null;
    salaryMaxPaise: number | null;
    salaryPeriod: string | null;
    otpConfirmed: boolean;
  }[];
  stats: { candidatesShown: number; interviews: number; placements: number; inGuarantee: number };
  visits: {
    id: string;
    at: string;
    durationSeconds: number | null;
    purpose: string | null;
    hasBoardPhoto: boolean;
    hasSelfie: boolean;
    outcome: string | null;
    staffName: string | null;
    mine: boolean;
  }[];
}

export interface FieldTargets {
  year: number;
  month: number;
  candidatesActivated: number;
}

export const fieldWorkApi = (api: ApiClient) => ({
  home: () => api.get<FieldHome>('/field-work/home'),
  visits: () => api.get<FieldVisits>('/field-work/visits'),
  map: (lat: number, lng: number, radius?: number) =>
    api.get<FieldMap>('/field-work/map', { query: { lat, lng, radius } }),
  business: (ref: string) => api.get<FieldBusiness>(`/field-work/businesses/${encodeURIComponent(ref)}`),
  targets: () => api.get<FieldTargets>('/field-work/targets'),
});
