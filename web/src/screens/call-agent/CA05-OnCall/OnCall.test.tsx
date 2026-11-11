import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { mockApi, renderScreen, signInAs } from '../../../test/utils';
import { jobs, NOW, seekerProfile } from '../_lib/fixtures';
import NoAnswer from '../CA05n-NoAnswer/index';
import OnCall from './index';

const call = (over: Record<string, unknown> = {}) => ({
  id: 'c1',
  code: 'CR-00001',
  subjectType: 'job_seeker',
  subjectId: 'js1',
  purpose: 'general',
  relatedType: null,
  relatedId: null,
  status: 'answered',
  answered: true,
  final: false,
  startedAt: '2026-11-11T05:56:00Z',
  answeredAt: '2026-11-11T05:56:48Z',
  endedAt: null,
  durationSec: null,
  recorded: true,
  agentOutcome: null,
  noAnswer: null,
  next: null,
  ...over,
});

const opts = { portal: 'call-agent' as const, path: '/call-agent/calls/c1', route: '/call-agent/calls/:id', now: NOW };
const base = { 'GET /call-work/people/js1': seekerProfile(), 'GET /call-work/people/JS-00198/jobs': jobs };

describe('On a call (CA05)', () => {
  it('shows no answer form until the calling system says the call was answered', async () => {
    mockApi({ ...base, 'GET /call-work/calls/c1': call({ status: 'ringing', answered: false, answeredAt: null }) });
    signInAs('call_agent');
    renderScreen(<OnCall />, opts);
    expect(await screen.findByText(/your phone rings first/)).toBeInTheDocument();
    expect(screen.queryByText('What did he say?')).not.toBeInTheDocument();
  });

  it('"Call me back" needs a date and time and sends them with the outcome', async () => {
    const api = mockApi({ ...base, 'GET /call-work/calls/c1': call(), 'POST /calls/c1/outcome': { callRecordId: 'c1' }, 'GET /call-work/home': { work: { items: [] } } });
    signInAs('call_agent');
    renderScreen(<OnCall />, opts);
    expect(await screen.findByText('Answered — confirmed by the calling system')).toBeInTheDocument();
    await userEvent.click(await screen.findByLabelText('Call me back'));
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('needs a date and a time');
    await userEvent.type(screen.getByLabelText('Time'), '15:30');
    await userEvent.type(screen.getByLabelText('Note (optional)'), 'At work till 3');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(api.calls('POST /calls/c1/outcome')).toHaveLength(1));
    expect(api.calls('POST /calls/c1/outcome')[0]!.body).toEqual({
      agentOutcome: 'callback_requested',
      reason: 'At work till 3',
      callbackAt: '2026-11-11T10:00:00.000Z',
    });
  });

  it('records an offer reply on the interview, with the reason when he turns it down', async () => {
    const api = mockApi({
      ...base,
      'GET /call-work/calls/c1': call({ purpose: 'offer', relatedType: 'interview', relatedId: 'i1' }),
      'POST /interviews/i1/call-reply': { ok: true },
    });
    signInAs('call_agent');
    renderScreen(<OnCall />, opts);
    await userEvent.click(await screen.findByLabelText('Turned down the offer'));
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('reason');
    await userEvent.type(screen.getByLabelText('Reason he turned it down (required)'), 'Night shift');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(api.calls('POST /interviews/i1/call-reply')).toHaveLength(1));
    expect(api.calls('POST /interviews/i1/call-reply')[0]!.body).toEqual({ callRecordId: 'c1', answer: 'rejected_offer', reason: 'Night shift' });
  });

  it('moves to the No answer screen when the call ends unanswered', async () => {
    mockApi({ ...base, 'GET /call-work/calls/c1': call({ status: 'no_answer', answered: false, answeredAt: null, final: true }) });
    signInAs('call_agent');
    renderScreen(<OnCall />, opts);
    await waitFor(() => expect(screen.getByTestId('navigated-away')).toBeInTheDocument());
  });
});

describe('No answer (CA05n)', () => {
  it('shows what was done automatically and offers Call next', async () => {
    mockApi({
      'GET /call-work/people/js1': seekerProfile(),
      'GET /call-work/calls/c1': call({
        status: 'no_answer',
        answered: false,
        answeredAt: null,
        final: true,
        startedAt: '2026-11-11T06:11:30Z',
        endedAt: '2026-11-11T06:12:00Z',
        noAnswer: { endedAt: '2026-11-11T06:12:00Z', whatsapp: { status: 'sent', at: '2026-11-11T06:12:01Z' }, nextTryAt: '2026-11-11T12:45:00Z', missedToday: 1, missedForHit: 2 },
        next: { name: 'Suresh Patil', subjectId: 'js2' },
      }),
    });
    signInAs('call_agent');
    renderScreen(<NoAnswer />, { ...opts, path: '/call-agent/calls/c1/no-answer', route: '/call-agent/calls/:id/no-answer' });
    expect(await screen.findByText('No answer · rang 30 seconds · logged by the calling system at 11:42 AM')).toBeInTheDocument();
    expect(screen.getByText('Sent')).toBeInTheDocument();
    expect(screen.getByText('Today 6:15 PM')).toBeInTheDocument();
    expect(screen.getByText('1 of 2 · the 2nd plus WhatsApp counts as one hit')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '☎ Call next · Suresh Patil' })).toBeInTheDocument();
  });
});
