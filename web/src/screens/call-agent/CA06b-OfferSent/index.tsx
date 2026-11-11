import { Link, useSearchParams } from 'react-router-dom';
import { TopBar } from '../../../components/TopBar';
import { useT } from '../../../i18n/I18nProvider';
import { formatDayMonthIST } from '../../../lib/format/date';
import { useScreenPath } from '../../../portals/PortalContext';
import { useProfile } from '../_lib/api';
import { time12 } from '../_lib/format';

/**
 * Offer sent — design CA06b-OfferSent. Everything after this is automatic:
 * messages, the owner's result, the check with him, deadlines and flags.
 */
export default function OfferSent() {
  const t = useT();
  const to = useScreenPath();
  const [params] = useSearchParams();
  const person = params.get('person') ?? '';
  const due = params.get('due');
  const profile = useProfile(person);
  const name = profile.data?.name.split(/\s+/)[0] ?? '';
  const steps: Array<[string, string]> = [
    [t('ca.sent.s1'), t('ca.sent.s1r')],
    [t('ca.sent.s2'), t('ca.sent.s2r')],
    [t('ca.sent.s3'), t('ca.sent.s3r')],
    [t('ca.sent.s4'), t('ca.sent.s4r', { name })],
    [t('ca.sent.s5'), t('ca.sent.s5r')],
  ];
  return (
    <div className="lb-page lb-ca">
      <TopBar title={t('screen.CA06b-OfferSent')} titleHidden />
      <div className="ok" role="status">
        ✓ {t('ca.sent.banner', { name, time: due ? `${formatDayMonthIST(due)}, ${time12(due)}` : '—' })}
      </div>
      <div className="card" style={{ maxWidth: 760 }}>
        <h2 className="h2" style={{ marginBottom: 6 }}>{t('ca.sent.next')}</h2>
        {steps.map(([when, what]) => (
          <div className="row" key={when}>
            <span>{when}</span>
            <b style={{ textAlign: 'right' }}>{what}</b>
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <Link className="btn bp lb-btn" to={to('CA03-Home')}>{t('ca.sent.back')}</Link>
        {person && <Link className="btn bs lb-btn" to={to('CA04-Profile', { id: person })}>{t('ca.sent.profile', { name })}</Link>}
      </div>
    </div>
  );
}
