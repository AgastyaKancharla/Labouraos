import type { ApiClient } from '../client';

/** A shop visit (src/modules/field-visit/field-visit.service.ts present()). */
export interface Visit {
  id: string;
  purpose: string | null;
  business: { id: string; code: string; name: string } | null;
  shopName: string | null;
  assignmentId: string | null;
  revisitOfVisitId: string | null;
  latitude: number;
  longitude: number;
  accuracyMeters: number | null;
  startedAt: string;
  endedAt: string | null;
  durationSeconds: number | null;
  hasBoardPhoto: boolean;
  hasSelfie: boolean;
  proofDistanceMeters: number | null;
  geofenceFlag: boolean;
  spokeTo: string | null;
  contactPhone: string | null;
  outcome: string | null;
  outcomeReason: string | null;
  revisitOn: string | null;
  note: string | null;
  ownerOtpDone: boolean;
}

export type VisitOutcome = 'onboarded' | 'interested_later' | 'not_interested' | 'owner_not_there';

export interface OutcomeBody {
  outcome: VisitOutcome | 'onboard_now';
  shopName?: string;
  spokeTo?: string;
  contactPhone?: string;
  reason?: string;
  revisitOn?: string;
  /** 21 Nov: optional come-back time, "HH:mm" IST. */
  revisitTime?: string;
  note?: string;
  endedAt?: string;
}

/**
 * Paths of the visit writes. They go through the offline queue
 * (`queue.submit`), except the owner's code, which needs signal.
 */
export const visitPaths = {
  start: '/field-visits',
  outcome: (id: string) => `/field-visits/${encodeURIComponent(id)}/outcome`,
  proof: (id: string) => `/field-visits/${encodeURIComponent(id)}/proof`,
  /** 22 Nov (rev 208): "Close this revisit" with a reason. */
  closeRevisit: (id: string) => `/field-visits/${encodeURIComponent(id)}/close-revisit`,
};

export const visitsApi = (api: ApiClient) => ({
  get: (id: string) => api.get<Visit>(`/field-visits/${encodeURIComponent(id)}`),
  /** FA06: live only (the owner reads the code out). */
  verify: (id: string, body: { ownerOtpRequestId: string; ownerOtpCode: string }) =>
    api.post<Visit & {
      businessVerificationStatus: string | null;
      /** The verifying agent is the business's account agent now (server, 16 Nov). */
      isAccountAgent?: boolean;
      /** He became it with this visit (the business had none): the finish screen says so. */
      becameAccountAgent?: boolean;
    }>(`/field-visits/${encodeURIComponent(id)}/verify`, body),
  /** FA06: sends the owner's presence code (live). */
  sendOwnerOtp: (businessId: string, assignmentId: string, channel?: 'sms') =>
    api.post<{ success: boolean; requestId: string; phone: string }>(
      `/businesses/${encodeURIComponent(businessId)}/visit-assignments/${encodeURIComponent(assignmentId)}/owner-otp`,
      channel ? { channel } : undefined,
    ),
  /** The business form's first agreement link; `smsSent: false` when the SMS did not go (show Resend). */
  /** The agreement link, in English (rev 193). */
  sendAgreementLink: (businessId: string) =>
    api.post<{ success?: boolean; smsSent?: boolean } | null>(`/businesses/${encodeURIComponent(businessId)}/agreement-links`, {}),
  checkIn: (body: { latitude: number; longitude: number; accuracyMeters: number }) => api.post<unknown>('/field-agent/check-in', body),
  leaderboard: () =>
    api.get<{ leaderboard: { position: number; staffId: string; staffCode: string; name: string; placementsClosed: number }[] }>(
      '/targets/leaderboard',
    ),
  businessCheckOut: () => api.post<unknown>('/attendance/business-check-out'),
});
