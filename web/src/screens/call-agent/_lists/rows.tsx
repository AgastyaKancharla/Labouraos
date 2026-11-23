import { useT } from '../../../i18n/I18nProvider';
import type { MessageKey } from '../../../i18n/en';
import { api } from '../../../lib/api/client';
import { formatDayMonthIST, formatTimeIST } from '../../../lib/format/date';
import { useScreenPath } from '../../../portals/PortalContext';
import { businessTypeLabel } from '../_registration/businessTypes';
import type { BusinessRowState, MyBusiness, MyPartner, MySeeker, PartnerRowState, SeekerRowState } from './api';
import { Avatar, ListRow, maskedLast4, RowAction, RowEnd, toneOf } from './parts';

type T = ReturnType<typeof useT>;
const enc = encodeURIComponent;

// ------------------------------------------------------------------ job seekers

export function seekerStatusText(row: SeekerRowState, t: T): string {
  return t(`cl.js.status.${row.status}` as MessageKey);
}

/** "Cook · Bommanahalli · 1 yr". */
export function seekerTradeLine(s: Pick<MySeeker, 'trade' | 'locality' | 'yearsExperience'>, t: T): string {
  const years = s.yearsExperience ? t(s.yearsExperience === 1 ? 'cl.js.year' : 'cl.js.years', { count: s.yearsExperience }) : null;
  return [s.trade, s.locality, years].filter(Boolean).join(' · ');
}

/** Once paid: "Day 5 of 30 · 2 hits", and the next interview when there is one. */
export function seekerGuaranteeLine(s: Pick<MySeeker, 'guarantee' | 'hits' | 'nextInterviewAt'>, t: T): string {
  const parts: string[] = [];
  if (s.guarantee) {
    parts.push(t('cl.js.dayOf', { day: s.guarantee.day, days: s.guarantee.days }));
    parts.push(t(s.hits === 1 ? 'cl.js.hit' : 'cl.js.hits', { count: s.hits ?? 0 }));
  }
  if (s.nextInterviewAt) parts.push(t('cl.js.nextInterview', { when: `${formatDayMonthIST(s.nextInterviewAt)} ${formatTimeIST(s.nextInterviewAt)}` }));
  return parts.join(' · ');
}

export function SeekerRow({ js }: { js: MySeeker }) {
  const t = useT();
  const to = useScreenPath();
  return (
    <ListRow
      to={to('CA04-Profile', { id: js.code })}
      leading={<Avatar name={js.name} photoUrl={js.photoUrl} />}
      name={js.name}
      status={seekerStatusText(js.row, t)}
      tone={toneOf(js.row, ['stuck_payment', 'id_stopped', 'closed'])}
      lines={[seekerTradeLine(js, t), seekerGuaranteeLine(js, t)]}
      small={[js.code, maskedLast4(js.phoneLast4)].filter(Boolean).join(' · ')}
      trailing={<RowEnd row={js.row} button={<SeekerButton js={js} />} />}
      testId={`seeker-row-${js.code}`}
    />
  );
}

/** Send / Resend link, Send payment link (in place) or Book interview (opens CA06). */
function SeekerButton({ js }: { js: MySeeker }) {
  const t = useT();
  const to = useScreenPath();
  const row = js.row;
  switch (row.action) {
    case 'registration_link':
    case 'scan_aadhaar':
      return (
        <RowAction
          name={js.name}
          label={row.status === 'link_not_sent' ? t('cl.js.action.sendLink') : t('cl.js.action.registration_link')}
          run={() => api.post('/consent/links', { jobSeekerId: js.id })}
        />
      );
    case 'payment_link':
      return <RowAction name={js.name} label={t('cl.js.action.payment_link')} run={() => api.post(`/job-seekers/${enc(js.id)}/resend-payment`, {})} />;
    case 'book_interview':
      return row.vacancyId ? (
        <RowAction name={js.name} label={t('cl.js.action.book_interview')} to={`${to('CA06-BookInterview')}?person=${enc(js.code)}&vacancy=${enc(row.vacancyId)}`} />
      ) : null;
    default:
      return null;
  }
}

// ------------------------------------------------------------------ businesses

export function businessStatusText(row: BusinessRowState, t: T): string {
  return t(`cl.biz.status.${row.status}` as MessageKey);
}

/** "Sweet shop · Bellandur". */
export function businessTypeLine(b: Pick<MyBusiness, 'businessType' | 'businessTypeOther' | 'locality'>): string {
  return [businessTypeLabel(b.businessType, b.businessTypeOther), b.locality].filter(Boolean).join(' · ');
}

export function BusinessRow({ b }: { b: MyBusiness }) {
  const t = useT();
  const to = useScreenPath();
  return (
    <ListRow
      to={to('CA04-Profile', { id: b.code })}
      name={b.name}
      status={businessStatusText(b.row, t)}
      tone={toneOf(b.row, ['suspended', 'agreement_expired'])}
      lines={[businessTypeLine(b), t('cl.biz.numbers', { vacancies: b.openVacancies, shown: b.candidatesShown, interviews: b.interviewsToday })]}
      small={b.code}
      trailing={<RowEnd row={b.row} button={<BusinessButton b={b} />} />}
      testId={`business-row-${b.code}`}
    />
  );
}

/**
 * Send agreement link and Resend vacancy link work in place; Finish vacancy (a draft) and Add
 * vacancy open CA09 (which adds a shift when the business has none).
 */
function BusinessButton({ b }: { b: MyBusiness }) {
  const t = useT();
  const to = useScreenPath();
  const row = b.row;
  switch (row.action) {
    case 'agreement_link':
      return <RowAction name={b.name} label={t('cl.biz.action.agreement_link')} run={() => api.post(`/businesses/${enc(b.id)}/agreement-links`, {})} />;
    case 'confirm_vacancy':
      if (!row.vacancyId) return null;
      return row.status === 'vacancy_to_send' ? (
        <RowAction name={b.name} label={t('cl.biz.action.finishVacancy')} to={`${to('CA09-AddVacancy')}?draft=${enc(row.vacancyId)}`} />
      ) : (
        <RowAction name={b.name} label={t('cl.biz.action.resendVacancy')} run={() => api.post(`/vacancies/${enc(row.vacancyId!)}/confirmation-link`, {})} />
      );
    case 'add_vacancy':
    case 'add_shifts':
      return <RowAction name={b.name} label={t('cl.biz.action.add_vacancy')} to={`${to('CA09-AddVacancy')}?business=${enc(b.code)}`} />;
    default:
      return null;
  }
}

// ------------------------------------------------------------ referral partners

export function partnerStatusText(row: PartnerRowState, t: T): string {
  return t(`cl.ref.status.${row.status}` as MessageKey);
}

export function PartnerRow({ p }: { p: MyPartner }) {
  const t = useT();
  const to = useScreenPath();
  return (
    <ListRow
      to={to('CA04-Profile', { id: p.code })}
      name={p.name}
      status={partnerStatusText(p.row, t)}
      tone={toneOf(p.row, ['id_stopped', 'upi_mismatch'])}
      lines={[[t(p.partnerType === 'business' ? 'cl.ref.business' : 'cl.ref.individual'), p.locality].filter(Boolean).join(' · '), t('cl.ref.referred', { count: p.referred })]}
      small={[p.code, maskedLast4(p.phoneLast4)].filter(Boolean).join(' · ')}
      trailing={
        <RowEnd
          row={p.row}
          button={
            p.row.action === 'partner_terms_link' ? (
              <RowAction name={p.name} label={t('cl.ref.action.partner_terms_link')} run={() => api.post(`/referrals/${enc(p.id)}/terms-links`, {})} />
            ) : null
          }
        />
      }
      testId={`partner-row-${p.code}`}
    />
  );
}
