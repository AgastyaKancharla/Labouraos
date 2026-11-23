import { useT } from '../../../i18n/I18nProvider';
import type { MyPartner } from '../_lists/api';
import { ListScreen } from '../_lists/parts';
import { PartnerRow } from '../_lists/rows';

/**
 * My referral partners (rev 210, 23 Nov): the partners this agent registered or was given. Each
 * row: the name in bold, "Individual / Business · area", one plain status line (terms, selfie,
 * ID, UPI, active) and how many job seekers they referred; on the right Done, Waiting (the Team
 * Lead's ID check) or Send partner terms link. Tapping a row opens the partner profile (CA04)
 * with "Where they're stuck". Data: GET /call-work/my/referrals.
 */
export default function MyPartners() {
  const t = useT();
  return (
    <ListScreen<MyPartner>
      kind="referrals"
      title={t('screen.CA-MyPartners')}
      placeholder={t('cl.search.partners')}
      emptyKey="cl.none.partners"
      renderRow={(p) => <PartnerRow p={p} />}
    />
  );
}
