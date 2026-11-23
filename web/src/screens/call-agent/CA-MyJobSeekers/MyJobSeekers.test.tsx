import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { apiError, mockApi, renderScreen, signInAs } from '../../../test/utils';
import { listPage, seeker } from '../_lists/fixtures';
import MyJobSeekers from './index';

const path = { portal: 'call-agent' as const, path: '/call-agent/my/job-seekers' };

const rows = () => [
  seeker(),
  seeker({ id: 'js2', code: 'JS-00102', name: 'Pooja Nair', row: { status: 'stuck_payment', action: 'payment_link', vacancyId: null, waiting: false, done: false, group: 'needs_action' } }),
  seeker({ id: 'js5', code: 'JS-00105', name: 'Book Me', status: 'active', guarantee: { day: 3, days: 30, endsAt: '2026-12-08T00:00:00Z' }, row: { status: 'active', action: 'book_interview', vacancyId: 'vac9', waiting: false, done: false, group: 'needs_action' } }),
  seeker({ id: 'js3', code: 'JS-00103', name: 'Waiting Wilson', photoUrl: 'https://files.test/selfie.jpg', row: { status: 'waiting_tl', action: null, vacancyId: null, waiting: true, done: false, group: 'waiting_tl' } }),
  seeker({
    id: 'js4', code: 'JS-00104', name: 'Paid Lakshmi', status: 'active', hits: 2, yearsExperience: 3,
    guarantee: { day: 5, days: 30, endsAt: '2026-12-01T00:00:00Z' }, nextInterviewAt: '2026-11-25T05:00:00Z',
    row: { status: 'interview_booked', action: null, vacancyId: null, waiting: false, done: true, group: 'active' },
  }),
];

describe('My job seekers (call agent console lists, 23 Nov)', () => {
  it('shows each row: photo or initials, bold name, trade · area · experience, one status line, guarantee and next interview', async () => {
    mockApi({ 'GET /call-work/my/job-seekers': listPage(rows()) });
    signInAs('call_agent');
    renderScreen(<MyJobSeekers />, path);
    const ravi = await screen.findByTestId('seeker-row-JS-00101');
    expect(within(ravi).getByText('Ravi Kumar').tagName).toBe('B');
    expect(within(ravi).getByTestId('row-initials')).toHaveTextContent('RK');
    expect(within(ravi).getByText('Cook · Bommanahalli · 1 yr')).toBeInTheDocument();
    expect(within(ravi).getByTestId('row-status')).toHaveTextContent('Registration link not sent');
    expect(within(ravi).getByText('JS-00101 · ******4321')).toBeInTheDocument();
    // Tapping the row opens CA04.
    expect(within(ravi).getByRole('link')).toHaveAttribute('href', '/call-agent/people/JS-00101');

    const waiting = screen.getByTestId('seeker-row-JS-00103');
    expect(within(waiting).getByRole('img', { name: 'Photo of Waiting Wilson' })).toHaveAttribute('src', 'https://files.test/selfie.jpg');
    expect(within(waiting).getByTestId('row-waiting')).toBeInTheDocument();
    expect(within(waiting).queryByRole('button')).toBeNull();

    const paid = screen.getByTestId('seeker-row-JS-00104');
    expect(within(paid).getByText(/^Day 5 of 30 · 2 hits · Interview 25 Nov/)).toBeInTheDocument();
    expect(within(paid).getByTestId('row-done')).toHaveTextContent('Done');
    // Book interview opens CA06 for that vacancy.
    expect(within(screen.getByTestId('seeker-row-JS-00105')).getByRole('link', { name: 'Book interview' })).toHaveAttribute(
      'href',
      '/call-agent/interviews/book?person=JS-00105&vacancy=vac9',
    );
    // Needs action first, as the server sends them; no rupee amounts.
    expect(screen.getAllByTestId(/^seeker-row-/).map((r) => r.dataset.testid)).toEqual([
      'seeker-row-JS-00101', 'seeker-row-JS-00102', 'seeker-row-JS-00105', 'seeker-row-JS-00103', 'seeker-row-JS-00104',
    ]);
    expect(document.body.textContent).not.toMatch(/₹/);
    expect(screen.getByRole('button', { name: 'Needs action · 3' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Waiting for Team Lead · 1' })).toBeInTheDocument();
  });

  it('the one button works in place: Send link and Send payment link', async () => {
    const api = mockApi({
      'GET /call-work/my/job-seekers': listPage(rows()),
      'POST /consent/links': { ok: true },
      'POST /job-seekers/js2/resend-payment': { ok: true },
    });
    signInAs('call_agent');
    renderScreen(<MyJobSeekers />, path);
    await userEvent.click(within(await screen.findByTestId('seeker-row-JS-00101')).getByRole('button', { name: 'Send link' }));
    await waitFor(() => expect(api.calls('POST /consent/links')).toHaveLength(1));
    expect(api.calls('POST /consent/links')[0]!.body).toEqual({ jobSeekerId: 'js1' });
    await userEvent.click(within(screen.getByTestId('seeker-row-JS-00102')).getByRole('button', { name: 'Send payment link' }));
    await waitFor(() => expect(api.calls('POST /job-seekers/js2/resend-payment')).toHaveLength(1));
    // The list is read again so the status line follows.
    await waitFor(() => expect(api.calls('GET /call-work/my/job-seekers').length).toBeGreaterThan(1));
  });

  it('shows the server’s refusal on the row', async () => {
    mockApi({
      'GET /call-work/my/job-seekers': listPage(rows()),
      'POST /job-seekers/js2/resend-payment': apiError(409, 'This number is marked do not call'),
    });
    signInAs('call_agent');
    renderScreen(<MyJobSeekers />, path);
    await userEvent.click(within(await screen.findByTestId('seeker-row-JS-00102')).getByRole('button', { name: 'Send payment link' }));
    expect(await within(screen.getByTestId('seeker-row-JS-00102')).findByRole('alert')).toHaveTextContent('This number is marked do not call');
  });

  it('search, filter chips and Load more ask the server', async () => {
    const api = mockApi({
      'GET /call-work/my/job-seekers': ({ url }: { url: URL }) => {
        const offset = Number(url.searchParams.get('offset') ?? 0);
        if (offset === 25) return listPage([seeker({ id: 'js99', code: 'JS-00199', name: 'Second Page' })], { total: 26, counts: { all: 26, needs_action: 26, waiting_tl: 0, active: 0, done: 0 } });
        return listPage(rows(), { total: 26, nextOffset: 25, counts: { all: 26, needs_action: 21, waiting_tl: 1, active: 4, done: 0 } });
      },
    });
    signInAs('call_agent');
    renderScreen(<MyJobSeekers />, path);
    expect(await screen.findByText('5 of 26')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Load more' }));
    expect(await screen.findByText('Second Page')).toBeInTheDocument();
    expect(api.calls('GET /call-work/my/job-seekers').some((c) => c.query.get('offset') === '25')).toBe(true);

    await userEvent.click(screen.getByRole('button', { name: 'Waiting for Team Lead · 1' }));
    await waitFor(() => expect(api.calls('GET /call-work/my/job-seekers').some((c) => c.query.get('filter') === 'waiting_tl')).toBe(true));
    expect(screen.getByRole('button', { name: 'Waiting for Team Lead · 1' })).toHaveAttribute('aria-pressed', 'true');

    await userEvent.type(screen.getByLabelText('Search my list'), 'Ravi');
    await waitFor(() => expect(api.calls('GET /call-work/my/job-seekers').some((c) => c.query.get('q') === 'Ravi')).toBe(true));
  });

  it('empty list and an error with retry', async () => {
    let fail = true;
    mockApi({ 'GET /call-work/my/job-seekers': () => (fail ? apiError(500, 'Internal server error') : listPage([])) });
    signInAs('call_agent');
    renderScreen(<MyJobSeekers />, path);
    const retry = await screen.findByRole('button', { name: /try again/i });
    fail = false;
    await userEvent.click(retry);
    expect(await screen.findByText(/No job seekers of yours yet/)).toBeInTheDocument();
  });
});

describe('My job seekers at phone width', () => {
  it('the sidebar folds into the menu button, which lists the three pages; the rows wrap (no fixed widths)', async () => {
    mockApi({ 'GET /call-work/my/job-seekers': listPage(rows()) });
    signInAs('call_agent');
    renderScreen(<MyJobSeekers />, path);
    await screen.findByTestId('seeker-row-JS-00101');
    await userEvent.click(screen.getByRole('button', { name: 'Open menu' }));
    const nav = screen.getByRole('navigation', { name: 'Main' });
    expect(within(nav).getByRole('link', { name: 'My job seekers' })).toHaveAttribute('href', '/call-agent/my/job-seekers');
    expect(within(nav).getByRole('link', { name: 'My businesses' })).toHaveAttribute('href', '/call-agent/my/businesses');
    expect(within(nav).getByRole('link', { name: 'My referral partners' })).toHaveAttribute('href', '/call-agent/my/referral-partners');
    // Rows carry no inline widths: the CSS lets the button drop below the text.
    for (const row of screen.getAllByTestId(/^seeker-row-/)) expect(row.getAttribute('style')).toBeNull();
  });
});
