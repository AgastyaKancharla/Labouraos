import { Link, useSearchParams } from 'react-router-dom';
import { EmptyState, ErrorState } from '../../../components/ErrorState';
import { SkeletonCard } from '../../../components/Skeleton';
import { TopBar } from '../../../components/TopBar';
import { useT } from '../../../i18n/I18nProvider';
import { useNow } from '../../../lib/useNow';
import { useScreenPath } from '../../../portals/PortalContext';
import { useIncoming } from '../_lib/api';
import { stopwatch } from '../_lib/format';

/**
 * Unknown caller — design CA17b-UnknownCaller. One tap starts the right
 * registration. The registration screens receive `?incomingCall=<task id>`
 * and fill the mobile number from the call on the server side (agents never
 * see full numbers); it still needs an OTP.
 */
export default function UnknownCaller() {
  const t = useT();
  const to = useScreenPath();
  const now = useNow(1000);
  const [params] = useSearchParams();
  const task = params.get('task');
  const card = useIncoming(task);
  const c = card.data;
  const from = (id: string) => `${to(id)}?incomingCall=${encodeURIComponent(task ?? '')}`;
  return (
    <div className="lb-page lb-ca">
      <TopBar title={t('screen.CA17b-UnknownCaller')} titleHidden />
      {!task && <EmptyState title={t('ca.in.none')} />}
      {card.error && <ErrorState error={card.error} onRetry={() => void card.refetch()} />}
      {task && !c && !card.error && <SkeletonCard height={200} />}
      {c && (
        <div className="card" style={{ maxWidth: 820, display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div className="ok lb-ca-ringing" role="status">
            ☎ {t('ca.unk.banner', { time: stopwatch((now.getTime() - new Date(c.ringingSince).getTime()) / 1000), phone: c.maskedPhone })}
          </div>
          <div className="warn">
            <strong>{t('ca.unk.new')}</strong> {t('ca.unk.ask')}
          </div>
          <div className="lb-ca-options">
            <Link className="qc" to={from('CA08-Register')}>{t('ca.unk.seeker')}</Link>
            <Link className="qc" to={from('CA13-BusinessLead')}>{t('ca.unk.business')}</Link>
            <Link className="qc" to={from('CA15-RegisterReferral')}>{t('ca.unk.partner')}</Link>
            <Link className="qc" to={to('CA16-Search')}>{t('ca.unk.search')}</Link>
          </div>
          <p className="sub">{t('ca.unk.note')}</p>
        </div>
      )}
    </div>
  );
}
