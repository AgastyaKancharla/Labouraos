import { useT } from '../../../i18n/I18nProvider';
import type { MyBusiness } from '../_lists/api';
import { ListScreen } from '../_lists/parts';
import { BusinessRow } from '../_lists/rows';

/**
 * My businesses (rev 210, 23 Nov): the businesses whose account agent this agent is, or whose
 * lead he created while they have no account agent. Each row: the name in bold, "Type · area",
 * one plain status line, "N vacancies · N candidates shown · N interviews today"; on the right
 * Done, Waiting (the Team Lead's check) or ONE button (Send agreement link, Resend vacancy link,
 * Finish vacancy, Add vacancy). Tapping a row opens the business profile (CA04) with "Where
 * they're stuck". Data: GET /call-work/my/businesses.
 */
export default function MyBusinesses() {
  const t = useT();
  return (
    <ListScreen<MyBusiness>
      kind="businesses"
      title={t('screen.CA-MyBusinesses')}
      placeholder={t('cl.search.businesses')}
      emptyKey="cl.none.businesses"
      renderRow={(b) => <BusinessRow b={b} />}
    />
  );
}
