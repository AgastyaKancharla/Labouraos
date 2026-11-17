import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { apiError, mockApi, renderScreen } from '../../../test/utils';
import ReferralTerms from './index';

const TERMS = { version: '1.0', referralPayoutPaise: 20000, activationFeePaise: 49900, payoutDetailsCoolingHours: 48 };

function renderTerms(path = '/p/referral-terms') {
  return renderScreen(<ReferralTerms />, { portal: 'public', path, route: '/p/referral-terms' });
}

describe('Referral partner terms (public)', () => {
  it('states what earns, when it is paid, payout details and pausing, with amounts from Settings', async () => {
    const api = mockApi({ 'GET /referral-terms': TERMS });
    renderTerms();
    expect(await screen.findByRole('heading', { name: 'Referral partner terms', level: 1 })).toBeInTheDocument();
    for (const heading of ['What earns money', 'When you are paid', 'Your payout details', 'Pausing a partner', 'Calls and your details']) {
      expect(screen.getByRole('heading', { name: heading })).toBeInTheDocument();
    }
    expect(screen.getByText('You earn ₹200 when a job seeker you referred joins a job through Laboura.')).toBeInTheDocument();
    expect(screen.getByText(/pay their ₹499 — only when they join/)).toBeInTheDocument();
    expect(screen.getByText(/then a 48-hour wait before the next payout/)).toBeInTheDocument();
    expect(screen.getByText(/Money you have already earned is still paid/)).toBeInTheDocument();
    expect(api.calls('GET /referral-terms')).toHaveLength(1);
  });

  it('a changed setting changes the page', async () => {
    mockApi({ 'GET /referral-terms': { ...TERMS, referralPayoutPaise: 25000, payoutDetailsCoolingHours: 72 } });
    renderTerms();
    expect(await screen.findByText('You earn ₹250 when a job seeker you referred joins a job through Laboura.')).toBeInTheDocument();
    expect(screen.getByText(/then a 72-hour wait/)).toBeInTheDocument();
  });

  it('is English even from an old ?lang= link, with no language switcher (rev 193)', async () => {
    mockApi({ 'GET /referral-terms': TERMS });
    renderTerms('/p/referral-terms?lang=hi');
    expect(await screen.findByText(/when a job seeker you referred joins a job through Laboura/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'EN' })).not.toBeInTheDocument();
    expect(document.documentElement.lang).toBe('en');
  });

  it('a failed load offers to try again', async () => {
    mockApi({ 'GET /referral-terms': apiError(500, 'Internal server error') });
    renderTerms();
    expect(await screen.findByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });
});
