import './console.css';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { useT } from '../../../i18n/I18nProvider';
import { useLiveEvent } from '../../../lib/live/liveChannel';
import { usePortal } from '../../../portals/PortalContext';
import { screenPath } from '../../../portals';

interface IncomingEvent {
  callbackTaskId: string;
  known: boolean;
  name: string | null;
  code: string | null;
  maskedPhone: string;
}

/**
 * Mounted once in the call agent console (AppShell). When the server says a
 * call is ringing for this agent (live channel `incoming_call`), a pop-up
 * shows who it is on whatever screen is open — without throwing away a
 * half-filled form — with one tap to the full incoming-call card.
 */
export function IncomingCallWatcher() {
  const t = useT();
  const portal = usePortal();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [call, setCall] = useState<IncomingEvent | null>(null);
  useLiveEvent<IncomingEvent>('incoming_call', (data) => {
    setCall(data);
    void qc.invalidateQueries({ queryKey: ['call-work', 'home'] });
  });
  if (!call) return null;
  const open = () => {
    const id = call.known ? 'CA17-IncomingCall' : 'CA17b-UnknownCaller';
    navigate(`${screenPath(portal, id)}?task=${encodeURIComponent(call.callbackTaskId)}`);
    setCall(null);
  };
  return (
    <div className="lb-ca-popup" role="alertdialog" aria-live="assertive" aria-labelledby="ca-popup-title">
      <div id="ca-popup-title" className="nm">
        ☎ {call.known ? t('ca.pop.incoming', { name: call.name ?? '' }) : t('ca.pop.unknown')}
      </div>
      <div className="sub">{[call.code, call.maskedPhone].filter(Boolean).join(' · ')}</div>
      <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
        <button type="button" className="btn bg lb-btn" onClick={open} autoFocus>
          {t('ca.pop.open')}
        </button>
        <button type="button" className="btn bs lb-btn" onClick={() => setCall(null)}>
          {t('ca.in.dismiss')}
        </button>
      </div>
    </div>
  );
}
