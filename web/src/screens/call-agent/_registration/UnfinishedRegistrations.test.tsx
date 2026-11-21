import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { mockApi, renderScreen, signInAs } from '../../../test/utils';
import RegisterJobSeeker from '../CA08-Register/index';
import { EMPTY_FORM, type JobSeekerForm } from '../CA08-Register/payload';

/** Unfinished registrations (Master Guide rev 204, 21 Nov): server drafts, banner, Resume / Discard. */
const NOW = new Date('2026-11-21T05:30:00Z');
const housekeeping = { id: 't1', name: 'Housekeeping', salaryMinPaise: 1600000, salaryMaxPaise: 2300000, minimumWageLevel: 'unskilled', legalMinimumPaise: 2340000 };
const draftForm: JobSeekerForm = {
  ...EMPTY_FORM,
  name: 'Kavya Reddy',
  mobile: '9845012345',
  dateOfBirth: '1998-03-14',
  gender: 'female',
};
const serverDraft = (over: Record<string, unknown> = {}) => ({
  id: 'd-1', kind: 'job_seeker', name: 'Kavya Reddy', phone: '+919845012345', phoneVerified: true, data: draftForm, updatedAt: '2026-11-21T05:00:00Z', ...over,
});
const base = {
  'GET /trades': [housekeeping],
  'GET /screens/call-registration/options': { city: 'Bengaluru', areas: [{ name: 'JP Nagar', pincode: '560078', latitude: 12.9063, longitude: 77.5857 }] },
};

function Home() {
  return <h1>Console home</h1>;
}

describe('Unfinished registrations in the call agent console (21 Nov)', () => {
  it('shows "Unfinished registration — <name> · Resume / Discard" at the top; Discard asks once and deletes it', async () => {
    const user = userEvent.setup();
    let drafts = [serverDraft(), serverDraft({ id: 'd-2', kind: 'referral', name: null, phone: null, phoneVerified: false, data: { name: '' } })];
    const api = mockApi({
      ...base,
      'GET /registration-drafts': () => ({ drafts }),
      'DELETE /registration-drafts': ({ url }: { url: URL }) => {
        drafts = drafts.filter((d) => d.kind !== url.searchParams.get('kind'));
        return { deleted: 1 };
      },
    });
    signInAs('call_agent');
    renderScreen(<Home />, { portal: 'call-agent', path: '/call-agent', now: NOW });
    const banner = await screen.findByTestId('unfinished-registrations');
    expect(banner).toHaveTextContent('Unfinished registration — Kavya Reddy');
    expect(banner).toHaveTextContent('Unfinished registration — no name yet');
    const discards = screen.getAllByRole('button', { name: 'Discard' });
    await user.click(discards[0]!);
    expect(await screen.findByRole('dialog', { name: 'Discard this unfinished registration?' })).toBeInTheDocument();
    expect(api.calls('DELETE /registration-drafts')).toHaveLength(0);
    await user.click(screen.getByRole('button', { name: 'Yes, discard' }));
    await waitFor(() => expect(api.calls('DELETE /registration-drafts')).toHaveLength(1));
    expect(api.calls('DELETE /registration-drafts')[0]!.query.get('kind')).toBe('job_seeker');
    await waitFor(() => expect(screen.queryByText(/Kavya Reddy/)).not.toBeInTheDocument());
    expect(screen.getByText(/no name yet/)).toBeInTheDocument();
  });

  it('Resume opens the form with every field and the number still checked; Save sends "draft:job_seeker"', async () => {
    const user = userEvent.setup();
    mockApi({ ...base, 'GET /registration-drafts': { drafts: [serverDraft()] }, 'PUT /registration-drafts': serverDraft() });
    signInAs('call_agent');
    renderScreen(<Home />, { portal: 'call-agent', path: '/call-agent', now: NOW });
    await user.click(await screen.findByRole('button', { name: 'Resume' }));
    expect(JSON.parse(localStorage.getItem('laboura.draft.job-seeker.staff-ca')!)).toMatchObject({ name: 'Kavya Reddy', mobile: '9845012345' });
    expect(sessionStorage.getItem('laboura.draft.verified.job_seeker.staff-ca')).toBe('+919845012345');
  });

  it('the resumed form opens with the mobile checked, and the save uses the draft’s OTP check', async () => {
    const user = userEvent.setup();
    const api = mockApi({ ...base, 'GET /registration-drafts': { drafts: [] }, 'PUT /registration-drafts': serverDraft(), 'POST /job-seekers': { status: 400, body: { statusCode: 400, message: 'stop here' } } });
    signInAs('call_agent');
    localStorage.setItem('laboura.draft.job-seeker.staff-ca', JSON.stringify(draftForm));
    sessionStorage.setItem('laboura.draft.verified.job_seeker.staff-ca', '+919845012345');
    renderScreen(<RegisterJobSeeker />, { portal: 'call-agent', path: '/call-agent/register/job-seeker', now: NOW });
    expect(await screen.findByText('✓ Verified')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save job seeker' })).toBeEnabled();
    expect(screen.getByLabelText(/^Full name/)).toHaveValue('Kavya Reddy');
    // The form is not complete, so nothing is posted; the check is what matters here.
    await user.click(screen.getByRole('button', { name: 'Save job seeker' }));
    expect(api.calls('POST /job-seekers')).toHaveLength(0);
  });

  it('autosaves the form on the server as the agent types (call agent console only)', async () => {
    const user = userEvent.setup();
    const api = mockApi({ ...base, 'GET /registration-drafts': { drafts: [] }, 'PUT /registration-drafts': serverDraft({ phoneVerified: false }) });
    signInAs('call_agent');
    renderScreen(<RegisterJobSeeker />, { portal: 'call-agent', path: '/call-agent/register/job-seeker', now: NOW });
    await user.type(await screen.findByLabelText(/^Full name/), 'Ravi');
    await waitFor(() => expect(api.calls('PUT /registration-drafts').length).toBeGreaterThan(0), { timeout: 3000 });
    const last = api.calls('PUT /registration-drafts').at(-1)!.body as { kind: string; name: string; data: { name: string }; otpRequestId: string | null };
    expect(last).toMatchObject({ kind: 'job_seeker', name: 'Ravi', data: { name: 'Ravi' }, otpRequestId: null });
  });

  it('the CEO’s copy of the form (another portal) saves no server draft', async () => {
    const user = userEvent.setup();
    const api = mockApi({ ...base, 'PUT /registration-drafts': serverDraft() });
    signInAs('ceo');
    renderScreen(<RegisterJobSeeker />, { portal: 'ceo', path: '/ceo/register/job-seeker', now: NOW });
    await user.type(await screen.findByLabelText(/^Full name/), 'Ravi');
    await new Promise((r) => setTimeout(r, 1200));
    expect(api.calls('PUT /registration-drafts')).toHaveLength(0);
    expect(api.calls('GET /registration-drafts')).toHaveLength(0);
  });
});
