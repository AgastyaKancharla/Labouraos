import { useState } from 'react';
import { createPortal } from 'react-dom';
import { useT } from '../i18n/I18nProvider';
import { useNow } from '../lib/useNow';
import { useAttendance } from './AttendanceProvider';
import { breakClock } from './StatusMenu';

/** "Not yet" hides the question for this long. */
const SNOOZE_MS = 5 * 60_000;

/**
 * "Back from lunch?" (decided 21 Nov): once the lunch or short-break
 * allowance is over the app asks, and one tap makes the person Available
 * again. The Team Lead's over-the-break bell stays as it is.
 */
export function BreakPrompt() {
  const t = useT();
  const attendance = useAttendance();
  const now = useNow(1000);
  const [snoozed, setSnoozed] = useState<{ since: string; until: number } | null>(null);
  if (!attendance?.today || attendance.phase !== 'open') return null;
  const { today, status, busy } = attendance;
  if (status !== 'lunch' && status !== 'short_break') return null;
  const clock = breakClock(today, status, now.getTime());
  if (!clock || clock.over <= 0) return null;
  if (snoozed && snoozed.since === today.statusSince && now.getTime() < snoozed.until) return null;
  const minutes = status === 'lunch' ? today.policy.lunchMinutes : today.policy.shortBreakMinutes;
  return createPortal(
    <div className="lb-att-idle">
      <div className="card lb-att-idle__card" role="alertdialog" aria-modal="true" aria-labelledby="att-back-title" aria-describedby="att-back-body">
        <span className="h1" id="att-back-title">
          {t(status === 'lunch' ? 'att.back.lunch' : 'att.back.break')}
        </span>
        <span className="lb-att-muted" id="att-back-body">
          {t('att.back.body', { minutes })}
        </span>
        <div className="lb-att-actions lb-att-actions--center">
          <button type="button" className="btn bg lb-btn" disabled={busy} onClick={() => void attendance.pick('available')}>
            {t('att.back.yes')}
          </button>
          <button
            type="button"
            className="btn bs lb-btn"
            onClick={() => setSnoozed({ since: today.statusSince ?? '', until: now.getTime() + SNOOZE_MS })}
          >
            {t('att.back.notYet')}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
