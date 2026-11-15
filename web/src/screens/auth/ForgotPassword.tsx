import { useEffect, useState, type FormEvent } from 'react';
import { authApi, type ResetRequestAnswer } from '../../auth/authApi';
import { Button } from '../../components/Button';
import { FieldShell } from '../../components/fields/Field';
import { OtpInput } from '../../components/fields/OtpInput';
import { TextField } from '../../components/fields/TextField';
import { useT } from '../../i18n/I18nProvider';
import { isApiError } from '../../lib/api/errors';
import { useClock } from '../../lib/useNow';
import { setupPasswordProblem } from './FirstLoginSetup';

/**
 * S5 — Forgot password (Master Guide rev 174–175). Staff code → "Ask your
 * senior for the reset code" (a red PASSWORD RESET card appears on their code
 * screen; they call back and read the code out) → reset code + new password
 * twice (+ a code from their own authenticator for CEO, Manager, Finance and
 * Team Lead, who keep it) → "Password changed" → sign in.
 *
 * The first answer is the same whether the staff code exists or not.
 */
const LOGO_SRC = `${import.meta.env.BASE_URL}logo-mark.png`;
const RULES = { minLength: 8, maxBytes: 72 };

function messageOf(err: unknown, fallback: string): string {
  if (isApiError(err)) return err.isNetworkError || err.isServerError ? fallback : err.message;
  return fallback;
}

export function ForgotPassword({ initialStaffCode = '', onBack }: { initialStaffCode?: string; onBack: () => void }) {
  const t = useT();
  const clock = useClock();
  const [staffCode, setStaffCode] = useState(initialStaffCode);
  const [asked, setAsked] = useState<ResetRequestAnswer | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [totp, setTotp] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => clock().getTime());

  useEffect(() => {
    if (!asked) return;
    const id = setInterval(() => setNow(clock().getTime()), 1000);
    return () => clearInterval(id);
  }, [asked, clock]);

  const brand = (title: string) => (
    <div className="lb-auth-card__brand">
      <img src={LOGO_SRC} alt="Laboura" width={36} height={36} />
      <h1 className="h1">{title}</h1>
    </div>
  );

  const ask = (e: FormEvent) => {
    e.preventDefault();
    if (!staffCode.trim()) return;
    setBusy(true);
    setError(null);
    authApi
      .requestReset(staffCode.trim())
      .then((answer) => {
        setAsked(answer);
        setNow(clock().getTime());
      })
      .catch((err: unknown) => setError(messageOf(err, t('error.network'))))
      .finally(() => setBusy(false));
  };

  const complete = (e: FormEvent) => {
    e.preventDefault();
    if (!asked) return;
    setError(null);
    if (code.length !== 6) {
      setError(t('form.otp.incomplete'));
      return;
    }
    const p = setupPasswordProblem(password, RULES);
    if (p === 'tooShort') return setError(t('access.setup.tooShort', { min: RULES.minLength }));
    if (p === 'tooLong') return setError(t('access.setup.tooLong'));
    if (confirm !== password) return setError(t('access.setup.mismatch'));
    setBusy(true);
    authApi
      .completeReset({
        resetRequestId: asked.resetRequestId,
        resetRequestProof: asked.resetRequestProof,
        code,
        newPassword: password,
        confirmPassword: confirm,
        ...(totp.trim() ? { totpCode: totp.trim() } : {}),
      })
      .then((res) => {
        setDone(res.code);
        setPassword('');
        setConfirm('');
        setCode('');
        setTotp('');
      })
      .catch((err: unknown) => setError(messageOf(err, t('error.network'))))
      .finally(() => setBusy(false));
  };

  if (done) {
    return (
      <div className="lb-stack" data-testid="reset-done">
        {brand(t('access.forgot.doneTitle'))}
        <p className="lb-notice" role="status">
          {t('access.forgot.doneBody', { code: done })}
        </p>
        <Button variant="primary" fullWidth onClick={onBack}>
          {t('access.signIn')}
        </Button>
      </div>
    );
  }

  if (asked) {
    const left = Math.max(0, Math.ceil((new Date(asked.expiresAt).getTime() - now) / 1000));
    const countdown = `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`;
    return (
      <form className="lb-stack" noValidate onSubmit={complete}>
        {brand(t('access.forgot.askedTitle'))}
        <p className="lb-notice" role="status">
          {t('access.forgot.askedBody')}
        </p>
        {left === 0 ? (
          <p className="lb-notice" role="alert">
            {t('access.forgot.expired')}
          </p>
        ) : (
          <>
            <FieldShell label={t('access.forgot.code')} hint={t('access.forgot.expiresIn', { time: countdown })}>
              {({ describedBy, invalid }) => (
                <OtpInput value={code} onChange={setCode} label={t('access.forgot.code')} invalid={invalid} describedBy={describedBy} disabled={busy} />
              )}
            </FieldShell>
            <input type="text" name="username" autoComplete="username" value={staffCode} readOnly hidden />
            <TextField
              label={t('access.setup.newPassword')}
              type="password"
              value={password}
              onChange={setPassword}
              autoComplete="new-password"
              hint={t('access.setup.passwordHint', { min: RULES.minLength })}
              required
            />
            <TextField label={t('access.setup.confirm')} type="password" value={confirm} onChange={setConfirm} autoComplete="new-password" required />
            <TextField label={t('access.forgot.totp')} value={totp} onChange={setTotp} inputMode="numeric" autoComplete="one-time-code" hint={t('access.forgot.totpHint')} />
            {error && (
              <p className="vno" role="alert">
                {error}
              </p>
            )}
            <Button type="submit" variant="primary" fullWidth loading={busy} disabled={!password || !confirm || code.length !== 6}>
              {t('access.forgot.submit')}
            </Button>
          </>
        )}
        <Button fullWidth onClick={onBack}>
          {t('access.back')}
        </Button>
      </form>
    );
  }

  return (
    <form className="lb-stack" noValidate onSubmit={ask}>
      {brand(t('access.forgot.title'))}
      <p className="muted">{t('access.forgot.body')}</p>
      <TextField label={t('auth.staffCode')} value={staffCode} onChange={setStaffCode} autoComplete="username" autoCapitalize="characters" spellCheck={false} required />
      {error && (
        <p className="vno" role="alert">
          {error}
        </p>
      )}
      <Button type="submit" variant="primary" fullWidth loading={busy} disabled={!staffCode.trim()}>
        {t('access.forgot.send')}
      </Button>
      <Button fullWidth onClick={onBack}>
        {t('access.back')}
      </Button>
    </form>
  );
}
