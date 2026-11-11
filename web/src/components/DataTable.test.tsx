import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { formatINR } from '../lib/format/money';
import { apiError, renderScreen, signInAs } from '../test/utils';
import { ApiError } from '../lib/api/errors';
import { DataTable, type Column } from './DataTable';

interface Row {
  id: string;
  name: string;
  area: string;
  amount: number;
}
const rows: Row[] = [
  { id: '1', name: 'Sri Sai Hotel', area: 'Koramangala', amount: 1003000 },
  { id: '2', name: 'Metro Mart', area: 'HSR Layout', amount: 944000 },
  { id: '3', name: 'Annapoorna Mess', area: 'Koramangala', amount: 49900 },
];
const columns: Column<Row>[] = [
  { key: 'name', header: 'Business', sortValue: (r) => r.name, filter: 'text', filterValue: (r) => r.name, csv: (r) => r.name },
  { key: 'area', header: 'Area', filter: 'select', filterValue: (r) => r.area, csv: (r) => r.area },
  { key: 'amount', header: 'Amount', cell: (r) => formatINR(r.amount), sortValue: (r) => r.amount, align: 'right', csv: (r) => r.amount / 100 },
];

function names() {
  return screen
    .getAllByRole('row')
    .slice(1)
    .map((r) => within(r).getAllByRole('cell')[0].textContent);
}

describe('DataTable', () => {
  it('sorts by a column and announces the order', async () => {
    signInAs('ceo');
    renderScreen(<DataTable caption="Businesses" columns={columns} rows={rows} rowKey={(r) => r.id} />);
    expect(names()).toEqual(['Sri Sai Hotel', 'Metro Mart', 'Annapoorna Mess']);
    await userEvent.click(screen.getByRole('button', { name: /Amount/ }));
    expect(names()).toEqual(['Annapoorna Mess', 'Metro Mart', 'Sri Sai Hotel']);
    expect(screen.getByRole('columnheader', { name: /Amount/ })).toHaveAttribute('aria-sort', 'ascending');
    await userEvent.click(screen.getByRole('button', { name: /Amount/ }));
    expect(names()[0]).toBe('Sri Sai Hotel');
  });

  it('filters by dropdown and by text', async () => {
    signInAs('ceo');
    renderScreen(<DataTable caption="Businesses" columns={columns} rows={rows} rowKey={(r) => r.id} />);
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Filter by Area' }), 'Koramangala');
    expect(names()).toEqual(['Sri Sai Hotel', 'Annapoorna Mess']);
    await userEvent.type(screen.getByRole('searchbox', { name: 'Filter by Business' }), 'anna');
    expect(names()).toEqual(['Annapoorna Mess']);
  });

  it('pages long lists', async () => {
    signInAs('ceo');
    const many = Array.from({ length: 7 }, (_, i) => ({ id: String(i), name: `B${i}`, area: 'X', amount: i }));
    renderScreen(<DataTable caption="Many" columns={columns} rows={many} rowKey={(r) => r.id} pageSize={3} />);
    expect(screen.getByText('1–3 of 7')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /Next/ }));
    expect(screen.getByText('4–6 of 7')).toBeInTheDocument();
    expect(screen.getByText('Page 2 of 3')).toBeInTheDocument();
  });

  it('shows empty, loading and error states', async () => {
    signInAs('ceo');
    const retry = vi.fn();
    const { rerender } = renderScreen(<DataTable caption="E" columns={columns} rows={[]} rowKey={(r) => r.id} emptyTitle="No businesses yet" />);
    expect(screen.getByText('No businesses yet')).toBeInTheDocument();
    rerender(<DataTable caption="E" columns={columns} rows={undefined} rowKey={(r) => r.id} loading />);
    expect(screen.getByRole('table')).toHaveAttribute('aria-busy', 'true');
    const error = new ApiError({ status: 500, messages: ['x'], requestId: 'req-9' });
    void apiError;
    rerender(<DataTable caption="E" columns={columns} rows={undefined} rowKey={(r) => r.id} error={error} onRetry={retry} />);
    expect(screen.getByRole('alert')).toHaveTextContent('Reference: req-9');
    await userEvent.click(screen.getByRole('button', { name: /Try again/ }));
    expect(retry).toHaveBeenCalled();
  });

  it('offers the download only to roles allowed to export lists', () => {
    signInAs('ceo');
    const { unmount } = renderScreen(<DataTable caption="B" columns={columns} rows={rows} rowKey={(r) => r.id} download="businesses" />);
    expect(screen.getByRole('button', { name: /Download \(Excel\)/ })).toBeInTheDocument();
    unmount();
    signInAs('team_lead');
    renderScreen(<DataTable caption="B" columns={columns} rows={rows} rowKey={(r) => r.id} download="businesses" />);
    expect(screen.queryByRole('button', { name: /Download/ })).not.toBeInTheDocument();
  });
});
