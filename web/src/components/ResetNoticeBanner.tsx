import { useAuth } from '../auth/AuthProvider';
import { useT } from '../i18n/I18nProvider';
import { formatDateTimeIST } from '../lib/format/date';

/**
 * Shown once, at the first sign-in after a password reset (Master Guide rev
 * 174–175, rule 10): "Your password was reset on … approved by …". If it was
 * not them, they tell their senior at once.
 */
export function ResetNoticeBanner() {
  const t = useT();
  const { resetNotice, dismissResetNotice } = useAuth();
  if (!resetNotice) return null;
  const date = resetNotice.at ? formatDateTimeIST(resetNotice.at) : '';
  return (
    <div className="lb-testmode" role="status" data-testid="reset-notice">
      <strong>
        {resetNotice.byName ? t('access.notice', { date, name: resetNotice.byName }) : t('access.noticeServer', { date })}
      </strong>
      <button type="button" onClick={dismissResetNotice} aria-label={t('common.close')}>
        ×
      </button>
    </div>
  );
}
