import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Button } from '../../../components/Button';
import { EmptyState, ErrorState } from '../../../components/ErrorState';
import { SkeletonCard } from '../../../components/Skeleton';
import { TopBar } from '../../../components/TopBar';
import { useT } from '../../../i18n/I18nProvider';
import { usePortal } from '../../../portals/PortalContext';
import { api } from '../../../lib/api/client';
import { ApiError } from '../../../lib/api/errors';
import { PayslipCard, type Payslip } from './PayslipCard';

interface MonthList {
  months: { month: string; label: string; paidOn: string | null }[];
}

/**
 * Payslips — design CA14g-Payslip. The standard corporate payslip, worked
 * out from attendance and approved leave and released by Finance. Each person
 * reads only their own (the API takes the person from the sign-in, never from
 * the page), and only once Finance has paid them.
 */
export default function MyPayslips() {
  const t = useT();
  const portal = usePortal();
  const list = useQuery({ queryKey: ['payroll', 'my-payslips'], queryFn: () => api.get<MonthList>('/payroll/my-payslips') });
  const months = useMemo(() => list.data?.months ?? [], [list.data]);
  const [picked, setPicked] = useState('');
  // The newest released payslip until the person picks another month.
  const month = picked || months[0]?.month || '';
  const setMonth = setPicked;
  const slip = useQuery({
    queryKey: ['payroll', 'my-payslips', month],
    queryFn: () => api.get<Payslip>(`/payroll/my-payslips/${month}`),
    enabled: Boolean(month),
  });
  const actions = months.length ? (
    <span className="lb-payslip-bar">
      <select aria-label={t('payslip.month')} value={month} onChange={(e) => setMonth(e.target.value)}>
        {months.map((m) => (
          <option key={m.month} value={m.month}>
            {m.label}
          </option>
        ))}
      </select>
      <Button variant="primary" onClick={() => window.print()} disabled={!slip.data}>
        {t('payslip.download')}
      </Button>
    </span>
  ) : undefined;
  return (
    <div className={portal.family === 'portal' ? 'lb-page' : 'lb-page lb-ca'} style={{ maxWidth: 900, margin: '0 auto', width: '100%' }}>
      <TopBar title={t('payslip.title')} actions={actions} />
      {list.error && <ErrorState error={list.error} onRetry={() => void list.refetch()} />}
      {list.isPending && <SkeletonCard height={420} />}
      {list.data && months.length === 0 && <EmptyState title={t('payslip.none')} />}
      {slip.isPending && slip.fetchStatus !== 'idle' && <SkeletonCard height={420} />}
      {slip.error &&
        (slip.error instanceof ApiError && slip.error.status === 404 ? (
          <EmptyState title={t('payslip.notReleased')} />
        ) : (
          <ErrorState error={slip.error} onRetry={() => void slip.refetch()} />
        ))}
      {slip.data && (
        <div className={portal.family === 'portal' ? 'console' : undefined}>
          <PayslipCard slip={slip.data} />
        </div>
      )}
    </div>
  );
}
