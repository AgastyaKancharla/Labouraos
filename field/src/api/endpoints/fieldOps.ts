import type { ApiClient } from '../client';

const enc = encodeURIComponent;

/** One open verification visit as a job card (GET /field-work/verification-visits, 21 Nov). */
export interface VerificationJob {
  assignmentId: string;
  purpose: string;
  requestedFor: string | null;
  business: {
    id: string;
    code: string;
    name: string;
    address: string | null;
    locality: string | null;
    ownerName: string | null;
    contactName: string | null;
    phoneLast4: string;
    latitude: number | null;
    longitude: number | null;
  };
  lastAttempt: { visitId: string; outcome: string | null; at: string; revisitOn: string | null; revisitTime: string | null } | null;
  unfinishedVisitId: string | null;
}

/** GET /field-work/calling-phone */
export interface CallingPhone {
  set: boolean;
  last4: string | null;
}

/** Where a notification opens in Laboura Field. */
export interface FieldNotificationTarget {
  type: 'visit_assignment' | 'business' | 'placement' | 'revisit' | 'vacancy_matches' | 'job_seeker' | 'referral' | 'leave' | 'correction' | 'payslip' | string;
  id: string;
  vacancyId?: string;
  businessId?: string;
}

export interface FieldNotification {
  id: string;
  kind: string;
  title: string;
  body: string | null;
  createdAt: string;
  seenAt: string | null;
  clearedAt: string | null;
  target: FieldNotificationTarget | null;
}

/** GET /field-work/notifications */
export interface FieldNotifications {
  unseenCount: number;
  openCount: number;
  items: FieldNotification[];
  asOf: string;
}

/** GET /field-work/follow-ups/:id */
export interface FollowUpView {
  id: string;
  code: string;
  kind: string;
  kindLabel: string;
  status: string;
  dueAt: string;
  subjectType: string;
  subjectId: string;
  relatedType: string | null;
  relatedId: string | null;
  answer: string | null;
  completedAt: string | null;
  answers: string[];
  callPurpose: string;
  business: { id: string; code: string; name: string; locality: string | null; contactName: string | null; phoneLast4: string; mine: boolean } | null;
  jobSeeker: { id: string; code: string; firstName: string; phoneLast4: string } | null;
}

/** GET /field-work/similar-shops */
export interface SimilarShop {
  id: string;
  code: string;
  name: string;
  locality: string | null;
  distanceMeters: number;
  mine: boolean;
}

/**
 * Laboura Field's 21 Nov fixes: verification job cards and "Update the pin",
 * the calling phone, the bell, follow-up tasks and the similar-shop warning.
 */
export function fieldOpsApi(api: ApiClient) {
  return {
    verificationVisits: () => api.get<VerificationJob[]>('/field-work/verification-visits'),
    updatePin: (assignmentId: string, body: { latitude: number; longitude: number; accuracy?: number | null; reason: string }) =>
      api.post<{ businessId: string; latitude: number; longitude: number; movedMeters: number | null }>(`/field-work/verification-visits/${enc(assignmentId)}/pin`, body),
    callingPhone: () => api.get<CallingPhone>('/field-work/calling-phone'),
    setCallingPhone: (staffId: string, phone: string) => api.put<{ set: boolean }>(`/staff/${enc(staffId)}/call-routing-phone`, { phone }),
    notifications: () => api.get<FieldNotifications>('/field-work/notifications'),
    markSeen: (id: string) => api.post(`/notifications/${enc(id)}/seen`, {}),
    markAllSeen: () => api.post('/notifications/seen', {}),
    followUp: (id: string) => api.get<FollowUpView>(`/field-work/follow-ups/${enc(id)}`),
    completeFollowUp: (id: string, body: { callRecordId: string; answer: string; notes?: string }) =>
      api.post(`/follow-up-tasks/${enc(id)}/complete`, body),
    similarShops: (name: string, lat: number, lng: number) =>
      api.get<{ matches: SimilarShop[] }>('/field-work/similar-shops', { query: { name, lat, lng } }),
  };
}
