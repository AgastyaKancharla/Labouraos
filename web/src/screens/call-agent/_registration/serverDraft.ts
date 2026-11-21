import { useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../../../auth/AuthProvider';
import { api } from '../../../lib/api/client';
import { usePortal } from '../../../portals/PortalContext';
import { clearDraft, draftKey, writeDraft } from './useDraft';
import type { MobileState } from './kit';

/**
 * Unfinished registrations (Master Guide rev 204, 21 Nov): in the call agent
 * console the job seeker, business and referral partner forms are also saved
 * on the server as the agent types (only that agent can read them), so the
 * banner can offer "Resume / Discard" from any screen or another browser.
 * The local draft (useDraft) stays as it was; this mirrors it.
 */
export type DraftKind = 'job_seeker' | 'business' | 'referral';

/** The useDraft form name of each kind. */
export const FORM_OF: Record<DraftKind, string> = { job_seeker: 'job-seeker', business: 'business', referral: 'referral' };
/** The screen that holds each form. */
export const SCREEN_OF: Record<DraftKind, string> = { job_seeker: 'CA08-Register', business: 'CA13-BusinessLead', referral: 'CA15-RegisterReferral' };

export interface ServerDraft {
  id: string;
  kind: DraftKind;
  name: string | null;
  phone: string | null;
  phoneVerified: boolean;
  data: Record<string, unknown>;
  updatedAt: string;
}

export const draftsKey = ['registration-drafts'] as const;

export const draftsApi = {
  mine: () => api.get<{ drafts: ServerDraft[] }>('/registration-drafts'),
  save: (body: { kind: DraftKind; data: unknown; name: string | null; mobile: string | null; otpRequestId?: string | null }) =>
    api.put<ServerDraft>('/registration-drafts', body),
  discard: (kind: DraftKind) => api.delete<{ deleted: number }>('/registration-drafts', { query: { kind } }),
};

/** What the create routes take for a resumed draft whose number was checked by OTP. */
export function draftOtpRequestId(kind: DraftKind): string {
  return `draft:${kind}`;
}

const VERIFIED_PREFIX = 'laboura.draft.verified.';

function tabStore(): Storage | null {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

/** Resume: the number the draft keeps checked by OTP (this tab only). */
export function rememberResumedCheck(kind: DraftKind, staffId: string | undefined, mobile: string | null) {
  try {
    if (mobile) tabStore()?.setItem(`${VERIFIED_PREFIX}${kind}.${staffId ?? 'anon'}`, mobile);
    else tabStore()?.removeItem(`${VERIFIED_PREFIX}${kind}.${staffId ?? 'anon'}`);
  } catch {
    /* storage blocked: the number is checked again */
  }
}

function resumedCheck(kind: DraftKind, staffId: string | undefined): string | null {
  try {
    return tabStore()?.getItem(`${VERIFIED_PREFIX}${kind}.${staffId ?? 'anon'}`) ?? null;
  } catch {
    return null;
  }
}

/** 10 national digits of a mobile typed or stored any way ("+919845012345" → "9845012345"). */
export function nationalDigits(value: string | null | undefined): string {
  const digits = (value ?? '').replace(/\D/g, '');
  return digits.length > 10 ? digits.slice(-10) : digits;
}

/**
 * The form's first mobile state: a resumed draft whose number was checked by
 * OTP opens already checked (requestId "draft:<kind>"); otherwise unchecked.
 */
export function initialMobileState(kind: DraftKind, staffId: string | undefined, formMobile: string): MobileState {
  const checked = resumedCheck(kind, staffId);
  if (checked && formMobile && nationalDigits(checked) === nationalDigits(formMobile)) {
    return { mobile: formMobile, requestId: draftOtpRequestId(kind), verifiedAt: null };
  }
  return { mobile: formMobile, requestId: null, verifiedAt: null };
}

/** True only in the call agent console (drafts are the call agent's, not the CEO's or a Team Lead's). */
export function useConsoleDrafts(): boolean {
  const portal = usePortal();
  return portal.key === 'call-agent';
}

/**
 * Saves the form on the server as the agent types (debounced). The OTP request
 * id travels only while the code is fresh, so the server can mark the number
 * checked for this draft; a changed number loses that.
 */
export function useServerDraftSync(kind: DraftKind, form: object, mobile: MobileState, name: string, opts: { disabled?: boolean } = {}) {
  const enabled = useConsoleDrafts() && !opts.disabled;
  const { session } = useAuth();
  const staffId = session?.staff.id;
  const queryClient = useQueryClient();
  const first = useRef(true);
  const payload = JSON.stringify(form);
  useEffect(() => {
    if (!enabled) return;
    if (first.current) {
      first.current = false;
      return;
    }
    if (mobile.requestId !== draftOtpRequestId(kind)) rememberResumedCheck(kind, staffId, null);
    const id = setTimeout(() => {
      draftsApi
        .save({
          kind,
          data: JSON.parse(payload),
          name: name.trim() || null,
          mobile: mobile.mobile || null,
          otpRequestId: mobile.requestId && !mobile.requestId.startsWith('draft:') ? mobile.requestId : null,
        })
        .then(() => queryClient.invalidateQueries({ queryKey: draftsKey }))
        .catch(() => undefined);
    }, 800);
    return () => clearTimeout(id);
  }, [enabled, kind, payload, name, mobile.mobile, mobile.requestId, staffId, queryClient]);

  return {
    /** Discard (on the form) or after the registration is saved: the server copy goes too. */
    forget: () => {
      rememberResumedCheck(kind, staffId, null);
      if (!enabled) return;
      void draftsApi
        .discard(kind)
        .then(() => queryClient.invalidateQueries({ queryKey: draftsKey }))
        .catch(() => undefined);
    },
  };
}

/** Resume from the banner: the form opens with every field, and the number checked when the draft kept it. */
export function prepareResume(draft: ServerDraft, staffId: string | undefined) {
  writeDraft(draftKey(FORM_OF[draft.kind], staffId), draft.data);
  rememberResumedCheck(draft.kind, staffId, draft.phoneVerified ? draft.phone : null);
}

/** Discard from the banner: the server copy and this browser's copy. */
export async function discardEverywhere(kind: DraftKind, staffId: string | undefined) {
  clearDraft(draftKey(FORM_OF[kind], staffId));
  rememberResumedCheck(kind, staffId, null);
  await draftsApi.discard(kind);
}
