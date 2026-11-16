import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../../../auth/AuthProvider';
import { Button } from '../../../components/Button';
import { useToast } from '../../../components/Toast';
import { useT } from '../../../i18n/I18nProvider';
import { api } from '../../../lib/api/client';
import { isApiError } from '../../../lib/api/errors';

/**
 * "Your calling phone" on the call agent's Home: the mobile the calling system
 * rings first when he places a call (PUT /staff/:id/call-routing-phone, his
 * own account; a Team Lead, Manager or the CEO can also set it from Team &
 * Access). Without it every call is refused with "Set the phone the calling
 * system rings…". The number itself is never shown back: it is stored
 * encrypted and the answer only says whether it is set.
 */
export function CallRoutingPhoneCard({ isSet, onSaved }: { isSet: boolean; onSaved?: () => void }) {
  const t = useT();
  const toast = useToast();
  const queryClient = useQueryClient();
  const staffId = useAuth().session?.staff.id;
  const [editing, setEditing] = useState(!isSet);
  const [phone, setPhone] = useState('');
  const [error, setError] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: () => api.put(`/staff/${staffId}/call-routing-phone`, { phone }),
    onSuccess: () => {
      toast.success(t('ca.routing.saved'));
      setPhone('');
      setEditing(false);
      onSaved?.();
      void queryClient.invalidateQueries();
    },
    onError: (e) => setError(isApiError(e) ? e.message : t('error.server')),
  });
  if (!staffId) return null;

  const submit = () => {
    if (!/^[6-9]\d{9}$/.test(phone)) {
      setError(t('ca.routing.invalid'));
      return;
    }
    setError(null);
    save.mutate();
  };

  return (
    <section className={isSet ? 'card' : 'card warn'} aria-label={t('ca.routing.title')} data-testid="call-routing-phone" style={{ padding: 14 }}>
      <strong>{t('ca.routing.title')}</strong>
      <p className="sub" style={{ margin: '4px 0 8px' }}>
        {isSet ? t('ca.routing.set') : t('ca.routing.notSet')}
      </p>
      {editing ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
          style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}
        >
          <label className="field" style={{ minWidth: 200 }}>
            {t('ca.routing.label')}
            <input
              type="tel"
              inputMode="numeric"
              autoComplete="tel-national"
              maxLength={10}
              value={phone}
              aria-invalid={Boolean(error) || undefined}
              onChange={(e) => setPhone(e.target.value.replace(/\D/g, '').slice(0, 10))}
            />
          </label>
          <Button type="submit" variant="primary" loading={save.isPending}>
            {t('ca.routing.save')}
          </Button>
        </form>
      ) : (
        <Button onClick={() => setEditing(true)}>{t('ca.routing.change')}</Button>
      )}
      {error && (
        <p className="err" role="alert" style={{ marginTop: 6 }}>
          {error}
        </p>
      )}
    </section>
  );
}
