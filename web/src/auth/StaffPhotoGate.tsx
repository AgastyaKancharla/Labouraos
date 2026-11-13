import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { Button } from '../components/Button';
import { FamilyContext } from '../components/family';
import { useT } from '../i18n/I18nProvider';
import { LanguageSwitcher } from '../i18n/LanguageSwitcher';
import { api } from '../lib/api/client';
import { isApiError } from '../lib/api/errors';
import { postLiveSelfie } from '../screens/public/shared/api';
import { LiveSelfie } from '../screens/public/shared/LiveSelfie';
import { ActionError } from '../screens/public/shared/ui';
import { useAuth } from './AuthProvider';
import { sessionStore } from './session';

/**
 * Staff photo at sign-in (guide, login codes, 14 Nov). Anyone signed in with
 * no staff photo yet (accounts made before photos), or whose photo the CEO
 * asked to be retaken, takes a live camera selfie here before going on.
 * Camera only — no file picker. If the API can't say (an older API, a
 * network blip), the person is not blocked: the next page load asks again.
 */
export interface StaffPhotoStatus {
  required: boolean;
  reason: 'missing' | 'retake' | null;
  photoUrl: string | null;
}

/** Per person, so a different sign-in on the same browser asks again. */
export const staffPhotoQueryKey = (staffId: string) => ['staff-photo', 'me', staffId] as const;

export function StaffPhotoGate({ children }: { children: ReactNode }) {
  const { session } = useAuth();
  const staffId = session?.staff.id ?? '';
  const status = useQuery({
    queryKey: staffPhotoQueryKey(staffId),
    enabled: Boolean(staffId),
    queryFn: () => api.get<StaffPhotoStatus>('/staff/me/photo'),
    staleTime: Infinity,
    retry: false,
  });
  if (staffId && status.isPending) return null;
  if (!status.data?.required) return <>{children}</>;
  return <TakeStaffPhoto staffId={staffId} reason={status.data.reason} />;
}

function TakeStaffPhoto({ staffId, reason }: { staffId: string; reason: StaffPhotoStatus['reason'] }) {
  const t = useT();
  const { signOut } = useAuth();
  const queryClient = useQueryClient();
  const [error, setError] = useState<unknown>(null);

  const upload = async (photo: Blob): Promise<'done' | 'retry'> => {
    setError(null);
    try {
      const token = sessionStore.token();
      const saved = (await postLiveSelfie('/staff/me/photo', {}, photo, token ? { Authorization: `Bearer ${token}` } : {})) as StaffPhotoStatus;
      queryClient.setQueryData(staffPhotoQueryKey(staffId), { ...saved, required: false, reason: null });
      return 'done';
    } catch (e) {
      if (isApiError(e) && e.status === 401) return 'done';
      setError(e);
      return 'retry';
    }
  };

  return (
    <FamilyContext.Provider value="console">
      <div className="console lb-center lb-invite">
        <main id="main" className="card lb-auth-card">
          <div className="lb-invite__lang">
            <LanguageSwitcher tone="onLight" />
          </div>
          <div className="lb-stack">
            <h1 className="h1">{t(reason === 'retake' ? 'staffPhoto.retakeTitle' : 'staffPhoto.title')}</h1>
            <p className="muted">{t(reason === 'retake' ? 'staffPhoto.retakeIntro' : 'staffPhoto.intro')}</p>
            <LiveSelfie
              active
              onCapture={upload}
              tips={t('staffPhoto.tips')}
              takeLabel={t('staffPhoto.take')}
              savingLabel={t('staffPhoto.saving')}
              error={<ActionError error={error} />}
            />
            <p className="sub">{t('staffPhoto.noCamera')}</p>
            <Button fullWidth onClick={() => void signOut()}>
              {t('staffPhoto.signOut')}
            </Button>
          </div>
        </main>
      </div>
    </FamilyContext.Provider>
  );
}
