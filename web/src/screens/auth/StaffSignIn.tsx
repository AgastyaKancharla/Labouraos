import { useEffect, useState, type FormEvent } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../../auth/AuthProvider';
import { authApi, isAwaitingCode, isSetupRequired, TOTP_REQUIRED_MESSAGE, type SetupRequiredResponse, type TokenResponse } from '../../auth/authApi';
import { landingPath } from '../../auth/RequireRole';
import { fieldAppUrlFromRefusal, isFieldAgentRefusal } from '../../auth/fieldApp';
import { isStaffRole } from '../../auth/roles';
import { Button } from '../../components/Button';
import { FamilyContext } from '../../components/family';
import { FieldShell } from '../../components/fields/Field';
import { OtpInput } from '../../components/fields/OtpInput';
import { TextField } from '../../components/fields/TextField';
import { useT } from '../../i18n/I18nProvider';
import { isApiError } from '../../lib/api/errors';
import { useClock } from '../../lib/useNow';
import { FirstLoginSetup } from './FirstLoginSetup';
import { ForgotPassword } from './ForgotPassword';

/**
 * Staff sign-in for every role, built from the approved designs:
 *
 *   step 1  Staff code + password ............ M01 / MG01 / F01 / TL01 / CA01
 *   step 2a Authenticator code (CEO, Manager, Finance, Team Lead) . M02 / MG02 / F02 / TL02
 *   step 2b Login code read out by a Team Lead / Manager / CEO ............ CA02
 *   (first login) the temporary password → "Set your password" (S4)
 *   (forgot password) staff code → reset code from a senior (S5)
 *
 * The API decides which step applies: an authenticator role's password that
 * is right but has no code gets "TOTP 2FA code is required"; call agents get
 * { status: 'awaiting_code' }; the temporary password gets
 * { status: 'setup_required' } (Master Guide rev 174–175).
 */
type Step =
  | { kind: 'password' }
  | { kind: 'forgot' }
  | { kind: 'totp' }
  | { kind: 'code'; loginRequestId: string; loginRequestProof: string; expiresAt: number }
  | { kind: 'setup'; setup: SetupRequiredResponse; temporary: string };

const LOGO_SRC = `${import.meta.env.BASE_URL}logo-mark.png`;

function messageOf(err: unknown, fallback: string): string {
  if (isApiError(err)) return err.isNetworkError || err.isServerError ? fallback : err.message;
  return fallback;
}

/** Agents get their code from their Team Lead (staff code prefixes CA-, FA-). */
function codeAudience(staffCode: string): 'teamLead' | 'any' {
  const prefix = staffCode.trim().toUpperCase().split('-')[0];
  if (prefix === 'CA' || prefix === 'FA') return 'teamLead';
  return 'any';
}

export default function StaffSignIn() {
  const t = useT();
  const navigate = useNavigate();
  const location = useLocation();
  const clock = useClock();
  const { session, acceptLogin, signOutReason, clearSignOutReason } = useAuth();
  const from = (location.state as { from?: string } | null)?.from;

  const [step, setStep] = useState<Step>({ kind: 'password' });
  const [staffCode, setStaffCode] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [now, setNow] = useState(() => clock().getTime());
  /** Set when the API refused a field agent here: Laboura Field's address (owner decision 14 Nov). */
  const [fieldAppUrl, setFieldAppUrl] = useState<string | null>(null);

  useEffect(() => {
    document.title = `${t('auth.signIn.title')} · ${t('app.name')}`;
  }, [t]);

  // Countdown for the login-code request (5 minutes).
  useEffect(() => {
    if (step.kind !== 'code') return;
    const id = setInterval(() => setNow(clock().getTime()), 1000);
    return () => clearInterval(id);
  }, [step.kind, clock]);

  if (session && !session.totpSetupOnly) {
    return <Navigate to={landingPath(session.staff.role, from)} replace state={{ landing: true }} />;
  }

  const finish = async (response: TokenResponse) => {
    const next = acceptLogin(response);
    if (!next || !isStaffRole(next.staff.role)) {
      setError(t('auth.signedOut.unauthorized'));
      return;
    }
    navigate(landingPath(next.staff.role, from), { replace: true, state: { landing: true } });
  };

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (err) {
      setError(messageOf(err, t('error.network')));
    } finally {
      setBusy(false);
    }
  };

  const submitPassword = (e: FormEvent) => {
    e.preventDefault();
    clearSignOutReason();
    setNotice(null);
    setFieldAppUrl(null);
    void run(async () => {
      try {
        const response = await authApi.login({ staffCode: staffCode.trim(), password });
        if (isSetupRequired(response)) {
          // First login: the temporary password was recognised (S4).
          setStep({ kind: 'setup', setup: response, temporary: password });
          setPassword('');
          return;
        }
        if (isAwaitingCode(response)) {
          setCode('');
          setNow(clock().getTime());
          setStep({
            kind: 'code',
            loginRequestId: response.loginRequestId,
            loginRequestProof: response.loginRequestProof,
            expiresAt: new Date(response.expiresAt).getTime(),
          });
          return;
        }
        await finish(response);
      } catch (err) {
        if (isApiError(err) && err.status === 401 && err.message === TOTP_REQUIRED_MESSAGE) {
          setCode('');
          setStep({ kind: 'totp' });
          return;
        }
        // A field agent is refused here before any device or login code request is made.
        if (isApiError(err) && err.status === 401 && isFieldAgentRefusal(err.message)) {
          setPassword('');
          setFieldAppUrl(fieldAppUrlFromRefusal(err.message));
          return;
        }
        throw err;
      }
    });
  };

  const submitTotp = (value = code) => {
    if (value.length !== 6) {
      setError(t('form.otp.incomplete'));
      return;
    }
    void run(async () => {
      const response = await authApi.login({ staffCode: staffCode.trim(), password, totpCode: value });
      if (isAwaitingCode(response) || isSetupRequired(response)) throw new Error('unexpected sign-in step');
      await finish(response);
    });
  };

  const submitLoginCode = (value = code) => {
    if (step.kind !== 'code') return;
    if (value.length !== 6) {
      setError(t('form.otp.incomplete'));
      return;
    }
    void run(async () => finish(await authApi.verifyCode(step.loginRequestId, value, step.loginRequestProof)));
  };

  const startAgain = () => {
    setStep({ kind: 'password' });
    setCode('');
    setPassword('');
    setError(null);
  };

  const reasonText = signOutReason ? t(`auth.signedOut.${signOutReason}`) : null;
  const audience = codeAudience(staffCode);
  const codeExpired = step.kind === 'code' && now >= step.expiresAt;
  const secondsLeft = step.kind === 'code' ? Math.max(0, Math.ceil((step.expiresAt - now) / 1000)) : 0;
  const countdown = `${Math.floor(secondsLeft / 60)}:${String(secondsLeft % 60).padStart(2, '0')}`;

  return (
    <FamilyContext.Provider value="console">
      <div className="console lb-center lb-signin">
        <main id="main" className="card lb-auth-card">
          {step.kind === 'password' && (
            <form onSubmit={submitPassword} noValidate className="lb-stack">
              <div className="lb-auth-card__brand">
                <img src={LOGO_SRC} alt="Laboura" width={36} height={36} />
                <h1 className="h1">{t('auth.signIn.title')}</h1>
              </div>
              {(notice || reasonText) && (
                <p className="lb-notice" role="status">
                  {notice ?? reasonText}
                </p>
              )}
              <TextField
                label={t('auth.staffCode')}
                value={staffCode}
                onChange={setStaffCode}
                autoComplete="username"
                autoCapitalize="characters"
                spellCheck={false}
                required
              />
              <TextField
                label={t('auth.password')}
                type="password"
                value={password}
                onChange={setPassword}
                autoComplete="current-password"
                required
              />
              {error && (
                <p className="vno" role="alert">
                  {error}
                </p>
              )}
              {fieldAppUrl && (
                <div className="lb-notice" role="alert" data-testid="field-agent-refusal">
                  <strong>{t('auth.fieldAgent.title')}</strong>
                  <p className="muted">{t('auth.fieldAgent.body')}</p>
                  <a className="btn bp full" href={fieldAppUrl}>
                    {t('auth.fieldAgent.open')}
                  </a>
                </div>
              )}
              <Button type="submit" variant="primary" fullWidth loading={busy} disabled={!staffCode.trim() || !password}>
                {busy ? t('auth.signingIn') : t('auth.signIn')}
              </Button>
              <p className="muted">{t('auth.signIn.note')}</p>
              <Button
                onClick={() => {
                  setError(null);
                  setStep({ kind: 'forgot' });
                }}
              >
                {t('access.forgot.link')}
              </Button>
            </form>
          )}

          {step.kind === 'forgot' && <ForgotPassword initialStaffCode={staffCode} onBack={() => setStep({ kind: 'password' })} />}

          {step.kind === 'setup' && <FirstLoginSetup setup={step.setup} temporaryPassword={step.temporary} onBack={startAgain} />}

          {step.kind === 'totp' && (
            <form
              className="lb-stack"
              onSubmit={(e) => {
                e.preventDefault();
                submitTotp();
              }}
            >
              <h1 className="h1">{t('auth.totp.title')}</h1>
              <p className="muted">{t('auth.totp.body')}</p>
              <FieldShell label={t('auth.totp.title')} error={error ?? undefined}>
                {({ describedBy, invalid }) => (
                  <OtpInput
                    value={code}
                    onChange={setCode}
                    label={t('auth.totp.title')}
                    autoFocus
                    invalid={invalid}
                    describedBy={describedBy}
                    onComplete={submitTotp}
                    disabled={busy}
                  />
                )}
              </FieldShell>
              <Button type="submit" variant="primary" fullWidth loading={busy}>
                {t('common.continue')}
              </Button>
              <Button onClick={startAgain} fullWidth>
                {t('auth.startAgain')}
              </Button>
            </form>
          )}

          {step.kind === 'code' && (
            <form
              className="lb-stack"
              onSubmit={(e) => {
                e.preventDefault();
                submitLoginCode();
              }}
            >
              <h1 className="h1">
                {audience === 'teamLead' ? t('auth.code.titleTeamLead') : t('auth.code.title')}
              </h1>
              <p className="muted">
                {audience === 'teamLead' ? t('auth.code.bodyTeamLead') : t('auth.code.body')}
              </p>
              {codeExpired ? (
                <p className="lb-notice" role="alert">
                  {t('auth.code.expired')}
                </p>
              ) : (
                <>
                  <FieldShell label={t('auth.code.label')} error={error ?? undefined} hint={t('auth.code.expiresIn', { time: countdown })}>
                    {({ describedBy, invalid }) => (
                      <OtpInput
                        value={code}
                        onChange={setCode}
                        label={t('auth.code.label')}
                        autoFocus
                        invalid={invalid}
                        describedBy={describedBy}
                        onComplete={submitLoginCode}
                        disabled={busy}
                      />
                    )}
                  </FieldShell>
                  <Button type="submit" variant="primary" fullWidth loading={busy}>
                    {t('common.continue')}
                  </Button>
                </>
              )}
              <Button onClick={startAgain} fullWidth variant={codeExpired ? 'primary' : 'secondary'}>
                {t('auth.startAgain')}
              </Button>
              <p className="muted">{t('auth.code.note')}</p>
            </form>
          )}

        </main>
      </div>
    </FamilyContext.Provider>
  );
}
