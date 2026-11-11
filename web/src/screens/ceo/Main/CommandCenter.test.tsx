import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { apiError, mockApi, renderScreen, signInAs } from '../../../test/utils';
import CommandCenter from './index';

const NOW = new Date('2026-11-11T13:00:00Z'); // Wednesday 11 Nov, 18:30 IST

const payments = [
  { id: 'a1', type: 'activation', status: 'succeeded', amount: 49900, createdAt: '2026-11-03T05:00:00Z', confirmedAt: '2026-11-03T05:05:00Z' },
  { id: 'a2', type: 'activation', status: 'succeeded', amount: 49900, createdAt: '2026-11-04T05:00:00Z', confirmedAt: '2026-11-04T05:05:00Z' },
  {
    id: 'pf1',
    type: 'placement_fee',
    status: 'succeeded',
    amount: 9440_00,
    createdAt: '2026-11-05T05:00:00Z',
    confirmedAt: '2026-11-05T06:00:00Z',
    placement: { placementFee: 8000_00, gstAmount: 1440_00 },
  },
  { id: 'r1', type: 'refund', status: 'succeeded', amount: 49900, createdAt: '2026-11-06T05:00:00Z', paidAt: '2026-11-06T09:00:00Z' },
];

function routes(overrides: Record<string, unknown> = {}) {
  return {
    'GET /payments': ({ url }: { url: URL }) => {
      const type = url.searchParams.get('type');
      if (type === 'referral_payout')
        return [
          { id: 'o1', type, status: 'pending', amount: 20000, createdAt: '2026-11-01T00:00:00Z' },
          { id: 'o2', type, status: 'failed', amount: 20000, createdAt: '2026-11-01T00:00:00Z' },
        ];
      if (type === 'joining_reward') return [{ id: 'o3', type, status: 'approved', amount: 20000, createdAt: '2026-11-01T00:00:00Z' }];
      return payments;
    },
    'GET /refunds/due': [{ id: 'd1', amount: 49900 }, { id: 'd2', amount: 8000_00 }],
    'GET /targets/money-at-risk': { totalAtRiskPaise: 2_495_00, candidatesCount: 5, placementsCount: 0 },
    'GET /login-codes/pending': [],
    'GET /review-flags': [],
    ...overrides,
  };
}

function renderCC() {
  signInAs('ceo');
  return renderScreen(<CommandCenter />, { portal: 'ceo', path: '/ceo', now: NOW });
}

describe('CEO Command Center — top section (Main.dc.html)', () => {
  it('greets the CEO in IST and shows the money row from the API', async () => {
    const api = mockApi(routes());
    renderCC();
    expect(screen.getByRole('heading', { level: 1, name: 'Good evening, Agastya' })).toBeInTheDocument();
    expect(screen.getByText(/Wednesday, 11 Nov 2026 · Bengaluru/)).toBeInTheDocument();
    expect(screen.getByText('Money · November')).toBeInTheDocument();

    expect(await screen.findByTestId('cc-net')).toHaveTextContent('₹8,499'); // 998 + 8,000 − 499
    expect(screen.getByText('Gross ₹8,998 − refunds paid ₹499 · excludes GST')).toBeInTheDocument();
    expect(screen.getByText('Placement fees ₹8,000 · 1')).toBeInTheDocument();
    expect(screen.getByText('Activation fees ₹998 · 2')).toBeInTheDocument();
    expect(await screen.findByTestId('cc-exposure')).toHaveTextContent('₹10,994'); // 8,499 owed + 2,495 at risk
    expect(screen.getByText('Act')).toBeInTheDocument();
    expect(await screen.findByTestId('cc-payouts')).toHaveTextContent('₹400');
    expect(screen.getByText('1 failed')).toBeInTheDocument();
    expect(screen.getByTestId('cc-gst')).toHaveTextContent('₹1,440');

    // Month preset asks for the month with a lookback for late confirmations, in UTC.
    const q = api.calls('GET /payments').find((c) => !c.query.get('type'))!.query;
    expect(q.get('toDate')).toBe('2026-11-11T18:29:59.999Z');
    expect(q.get('fromDate')).toBe('2026-09-01T18:30:00.000Z');
    expect(document.title).toBe('Good evening, Agastya · Laboura');
  });

  it('links each card to its screen', async () => {
    mockApi(routes());
    renderCC();
    await screen.findByTestId('cc-net');
    expect(screen.getByRole('link', { name: /Net revenue/ })).toHaveAttribute('href', '/ceo/reports');
    expect(screen.getByRole('link', { name: /Refund exposure/ })).toHaveAttribute('href', '/ceo/refunds');
    expect(screen.getByRole('link', { name: /Payouts due/ })).toHaveAttribute('href', '/ceo/payments/out');
    expect(screen.getByRole('link', { name: /GST collected/ })).toHaveAttribute('href', '/ceo/payments/gst');
  });

  it('shows skeletons while loading', () => {
    mockApi(routes({ 'GET /payments': () => new Promise(() => {}) }));
    renderCC();
    expect(screen.getByRole('link', { name: /Net revenue/ })).toHaveAttribute('aria-busy', 'true');
  });

  it('shows the empty state when nothing came in', async () => {
    mockApi(routes({ 'GET /payments': [], 'GET /refunds/due': [], 'GET /targets/money-at-risk': { totalAtRiskPaise: 0 } }));
    renderCC();
    expect(await screen.findByTestId('cc-net')).toHaveTextContent('₹0');
    expect(screen.getByText('No money has been received in this period yet.')).toBeInTheDocument();
    expect(screen.queryByText('Act')).not.toBeInTheDocument();
  });

  it('shows an error with the reference and retries', async () => {
    let fail = true;
    mockApi(
      routes({
        'GET /refunds/due': () => (fail ? apiError(500, 'Internal server error', 'req-77') : []),
      }),
    );
    renderCC();
    expect(await screen.findByText('Reference: req-77')).toBeInTheDocument();
    fail = false;
    await userEvent.click(screen.getByRole('button', { name: /Refresh/ }));
    await waitFor(() => expect(screen.getByTestId('cc-exposure')).toHaveTextContent('₹2,495'));
  });

  it('switches period with the presets', async () => {
    const api = mockApi(routes());
    renderCC();
    await screen.findByTestId('cc-net');
    await userEvent.click(screen.getByRole('button', { name: 'Today' }));
    expect(screen.getByText('Money · Today')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId('cc-net')).toHaveTextContent('₹0'));
    const last = api.calls('GET /payments').filter((c) => !c.query.get('type')).at(-1)!.query;
    expect(last.get('toDate')).toBe('2026-11-11T18:29:59.999Z');
  });
});
