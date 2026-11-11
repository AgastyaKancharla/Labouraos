import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { TopBar } from '../../../components/TopBar';
import { mockApi, renderScreen, signInAs } from '../../../test/utils';
import Search from './index';

const result = {
  query: 'Ramesh',
  kind: 'name',
  counts: { all: 3, job_seeker: 2, business: 1, referral: 0, vacancy: 0, placement: 0 },
  results: [
    { type: 'job_seeker', id: 'js1', code: 'JS-00198', name: 'Ramesh Gowda', maskedPhone: '******4412', status: 'active', trade: 'Electrician', locality: null, openRef: 'JS-00198', extra: {} },
    { type: 'job_seeker', id: 'js2', code: 'JS-00311', name: 'Ramesh K', maskedPhone: '******9020', status: 'pending_activation', trade: 'Driver', locality: null, openRef: 'JS-00311', extra: {} },
    { type: 'business', id: 'b1', code: 'BZ-00207', name: 'Ramesh Stores', maskedPhone: '******1111', status: 'verified', trade: null, locality: 'Jayanagar', openRef: 'BZ-00207', extra: { openVacancies: 1 } },
  ],
};

describe('Search (CA16)', () => {
  it('lists results by type with masked numbers, links to the profile and offers registration', async () => {
    const api = mockApi({ 'GET /search': result });
    signInAs('call_agent');
    renderScreen(<Search />, { portal: 'call-agent', path: '/call-agent/search?q=Ramesh' });
    expect(await screen.findByRole('link', { name: /Ramesh Gowda/ })).toHaveAttribute('href', '/call-agent/people/JS-00198');
    expect(screen.getByText(/Job seeker · JS-00198 · \*\*\*\*\*\*4412/)).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Job seekers 2' })).toBeInTheDocument();
    expect(screen.getByText('verified · 1 open vacancies')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Job seeker' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('tab', { name: 'Businesses 1' }));
    await waitFor(() => expect(api.calls('GET /search').some((c) => c.query.get('type') === 'business')).toBe(true));
  });

  it('links to the portal’s own detail screens for the CEO', async () => {
    mockApi({ 'GET /search': result });
    signInAs('ceo');
    renderScreen(<Search />, { portal: 'ceo', path: '/ceo/search?q=Ramesh' });
    expect(await screen.findByRole('link', { name: /Ramesh Stores/ })).toHaveAttribute('href', '/ceo/businesses/BZ-00207');
  });

  it('asks for more before searching', async () => {
    const api = mockApi({ 'GET /search': result });
    signInAs('call_agent');
    renderScreen(<Search />, { portal: 'call-agent', path: '/call-agent/search?q=12' });
    expect(await screen.findByText(/at least the last 4 digits/)).toBeInTheDocument();
    expect(api.calls('GET /search')).toHaveLength(0);
  });
});

describe('Search bar suggestions (TopBar, every portal)', () => {
  it('shows matches while typing and opens one with the keyboard', async () => {
    const api = mockApi({ 'GET /search': result });
    signInAs('call_agent');
    renderScreen(<TopBar title="Home" />, { portal: 'call-agent', path: '/call-agent' });
    const box = screen.getByRole('combobox', { name: 'Search people and records' });
    await userEvent.type(box, '4412');
    expect(await screen.findByRole('option', { name: /Ramesh Gowda/ })).toBeInTheDocument();
    expect(api.calls('GET /search')[0]!.query.get('q')).toBe('4412');
    await userEvent.keyboard('{ArrowDown}{Enter}');
    await waitFor(() => expect(screen.getByTestId('navigated-away')).toBeInTheDocument());
  });
});
