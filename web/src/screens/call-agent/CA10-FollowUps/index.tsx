import { Link } from 'react-router-dom';
import { Button } from '../../../components/Button';
import { EmptyState, ErrorState } from '../../../components/ErrorState';
import { SkeletonCard } from '../../../components/Skeleton';
import { TopBar } from '../../../components/TopBar';
import { useT } from '../../../i18n/I18nProvider';
import { formatDayMonthIST, istDateKey } from '../../../lib/format/date';
import { useNow } from '../../../lib/useNow';
import { useScreenPath } from '../../../portals/PortalContext';
import { useFollowUps, type FollowUpRow } from '../_lib/api';
import { followUpKindLabel } from '../_lib/format';
import { useCallActions } from '../_lib/useCallActions';

/**
 * My follow-up calls — design CA10-FollowUps. These catch a business that
 * said "not selected" but hired the person quietly, and check before any
 * refund. Click a name for the full profile, or Call.
 */
export default function FollowUps() {
  const t = useT();
  const to = useScreenPath();
  const now = useNow(60_000);
  const list = useFollowUps();
  const { call, placing } = useCallActions();
  const rows = list.data?.rows ?? [];
  const pending = rows.filter((r) => r.status === 'pending');
  const done = rows.filter((r) => r.status === 'done');

  const why = (r: FollowUpRow) => {
    if (r.kind === 'refund_check') return t('ca.fus.whyRefund');
    if (r.businessName && r.kind.startsWith('not_selected')) return t('ca.fus.whyNotSelected', { business: r.businessName, kind: followUpKindLabel(r.kind, t) });
    return r.businessName ? `${r.businessName} · ${followUpKindLabel(r.kind, t)}` : followUpKindLabel(r.kind, t);
  };
  const due = (r: FollowUpRow) => {
    if (r.missed) return { text: t('ca.fus.missed'), tone: 'tr' };
    const key = istDateKey(r.dueAt);
    if (key <= istDateKey(now)) return { text: t('ca.today'), tone: 'ta' };
    if (key === istDateKey(new Date(now.getTime() + 86_400_000))) return { text: t('ca.tomorrow'), tone: 'tn' };
    return { text: formatDayMonthIST(r.dueAt), tone: 'tn' };
  };

  return (
    <div className="lb-page lb-ca">
      <TopBar title={t('ca.fus.title')} />
      {list.error && <ErrorState error={list.error} onRetry={() => void list.refetch()} />}
      {!list.data && !list.error && <SkeletonCard height={240} />}
      {list.data && (
        <div className="card" style={{ padding: 0 }}>
          {pending.length === 0 ? (
            <EmptyState title={t('ca.fus.empty')} />
          ) : (
            <div className="scroll">
              <table className="tbl lb-ca-table">
                <caption className="sr-only">{t('ca.fus.title')}</caption>
                <thead>
                  <tr>
                    <th scope="col">{t('ca.fus.person')}</th>
                    <th scope="col">{t('ca.fus.why')}</th>
                    <th scope="col">{t('ca.fus.due')}</th>
                    <th scope="col"><span className="sr-only">{t('ca.fus.call')}</span></th>
                  </tr>
                </thead>
                <tbody>
                  {pending.map((r) => {
                    const d = due(r);
                    return (
                      <tr key={r.id}>
                        <td>
                          <Link className="nm" to={`${to('CA04-Profile', { id: r.personCode ?? r.subjectId })}?followUp=${encodeURIComponent(r.id)}`}>{r.name}</Link>
                          <div className="sub">{r.maskedPhone}</div>
                        </td>
                        <td>{why(r)}</td>
                        <td><span className={`tag ${d.tone}`}>{d.text}</span></td>
                        <td style={{ textAlign: 'right' }}>
                          <Button
                            variant="primary"
                            style={{ minHeight: 36, padding: '6px 14px' }}
                            disabled={placing}
                            onClick={() => call({ subjectType: r.subjectType, subjectId: r.subjectId, ...r.call }, to('CA10b-FollowUpAnswer', { id: r.id }))}
                          >
                            {t('ca.fus.call')}
                          </Button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
      {done.length > 0 && (
        <div className="card">
          <div className="lbl" style={{ marginBottom: 4 }}>{t('ca.fus.done')}</div>
          {done.map((r) => (
            <div className="row" key={r.id}>
              <span>{r.name} · {why(r)}</span>
              <span className="tag tg">{r.answer ? t(`ca.fua.answer.${r.answer}` as never) : '✓'}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
