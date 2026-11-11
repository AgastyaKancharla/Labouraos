import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '../../../components/Button';
import type { Column } from '../../../components/DataTable';
import { StatGrid, StatTile } from '../../../components/StatTile';
import { StatusPill } from '../../../components/Badge';
import { useToast } from '../../../components/Toast';
import { TopBar } from '../../../components/TopBar';
import { api } from '../../../lib/api/client';
import { formatDateIST, formatDayMonthIST, istStartOfDay } from '../../../lib/format/date';
import { formatINR } from '../../../lib/format/money';
import { periodFor, periodRangeLabel, type Period } from '../../../lib/period';
import { useNow } from '../../../lib/useNow';
import { useScreenPath } from '../../../portals/PortalContext';
import { FilterPanel, PagedTable, SearchField, htmlTable, printDocument, rangeQuery, useCeoList, useDebounced } from '../_kit/kit';
import { PaymentTabs } from '../_kit/tabs';

/** Payments · GST & invoices — design C-Payments-GST.dc.html. */
interface Row {
  id: string;
  code: string;
  invoiceCode: string;
  business: { id: string; code: string; name: string };
  gstin: string | null;
  feePaise: number;
  gstPaise: number;
  totalPaise: number;
  paidAt: string | null;
  status: 'paid' | 'credit_note';
}
interface Summary {
  collectedPaise: number;
  toPayPaise: number;
  creditNotes: number;
  invoices: number;
  due: { gstr1: string; gstr3b: string };
}

export default function PaymentsGst() {
  const to = useScreenPath();
  const navigate = useNavigate();
  const toast = useToast();
  const now = useNow(60_000);
  const [period, setPeriod] = useState<Period>(() => periodFor('month', now));
  const [search, setSearch] = useState('');
  const [printing, setPrinting] = useState(false);
  const q = useDebounced(search);
  const filters = { search: q, ...rangeQuery(period) };
  const list = useCeoList<Row, object, Summary>('/ceo/payments/gst', filters);
  const s = list.query.data?.summary;
  const loading = list.query.isPending;

  const columns: Column<Row>[] = [
    { key: 'inv', header: 'Invoice', cell: (r) => <span className="code">{r.invoiceCode}</span>, csv: (r) => r.invoiceCode },
    { key: 'biz', header: 'Business', cell: (r) => r.business.name, csv: (r) => r.business.name },
    { key: 'gstin', header: 'GSTIN', cell: (r) => (r.gstin ? `${r.gstin.slice(0, 7)}…` : '—'), csv: (r) => r.gstin, hideOnPhone: true },
    { key: 'fee', header: 'Fee', cell: (r) => formatINR(r.feePaise), csv: (r) => r.feePaise / 100, align: 'right' },
    { key: 'gst', header: 'GST 18%', cell: (r) => formatINR(r.gstPaise), csv: (r) => r.gstPaise / 100, align: 'right' },
    { key: 'total', header: 'Total', cell: (r) => formatINR(r.totalPaise), csv: (r) => r.totalPaise / 100, align: 'right', hideOnPhone: true },
    { key: 'date', header: 'Date', cell: (r) => (r.paidAt ? formatDateIST(r.paidAt) : '—'), csv: (r) => r.paidAt },
    { key: 'status', header: 'Status', cell: (r) => (r.status === 'paid' ? <StatusPill tone="good">Paid</StatusPill> : <StatusPill tone="warn">Refunded · credit note</StatusPill>), csv: (r) => r.status },
  ];

  const allInvoices = async () => {
    setPrinting(true);
    try {
      const all = await api.get<{ rows: Row[] }>('/ceo/payments/gst', { query: { ...filters, page: 1, pageSize: 5000 } });
      const ok = printDocument(
        `Laboura invoices ${periodRangeLabel(period)}`,
        `<h1>Placement fee invoices · ${periodRangeLabel(period)}</h1>` +
          htmlTable(
            ['Invoice', 'Business', 'GSTIN', 'Fee', 'GST 18%', 'Total', 'Date'],
            all.rows.map((r) => [r.invoiceCode, r.business.name, r.gstin, formatINR(r.feePaise), formatINR(r.gstPaise), formatINR(r.totalPaise), r.paidAt ? formatDateIST(r.paidAt) : '']),
          ),
      );
      if (ok) toast.success(`${all.rows.length} invoices ready — choose "Save as PDF".`);
      else toast.error('Allow pop-ups for this site to save the PDF.');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not build the invoices');
    } finally {
      setPrinting(false);
    }
  };

  return (
    <div className="lb-page">
      <TopBar
        back={{ to: to('Main'), label: 'Command Center' }}
        title="Payments"
        subtitle={`GST collected on placement fees and every invoice. Showing ${periodRangeLabel(period)}.`}
        period={period}
        onPeriodChange={setPeriod}
      />
      <PaymentTabs />
      <StatGrid>
        <StatTile label="GST collected" value={s ? formatINR(s.collectedPaise) : '—'} tone="gold" loading={loading} />
        <StatTile label={`To pay after ${s?.creditNotes ?? 0} credit note${s?.creditNotes === 1 ? '' : 's'}`} value={s ? formatINR(s.toPayPaise) : '—'} tone="orange" loading={loading} />
        <StatTile label="Invoices" value={s?.invoices ?? '—'} tone="royal" loading={loading} />
        <StatTile
          label={s ? `GSTR-1 due · GSTR-3B ${formatDayMonthIST(istStartOfDay(s.due.gstr3b))}` : 'GSTR-1 due'}
          value={s ? formatDayMonthIST(istStartOfDay(s.due.gstr1)) : '—'}
          tone="cyan"
          loading={loading}
        />
      </StatGrid>
      <FilterPanel>
        <SearchField value={search} onChange={setSearch} placeholder="Invoice number, business or GSTIN" />
      </FilterPanel>
      <PagedTable
        list={list}
        columns={columns}
        rowKey={(r) => r.id}
        caption="GST invoices"
        download="gst-ledger"
        onOpen={(r) => navigate(to('C-Placement', { id: r.id }))}
        emptyTitle="No invoices in this period."
        note="Invoices are created automatically when a placement fee is paid and emailed to the business's billing email. ₹499 activation fees carry no GST (decided). Filing dates to be confirmed with the CA."
      />
      <div className="ceo-actions">
        <Button onClick={() => void allInvoices()} loading={printing}>
          Download all invoices (PDF)
        </Button>
      </div>
    </div>
  );
}
