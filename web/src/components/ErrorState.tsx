import type { ReactNode } from 'react';
import { useT } from '../i18n/I18nProvider';
import { isApiError } from '../lib/api/errors';
import { Button } from './Button';
import { UiIcon } from './Icon';

/**
 * What a screen shows when its data failed to load. Pass the error from
 * TanStack Query; the message depends on the kind of failure and server
 * errors show the request id to quote to support.
 */
export function ErrorState({ error, onRetry, compact }: { error: unknown; onRetry?: () => void; compact?: boolean }) {
  const t = useT();
  let message: string;
  let reference: string | undefined;
  if (isApiError(error)) {
    if (error.isNetworkError) message = t('error.network');
    else if (error.isForbidden) message = t('error.forbidden');
    else if (error.isNotFound) message = t('error.notFound');
    else if (error.isServerError) message = t('error.server');
    else message = error.message;
    reference = error.requestId;
  } else {
    message = t('error.server');
  }
  return (
    <div className={compact ? 'lb-state lb-state--compact' : 'lb-state'} role="alert">
      <span className="lb-state__icon lb-state__icon--error">
        <UiIcon name="alert" size={20} />
      </span>
      <div className="lb-state__body">
        <strong>{t('error.title')}</strong>
        <span>{message}</span>
        {reference && <span className="lb-state__ref">{t('common.reference', { id: reference })}</span>}
      </div>
      {onRetry && (
        <Button onClick={onRetry} icon={<UiIcon name="refresh" size={14} />}>
          {t('common.retry')}
        </Button>
      )}
    </div>
  );
}

/** What a list or card shows when there is nothing in it. */
export function EmptyState({ title, children, action }: { title?: ReactNode; children?: ReactNode; action?: ReactNode }) {
  const t = useT();
  return (
    <div className="lb-state lb-state--empty">
      <div className="lb-state__body">
        <strong>{title ?? t('table.empty')}</strong>
        {children && <span>{children}</span>}
      </div>
      {action}
    </div>
  );
}
