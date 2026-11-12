import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider';
import { useT } from '../i18n/I18nProvider';
import { screenPath } from '../portals';
import { usePortal } from '../portals/PortalContext';
import { useAttendance } from './AttendanceProvider';
import { promptClock } from './format';

/**
 * "Still there?" — design CA14i-Idle. After the idle setting (10 minutes)
 * Available with no calls or clicks, the person gets one minute to confirm.
 * No answer means Idle: calls stop and it shows on the Team Lead's live board.
 */
export function IdlePrompt() {
  const t = useT();
  const attendance = useAttendance();
  const portal = usePortal();
  const navigate = useNavigate();
  const { session } = useAuth();
  const stay = useRef<HTMLButtonElement>(null);
  const open = Boolean(attendance?.idle.open);

  useEffect(() => {
    if (open) stay.current?.focus();
  }, [open]);

  if (!attendance || !open) return null;
  const office = attendance.audience === 'office';
  const firstName = session?.staff.name.split(/\s+/)[0] ?? '';
  const minutes = attendance.today?.policy.idleAfterMinutes ?? 10;
  return createPortal(
    <div className="lb-att-idle">
      <div className="card lb-att-idle__card" role="alertdialog" aria-modal="true" aria-labelledby="att-idle-title" aria-describedby="att-idle-body">
        <span className="h1" id="att-idle-title">
          {t('att.idle.title', { name: firstName })}
        </span>
        <span className="lb-att-muted" id="att-idle-body">
          {t('att.idle.body', { minutes })}
        </span>
        <span className="h1 lb-att-idle__clock" aria-live="polite">
          {promptClock(attendance.idle.secondsLeft)}
        </span>
        <span className="sub">{t(office ? 'att.idle.afterOffice' : 'att.idle.after')}</span>
        <div className="lb-att-actions lb-att-actions--center">
          <button ref={stay} type="button" className="btn bg lb-btn" onClick={attendance.stayAvailable}>
            {t('att.idle.stay')}
          </button>
          <button
            type="button"
            className="btn bs lb-btn"
            onClick={() => {
              attendance.stayAvailable();
              navigate(screenPath(portal, 'CA14b-AttendanceActive'));
            }}
          >
            {t('att.idle.change')}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
