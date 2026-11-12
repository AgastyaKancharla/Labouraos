import { Card } from '../../../components/Card';
import { ButtonLink } from '../../../components/Button';
import { LinkTabs } from '../../../components/Tabs';
import { TopBar } from '../../../components/TopBar';
import { useScreenPath } from '../../../portals/PortalContext';
import { Note } from '../_kit/kit';
import '../_kit/fin.css';

/**
 * Credit notes — design FN-CreditNotes.dc.html. A placeholder until the CA
 * confirms how GST is handled on a business refund (Master Guide: "every
 * refund of a GST invoice gets a credit note" — to confirm with the CA). Until
 * then a business refund returns the fee only and its GST stays owed (owner
 * decision 11 Nov); Tax lists those refunds.
 */
export default function CreditNotes() {
  const to = useScreenPath();
  return (
    <div className="lb-page">
      <TopBar back={{ to: to('FN-Invoices'), label: 'Invoices' }} title="Credit notes" subtitle="Every credit note issued for a refund." showSearch={false} />
      <LinkTabs
        label="Invoices and credit notes"
        items={[
          { to: to('FN-Invoices'), label: 'Invoices', end: true },
          { to: to('FN-CreditNotes'), label: 'Credit notes' },
        ]}
      />
      <Card>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, alignItems: 'flex-start' }}>
          <p className="fin-strong" style={{ margin: 0 }}>Credit notes start once the CA confirms GST on business refunds.</p>
          <p style={{ margin: 0, fontSize: 13.5 }}>
            Until then a business refund returns the fee only, and the GST on it stays owed: it is listed on Tax as a fee-only refund and does not reduce the GST to pay or appear in the GSTR-1 data.
          </p>
          <ButtonLink to={to('FN-Tax')}>See business refunds on Tax</ButtonLink>
        </div>
      </Card>
      <Note>A credit note will be made automatically with every refund of a GST invoice and go into that month's GST data · ₹499 registration refunds need none (no GST) · last date for a credit note: 30 Nov of the next financial year (confirm with the CA)</Note>
    </div>
  );
}
