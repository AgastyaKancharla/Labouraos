import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '../../../components/Button';
import { useToast } from '../../../components/Toast';
import { useT } from '../../../i18n/I18nProvider';
import { api } from '../../../lib/api/client';
import { isApiError } from '../../../lib/api/errors';

export type NoWhatsAppKind = 'job_seeker' | 'business' | 'referral';

interface NoWhatsAppView {
  noWhatsApp: boolean;
  source: 'meta' | 'staff' | null;
  since: string | null;
}

/**
 * "No WhatsApp" on a person's profile (Master Guide rev 211), call agent console
 * only: whether messages to this person go on WhatsApp first or straight by SMS,
 * and a button to change it (GET / PUT /no-whatsapp, call agents only, audited).
 */
export function NoWhatsAppToggle({ kind, id }: { kind: NoWhatsAppKind; id: string | undefined }) {
  const t = useT();
  const toast = useToast();
  const queryClient = useQueryClient();
  const key = ['no-whatsapp', kind, id] as const;
  const view = useQuery({
    queryKey: key,
    queryFn: () => api.get<NoWhatsAppView>('/no-whatsapp', { query: { kind, id: id! } }),
    enabled: Boolean(id),
    retry: false,
  });
  const change = useMutation({
    mutationFn: (noWhatsApp: boolean) => api.put<NoWhatsAppView>('/no-whatsapp', { kind, id, noWhatsApp }),
    onSuccess: (res) => {
      queryClient.setQueryData(key, res);
      toast.success(t('noWa.saved'));
    },
    onError: (e) => toast.error(isApiError(e) ? e.message : t('error.server')),
  });
  if (!id || !view.data) return null;
  const v = view.data;
  return (
    <section className="card lb-nowa" aria-label={t('noWa.title')} data-testid="no-whatsapp">
      <b>{t('noWa.title')}</b>
      <span data-testid="no-whatsapp-state">{t(v.noWhatsApp ? 'noWa.none' : 'noWa.has')}</span>
      {v.noWhatsApp && v.source === 'meta' && <span className="sub">{t('noWa.meta')}</span>}
      <Button onClick={() => change.mutate(!v.noWhatsApp)} loading={change.isPending}>
        {t(v.noWhatsApp ? 'noWa.clear' : 'noWa.mark')}
      </Button>
    </section>
  );
}
