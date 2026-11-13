import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { mockApi, renderScreen, signInAs } from '../../../test/utils';
import AuditLog, { deviceLabel } from './index';

const downloads = vi.hoisted(() => [] as { name: string; content: string }[]);
vi.mock('../../../lib/csv', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../lib/csv')>();
  return { ...actual, downloadTextFile: (name: string, content: string) => void downloads.push({ name, content }) };
});

const NOW = new Date('2026-11-16T06:30:00Z');
const common = { 'GET /login-codes/pending': [], 'GET /review-flags': [], 'GET /refunds/due': [], 'GET /notifications/bell': { openCount: 0, unseenCount: 0, latest: [], doneToday: [], asOf: NOW.toISOString() } };
const row = (over: Record<string, unknown>) => ({
  id: 'a1',
  code: 'AL-1',
  at: '2026-11-16T05:30:00Z',
  actor: { id: 'm1', code: 'MG-1', name: 'Priya Sharma', role: 'manager' },
  type: 'money',
  action: 'refund.approved',
  entityType: 'placement',
  entityCode: 'PL-00052',
  reason: null,
  change: null,
  ...over,
});

describe('C-Audit Device column', () => {
  // Owner decision 14 Nov: no office networks, so old rows' network labels are no longer shown.
  it('names the device each change was made from, never the old network label, and puts it in the Excel download', async () => {
    downloads.length = 0;
    const rows = [
      row({ device: { id: 'dev-4f2a9c71', name: 'Office PC 1', network: 'office:Jayanagar office' } }),
      row({ id: 'a2', code: 'AL-2', entityCode: 'PL-00091', device: { id: 'phone-a1b2c3', name: 'Login device (android)', network: 'outside_office' } }),
      row({ id: 'a3', code: 'AL-3', entityCode: 'JR-1', actor: { id: 'system', code: null, name: 'System', role: null }, device: { id: null, name: null, network: null } }),
    ];
    const api = mockApi({ ...common, 'GET /ceo/audit': { rows, total: 3, page: 1, pageSize: 50, summary: null } });
    signInAs('ceo');
    renderScreen(<AuditLog />, { portal: 'ceo', path: '/ceo/audit', now: NOW });

    expect(await screen.findByRole('columnheader', { name: /Device/ })).toBeInTheDocument();
    const first = (await screen.findByText('PL-00052')).closest('tr')!;
    expect(within(first).getByText('Office PC 1 · …2a9c71')).toBeInTheDocument();
    expect(within(first).queryByText(/Office network|Jayanagar office/)).not.toBeInTheDocument();
    const second = screen.getByText('PL-00091').closest('tr')!;
    expect(within(second).queryByText(/Outside the office/)).not.toBeInTheDocument();
    expect(within(screen.getByText('JR-1').closest('tr')!).getAllByText('System')).toHaveLength(2); // who, and the device column

    await userEvent.click(screen.getByRole('button', { name: 'Download (Excel)' }));
    await waitFor(() => expect(downloads).toHaveLength(1));
    expect(api.calls('GET /ceo/audit').some((c) => c.query.get('pageSize') === '5000')).toBe(true);
    const [header, line1, line2] = downloads[0].content.split('\r\n');
    expect(header.split(',').at(-1)).toBe('Device');
    expect(line1).toContain('Office PC 1 · …2a9c71');
    expect(line1).not.toContain('Jayanagar office');
    expect(line2).not.toContain('Outside the office');
  });

  it('labels the device', () => {
    expect(deviceLabel({ id: 'abcdef123456', name: 'Laptop', network: null })).toBe('Laptop · …123456');
    expect(deviceLabel({ id: null, name: null, network: 'outside_office' })).toBeNull();
    expect(deviceLabel(null)).toBeNull();
  });
});
