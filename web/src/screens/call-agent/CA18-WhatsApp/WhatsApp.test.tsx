import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { apiError, mockApi, renderScreen, signInAs } from '../../../test/utils';
import { NOW } from '../_lib/fixtures';
import { draftKey, readDraft } from '../_registration/useDraft';
import WhatsAppTab from './index';
import { SendOnWhatsAppButton } from './SendOnWhatsApp';

const row = (over: Record<string, unknown> = {}) => ({
  id: 'w1',
  name: 'Ravi Kumar',
  subjectType: 'job_seeker',
  subjectId: 'js1',
  subjectCode: 'JS-00012',
  isNew: false,
  phone: '******3210',
  status: 'open',
  outcome: null,
  lastMessage: { text: 'Any update on my job?', direction: 'in', at: '2026-11-11T05:00:00Z' },
  lastInboundAt: '2026-11-11T05:00:00Z',
  waitingSince: '2026-11-11T05:00:00Z',
  waitingWorkMinutes: 18,
  windowOpen: true,
  windowEndsAt: '2026-11-12T05:00:00Z',
  assignedTo: { id: 'staff-ca', code: 'CA-0042', name: 'Deepa Nair' },
  autoReplied: false,
  ...over,
});

const thread = (over: Record<string, unknown> = {}) => ({
  id: 'w1',
  name: 'Ravi Kumar',
  profileName: 'Ravi',
  phone: '******3210',
  person: { type: 'job_seeker', id: 'js1', code: 'JS-00012', name: 'Ravi Kumar' },
  status: 'open',
  outcome: null,
  outcomeNote: null,
  waitingSince: '2026-11-11T05:00:00Z',
  waitingWorkMinutes: 18,
  windowOpen: true,
  windowEndsAt: '2026-11-12T05:00:00Z',
  assignedTo: { id: 'staff-ca', code: 'CA-0042', name: 'Deepa Nair' },
  canAct: true,
  canTake: false,
  links: { registration: true, agreement: false, referral_terms: false },
  templates: [{ name: 'whatsapp_follow_up', label: 'Continue the conversation (after 24 hours)', text: 'Hi Ravi, this is Laboura replying…' }],
  outcomes: ['registered', 'call_booked', 'answered_question', 'not_interested', 'wrong_number', 'spam'],
  messages: [
    { id: 'm1', direction: 'in', kind: 'text', text: 'Any update on my job?', templateName: null, status: 'received', at: '2026-11-11T05:00:00Z', by: null },
  ],
  ...over,
});

const render = (path = '/call-agent/whatsapp') => renderScreen(<WhatsAppTab />, { portal: 'call-agent', path, route: '/call-agent/whatsapp', now: NOW });

describe('WhatsApp tab (CA18, rev 202)', () => {
  it('lists my conversations with how long they waited, opens the thread and replies inside the window', async () => {
    const api = mockApi({
      'GET /whatsapp/conversations': { rows: [row(), row({ id: 'w2', name: null, subjectCode: null, isNew: true, phone: '******9911', waitingSince: null, autoReplied: false })] },
      'GET /whatsapp/conversations/w1': thread(),
      'POST /whatsapp/conversations/w1/reply': { sent: true },
      'POST /whatsapp/conversations/w1/send-link': { sent: true, sentBy: 'whatsapp' },
      'POST /calls': { callRecordId: 'c9' },
    });
    signInAs('call_agent');
    render();
    expect(await screen.findByText('Ravi Kumar')).toBeInTheDocument();
    expect(screen.getByText('Waiting 18 min')).toBeInTheDocument();
    expect(screen.getByText('New contact ···9911')).toBeInTheDocument();
    expect(screen.getByText('Answered')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /Ravi Kumar/ }));
    expect(await screen.findByRole('link', { name: 'Open JS-00012' })).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText('Your reply'), 'I will call you in 10 minutes');
    await userEvent.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(api.calls('POST /whatsapp/conversations/w1/reply')).toHaveLength(1));
    expect(api.calls('POST /whatsapp/conversations/w1/reply')[0]!.body).toEqual({ text: 'I will call you in 10 minutes' });

    await userEvent.click(screen.getByRole('button', { name: 'Send registration link' }));
    await waitFor(() => expect(api.calls('POST /whatsapp/conversations/w1/send-link')[0]!.body).toEqual({ kind: 'registration' }));
    await userEvent.click(screen.getByRole('button', { name: /Call now/ }));
    await waitFor(() => expect(api.calls('POST /calls')[0]!.body).toEqual({ subjectType: 'job_seeker', subjectId: 'js1', purpose: 'general' }));
  });

  it('after 24 hours offers only templates, and closes with an outcome', async () => {
    const api = mockApi({
      'GET /whatsapp/conversations': { rows: [row({ windowOpen: false })] },
      'GET /whatsapp/conversations/w1': thread({ windowOpen: false }),
      'POST /whatsapp/conversations/w1/template': { sent: true },
      'POST /whatsapp/conversations/w1/outcome': { closed: true },
    });
    signInAs('call_agent');
    render('/call-agent/whatsapp?c=w1');
    expect(await screen.findByText('More than 24 hours since their last message: send a template.')).toBeInTheDocument();
    expect(screen.queryByLabelText('Your reply')).not.toBeInTheDocument();
    await userEvent.selectOptions(screen.getByLabelText('Send a template'), 'whatsapp_follow_up');
    await userEvent.click(screen.getByRole('button', { name: 'Send template' }));
    await waitFor(() => expect(api.calls('POST /whatsapp/conversations/w1/template')[0]!.body).toEqual({ template: 'whatsapp_follow_up' }));

    await userEvent.selectOptions(screen.getByLabelText('Close with an outcome'), 'call_booked');
    await userEvent.type(screen.getByLabelText('Note (optional)'), 'Call at 4 PM');
    await userEvent.click(screen.getByRole('button', { name: 'Save and close' }));
    await waitFor(() => expect(api.calls('POST /whatsapp/conversations/w1/outcome')[0]!.body).toEqual({ outcome: 'call_booked', note: 'Call at 4 PM' }));
  });

  it('a new person: Call now by conversation id; "Register as… Job seeker" starts the form from the server prefill (never the number)', async () => {
    const api = mockApi({
      'GET /whatsapp/conversations': { rows: [row({ id: 'w2', name: 'Sender', subjectCode: null, isNew: true })] },
      'GET /whatsapp/conversations/w2': thread({ id: 'w2', person: null, name: 'Sender', profileName: 'Sender Name', links: { registration: false, agreement: false, referral_terms: false } }),
      'POST /whatsapp/conversations/w2/call': { callRecordId: 'c1', callCode: 'CL-00001' },
      'POST /whatsapp/conversations/w2/registration-prefill': { name: 'Sender Name', heardFrom: 'whatsapp', maskedPhone: '******9911', prefillRef: 'ref-abc' },
      'POST /whatsapp/conversations/w2/send-link': apiError(409, 'Register them first: this link needs their record.'),
    });
    const staff = signInAs('call_agent');
    localStorage.removeItem(draftKey('job-seeker', staff.id));
    render('/call-agent/whatsapp?c=w2');
    await userEvent.click(await screen.findByRole('button', { name: /Call now/ }));
    await waitFor(() => expect(api.calls('POST /whatsapp/conversations/w2/call')).toHaveLength(1));
    expect(await screen.findByText('Calling: your phone rings first')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Job seeker' }));
    expect(await screen.findByTestId('navigated-away')).toBeInTheDocument();
    expect(readDraft<Record<string, unknown>>(draftKey('job-seeker', staff.id))).toEqual({ name: 'Sender Name', heardFrom: 'whatsapp', prefillRef: 'ref-abc' });
  });

  it('partner leads: register fills "referred by" with the partner, then close with an outcome', async () => {
    const api = mockApi({
      'GET /referral-leads': {
        rows: [{
          id: 'l1', name: 'Manju Nath', phone: '******4455', lookingFor: 'job', area: 'JP Nagar', note: null, source: 'link', status: 'open', outcome: null,
          createdAt: '2026-11-11T04:00:00Z', partner: { id: 'rf1', code: 'RF-00007', name: 'Suresh Babu' }, assignedTo: { id: 'staff-ca', code: 'CA-0042', name: 'Deepa Nair' }, alreadyRegistered: null,
        }],
      },
      'POST /referral-leads/l1/outcome': { closed: true },
      'POST /referral-leads/l1/call': { callRecordId: 'c2', callCode: 'CL-00002' },
      'POST /referral-leads/l1/registration-prefill': { name: 'Manju Nath', heardFrom: 'referral_partner', maskedPhone: '******4455', prefillRef: 'ref-lead', referredBy: { id: 'rf1', code: 'RF-00007', name: 'Suresh Babu' }, lookingFor: 'job' },
    });
    const staff = signInAs('call_agent');
    localStorage.removeItem(draftKey('job-seeker', staff.id));
    render('/call-agent/whatsapp?tab=leads');
    expect(await screen.findByText('Manju Nath')).toBeInTheDocument();
    expect(screen.getByText('From partner RF-00007 · Suresh Babu')).toBeInTheDocument();
    await userEvent.selectOptions(screen.getByLabelText('Close lead'), 'not_interested');
    await userEvent.click(screen.getByRole('button', { name: 'Save and close' }));
    await waitFor(() => expect(api.calls('POST /referral-leads/l1/outcome')[0]!.body).toEqual({ outcome: 'not_interested' }));
    await userEvent.click(screen.getByRole('button', { name: /Call/ }));
    await waitFor(() => expect(api.calls('POST /referral-leads/l1/call')).toHaveLength(1));
    await userEvent.click(screen.getByRole('button', { name: 'Register job seeker' }));
    expect(await screen.findByTestId('navigated-away')).toBeInTheDocument();
    expect(readDraft<Record<string, unknown>>(draftKey('job-seeker', staff.id))).toEqual({
      name: 'Manju Nath', heardFrom: 'referral_partner', prefillRef: 'ref-lead', referredBy: { id: 'rf1', code: 'RF-00007', name: 'Suresh Babu' },
    });
  });
});

describe('Send on WhatsApp (next to Resend)', () => {
  it('says when WhatsApp did not take it and it went by SMS', async () => {
    const api = mockApi({ 'POST /whatsapp/send-link/referral-terms/rf1': { sentBy: 'sms' } });
    signInAs('call_agent');
    renderScreen(<SendOnWhatsAppButton kind="referral_terms" id="rf1" />, { portal: 'call-agent', path: '/call-agent/register/referral/saved' });
    await userEvent.click(await screen.findByRole('button', { name: 'Send on WhatsApp' }));
    expect(await screen.findByText('WhatsApp did not take it, so it went by SMS')).toBeInTheDocument();
    expect(api.calls('POST /whatsapp/send-link/referral-terms/rf1')).toHaveLength(1);
  });
});
