import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { mockApi, renderScreen, signInAs } from '../../../test/utils';
import { NOW } from '../_lib/fixtures';
import FollowUpAnswer from '../CA10b-FollowUpAnswer/index';
import FollowUps from './index';

const row = (over: Record<string, unknown> = {}) => ({
  id: 'f1',
  code: 'FU-00001',
  kind: 'not_selected_day_30',
  status: 'pending',
  answer: null,
  subjectType: 'job_seeker',
  subjectId: 'js5',
  personCode: 'JS-00172',
  name: 'Imran Shaikh',
  maskedPhone: '******0539',
  businessName: 'Green Leaf Café',
  dueAt: '2026-11-11T04:00:00Z',
  missed: false,
  call: { purpose: 'follow_up', relatedType: 'follow_up_task', relatedId: 'f1' },
  ...over,
});

describe('My follow-up calls (CA10)', () => {
  it('lists why and when, marks missed ones, and calls with the follow-up attached', async () => {
    const api = mockApi({
      'GET /call-work/follow-ups': {
        now: NOW.toISOString(),
        rows: [
          row(),
          row({ id: 'f2', kind: 'refund_check', name: 'Asha Kumari', businessName: null, call: { purpose: 'refund_check', relatedType: 'follow_up_task', relatedId: 'f2' } }),
          row({ id: 'f3', kind: 'not_selected_day_90', name: 'Manju S', businessName: 'Sri Sai Hotel', dueAt: '2026-11-10T04:00:00Z', missed: true }),
        ],
      },
      'POST /calls': { callRecordId: 'c7' },
    });
    signInAs('call_agent');
    renderScreen(<FollowUps />, { portal: 'call-agent', path: '/call-agent/follow-ups', now: NOW });
    expect(await screen.findByText('Not selected at Green Leaf Café · day-30 check')).toBeInTheDocument();
    expect(screen.getByText('Refund check before the ₹499 refund')).toBeInTheDocument();
    expect(screen.getByText('Missed yesterday')).toBeInTheDocument();
    await userEvent.click(screen.getAllByRole('button', { name: 'Call' })[0]!);
    await waitFor(() => expect(api.calls('POST /calls')).toHaveLength(1));
    expect(api.calls('POST /calls')[0]!.body).toEqual({ subjectType: 'job_seeker', subjectId: 'js5', purpose: 'follow_up', relatedType: 'follow_up_task', relatedId: 'f1' });
  });

  it('says when nothing is due', async () => {
    mockApi({ 'GET /call-work/follow-ups': { now: NOW.toISOString(), rows: [] } });
    signInAs('call_agent');
    renderScreen(<FollowUps />, { portal: 'call-agent', path: '/call-agent/follow-ups', now: NOW });
    expect(await screen.findByText('No follow-up calls due.')).toBeInTheDocument();
  });
});

describe('Follow-up answer (CA10b)', () => {
  it('saves the answer with the live call attached and warns about bypass', async () => {
    const api = mockApi({
      'GET /call-work/follow-ups/f1': {
        ...row(),
        introducedBusinesses: [{ businessId: 'b1', name: 'Green Leaf Café', introducedAt: '2026-10-08T05:00:00Z', result: 'not_selected', resultAt: '2026-10-10T13:00:00Z', feePaid: false }],
      },
      'GET /call-work/calls/c7': {
        id: 'c7', code: 'CR-7', subjectType: 'job_seeker', subjectId: 'js5', purpose: 'follow_up', relatedType: 'follow_up_task', relatedId: 'f1',
        status: 'answered', answered: true, final: false, startedAt: '2026-11-11T05:58:00Z', answeredAt: '2026-11-11T05:58:20Z', endedAt: null,
        durationSec: null, recorded: true, agentOutcome: null, noAnswer: null, next: null,
      },
      'POST /follow-up-tasks/f1/complete': { ok: true },
    });
    signInAs('call_agent');
    renderScreen(<FollowUpAnswer />, { portal: 'call-agent', path: '/call-agent/follow-ups/f1?call=c7', route: '/call-agent/follow-ups/:id', now: NOW });
    await userEvent.click(await screen.findByLabelText('Working at the business we introduced'));
    expect(screen.getByText(/Green Leaf Café never paid a fee for Imran/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Save answer' }));
    await waitFor(() => expect(api.calls('POST /follow-up-tasks/f1/complete')).toHaveLength(1));
    expect(api.calls('POST /follow-up-tasks/f1/complete')[0]!.body).toEqual({ callRecordId: 'c7', answer: 'working_at_introduced_business', answerBusinessId: 'b1' });
  });
});
