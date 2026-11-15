import { useQuery } from '@tanstack/react-query';
import { useT } from '../../i18n/I18nProvider';
import { api } from '../../lib/api/client';

export type AppLabelType = 'job_seeker' | 'business' | 'referral';

export interface AppLabel {
  registeredInApp: boolean;
  hasApp: boolean;
  pushOn: boolean;
}

/**
 * "Registered in the app" labels for the records on a list or profile
 * (customer app proposal 8.6). One request per list: GET
 * /signup-tracker/app-labels?type=…&ids=… answers only for records linked to
 * an app account; everything else has no label.
 */
export function useAppLabels(type: AppLabelType, ids: Array<string | null | undefined>) {
  const clean = [...new Set(ids.filter((id): id is string => Boolean(id)))].sort();
  return useQuery({
    queryKey: ['signup-tracker', 'app-labels', type, clean.join(',')],
    queryFn: () => api.get<Record<string, AppLabel>>(`/signup-tracker/app-labels?type=${type}&ids=${encodeURIComponent(clean.join(','))}`),
    enabled: clean.length > 0,
    staleTime: 60_000,
  });
}

/** The small label itself. Renders nothing for a record that is not on the app. */
export function AppSignupBadge({ label }: { label: AppLabel | null | undefined }) {
  const t = useT();
  if (!label) return null;
  const text = label.registeredInApp ? t('appSignup.registeredInApp') : t('appSignup.usesApp');
  return (
    <span
      className="tag tb lb-app-badge"
      data-testid="app-badge"
      title={label.pushOn ? `${text} · ${t('appSignup.pushOn')}` : text}
      style={{ marginLeft: 6, whiteSpace: 'nowrap' }}
    >
      📱 {text}
    </span>
  );
}

/** Label for one record (profile pages). */
export function AppSignupBadgeFor({ type, id }: { type: AppLabelType; id: string | null | undefined }) {
  const labels = useAppLabels(type, [id]);
  return <AppSignupBadge label={id ? labels.data?.[id] : null} />;
}
