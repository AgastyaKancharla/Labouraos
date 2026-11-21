import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Button } from '../../../components/Button';
import { EmptyState, ErrorState } from '../../../components/ErrorState';
import { SkeletonCard } from '../../../components/Skeleton';
import { TopBar } from '../../../components/TopBar';
import { useToast } from '../../../components/Toast';
import { SelectField, TextField } from '../../../components/fields/TextField';
import { useAuth } from '../../../auth/AuthProvider';
import { useT } from '../../../i18n/I18nProvider';
import type { MessageKey } from '../../../i18n/en';
import { isApiError } from '../../../lib/api/errors';
import { formatDateTimeIST, formatTimeIST } from '../../../lib/format/date';
import { useScreenPath } from '../../../portals/PortalContext';
import { useCallActions } from '../_lib/useCallActions';
import {
  seedRegistrationDraft,
  useConversationAction,
  useConversations,
  useLeadAction,
  useReferralLeads,
  useThread,
  useCallById,
  useRegistrationPrefill,
  type ConversationRow,
  type LinkKind,
  type ReferralLeadRow,
  type Thread,
} from './api';
import './whatsapp.css';

type Tab = 'open' | 'closed' | 'leads';

const last4 = (phone: string) => phone.replace(/\D/g, '').slice(-4);

/** A registered person is called through their record (consent and calling window checks on the server). */
function recordToCall(e: unknown): { subjectType: 'job_seeker' | 'business' | 'referral'; subjectId: string } | null {
  if (!isApiError(e)) return null;
  const d = e.details as { code?: string; subjectType?: string; subjectId?: string } | undefined;
  if (d?.code !== 'USE_RECORD_CALL' || !d.subjectId) return null;
  if (d.subjectType !== 'job_seeker' && d.subjectType !== 'business' && d.subjectType !== 'referral') return null;
  return { subjectType: d.subjectType, subjectId: d.subjectId };
}

/**
 * WhatsApp tab of the call agent console (Master Guide rev 202, 21 Nov; no
 * design file — built like CA10 with a list and a thread). Every message
 * people send Laboura on WhatsApp is a lead the software assigns like a missed
 * call: the agent answers inside the 24-hour window (templates after), uses the
 * quick buttons (call, send a link, register) and closes it with an outcome.
 * The "Partner leads" tab lists leads referral partners sent.
 */
export default function WhatsAppTab() {
  const t = useT();
  const [params, setParams] = useSearchParams();
  const tab = (['open', 'closed', 'leads'].includes(params.get('tab') ?? '') ? params.get('tab') : 'open') as Tab;
  const selected = params.get('c');
  const select = (next: { tab?: Tab; c?: string | null }) => {
    const p = new URLSearchParams(params);
    if (next.tab) p.set('tab', next.tab);
    if (next.c === null) p.delete('c');
    else if (next.c) p.set('c', next.c);
    setParams(p, { replace: true });
  };
  return (
    <div className="lb-page lb-ca">
      <TopBar icon="callCenter" iconTone="good" title={t('wa.title')} subtitle={t('wa.sub')} />
      <div className="wa-tabs" role="tablist" aria-label={t('wa.title')}>
        {(['open', 'closed', 'leads'] as const).map((key) => (
          <button key={key} type="button" role="tab" aria-selected={tab === key} className={`wa-tab${tab === key ? ' on' : ''}`} onClick={() => select({ tab: key, c: null })}>
            {t(`wa.tab.${key}` as MessageKey)}
          </button>
        ))}
      </div>
      {tab === 'leads' ? <PartnerLeads /> : <Conversations status={tab} selected={selected} onSelect={(c) => select({ c })} />}
    </div>
  );
}

function Conversations({ status, selected, onSelect }: { status: 'open' | 'closed'; selected: string | null; onSelect: (id: string | null) => void }) {
  const t = useT();
  const list = useConversations(status);
  const rows = list.data?.rows ?? [];
  return (
    <div className={`wa-grid${selected ? ' has-thread' : ''}`}>
      <div className="card wa-list" style={{ padding: 0 }}>
        {list.error && <ErrorState error={list.error} onRetry={() => void list.refetch()} />}
        {!list.data && !list.error && <SkeletonCard height={240} />}
        {list.data && rows.length === 0 && <EmptyState emoji="💬" title={t(status === 'open' ? 'wa.empty' : 'wa.emptyClosed')} />}
        <ul className="wa-rows">
          {rows.map((r) => (
            <li key={r.id}>
              <button type="button" className={`wa-row${selected === r.id ? ' on' : ''}`} onClick={() => onSelect(r.id)} aria-current={selected === r.id || undefined}>
                <span className="wa-row-top">
                  <span className="nm">{r.name ?? t('wa.newContact', { last4: last4(r.phone) })}</span>
                  {r.lastMessage && <span className="sub">{formatTimeIST(r.lastMessage.at)}</span>}
                </span>
                <span className="wa-row-tags">
                  {r.subjectCode ? <span className="tag tn">{r.subjectCode}</span> : <span className="tag tc">{t('wa.new')}</span>}
                  <RowStatus row={r} />
                </span>
                {r.lastMessage && <span className="sub wa-preview">{r.lastMessage.direction === 'out' ? '↩ ' : ''}{r.lastMessage.text}</span>}
              </button>
            </li>
          ))}
        </ul>
      </div>
      <div className="wa-thread-col">
        {selected ? <ThreadPanel id={selected} onBack={() => onSelect(null)} /> : <div className="card wa-pick"><p className="sub">{t('wa.pick')}</p></div>}
      </div>
    </div>
  );
}

function RowStatus({ row }: { row: ConversationRow }) {
  const t = useT();
  if (row.status === 'closed') return <span className="tag tg">{t('wa.closedAs', { outcome: row.outcome ? t(`wa.outcome.${row.outcome}` as MessageKey) : '' })}</span>;
  if (row.waitingSince) {
    return (
      <>
        <span className={`tag ${row.waitingWorkMinutes >= 15 ? 'tr' : 'ta'}`}>{t('wa.waiting', { minutes: row.waitingWorkMinutes })}</span>
        {row.autoReplied && <span className="tag tn">{t('wa.autoReplied')}</span>}
      </>
    );
  }
  return <span className="tag tg">{t('wa.answered')}</span>;
}

function ThreadPanel({ id, onBack }: { id: string; onBack: () => void }) {
  const t = useT();
  const thread = useThread(id);
  if (thread.error) return <div className="card"><ErrorState error={thread.error} onRetry={() => void thread.refetch()} /></div>;
  if (!thread.data) return <SkeletonCard height={320} />;
  return <ThreadView key={thread.data.id} thread={thread.data} onBack={onBack} backLabel={t('wa.backToList')} />;
}

function ThreadView({ thread: c, onBack, backLabel }: { thread: Thread; onBack: () => void; backLabel: string }) {
  const t = useT();
  const toast = useToast();
  const to = useScreenPath();
  const navigate = useNavigate();
  const { session } = useAuth();
  const { call, placing } = useCallActions();
  const [text, setText] = useState('');
  const [template, setTemplate] = useState('');
  const [outcome, setOutcome] = useState('');
  const [note, setNote] = useState('');
  const [code, setCode] = useState('');
  const reply = useConversationAction<{ text: string }>(c.id, 'reply');
  const sendTemplate = useConversationAction<{ template: string }>(c.id, 'template');
  const sendLink = useConversationAction<{ kind: LinkKind }, { sentBy: 'whatsapp' | 'sms' }>(c.id, 'send-link');
  const close = useConversationAction<{ outcome: string; note: string }>(c.id, 'outcome');
  const link = useConversationAction<{ code: string }>(c.id, 'link');
  const take = useConversationAction<Record<string, never>>(c.id, 'take');
  const callNew = useCallById((id) => `/whatsapp/conversations/${encodeURIComponent(id)}/call`);
  const prefill = useRegistrationPrefill((id) => `/whatsapp/conversations/${encodeURIComponent(id)}/registration-prefill`);
  const fail = (e: unknown) => toast.error(isApiError(e) ? e.message : t('error.server'));
  const name = c.person?.name ?? c.profileName ?? t('wa.newContact', { last4: last4(c.phone) });

  const register = (screen: 'CA08-Register' | 'CA13-BusinessLead' | 'CA15-RegisterReferral') => {
    const form = screen === 'CA08-Register' ? 'job-seeker' : screen === 'CA13-BusinessLead' ? 'business' : 'referral';
    prefill.mutate(c.id, {
      onSuccess: (p) => {
        // The number stays on the server: the form gets the name, "heard from" and a prefill reference only.
        seedRegistrationDraft(form, session?.staff.id, { name: p.name, heardFrom: p.heardFrom, prefillRef: p.prefillRef });
        toast.success(t('wa.registerNote', { phone: p.maskedPhone }));
        navigate(to(screen));
      },
      onError: fail,
    });
  };

  return (
    <div className="card wa-thread">
      <div className="wa-thread-head">
        <button type="button" className="wa-back" onClick={onBack}>← {backLabel}</button>
        <div>
          <div className="nm">{name}</div>
          <div className="sub">
            {c.person ? <Link to={to('CA04-Profile', { id: c.person.code })}>{t('wa.openProfile', { code: c.person.code })}</Link> : <span className="tag tc">{t('wa.new')}</span>}
            {' · '}
            {c.phone}
            {' · '}
            {c.assignedTo ? t('wa.with', { name: c.assignedTo.name }) : t('wa.unassigned')}
          </div>
        </div>
        {c.canTake && (
          <Button variant="primary" className="lb-ca-small" loading={take.isPending} onClick={() => take.mutate({}, { onSuccess: () => toast.success(t('wa.taken')), onError: fail })}>
            {t('wa.take')}
          </Button>
        )}
      </div>

      <ol className="wa-messages" aria-label={name}>
        {c.messages.map((m) => (
          <li key={m.id} className={`wa-msg ${m.direction}${m.kind === 'auto' ? ' auto' : ''}`}>
            <span className="wa-bubble">{m.text}</span>
            <span className="sub">
              {m.kind === 'auto' ? t('wa.auto') : m.by ? t('wa.by', { name: m.by }) : ''} {formatDateTimeIST(m.at)}
              {m.status === 'failed' && <strong className="wa-failed"> · {t('wa.failed')}</strong>}
            </span>
          </li>
        ))}
      </ol>

      {c.status === 'closed' && (
        <p className="ok">{t('wa.closedAs', { outcome: c.outcome ? t(`wa.outcome.${c.outcome}` as MessageKey) : '' })}{c.outcomeNote ? ` · ${c.outcomeNote}` : ''}</p>
      )}

      {c.canAct && (
        <>
          {c.windowOpen ? (
            <form
              className="wa-reply"
              onSubmit={(e) => {
                e.preventDefault();
                reply.mutate({ text }, { onSuccess: () => { setText(''); toast.success(t('wa.sent')); }, onError: fail });
              }}
            >
              <TextField label={t('wa.replyLabel')} value={text} onChange={setText} placeholder={t('wa.replyPlaceholder')} maxLength={1000} />
              <Button type="submit" variant="primary" loading={reply.isPending} disabled={!text.trim()}>{t('wa.send')}</Button>
              {c.windowEndsAt && <p className="sub">{t('wa.windowOpen', { time: formatDateTimeIST(c.windowEndsAt) })}</p>}
            </form>
          ) : (
            <div className="wa-reply">
              <p className="warn">{t('wa.windowClosed')}</p>
              <SelectField label={t('wa.templateLabel')} value={template} onChange={(v) => setTemplate(v)} options={c.templates.map((x) => ({ value: x.name, label: x.label }))} />
              {template && <p className="sub">{c.templates.find((x) => x.name === template)?.text}</p>}
              <Button variant="primary" disabled={!template} loading={sendTemplate.isPending} onClick={() => sendTemplate.mutate({ template }, { onSuccess: () => { setTemplate(''); toast.success(t('wa.sent')); }, onError: fail })}>
                {t('wa.sendTemplate')}
              </Button>
            </div>
          )}

          <div className="wa-section">
            <div className="lbl">{t('wa.quick')}</div>
            <div className="lb-ca-actions">
              {c.person ? (
                <Button className="lb-ca-small" disabled={placing} onClick={() => call({ subjectType: c.person!.type, subjectId: c.person!.id, purpose: 'general' })}>
                  📞 {t('wa.callNow')}
                </Button>
              ) : (
                <Button
                  className="lb-ca-small"
                  loading={callNew.isPending}
                  onClick={() =>
                    callNew.mutate(c.id, {
                      onSuccess: () => toast.success(t('wa.calling')),
                      onError: (e) => {
                        const record = recordToCall(e);
                        if (record) call({ ...record, purpose: 'general' });
                        else fail(e);
                      },
                    })
                  }
                >
                  📞 {t('wa.callNow')}
                </Button>
              )}
              {(['registration', 'agreement', 'referral_terms'] as const).filter((k) => c.links[k]).map((k) => (
                <Button
                  key={k}
                  className="lb-ca-small"
                  loading={sendLink.isPending}
                  onClick={() => sendLink.mutate({ kind: k }, { onSuccess: (res) => toast.success(t(res.sentBy === 'sms' ? 'wa.sentBySms' : 'wa.sentOnWhatsApp')), onError: fail })}
                >
                  {t(`wa.sendLink.${k}` as MessageKey)}
                </Button>
              ))}
            </div>
            {!c.person && (
              <>
                <div className="lb-ca-actions" style={{ marginTop: 8 }}>
                  <span className="sub">{t('wa.register')}</span>
                  <Button className="lb-ca-small" onClick={() => register('CA08-Register')}>{t('wa.register.seeker')}</Button>
                  <Button className="lb-ca-small" onClick={() => register('CA13-BusinessLead')}>{t('wa.register.business')}</Button>
                  <Button className="lb-ca-small" onClick={() => register('CA15-RegisterReferral')}>{t('wa.register.partner')}</Button>
                </div>
                <form
                  className="wa-inline"
                  onSubmit={(e) => {
                    e.preventDefault();
                    link.mutate({ code }, { onSuccess: () => { toast.success(t('wa.linked', { code: code.toUpperCase() })); setCode(''); }, onError: fail });
                  }}
                >
                  <TextField label={t('wa.linkRecordLabel')} value={code} onChange={setCode} maxLength={20} />
                  <Button type="submit" className="lb-ca-small" disabled={code.trim().length < 4} loading={link.isPending}>{t('wa.link')}</Button>
                </form>
              </>
            )}
          </div>

          <form
            className="wa-section wa-inline"
            onSubmit={(e) => {
              e.preventDefault();
              close.mutate({ outcome, note }, { onSuccess: () => { toast.success(t('wa.closedToast')); setOutcome(''); setNote(''); }, onError: fail });
            }}
          >
            <SelectField label={t('wa.outcome')} value={outcome} onChange={(v) => setOutcome(v)} options={c.outcomes.map((o) => ({ value: o, label: t(`wa.outcome.${o}` as MessageKey) }))} />
            <TextField label={t('wa.outcomeNote')} value={note} onChange={setNote} maxLength={500} />
            <Button type="submit" disabled={!outcome} loading={close.isPending}>{t('wa.close')}</Button>
          </form>
        </>
      )}
    </div>
  );
}

const LEAD_OUTCOMES = ['registered', 'already_registered', 'not_interested', 'no_answer_3_tries', 'wrong_number'] as const;

function PartnerLeads() {
  const t = useT();
  const leads = useReferralLeads();
  const rows = (leads.data?.rows ?? []).filter((r) => r.status === 'open');
  return (
    <div className="card" style={{ padding: 0 }}>
      {leads.error && <ErrorState error={leads.error} onRetry={() => void leads.refetch()} />}
      {!leads.data && !leads.error && <SkeletonCard height={200} />}
      {leads.data && rows.length === 0 && <EmptyState emoji="🤝" title={t('wa.leads.empty')} />}
      <ul className="wa-rows">
        {rows.map((r) => <LeadRow key={r.id} lead={r} />)}
      </ul>
    </div>
  );
}

function LeadRow({ lead }: { lead: ReferralLeadRow }) {
  const t = useT();
  const toast = useToast();
  const to = useScreenPath();
  const navigate = useNavigate();
  const { session } = useAuth();
  const close = useLeadAction<{ outcome: string; code?: string }>('outcome');
  const callLead = useCallById((id) => `/referral-leads/${encodeURIComponent(id)}/call`);
  const prefill = useRegistrationPrefill((id) => `/referral-leads/${encodeURIComponent(id)}/registration-prefill`);
  const take = useLeadAction<never>('take');
  const [outcome, setOutcome] = useState('');
  const mine = lead.assignedTo?.id === session?.staff.id;
  const fail = (e: unknown) => toast.error(isApiError(e) ? e.message : t('error.server'));
  const { call } = useCallActions();
  const register = (asJob: boolean) => {
    prefill.mutate(lead.id, {
      onSuccess: (p) => {
        const values: Record<string, unknown> = { name: p.name, heardFrom: 'referral_partner', prefillRef: p.prefillRef };
        if (asJob && p.referredBy) values.referredBy = p.referredBy;
        const seeded = seedRegistrationDraft(asJob ? 'job-seeker' : 'business', session?.staff.id, values);
        if (!seeded && lead.partner) toast.success(t('wa.leads.draftNote', { code: lead.partner.code }));
        else toast.success(t('wa.registerNote', { phone: p.maskedPhone }));
        navigate(to(asJob ? 'CA08-Register' : 'CA13-BusinessLead'));
      },
      onError: fail,
    });
  };
  return (
    <li className="wa-lead">
      <div className="wa-row-top">
        <span className="nm">{lead.name}</span>
        <span className="sub">{formatDateTimeIST(lead.createdAt)}</span>
      </div>
      <div className="wa-row-tags">
        <span className="tag tn">{t(lead.lookingFor === 'job' ? 'wa.leads.job' : lead.lookingFor === 'staff' ? 'wa.leads.staff' : 'wa.leads.unknown')}</span>
        {lead.source === 'app' && <span className="tag tc">{t('wa.leads.fromApp')}</span>}
        {lead.area && <span className="tag tc">{lead.area}</span>}
        <span className="sub">{lead.phone}</span>
      </div>
      {lead.partner && <div className="sub">{t('wa.leads.from', { code: lead.partner.code, name: lead.partner.name })}</div>}
      {lead.note && <div className="sub">“{lead.note}”</div>}
      {lead.alreadyRegistered && (
        <div className="ok">
          <Link to={to('CA04-Profile', { id: lead.alreadyRegistered.code })}>{t('wa.leads.already', { code: lead.alreadyRegistered.code })}</Link>
        </div>
      )}
      <div className="lb-ca-actions" style={{ marginTop: 6 }}>
        {!lead.assignedTo && (
          <Button className="lb-ca-small" variant="primary" loading={take.isPending} onClick={() => take.mutate({ id: lead.id }, { onError: fail })}>{t('wa.take')}</Button>
        )}
        {mine && (
          <Button
            className="lb-ca-small"
            loading={callLead.isPending}
            onClick={() =>
              callLead.mutate(lead.id, {
                onSuccess: () => toast.success(t('wa.calling')),
                onError: (e) => {
                  const record = recordToCall(e);
                  if (record) call({ ...record, purpose: 'general' });
                  else fail(e);
                },
              })
            }
          >
            📞 {t('wa.leads.call')}
          </Button>
        )}
        {mine && !lead.alreadyRegistered && lead.lookingFor !== 'staff' && (
          <Button className="lb-ca-small" variant="primary" onClick={() => register(true)}>{t('wa.leads.registerSeeker')}</Button>
        )}
        {mine && !lead.alreadyRegistered && lead.lookingFor !== 'job' && (
          <Button className="lb-ca-small" variant={lead.lookingFor === 'staff' ? 'primary' : 'secondary'} onClick={() => register(false)}>{t('wa.leads.registerBusiness')}</Button>
        )}
        {mine && (
          <form
            className="wa-inline"
            onSubmit={(e) => {
              e.preventDefault();
              close.mutate({ id: lead.id, body: { outcome, code: lead.alreadyRegistered?.code } }, { onSuccess: () => toast.success(t('wa.closedToast')), onError: fail });
            }}
          >
            <SelectField label={t('wa.leads.close')} value={outcome} onChange={(v) => setOutcome(v)} options={LEAD_OUTCOMES.map((o) => ({ value: o, label: t(`wa.leads.outcome.${o}` as MessageKey) }))} />
            <Button type="submit" className="lb-ca-small" disabled={!outcome} loading={close.isPending}>{t('wa.close')}</Button>
          </form>
        )}
      </div>
    </li>
  );
}
