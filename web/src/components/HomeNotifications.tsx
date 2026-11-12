import { Link } from 'react-router-dom';
import { useT } from '../i18n/I18nProvider';
import { usePortal } from '../portals/PortalContext';
import { toBellItems, useBellQuery, type NotificationItem } from '../portals/notifications';
import { Card } from './Card';
import { ErrorState } from './ErrorState';
import { Skeleton } from './Skeleton';

/** How many open notifications the Home block lists before "See all notifications →". */
export const HOME_NOTIFICATIONS_LIMIT = 8;

/**
 * The notifications block on the Home screens (designs Main, MG-Home, T-Home,
 * FN-Home): the open notifications, newest first, then "Done today · cleared
 * by themselves" with who did the work, then "See all notifications →". The
 * same `GET /notifications/bell` answer as the top-bar bell (one shared
 * query), so both always agree; NotificationService clears an item by itself
 * when the work behind it is done.
 */
export function HomeNotifications() {
  const t = useT();
  const portal = usePortal();
  const { bell } = useBellQuery(portal.key);
  const notificationsScreen = portal.screens.find((s) => s.path === 'notifications');
  const allPath = notificationsScreen ? `${portal.root}/${notificationsScreen.path}` : undefined;
  const items = toBellItems(bell.data, (name) => (name ? t('common.notificationDoneBy', { name }) : t('common.notificationClearedItself')));
  const open = items.filter((i) => i.state === 'open').slice(0, HOME_NOTIFICATIONS_LIMIT);
  const done = items.filter((i) => i.state === 'cleared');
  const count = bell.data?.openCount ?? 0;

  return (
    <Card
      title={count > 0 ? t('common.notificationsTitle', { count }) : t('common.notifications')}
      aria-label={t('common.notifications')}
    >
      {bell.isPending ? (
        <div className="lb-stack">
          <Skeleton width="70%" />
          <Skeleton width="55%" />
        </div>
      ) : bell.isError ? (
        <ErrorState error={bell.error} onRetry={() => void bell.refetch()} />
      ) : (
        <div className="lb-homenotes" data-testid="home-notifications">
          {open.length === 0 && <p className="lb-bell__empty">{t('common.noNotifications')}</p>}
          {open.map((item) => (
            <Row key={item.id} item={item} />
          ))}
          {done.length > 0 && <div className="lb-homenotes__done">{t('common.notificationsDoneToday')}</div>}
          {done.map((item) => (
            <Row key={item.id} item={item} />
          ))}
          {allPath && (
            <Link to={allPath} className="lb-bell__all">
              {t('common.seeAllNotifications')}
            </Link>
          )}
        </div>
      )}
    </Card>
  );
}

function Row({ item }: { item: NotificationItem }) {
  const body = (
    <>
      <span className={`lb-bell__dot lb-bell__dot--${item.state}`} aria-hidden="true" />
      <span className="lb-bell__text">
        <span className="lb-bell__title">{item.title}</span>
        {item.detail && <span className="lb-bell__detail">{item.detail}</span>}
        {item.meta && <span className="lb-bell__meta">{item.meta}</span>}
      </span>
    </>
  );
  const cls = `lb-bell__item${item.state === 'cleared' ? ' is-cleared' : ''}`;
  return item.to ? (
    <Link to={item.to} className={cls}>
      {body}
    </Link>
  ) : (
    <div className={cls}>{body}</div>
  );
}
