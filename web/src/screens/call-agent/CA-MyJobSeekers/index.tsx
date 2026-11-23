import { useT } from '../../../i18n/I18nProvider';
import type { MySeeker } from '../_lists/api';
import { ListScreen } from '../_lists/parts';
import { SeekerRow } from '../_lists/rows';

/**
 * My job seekers (Master Guide rev 210, "Call agent console lists, decided 23 Nov"): the job
 * seekers this agent registered or was given (assigned ?? registered). Each row: selfie or
 * initials, the name in bold, "Trade · area · experience", one plain status line, once paid
 * "Day X of 30 · N hits" and the next interview; on the right Done, Waiting (the Team Lead's ID
 * check) or ONE button that works in place (Send / Resend link, Send payment link) or opens Book
 * interview. Search, filter chips, needs action first, Load more. Tapping a row opens CA04.
 * Data: GET /call-work/my/job-seekers.
 */
export default function MyJobSeekers() {
  const t = useT();
  return (
    <ListScreen<MySeeker>
      kind="job-seekers"
      title={t('screen.CA-MyJobSeekers')}
      placeholder={t('cl.search.seekers')}
      emptyKey="cl.none.seekers"
      renderRow={(js) => <SeekerRow js={js} />}
    />
  );
}
