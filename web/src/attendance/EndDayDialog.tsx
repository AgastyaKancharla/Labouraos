import { Button } from '../components/Button';
import { Modal } from '../components/Modal';
import { useT } from '../i18n/I18nProvider';
import { useAttendance } from './AttendanceProvider';
import { hm } from './format';

/** "End your day?" — the day can't be started again today, so it is confirmed first. */
export function EndDayDialog({ open, onClose, onConfirm, busy }: { open: boolean; onClose: () => void; onConfirm: () => void; busy: boolean }) {
  const t = useT();
  const attendance = useAttendance();
  const today = attendance?.today;
  const total = (today?.policy.productionHoursFullDay ?? 8) * 3600;
  return (
    <Modal
      open={open}
      onClose={onClose}
      dismissible={!busy}
      title={t('att.end.title')}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            {t('common.cancel')}
          </Button>
          <Button variant="danger" onClick={onConfirm} loading={busy}>
            {t('att.end.confirm')}
          </Button>
        </>
      }
    >
      <p className="lb-att-modal-text">{t('att.end.body', { production: hm(today?.productionSeconds ?? 0), total: hm(total) })}</p>
    </Modal>
  );
}
