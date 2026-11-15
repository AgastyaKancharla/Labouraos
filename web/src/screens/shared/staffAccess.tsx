import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '../../components/Button';
import { Card } from '../../components/Card';
import { DataTable, type Column } from '../../components/DataTable';
import { Modal } from '../../components/Modal';
import { StaffAvatar } from '../../components/StaffAvatar';
import { StatusPill, type StatusTone } from '../../components/Badge';
import { useToast } from '../../components/Toast';
import { useT } from '../../i18n/I18nProvider';
import type { StaffAccessKey } from '../../i18n/staffAccess';
import { api } from '../../lib/api/client';
import { ApiError } from '../../lib/api/errors';
import { formatDateTimeIST, formatTimeIST } from '../../lib/format/date';
import { ActionButton } from '../ceo/_kit/actions';

/**
 * Staff accounts kit (Master Guide rev 174–175), shared by the CEO, Manager
 * and Team Lead screens:
 *   S1  the temporary password box (staff code + temporary password, shown
 *       once, expiry, Copy; Share on WhatsApp for agents only);
 *   S2  "New temporary password" and "Reset sign-in completely";
 *   S6  the red PASSWORD RESET cards on the code screens (Reveal / Refuse);
 *   S7  the password reset history.
 */

/** POST /staff, /staff/:id/temp-password, /staff/:id/reset-sign-in, /staff/:id/reactivate. */
export interface TempPasswordResult {
  staff: { id: string; code: string; name: string; role: string };
  tempPassword: string;
  tempPasswordExpiresAt: string;
}

const roleWords: Record<string, string> = {
  ceo: 'CEO',
  manager: 'Manager',
  team_lead: 'Team Lead',
  finance: 'Finance',
  call_agent: 'Call agent',
  field_agent: 'Field agent',
};
const roleWord = (role: string) => roleWords[role] ?? role;

/**
 * Only call agent and field agent accounts get the WhatsApp share: they still
 * need an approved device and a login code from a senior. For the CEO, a
 * Manager, Finance or a Team Lead the temporary password is read out on a
 * call (it must never sit in a link or a chat).
 */
export const WHATSAPP_SHARE_ROLES = ['call_agent', 'field_agent'];

/** The WhatsApp message with the staff code and temporary password (wa.me opens the share sheet). */
export function whatsappShareLink(text: string): string {
  return `https://wa.me/?text=${encodeURIComponent(text)}`;
}

/** S1: the box shown once after adding someone or giving a temporary password. */
export function TempPasswordModal({ result, onClose }: { result: TempPasswordResult | null; onClose: () => void }) {
  const t = useT();
  const toast = useToast();
  const message = result ? t('access.temp.message', { code: result.staff.code, password: result.tempPassword }) : '';
  const shareable = Boolean(result && WHATSAPP_SHARE_ROLES.includes(result.staff.role));
  return (
    <Modal
      open={Boolean(result)}
      onClose={onClose}
      title={result ? t('access.temp.title', { name: result.staff.name }) : ''}
      footer={
        <>
          <Button
            onClick={() => {
              void navigator.clipboard?.writeText(message);
              toast.success(t('access.temp.copied'));
            }}
          >
            {t('access.temp.copy')}
          </Button>
          {shareable && (
            <a className="btn" href={whatsappShareLink(message)} target="_blank" rel="noreferrer noopener" data-testid="temp-password-whatsapp">
              {t('access.temp.whatsapp')}
            </a>
          )}
          <Button variant="primary" onClick={onClose}>
            {t('access.temp.done')}
          </Button>
        </>
      }
    >
      {result && (
        <div className="lb-stack" data-testid="temp-password-box">
          <div className="kv">
            <span>{t('access.temp.staffCode')}</span>
            <span className="code">{result.staff.code}</span>
            <span>{t('access.temp.password')}</span>
            <span className="code ceo-code-big" data-testid="temp-password">
              {result.tempPassword}
            </span>
          </div>
          <p className="ceo-sub" style={{ margin: 0 }}>
            <strong>{t('access.temp.once')}</strong> {t('access.temp.expires', { time: formatDateTimeIST(result.tempPasswordExpiresAt) })}
          </p>
          {!shareable && (
            <p className="lb-notice" style={{ margin: 0 }} data-testid="temp-password-read-out">
              {t('access.temp.readOut')}
            </p>
          )}
        </div>
      )}
    </Modal>
  );
}

/** S2: "New temporary password" (replaces Resend invite and the reset link). */
export function NewTempPasswordButton({ id, name }: { id: string; name: string }) {
  const t = useT();
  const [shown, setShown] = useState<TempPasswordResult | null>(null);
  return (
    <>
      <ActionButton
        label={t('access.action.newTemp')}
        title={t('access.action.newTempTitle', { name })}
        description={t('access.action.newTempBody')}
        confirmLabel={t('access.action.newTemp')}
        run={async () => {
          const res = await api.post<TempPasswordResult>(`/staff/${id}/temp-password`);
          setShown(res);
          return res;
        }}
        success={t('access.action.newTemp')}
      />
      <TempPasswordModal result={shown} onClose={() => setShown(null)} />
    </>
  );
}

/** S2: "Reset sign-in completely" (lost phone or authenticator). */
export function ResetSignInButton({ id, name }: { id: string; name: string }) {
  const t = useT();
  const [shown, setShown] = useState<TempPasswordResult | null>(null);
  return (
    <>
      <ActionButton
        label={t('access.action.resetAll')}
        variant="danger"
        title={t('access.action.resetAllTitle', { name })}
        description={t('access.action.resetAllBody')}
        confirmLabel={t('access.action.resetAll')}
        run={async () => {
          const res = await api.post<TempPasswordResult>(`/staff/${id}/reset-sign-in`);
          setShown(res);
          return res;
        }}
        success={t('access.action.resetAll')}
      />
      <TempPasswordModal result={shown} onClose={() => setShown(null)} />
    </>
  );
}

/** Reactivation gives a temporary password too. */
export function ReactivateButton({ id, name }: { id: string; name: string }) {
  const t = useT();
  const [shown, setShown] = useState<TempPasswordResult | null>(null);
  return (
    <>
      <ActionButton
        label={t('access.action.reactivate')}
        title={`${t('access.action.reactivate')} · ${name}`}
        description={t('access.action.reactivateBody')}
        confirmLabel={t('access.action.reactivate')}
        run={async () => {
          const res = await api.post<TempPasswordResult>(`/staff/${id}/reactivate`);
          setShown(res);
          return res;
        }}
        success={t('access.action.reactivate')}
      />
      <TempPasswordModal result={shown} onClose={() => setShown(null)} />
    </>
  );
}

/** GET /password-resets/pending. */
export interface ResetRequestCard {
  id: string;
  kind: 'password_reset';
  status: 'pending' | 'revealed';
  createdAt: string;
  expiresAt: string;
  knownDevice: boolean;
  app: string | null;
  revealedAt: string | null;
  staff: { id: string; code: string; name: string; role: string; photoUrl?: string | null };
}

export function usePendingResets() {
  return useQuery({
    queryKey: ['password-resets', 'pending'],
    queryFn: () => api.get<ResetRequestCard[]>('/password-resets/pending'),
    refetchInterval: 10_000,
  });
}

/** S6: one red PASSWORD RESET card — clearly unlike a LOGIN card. */
export function ResetRequestCardView({ request }: { request: ResetRequestCard }) {
  const t = useT();
  const toast = useToast();
  const qc = useQueryClient();
  const [code, setCode] = useState<{ code: string; expiresAt: string } | null>(null);
  const reveal = useMutation({
    mutationFn: () => api.post<{ code: string; expiresAt: string }>(`/password-resets/${request.id}/reveal`),
    onSuccess: (res) => setCode({ code: res.code, expiresAt: res.expiresAt }),
    onError: (e) => toast.error(e instanceof ApiError ? e.message : t('error.network')),
  });
  const pretty = code ? `${code.code.slice(0, 3)} ${code.code.slice(3)}` : null;
  return (
    <div className="card lb-reset-card" data-testid="reset-request-card" style={{ borderLeft: '6px solid var(--red, #c62828)', background: 'var(--red-bg, #fdecea)' }}>
      <div className="ceo-req">
        <StaffAvatar name={request.staff.name} photoUrl={request.staff.photoUrl} size="lg" noPhotoLabel="—" />
        <div>
          <StatusPill tone="danger">{t('access.card.resetKind')}</StatusPill>
          <div style={{ fontWeight: 700, marginTop: 6 }}>{request.staff.name}</div>
          <div className="ceo-cell-sub">
            {request.staff.code} · {roleWord(request.staff.role)}
          </div>
          <div className="kv" style={{ marginTop: 10 }}>
            <span>{t('access.card.asked')}</span>
            <span>{formatTimeIST(request.createdAt)}</span>
            <span>{t('access.card.device')}</span>
            <span>
              {request.knownDevice ? (
                t('access.card.usualPhone')
              ) : (
                <strong style={{ color: 'var(--red, #c62828)' }}>{t('access.card.newPhone')}</strong>
              )}
            </span>
          </div>
          <p className="ceo-sub">{t('access.card.callBack')}</p>
          {pretty ? (
            <div style={{ marginTop: 12 }}>
              <div className="ceo-code-big" aria-live="polite" data-testid="reset-code">
                {pretty}
              </div>
              <p className="ceo-sub">{t('access.card.codeNote')}</p>
            </div>
          ) : null}
          <div className="ceo-actions" style={{ marginTop: 12 }}>
            {!pretty && (
              <Button variant="danger" onClick={() => reveal.mutate()} loading={reveal.isPending}>
                {t('access.card.reveal')}
              </Button>
            )}
            <ActionButton
              label={t('access.card.refuse')}
              title={t('access.card.refuseTitle', { name: request.staff.name })}
              description={t('access.card.refuseBody')}
              reason={{ label: t('access.card.reason'), required: true }}
              run={async ({ reason }) => {
                const res = await api.post(`/password-resets/${request.id}/refuse`, { reason });
                void qc.invalidateQueries({ queryKey: ['password-resets'] });
                return res;
              }}
              success={t('access.card.refused')}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

/** S6: every red card waiting for this senior (nothing when none). */
export function PendingResetCards() {
  const t = useT();
  const pending = usePendingResets();
  if (!pending.data?.length) return null;
  return (
    <section aria-label={t('access.card.title')}>
      <h2 className="h2">{t('access.card.title')}</h2>
      <div className="two-col">
        {pending.data.map((r) => (
          <ResetRequestCardView key={r.id} request={r} />
        ))}
      </div>
    </section>
  );
}

/** GET /staff/password-resets (CEO: everyone; Manager: their tree). */
export interface PasswordResetHistoryRow {
  id: string;
  kind: string;
  staff: { id: string; code: string; name: string; role: string };
  issuedBy: { id: string; code: string; name: string; role: string } | null;
  refusedBy: { id: string; code: string; name: string; role: string } | null;
  refusedReason: string | null;
  knownDevice: boolean | null;
  createdAt: string;
  expiresAt: string;
  usedAt: string | null;
  cancelledAt: string | null;
  state: string;
}

const STATE_TONE: Record<string, StatusTone> = {
  waiting: 'warn',
  asked: 'warn',
  code_given: 'info',
  used: 'good',
  expired: 'muted',
  replaced: 'muted',
  refused: 'danger',
};

/** S7: who asked, how, who approved or refused, and how it ended. */
export function PasswordResetHistory() {
  const t = useT();
  const q = useQuery({ queryKey: ['password-resets', 'history'], queryFn: () => api.get<PasswordResetHistoryRow[]>('/staff/password-resets') });
  const kind = (k: string) => t(`access.history.kind.${k}` as StaffAccessKey);
  const state = (s: string) => t(`access.history.state.${s}` as StaffAccessKey);
  const columns: Column<PasswordResetHistoryRow>[] = [
    { key: 'when', header: t('access.history.when'), cell: (r) => formatDateTimeIST(r.createdAt), sortValue: (r) => r.createdAt, csv: (r) => r.createdAt },
    { key: 'who', header: t('access.history.who'), cell: (r) => `${r.staff.name} (${r.staff.code})`, filter: 'text', filterValue: (r) => `${r.staff.name} ${r.staff.code}`, csv: (r) => `${r.staff.code} ${r.staff.name}` },
    {
      key: 'how',
      header: t('access.history.how'),
      cell: (r) => `${kind(r.kind)}${r.knownDevice === false ? ` · ${t('access.card.newPhone')}` : ''}`,
      filter: 'select',
      filterValue: (r) => kind(r.kind),
      csv: (r) => r.kind,
    },
    {
      key: 'by',
      header: t('access.history.by'),
      cell: (r) => (r.refusedBy ? `${r.refusedBy.name}${r.refusedReason ? ` · ${r.refusedReason}` : ''}` : (r.issuedBy?.name ?? '—')),
      csv: (r) => r.refusedBy?.name ?? r.issuedBy?.name ?? '',
      hideOnPhone: true,
    },
    { key: 'status', header: t('access.history.status'), cell: (r) => <StatusPill tone={STATE_TONE[r.state] ?? 'muted'}>{state(r.state)}</StatusPill>, filter: 'select', filterValue: (r) => state(r.state), csv: (r) => r.state },
  ];
  return (
    <Card title={t('access.history.title')}>
      <DataTable columns={columns} rows={q.data} rowKey={(r) => `${r.kind}:${r.id}`} caption={t('access.history.title')} loading={q.isPending} error={q.error} onRetry={() => void q.refetch()} download="password-resets" emptyTitle={t('access.history.empty')} />
    </Card>
  );
}
