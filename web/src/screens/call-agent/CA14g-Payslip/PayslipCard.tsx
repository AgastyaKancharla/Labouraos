import { useT } from '../../../i18n/I18nProvider';
import { formatDateIST } from '../../../lib/format/date';
import { formatINR } from '../../../lib/format/money';
import './payslip.css';

/** A payslip as GET /payroll/my-payslips/:month and GET /finance/salaries/:month/payslips/:staffId return it. */
export interface Payslip {
  month: string;
  label: string;
  status: string;
  paidOn: string | null;
  company: { name: string; address: string | null; city: string };
  employee: { name: string; code: string; designation: string; reportsTo: string | null; joinedOn: string | null; paymentRefLast4: string | null; paidFrom: string | null };
  days: { salaryDays: number; calendarDays: number; paidDays: number; lossOfPayDays: number; notEmployedDays: number; shortfallMinutes: number };
  earnings: { key: string; label: string; paise: number }[];
  grossPaise: number;
  deductions: { key: string; label: string; paise: number; note: string | null }[];
  deductionsPaise: number;
  correction?: { paise: number; note: string | null } | null;
  netPaise: number;
  netInWords: string;
  note: string;
}

const EARN_KEY: Record<string, 'payslip.basic' | 'payslip.hra' | 'payslip.special'> = { basic: 'payslip.basic', hra: 'payslip.hra', special: 'payslip.special' };
const STAT_KEY: Record<string, 'payslip.pf' | 'payslip.esi' | 'payslip.pt'> = { pf: 'payslip.pf', esi: 'payslip.esi', professional_tax: 'payslip.pt' };

function hm(minutes: number): string {
  return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, '0')}m`;
}

/**
 * The standard corporate payslip (design CA14g-Payslip): company, employee,
 * days, earnings and deductions side by side, net pay in figures and words.
 * It prints on one A4 page ("Download PDF" opens the print dialog — choose
 * Save as PDF).
 */
export function PayslipCard({ slip }: { slip: Payslip }) {
  const t = useT();
  return (
    <article className="card lb-payslip" aria-label={t('payslip.for', { month: slip.label })}>
      <div className="lb-payslip__head">
        <span className="lb-payslip__co">
          <strong>{slip.company.name.toUpperCase()}</strong>
          <span className="sub">
            {slip.company.city} · {t('payslip.for', { month: slip.label })}
          </span>
        </span>
        <span className="sub" style={{ textAlign: 'right' }}>
          {slip.paidOn ? t('payslip.paidOn', { date: formatDateIST(slip.paidOn) }) : t('payslip.notPaid')}
        </span>
      </div>
      <div className="grid2 lb-payslip__kv">
        <div className="row">
          <span>{t('payslip.name')}</span>
          <strong>{slip.employee.name}</strong>
        </div>
        <div className="row">
          <span>{t('payslip.employeeId')}</span>
          <span>{slip.employee.code}</span>
        </div>
        <div className="row">
          <span>{t('payslip.designation')}</span>
          <span>{slip.employee.designation}</span>
        </div>
        <div className="row">
          <span>{t('payslip.reportsTo')}</span>
          <span>{slip.employee.reportsTo ?? '—'}</span>
        </div>
        <div className="row">
          <span>{t('payslip.joined')}</span>
          <span>{slip.employee.joinedOn ? formatDateIST(slip.employee.joinedOn) : '—'}</span>
        </div>
        <div className="row">
          <span>{t('payslip.paymentRef')}</span>
          <span>{slip.employee.paymentRefLast4 ? `****${slip.employee.paymentRefLast4}` : '—'}</span>
        </div>
        <div className="row">
          <span>{t('payslip.daysInMonth')}</span>
          <span>{slip.days.salaryDays}</span>
        </div>
        <div className="row">
          <span>{t('payslip.paidDays')}</span>
          <span>{slip.days.lossOfPayDays > 0 ? t('payslip.paidDaysLop', { paid: slip.days.paidDays, lop: slip.days.lossOfPayDays }) : slip.days.paidDays}</span>
        </div>
        {slip.days.notEmployedDays > 0 && (
          <div className="row">
            <span>{t('payslip.notOnStaff')}</span>
            <span>{t('payslip.notOnStaffDays', { days: slip.days.notEmployedDays })}</span>
          </div>
        )}
      </div>
      <div className="grid2 lb-payslip__cols">
        <div>
          <div className="lbl" style={{ marginBottom: 4 }}>{t('payslip.earnings')}</div>
          {slip.earnings.map((e) => (
            <div className="row" key={e.key}>
              <span>{EARN_KEY[e.key] ? t(EARN_KEY[e.key]) : e.label}</span>
              <span>{formatINR(e.paise)}</span>
            </div>
          ))}
          <div className="row">
            <strong>{t('payslip.gross')}</strong>
            <strong>{formatINR(slip.grossPaise)}</strong>
          </div>
        </div>
        <div>
          <div className="lbl" style={{ marginBottom: 4 }}>{t('payslip.deductions')}</div>
          {slip.deductions.map((d) => {
            const label =
              d.key === 'loss_of_pay'
                ? slip.days.lossOfPayDays === 1
                  ? t('payslip.lopOne')
                  : t('payslip.lop', { days: slip.days.lossOfPayDays })
                : d.key === 'not_on_staff'
                  ? slip.days.notEmployedDays === 1
                    ? t('payslip.notOnStaffLineOne')
                    : t('payslip.notOnStaffLine', { days: slip.days.notEmployedDays })
                : d.key === 'shortfall'
                  ? t('payslip.shortfall', { time: hm(slip.days.shortfallMinutes) })
                  : STAT_KEY[d.key]
                    ? t(STAT_KEY[d.key])
                    : d.label;
            return (
              <div className="row" key={d.key}>
                <span>{label}</span>
                <span>{d.note && d.paise === 0 ? t('payslip.afterRegistration') : formatINR(d.paise)}</span>
              </div>
            );
          })}
          <div className="row">
            <strong>{t('payslip.total')}</strong>
            <strong>{formatINR(slip.deductionsPaise)}</strong>
          </div>
          {slip.correction && slip.correction.paise !== 0 && (
            <div className="row" title={slip.correction.note ?? undefined}>
              <span>{t('payslip.correction')}</span>
              <span>
                {slip.correction.paise > 0 ? '+ ' : ''}
                {formatINR(slip.correction.paise)}
              </span>
            </div>
          )}
        </div>
      </div>
      <div className="ok lb-payslip__net">
        <span>{t('payslip.net')}</span>
        <span>
          {formatINR(slip.netPaise)} · {slip.netInWords}
        </span>
      </div>
      <div className="warn lb-payslip__note">{t('payslip.note')}</div>
    </article>
  );
}
