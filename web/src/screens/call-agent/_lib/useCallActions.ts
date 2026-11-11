import { useNavigate } from 'react-router-dom';
import { useToast } from '../../../components/Toast';
import { useT } from '../../../i18n/I18nProvider';
import { ApiError } from '../../../lib/api/errors';
import { useScreenPath } from '../../../portals/PortalContext';
import { readSkipped, useCallNext, usePlaceCall, type CallNextResult, type PlaceCallInput } from './api';
import { clock12 } from './format';

/**
 * Starting calls from any console screen. Every call goes through the
 * calling system (POST /calls rings the agent's phone first, then the
 * person); the on-call screen then follows what the calling system reports.
 */
export function useCallActions() {
  const t = useT();
  const toast = useToast();
  const navigate = useNavigate();
  const to = useScreenPath();
  const place = usePlaceCall();
  const next = useCallNext();

  const openCall = (callRecordId: string, back?: string) =>
    navigate(to('CA05-OnCall', { id: callRecordId }), { state: back ? { back } : undefined });

  const call = (input: PlaceCallInput, back?: string) =>
    place.mutate(input, {
      onSuccess: (res) => openCall(res.callRecordId, back),
      onError: (err) => toast.error(err instanceof ApiError ? err.message : t('ca.call.failed')),
    });

  const explainBlocked = (res: CallNextResult) => {
    switch (res.blocked) {
      case 'outside_calling_hours':
        return t('ca.blocked.outside_calling_hours', { start: clock12(res.callingHours.start), end: clock12(res.callingHours.end) });
      case 'not_available':
        return t('ca.blocked.not_available');
      case 'nothing_to_call':
        return t('ca.blocked.nothing_to_call');
      default:
        return t('ca.blocked.call_refused', { message: res.message ?? '' });
    }
  };

  const callNext = () =>
    next.mutate(readSkipped(), {
      onSuccess: (res) => {
        if (res.placed && res.callRecordId) {
          openCall(res.callRecordId);
          return;
        }
        if (res.blocked === 'call_refused' && res.item) {
          toast.error(explainBlocked(res));
          navigate(to('CA04-Profile', { id: res.item.code ?? res.item.subjectId }));
          return;
        }
        toast.error(explainBlocked(res));
      },
      onError: (err) => toast.error(err instanceof ApiError ? err.message : t('ca.call.failed')),
    });

  return { call, callNext, placing: place.isPending, callingNext: next.isPending };
}
