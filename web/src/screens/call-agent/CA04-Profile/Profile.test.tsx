import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { apiError, mockApi, renderScreen, signInAs } from '../../../test/utils';
import { homeData, jobs, NOW, seekerProfile, workItem } from '../_lib/fixtures';
import Profile from './index';

const opts = { portal: 'call-agent' as const, path: '/call-agent/people/JS-00198', route: '/call-agent/people/:id', now: NOW };

describe('Profile (CA04 / CA04b)', () => {
  it('shows why he is on the list, details, glance, best jobs and history, and calls through the calling system', async () => {
    const api = mockApi({
      'GET /call-work/people/JS-00198': seekerProfile(),
      'GET /call-work/people/JS-00198/jobs': jobs,
      'GET /call-work/home': homeData(),
      'POST /calls': { callRecordId: 'c9' },
    });
    signInAs('call_agent');
    renderScreen(<Profile />, opts);
    expect(await screen.findByRole('heading', { level: 2, name: 'Ramesh Gowda' })).toBeInTheDocument();
    expect(screen.getByText(/day 27 of his 30 days/)).toBeInTheDocument();
    expect(screen.getByText('Electrician (4 yrs)')).toBeInTheDocument();
    expect(screen.getByText('Paid · day 27 of 30')).toBeInTheDocument();
    expect(screen.getByText('1 of 3')).toBeInTheDocument();
    expect(screen.getByText('10 AM – 7 PM')).toBeInTheDocument();
    expect(await screen.findByText('Electrician · HSR Layout')).toBeInTheDocument();
    expect(screen.getByText(/Call answered · 3 min · you/)).toBeInTheDocument();
    expect(screen.getByText('₹499 confirmed by the bank')).toBeInTheDocument();
    expect(screen.getByText(/Editing is locked/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '☎ Call Ramesh' }));
    await waitFor(() => expect(api.calls('POST /calls')).toHaveLength(1));
    expect(api.calls('POST /calls')[0]!.body).toEqual({ subjectType: 'job_seeker', subjectId: 'js1', purpose: 'general' });
  });

  it('locks Call outside his best time and says why', async () => {
    mockApi({
      'GET /call-work/people/JS-00198': seekerProfile({ withinBestTimeNow: false, bestTime: { start: '15:00', end: '18:00' } }),
      'GET /call-work/people/JS-00198/jobs': jobs,
      'GET /call-work/home': homeData(),
    });
    signInAs('call_agent');
    renderScreen(<Profile />, opts);
    expect(await screen.findByRole('button', { name: '☎ Call Ramesh' })).toBeDisabled();
    expect(screen.getByText('his time 3 PM – 6 PM')).toBeInTheDocument();
  });

  it('shows the follow-up view: businesses he was introduced to and what happened', async () => {
    mockApi({
      'GET /call-work/people/JS-00198': seekerProfile({
        onList: workItem({ kind: 'follow_up', category: 'follow_ups', priority: false, detail: { followUpKind: 'not_selected_day_30', businessName: 'Green Leaf Café', followUpTaskId: 'f1' } }),
        introductions: [
          { interviewId: 'i1', businessId: 'b1', businessName: 'Green Leaf Café', trade: 'Security guard', slotStartsAt: '2026-10-10T05:00:00Z', offerSentAt: '2026-10-08T05:00:00Z', status: 'completed', result: 'not_selected', feePaid: false },
          { interviewId: 'i2', businessId: 'b2', businessName: 'Metro Mart', trade: 'Night guard', slotStartsAt: '2026-10-28T05:00:00Z', offerSentAt: '2026-10-27T05:00:00Z', status: 'declined', result: null, feePaid: false },
        ],
        followUpDue: { id: 'f1', kind: 'not_selected_day_30', dueAt: '2026-11-11T04:00:00Z' },
      }),
      'GET /call-work/people/JS-00198/jobs': jobs,
      'GET /call-work/home': homeData(),
    });
    signInAs('call_agent');
    renderScreen(<Profile />, { ...opts, path: '/call-agent/people/JS-00198?followUp=f1' });
    expect(await screen.findByText(/Green Leaf Café said “not selected”/)).toBeInTheDocument();
    expect(screen.getByText('Not selected (owner, OTP)')).toBeInTheDocument();
    expect(screen.getByText('He said no · 1 hit')).toBeInTheDocument();
    expect(screen.getByText('Today · day-30 check')).toBeInTheDocument();
  });

  it('shows an error with retry', async () => {
    mockApi({ 'GET /call-work/people/JS-00198': apiError(404, 'No one found'), 'GET /call-work/home': homeData() });
    signInAs('call_agent');
    renderScreen(<Profile />, opts);
    expect(await screen.findByRole('button', { name: /try again/i })).toBeInTheDocument();
  });
});
