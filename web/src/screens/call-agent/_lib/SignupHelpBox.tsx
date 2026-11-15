import { useT } from '../../../i18n/I18nProvider';
import type { MessageKey } from '../../../i18n/en';
import type { WorkItem } from './api';
import { isSignupItem, signupScript, signupStepLabel } from './format';

/**
 * On a profile opened from a "sign-up help" row (customer app proposal 4.4):
 * what kind of sign-up it is, the steps still to do, why they are stuck and
 * what to say. Read from the work list row the server built.
 */
export function SignupHelpBox({ item }: { item: WorkItem | null }) {
  const t = useT();
  if (!item || !isSignupItem(item)) return null;
  const d = item.detail;
  const kind = String(d.signupKind ?? '');
  const missing = String(d.missing ?? '')
    .split(',')
    .filter(Boolean)
    .map((step) => signupStepLabel(step, t));
  return (
    <div className="lb-ca-why" data-testid="signup-help">
      <strong>
        {t('ca.signup.title')}
        {['job_seeker', 'business', 'referral'].includes(kind) ? ` · ${t(`ca.signup.kind.${kind}` as MessageKey)}` : ''}
        {d.callTry ? ` · ${t('ca.signup.try', { n: Number(d.callTry) })}` : ''}
      </strong>
      {missing.length > 0 && (
        <div>
          {t('ca.signup.missing')}: {missing.join(' · ')}
        </div>
      )}
      {d.stuckReason ? (
        <div>
          {t('ca.signup.stuck')}: {String(d.stuckReason)}
        </div>
      ) : null}
      <div>
        <strong>{t('ca.signup.script')}:</strong> {signupScript(String(d.scriptHint ?? ''), t)}
      </div>
    </div>
  );
}
