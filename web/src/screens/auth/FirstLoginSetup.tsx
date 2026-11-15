import { useMemo, useState, type FormEvent } from 'react';
import qrcode from 'qrcode-generator';
import { authApi, setupTicketHeaders, type SetupRequiredResponse } from '../../auth/authApi';
import { useFieldAppUrl } from '../../auth/fieldApp';
import { Button, buttonClass } from '../../components/Button';
import { FieldShell } from '../../components/fields/Field';
import { OtpInput } from '../../components/fields/OtpInput';
import { TextField } from '../../components/fields/TextField';
import { useT } from '../../i18n/I18nProvider';
import { isApiError } from '../../lib/api/errors';
import { postLiveSelfie } from '../public/shared/api';
import { LiveSelfie } from '../public/shared/LiveSelfie';

/**
 * S4 — Set your password (Master Guide rev 174–175). Shown after the staff
 * code and the temporary password: no session, only the set-up ticket for
 * this device (15 minutes).
 *
 *   1. live camera selfie (when no staff photo is on file; "later" when the
 *      device has no camera — it is asked again at the first sign-in);
 *   2. the new password, typed twice (not the temporary one);
 *   3. CEO, Manager, Finance and Team Lead: the authenticator QR code and its
 *      first code, in the same step (or a code from the authenticator they keep);
 *   4. "Password set — sign in" → back to the sign-in page.
 */
const LOGO_SRC = `${import.meta.env.BASE_URL}logo-mark.png`;

function utf8Bytes(value: string): number {
  return new TextEncoder().encode(value).length;
}

/** Same checks as the API, so it never has to refuse. */
export function setupPasswordProblem(password: string, rules: SetupRequiredResponse['passwordRules']): 'tooShort' | 'tooLong' | null {
  if (password.length < rules.minLength) return 'tooShort';
  if (utf8Bytes(password) > rules.maxBytes) return 'tooLong';
  return null;
}

/** True when the text is the temporary password in another form (any case, with or without the dash). */
export function looksLikeTemporary(password: string, temporary: string): boolean {
  const clean = (v: string) => v.replace(/[\s-]/g, '').toUpperCase();
  return Boolean(temporary) && clean(password) === clean(temporary);
}

export function QrImage({ text }: { text: string }) {
  const src = useMemo(() => {
    const qr = qrcode(0, 'M');
    qr.addData(text);
    qr.make();
    return qr.createDataURL(5, 2);
  }, [text]);
  return <img src={src} alt="" width={180} height={180} className="lb-qr" />;
}

type Step = 'photo' | 'password' | 'authenticator' | 'done';

export function FirstLoginSetup({
  setup,
  temporaryPassword,
  onBack,
}: {
  setup: SetupRequiredResponse;
  /** What the person typed at sign-in, so the new password can be checked against it before sending. */
  temporaryPassword: string;
  onBack: () => void;
}) {
  const t = useT();
  const fieldAppUrl = useFieldAppUrl();
  const authenticator = setup.authenticatorSetupRequired || setup.authenticatorCodeRequired;
  const [step, setStep] = useState<Step>(setup.photoRequired ? 'photo' : 'password');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [code, setCode] = useState('');
  const [qr, setQr] = useState<{ secret: string; otpauthUrl: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expired, setExpired] = useState(false);
  const [photoDone, setPhotoDone] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<{ password?: string; confirm?: string }>({});

  const failed = (err: unknown) => {
    if (isApiError(err) && err.status === 401) {
      setExpired(true);
      return;
    }
    if (isApiError(err) && !err.isNetworkError && !err.isServerError) {
      const reason = (err.details as { reason?: unknown } | undefined)?.reason;
      if (reason === 'same_as_temporary') {
        setStep('password');
        setFieldErrors({ password: t('access.setup.sameAsTemp') });
        return;
      }
      setError(err.message);
      return;
    }
    setError(t('error.network'));
  };

  const finish = async (totpCode?: string) => {
    await authApi.completeSetup({ setupTicket: setup.setupTicket, newPassword: password, confirmPassword: confirm, ...(totpCode ? { totpCode } : {}) });
    setPassword('');
    setConfirm('');
    setCode('');
    setStep('done');
  };

  const submitPassword = (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    const p = setupPasswordProblem(password, setup.passwordRules);
    const next: { password?: string; confirm?: string } = {};
    if (p === 'tooShort') next.password = t('access.setup.tooShort', { min: setup.passwordRules.minLength });
    if (p === 'tooLong') next.password = t('access.setup.tooLong');
    if (!p && looksLikeTemporary(password, temporaryPassword)) next.password = t('access.setup.sameAsTemp');
    if (!next.password && confirm !== password) next.confirm = t('access.setup.mismatch');
    setFieldErrors(next);
    if (next.password || next.confirm) return;
    setBusy(true);
    void (async () => {
      try {
        if (setup.authenticatorSetupRequired) {
          setQr(await authApi.setupAuthenticator(setup.setupTicket));
          setCode('');
          setStep('authenticator');
        } else if (setup.authenticatorCodeRequired) {
          setCode('');
          setStep('authenticator');
        } else {
          await finish();
        }
      } catch (err) {
        failed(err);
      } finally {
        setBusy(false);
      }
    })();
  };

  const submitCode = (value = code) => {
    if (value.length !== 6) {
      setError(t('form.otp.incomplete'));
      return;
    }
    setError(null);
    setBusy(true);
    void (async () => {
      try {
        await finish(value);
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

  if (expired) {
    return (
      <div className="lb-stack">
        {brand(t('access.setup.title'))}
        <p className="lb-notice" role="alert">
          {t('access.setup.expired')}
        </p>
        <Button variant="primary" fullWidth onClick={onBack}>
          {t('access.back')}
        </Button>
      </div>
    );
  }

  if (step === 'done') {
    const field = setup.signInAt === 'field_app';
    return (
      <div className="lb-stack" data-testid="setup-done">
        {brand(t('access.setup.doneTitle'))}
        <p className="lb-notice" role="status">
          {t('access.setup.doneBody', { code: setup.staff.code })}
        </p>
        <p className="muted">{field ? t('access.setup.doneField') : t('access.setup.doneDevice')}</p>
        {field ? (
          <a className={buttonClass('primary', 'regular', undefined, true)} href={fieldAppUrl}>
            {t('access.setup.openField')}
          </a>
        ) : (
          <Button variant="primary" fullWidth onClick={onBack}>
            {t('access.signIn')}
          </Button>
        )}
      </div>
    );
  }

  if (step === 'photo') {
    return (
      <div className="lb-stack">
        {brand(t('access.setup.welcome', { name: setup.staff.name }))}
        <h2 className="h2">{t('staffPhoto.inviteStep')}</h2>
        <p className="muted">{t('staffPhoto.intro')}</p>
        <LiveSelfie
          active
          tips={t('staffPhoto.tips')}
          takeLabel={t('staffPhoto.take')}
          savingLabel={t('staffPhoto.saving')}
          error={
            error && (
              <p className="vno" role="alert">
                {error}
              </p>
            )
          }
          onCapture={async (photo) => {
            setError(null);
            try {
              await postLiveSelfie('/auth/setup/photo', {}, photo, setupTicketHeaders(setup.setupTicket));
              setPhotoDone(true);
              setStep('password');
              return 'done';
            } catch (err) {
              failed(err);
              return 'retry';
            }
          }}
        />
        {/* No camera on this device: the photo is asked again, before anything else, at the first sign-in. */}
        <Button fullWidth onClick={() => setStep('password')}>
          {t('staffPhoto.inviteLater')}
        </Button>
      </div>
    );
  }

  if (step === 'authenticator') {
    return (
      <form
        className="lb-stack"
        onSubmit={(e) => {
          e.preventDefault();
          submitCode();
        }}
      >
        {brand(t('access.setup.authTitle'))}
        {qr ? (
          <>
            <p className="muted">{t('access.setup.authBody')}</p>
            <QrImage text={qr.otpauthUrl} />
            <p className="sub lb-break">{t('access.setup.authSecret', { secret: qr.secret })}</p>
          </>
        ) : (
          <p className="muted">{t('access.setup.keepAuth')}</p>
        )}
        <FieldShell label={t('access.setup.authCode')} error={error ?? undefined}>
          {({ describedBy, invalid }) => (
            <OtpInput value={code} onChange={setCode} label={t('access.setup.authCode')} autoFocus invalid={invalid} describedBy={describedBy} disabled={busy} />
          )}
        </FieldShell>
        <Button type="submit" variant="primary" fullWidth loading={busy}>
          {busy ? t('access.setup.saving') : t('access.setup.finish')}
        </Button>
        <Button
          fullWidth
          onClick={() => {
            setStep('password');
            setError(null);
          }}
        >
          {t('common.back')}
        </Button>
      </form>
    );
  }

  return (
    <form onSubmit={submitPassword} noValidate className="lb-stack">
      {brand(t('access.setup.welcome', { name: setup.staff.name }))}
      {photoDone && (
        <p className="lb-notice" role="status">
          {t('staffPhoto.inviteDone')}
        </p>
      )}
      <p className="muted">{t('access.setup.intro')}</p>
      <div className="kv lb-invite__who">
        <span>{t('access.setup.staffCode')}</span>
        <span className="mono">{setup.staff.code}</span>
      </div>
      <p className="muted">{t('access.setup.staffCodeNote')}</p>
      {/* Lets password managers save the staff code with the new password. */}
      <input type="text" name="username" autoComplete="username" value={setup.staff.code} readOnly hidden />
      <TextField
        label={t('access.setup.newPassword')}
        type="password"
        value={password}
        onChange={setPassword}
        autoComplete="new-password"
        hint={t('access.setup.passwordHint', { min: setup.passwordRules.minLength })}
        error={fieldErrors.password}
        required
        autoFocus
      />
      <TextField label={t('access.setup.confirm')} type="password" value={confirm} onChange={setConfirm} autoComplete="new-password" error={fieldErrors.confirm} required />
      {error && (
        <p className="vno" role="alert">
          {error}
        </p>
      )}
      <Button type="submit" variant="primary" fullWidth loading={busy} disabled={!password || !confirm}>
        {busy ? t('access.setup.saving') : authenticator ? t('access.setup.next') : t('access.setup.finish')}
      </Button>
      <Button fullWidth onClick={onBack}>
        {t('access.back')}
      </Button>
    </form>
  );
}
