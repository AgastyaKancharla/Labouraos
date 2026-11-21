import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../../lib/api/client';
import { draftKey, readDraft, writeDraft } from '../_registration/useDraft';

/** One WhatsApp conversation in the list (GET /whatsapp/conversations). Phones come masked. */
export interface ConversationRow {
  id: string;
  name: string | null;
  subjectType: 'job_seeker' | 'business' | 'referral' | null;
  subjectId: string | null;
  subjectCode: string | null;
  isNew: boolean;
  phone: string;
  status: 'open' | 'closed';
  outcome: string | null;
  lastMessage: { text: string; direction: 'in' | 'out'; at: string } | null;
  lastInboundAt: string | null;
  waitingSince: string | null;
  waitingWorkMinutes: number;
  windowOpen: boolean;
  windowEndsAt: string | null;
  assignedTo: { id: string; code: string; name: string } | null;
  autoReplied: boolean;
}

export interface ThreadMessage {
  id: string;
  direction: 'in' | 'out';
  kind: 'text' | 'template' | 'auto' | 'other';
  text: string;
  templateName: string | null;
  status: string;
  at: string;
  by: string | null;
}

export interface Thread {
  id: string;
  name: string | null;
  profileName: string | null;
  phone: string;
  person: { type: 'job_seeker' | 'business' | 'referral'; id: string; code: string; name: string } | null;
  status: 'open' | 'closed';
  outcome: string | null;
  outcomeNote: string | null;
  waitingSince: string | null;
  waitingWorkMinutes: number;
  windowOpen: boolean;
  windowEndsAt: string | null;
  assignedTo: { id: string; code: string; name: string } | null;
  canAct: boolean;
  canTake: boolean;
  links: { registration: boolean; agreement: boolean; referral_terms: boolean };
  templates: Array<{ name: string; label: string; text: string }>;
  outcomes: string[];
  messages: ThreadMessage[];
}

export interface ReferralLeadRow {
  id: string;
  name: string;
  phone: string;
  /** unknown: an app lead sent with only name and mobile. */
  lookingFor: 'job' | 'staff' | 'unknown';
  area: string | null;
  note: string | null;
  source: 'link' | 'app';
  status: 'open' | 'closed';
  outcome: string | null;
  createdAt: string;
  partner: { id: string; code: string; name: string } | null;
  assignedTo: { id: string; code: string; name: string } | null;
  alreadyRegistered: { type: string; id: string; code: string } | null;
}

export type LinkKind = 'registration' | 'agreement' | 'referral_terms';

export const waKeys = {
  list: (status: string) => ['whatsapp', 'conversations', status] as const,
  thread: (id: string) => ['whatsapp', 'thread', id] as const,
  leads: () => ['whatsapp', 'referral-leads'] as const,
};

export function useConversations(status: 'open' | 'closed') {
  return useQuery({
    queryKey: waKeys.list(status),
    queryFn: () => api.get<{ rows: ConversationRow[] }>('/whatsapp/conversations', { query: { status } }),
    refetchInterval: 15_000,
  });
}

export function useThread(id: string | null) {
  return useQuery({
    queryKey: waKeys.thread(id ?? ''),
    queryFn: () => api.get<Thread>(`/whatsapp/conversations/${encodeURIComponent(id!)}`),
    enabled: Boolean(id),
    refetchInterval: 10_000,
  });
}

export function useReferralLeads() {
  return useQuery({
    queryKey: waKeys.leads(),
    queryFn: () => api.get<{ rows: ReferralLeadRow[] }>('/referral-leads'),
    refetchInterval: 30_000,
  });
}

/** Every write on a conversation refreshes its thread and both lists. */
export function useConversationAction<TBody, TResult = unknown>(id: string | null, action: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body: TBody) => api.post<TResult>(`/whatsapp/conversations/${encodeURIComponent(id ?? '')}/${action}`, body ?? {}),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['whatsapp'] });
    },
  });
}

export function useLeadAction<TBody>(action: 'outcome' | 'take') {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body?: TBody }) => api.post(`/referral-leads/${encodeURIComponent(id)}/${action}`, body ?? {}),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: waKeys.leads() });
    },
  });
}

const SEND_LINK_PATH: Record<LinkKind, string> = {
  registration: 'registration',
  agreement: 'agreement',
  referral_terms: 'referral-terms',
};

/** "Send on WhatsApp" next to Resend: WhatsApp first, SMS when WhatsApp fails. */
export function useSendOnWhatsApp(kind: LinkKind) {
  return useMutation({
    mutationFn: (id: string) => api.post<{ sentBy: 'whatsapp' | 'sms' | null }>(`/whatsapp/send-link/${SEND_LINK_PATH[kind]}/${encodeURIComponent(id)}`, {}),
  });
}

/**
 * Starts a registration form already filled with what we know (name, how they
 * heard about Laboura, the referral partner). An unsaved form the agent already
 * has open is never overwritten: then nothing is filled and the screen says so.
 */
export function seedRegistrationDraft(form: 'job-seeker' | 'business' | 'referral', staffId: string | undefined, values: Record<string, unknown>): boolean {
  const key = draftKey(form, staffId);
  if (readDraft(key)) return false;
  writeDraft(key, values);
  return true;
}
