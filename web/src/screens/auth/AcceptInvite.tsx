import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import qrcode from 'qrcode-generator';
import { Button, ButtonLink, buttonClass } from '../../components/Button';
import { FamilyContext } from '../../components/family';
import { FieldShell } from '../../components/fields/Field';
import { OtpInput } from '../../components/fields/OtpInput';
import { TextField } from '../../components/fields/TextField';
import { Skeleton } from '../../components/Skeleton';
import { useT } from '../../i18n/I18nProvider';
import { LanguageSwitcher } from '../../i18n/LanguageSwitcher';
import type { StaffInviteKey } from '../../i18n/staffInvite';
import { api } from '../../lib/api/client';
import { isApiError } from '../../lib/api/errors';
import { formatDateTimeIST } from '../../lib/format/date';

/**
 * The invite page: /p/invite/:token (the link in `inviteUrl` when the
 * CEO, a Manager or a Team Lead adds someone or resets their password).
 *
 * No design file exists for it, so it uses the sign-in card (M01). Steps:
 *   1. whose invite it is (name, staff code, role) and a new password that
 *      meets the API's rules (passwordRules from the preview);
 *   2. CEO, Manager and Finance only: set up the authenticator app;
 *   3. done → sign in (field agents: Laboura Field).
 * A link that is not valid, has expired or was already used gets its own
 * plain explanation.
 *
 * API (src/modules/staff): POST /staff/accept-invite/preview { token },
 * POST /staff/accept-invite/authenticator { token },
 * POST /staff/accept-invite { token, password, totpCode? }.
 */
export interface InvitePreview {
  /** 'reset' for a password reset link (POST /staff/:id/reset-password); older APIs leave it out. */
  purpose?: 'invite' | 'reset';
  name: string;
  code: string;
  role: string;
  expiresAt: string;
  authenticatorRequired: boolean;
  passwordRules: { minLength: number; maxBytes: number };
  signInAt: 'field_app' | 'web';
}

type Problem = 'invalid' | 'expired' | 'used';
type Step =
  | { kind: 'password' }
  | { kind: 'authenticator'; secret: string; otpauthUrl: string }
  | { kind: 'done'; withAuthenticator: boolean };

const LOGO_SRC = `${import.meta.env.BASE_URL}logo-mark.png`;
/** Laboura Field is served by the same API at /field (outside the web app). */
export const FIELD_APP_URL = '/field/';

function problemOf(err: unknown): Problem | null {
  if (!isApiError(err)) return null;
  const reason = (err.details as { reason?: unknown } | undefined)?.reason;
  if (reason === 'invalid' || reason === 'expired' || reason === 'used') return reason;
  if (err.status === 404) return 'invalid';
  return null;
}

function utf8Bytes(value: string): number {
  return new TextEncoder().encode(value).length;
}

/** Same checks as StaffService.acceptInvite, so the API never has to refuse. */
export function passwordProblem(
  password: string,
  rules: InvitePreview['passwordRules'],
): 'tooShort' | 'tooLong' | null {
  if (password.length < rules.minLength) return 'tooShort';
  if (utf8Bytes(password) > rules.maxBytes) return 'tooLong';
  return null;
}

function QrImage({ text }: { text: string }) {
  const src = useMemo(() => {
    const qr = qrcode(0, 'M');
    qr.addData(text);
    qr.make();
    return qr.createDataURL(5, 2);
  }, [text]);
  return <img src={src} alt="" width={180} height={180} className="lb-qr" />;
}

function roleKey(role: string): StaffInviteKey | null {
  const key = `invite.role.${role}`;
  return ['ceo', 'manager', 'team_lead', 'finance', 'call_agent', 'field_agent'].includes(role) ? (key as StaffInviteKey) : null;
}

export default function AcceptInvite() {
  const t = useT();
  const { token = '' } = useParams<{ token: string }>();
  const [step, setStep] = useState<Step>({ kind: 'password' });
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<{ password?: string; confirm?: string }>({});
  const [problem, setProblem] = useState<Problem | null>(null);

  useEffect(() => {
    document.title = `${t('invite.title')} · ${t('app.name')}`;
  }, [t]);

  const preview = useQuery({
    queryKey: ['staff-invite', token],
    queryFn: () => api.post<InvitePreview>('/staff/accept-invite/preview', { token }, { auth: false }),
    retry: false,
    staleTime: Infinity,
  });

  const invite = preview.data;
  const shownProblem = problem ?? (preview.isError ? problemOf(preview.error) : null);

  const failed = (err: unknown) => {
    const p = problemOf(err);
    if (p) {
      setProblem(p);
      return;
    }
    if (isApiError(err) && !err.isNetworkError && !err.isServerError) {
      setError(err.message);
      return;
    }
    setError(t('error.network'));
  };

  const accept = async (totpCode?: string) => {
    await api.post('/staff/accept-invite', { token, password, ...(totpCode ? { totpCode } : {}) }, { auth: false });
    setPassword('');
    setConfirm('');
    setCode('');
    setStep({ kind: 'done', withAuthenticator: Boolean(totpCode) });
  };

  const submitPassword = (e: FormEvent) => {
    e.preventDefault();
    if (!invite) return;
    setError(null);
    const rules = invite.passwordRules;
    const p = passwordProblem(password, rules);
    const next: { password?: string; confirm?: string } = {};
    if (p === 'tooShort') next.password = t('invite.passwordTooShort', { min: rules.minLength });
    if (p === 'tooLong') next.password = t('invite.passwordTooLong');
    if (!p && confirm !== password) next.confirm = t('invite.passwordMismatch');
    setFieldErrors(next);
    if (next.password || next.confirm) return;

    setBusy(true);
    void (async () => {
      try {
        if (invite.authenticatorRequired) {
          const setup = await api.post<{ secret: string; otpauthUrl: string }>(
            '/staff/accept-invite/authenticator',
            { token },
            { auth: false },
          );
          setCode('');
          setStep({ kind: 'authenticator', secret: setup.secret, otpauthUrl: setup.otpauthUrl });
        } else {
          await accept();
        }
      } catch (err) {
        failed(err);
      } finally {
        setBusy(false);
      }
    })();
  };

  const submitAuthenticator = (value = code) => {
    if (value.length !== 6) {
      setError(t('form.otp.incomplete'));
      return;
    }
    setError(null);
    setBusy(true);
    void (async () => {
      try {
        await accept(value);
      } catch (err) {
        failed(err);
      } finally {
        setBusy(false);
      }
    })();
  };

  const brand = (title: string) => (
    <div className="lb-auth-card__brand">
      <img src={LOGO_SRC} alt="Laboura" width={36} height={36} />
      <h1 className="h1">{title}</h1>
    </div>
  );

  let body;
  if (shownProblem) {
    body = (
      <div className="lb-stack">
        {brand(t(`invite.problem.${shownProblem}.title`))}
        <p className="lb-notice" role="alert">
          {t(`invite.problem.${shownProblem}.body`)}
        </p>
        {shownProblem === 'used' && (
          <ButtonLink to="/login" variant="primary" fullWidth>
            {t('invite.goToSignIn')}
          </ButtonLink>
        )}
      </div>
    );
  } else if (preview.isPending) {
    body = (
      <div className="lb-stack" aria-busy="true">
        {brand(t('invite.title'))}
        <p className="muted" role="status">
          {t('invite.checking')}
        </p>
        <Skeleton height={44} />
        <Skeleton height={44} />
      </div>
    );
  } else if (preview.isError || !invite) {
    body = (
      <div className="lb-stack">
        {brand(t('invite.title'))}
        <p className="vno" role="alert">
          {isApiError(preview.error) && !preview.error.isServerError && !preview.error.isNetworkError
            ? preview.error.message
            : t('error.network')}
        </p>
        <Button variant="primary" fullWidth onClick={() => void preview.refetch()}>
          {t('common.retry')}
        </Button>
      </div>
    );
  } else if (step.kind === 'done') {
    const field = invite.signInAt === 'field_app';
    body = (
      <div className="lb-stack">
        {brand(t('invite.doneTitle'))}
        <p className="lb-notice" role="status">
          {t('invite.doneBody', { code: invite.code })}
        </p>
        {step.withAuthenticator && <p className="muted">{t('invite.doneAuthenticator')}</p>}
        <p className="muted">{field ? t('invite.doneField') : t('invite.doneDevice')}</p>
        {field ? (
          <a className={buttonClass('primary', 'regular', undefined, true)} href={FIELD_APP_URL}>
            {t('invite.openField')}
          </a>
        ) : (
          <ButtonLink to="/login" variant="primary" fullWidth>
            {t('invite.goToSignIn')}
          </ButtonLink>
        )}
      </div>
    );
  } else if (step.kind === 'authenticator') {
    body = (
      <form
        className="lb-stack"
        onSubmit={(e) => {
          e.preventDefault();
          submitAuthenticator();
        }}
      >
        {brand(t('invite.authTitle'))}
        <p className="muted">{t('invite.authBody')}</p>
        <QrImage text={step.otpauthUrl} />
        <p className="sub lb-break">{t('invite.authSecret', { secret: step.secret })}</p>
        <FieldShell label={t('invite.authCode')} error={error ?? undefined}>
          {({ describedBy, invalid }) => (
            <OtpInput
              value={code}
              onChange={setCode}
              label={t('invite.authCode')}
              autoFocus
              invalid={invalid}
              describedBy={describedBy}
              disabled={busy}
            />
          )}
        </FieldShell>
        <Button type="submit" variant="primary" fullWidth loading={busy}>
          {busy ? t('invite.saving') : t('invite.authFinish')}
        </Button>
        <Button
          fullWidth
          onClick={() => {
            setStep({ kind: 'password' });
            setError(null);
          }}
        >
          {t('invite.back')}
        </Button>
      </form>
    );
  } else {
    const role = roleKey(invite.role);
    body = (
      <form onSubmit={submitPassword} noValidate className="lb-stack">
        {brand(t('invite.welcome', { name: invite.name }))}
        <p className="muted">{t(invite.purpose === 'reset' ? 'invite.resetIntro' : 'invite.intro')}</p>
        <div className="kv lb-invite__who">
          <span>{t('invite.staffCode')}</span>
          <span className="mono">{invite.code}</span>
          <span>{t('invite.role')}</span>
          <span>{role ? t(role) : invite.role}</span>
          <span>{t('invite.expires')}</span>
          <span>{formatDateTimeIST(invite.expiresAt)}</span>
        </div>
        <p className="muted">{t('invite.staffCodeNote')}</p>
        {/* Lets password managers save the staff code with the new password. */}
        <input type="text" name="username" autoComplete="username" value={invite.code} readOnly hidden />
        <TextField
          label={t('invite.newPassword')}
          type="password"
          value={password}
          onChange={setPassword}
          autoComplete="new-password"
          hint={t('invite.passwordHint', { min: invite.passwordRules.minLength })}
          error={fieldErrors.password}
          required
          autoFocus
        />
        <TextField
          label={t('invite.confirmPassword')}
          type="password"
          value={confirm}
          onChange={setConfirm}
          autoComplete="new-password"
          error={fieldErrors.confirm}
          required
        />
        {error && (
          <p className="vno" role="alert">
            {error}
          </p>
        )}
        <Button type="submit" variant="primary" fullWidth loading={busy} disabled={!password || !confirm}>
          {busy ? t('invite.saving') : invite.authenticatorRequired ? t('invite.next') : t('invite.setPassword')}
        </Button>
      </form>
    );
  }

  return (
    <FamilyContext.Provider value="console">
      <div className="console lb-center lb-invite">
        <main id="main" className="card lb-auth-card">
          <div className="lb-invite__lang">
            <LanguageSwitcher tone="onLight" />
          </div>
          {body}
        </main>
      </div>
    </FamilyContext.Provider>
  );
}
