import { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../../../auth/AuthProvider';
import { Button } from '../../../components/Button';
import { Modal } from '../../../components/Modal';
import { useT } from '../../../i18n/I18nProvider';
import type { MessageKey } from '../../../i18n/en';
import { isApiError } from '../../../lib/api/errors';
import { useScreenPath } from '../../../portals/PortalContext';
import { discardEverywhere, draftsApi, draftsKey, prepareResume, SCREEN_OF, type ServerDraft } from './serverDraft';

const KIND_LABEL: Record<ServerDraft['kind'], MessageKey> = {
  job_seeker: 'reg.drafts.kind.job_seeker',
  business: 'reg.drafts.kind.business',
  referral: 'reg.drafts.kind.referral',
};

/**
 * At the top of the call agent console (21 Nov, rev 204): "Unfinished
 * registration — <name or 'no name yet'> · Resume / Discard". Resume opens the
 * form with every field (and the number still checked when the draft kept
 * it); Discard asks once. Hidden on the form that is open right now.
 */
export function UnfinishedRegistrationBanner() {
  const t = useT();
  const to = useScreenPath();
  const navigate = useNavigate();
  const location = useLocation();
  const { session } = useAuth();
  const staffId = session?.staff.id;
  const queryClient = useQueryClient();
  const drafts = useQuery({ queryKey: draftsKey, queryFn: draftsApi.mine, enabled: Boolean(staffId), retry: false, staleTime: 15_000 });
  const [asking, setAsking] = useState<ServerDraft | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const rows = (drafts.data?.drafts ?? []).filter((d) => location.pathname !== to(SCREEN_OF[d.kind]));
  if (rows.length === 0) return null;
  return (
    <div className="lb-drafts" role="region" aria-label={t('reg.drafts.region')} data-testid="unfinished-registrations">
      {rows.map((d) => (
        <div key={d.id} className="warn lb-drafts__row">
          <span>
            <strong>{t('reg.drafts.title')}</strong> — {d.name?.trim() || t('reg.drafts.noName')} <span className="sub">· {t(KIND_LABEL[d.kind])}</span>
          </span>
          <span className="lb-drafts__actions">
            <Button
              variant="primary"
              onClick={() => {
                prepareResume(d, staffId);
                navigate(to(SCREEN_OF[d.kind]));
              }}
            >
              {t('reg.drafts.resume')}
            </Button>
            <Button onClick={() => setAsking(d)}>{t('reg.drafts.discard')}</Button>
          </span>
        </div>
      ))}
      <Modal
        open={Boolean(asking)}
        onClose={() => setAsking(null)}
        title={t('reg.drafts.discardTitle')}
        footer={
          <>
            <Button onClick={() => setAsking(null)}>{t('common.cancel')}</Button>
            <Button
              variant="danger"
              loading={busy}
              onClick={async () => {
                if (!asking) return;
                setBusy(true);
                setProblem(null);
                try {
                  await discardEverywhere(asking.kind, staffId);
                  await queryClient.invalidateQueries({ queryKey: draftsKey });
                  setAsking(null);
                } catch (e) {
                  setProblem(isApiError(e) ? e.message : t('error.server'));
                } finally {
                  setBusy(false);
                }
              }}
            >
              {t('reg.drafts.discardYes')}
            </Button>
          </>
        }
      >
        <p>{t('reg.drafts.discardBody', { name: asking?.name?.trim() || t('reg.drafts.noName') })}</p>
        {problem && (
          <p className="vno" role="alert">
            {problem}
          </p>
        )}
      </Modal>
    </div>
  );
}
