import { act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { sessionStore } from '../../auth/session';
import { DEVICE_ID_KEY } from '../../auth/device';
import { apiError, fakeJwt, mockApi, renderScreen } from '../../test/utils';
import StaffSignIn from './StaffSignIn';

function tokenResponse(role: string, code: string, extra: Record<string, unknown> = {}) {
  return {
    accessToken: fakeJwt({ role }),
    sessionId: 's1',
    staff: { id: `id-${code}`, code, name: 'Agastya Kancharla', email: null, role },
    ...extra,
  };
}

async function enterPassword(code: string) {
  await userEvent.type(screen.getByLabelText(/Staff code/), code);
  await userEvent.type(screen.getByLabelText(/Password/), 'password12');
  await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
}

function renderSignIn() {
  return renderScreen(<StaffSignIn />, { path: '/login' });
}

describe('Staff sign in', () => {
  it('sits on the brand gradient panel (Command Center colours) with the same form', () => {
    mockApi({});
    renderSignIn();
    expect(screen.getByRole('main').parentElement).toHaveClass('lb-center', 'lb-signin');
    expect(screen.getByRole('heading', { name: 'Staff sign in' })).toBeInTheDocument();
  });

  it('Forgot password (S5): staff code → ask your senior → reset code + new password twice (+ authenticator code)', async () => {
    const answer = { status: 'requested', message: 'If that staff code belongs to an active account, your request is now with your seniors.', resetRequestId: 'rr-1', resetRequestProof: 'rp-1', expiresAt: new Date(Date.now() + 900_000).toISOString() };
    const api = mockApi({
      'POST /auth/password-reset/request': answer,
      'POST /auth/password-reset/complete': { success: true, code: 'TL-0003', signInAt: 'web' },
    });
    renderSignIn();
    await userEvent.click(screen.getByRole('button', { name: 'Forgot password?' }));
    expect(screen.getByRole('heading', { name: 'Forgot password' })).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText(/Staff code/), 'TL-0003');
    await userEvent.click(screen.getByRole('button', { name: 'Ask for a reset code' }));
    expect(await screen.findByRole('heading', { name: 'Ask your senior for the reset code' })).toBeInTheDocument();
    expect(api.calls('POST /auth/password-reset/request')[0].body).toEqual({ staffCode: 'TL-0003', deviceId: localStorage.getItem(DEVICE_ID_KEY), app: 'office' });
    expect(screen.getByText(/Request ends in 1[45]:\d\d/)).toBeInTheDocument();
    await userEvent.click(screen.getAllByRole('textbox')[0]);
    await userEvent.paste('123456');
    await userEvent.type(screen.getByLabelText(/^New password/), 'new-pass-1');
    await userEvent.type(screen.getByLabelText(/Type the new password again/), 'new-pass-1');
    await userEvent.type(screen.getByLabelText(/Code from your authenticator app/), '654321');
    await userEvent.click(screen.getByRole('button', { name: 'Set new password' }));
    expect(await screen.findByTestId('reset-done')).toHaveTextContent('Sign in with staff code TL-0003 and your new password');
    expect(api.calls('POST /auth/password-reset/complete')[0].body).toEqual({
      resetRequestId: 'rr-1',
      resetRequestProof: 'rp-1',
      code: '123456',
      newPassword: 'new-pass-1',
      confirmPassword: 'new-pass-1',
      totpCode: '654321',
      deviceId: localStorage.getItem(DEVICE_ID_KEY),
      app: 'office',
    });
    // No session from a reset: they sign in with the new password.
    expect(sessionStore.get()).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Go to sign in' }));
    expect(screen.getByRole('heading', { name: 'Staff sign in' })).toBeInTheDocument();
  });

  it('Forgot password: two different passwords are caught before anything is sent', async () => {
    const api = mockApi({
      'POST /auth/password-reset/request': { status: 'requested', message: 'x', resetRequestId: 'rr-2', resetRequestProof: 'rp-2', expiresAt: new Date(Date.now() + 900_000).toISOString() },
    });
    renderSignIn();
    await userEvent.click(screen.getByRole('button', { name: 'Forgot password?' }));
    await userEvent.type(screen.getByLabelText(/Staff code/), 'CA-0042');
    await userEvent.click(screen.getByRole('button', { name: 'Ask for a reset code' }));
    await screen.findByRole('heading', { name: 'Ask your senior for the reset code' });
    await userEvent.click(screen.getAllByRole('textbox')[0]);
    await userEvent.paste('123456');
    await userEvent.type(screen.getByLabelText(/^New password/), 'new-pass-1');
    await userEvent.type(screen.getByLabelText(/Type the new password again/), 'new-pass-2');
    await userEvent.click(screen.getByRole('button', { name: 'Set new password' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('The two passwords are not the same.');
    expect(api.calls('POST /auth/password-reset/complete')).toHaveLength(0);
  });

  it('CEO: password, then the authenticator code as a second step (M01 → M02)', async () => {
    const api = mockApi({
      'POST /auth/login': ({ body }: { body: { totpCode?: string } }) =>
        body.totpCode ? tokenResponse('ceo', 'CEO-0001') : apiError(401, 'TOTP 2FA code is required'),
    });
    renderSignIn();
    expect(screen.getByRole('heading', { name: 'Staff sign in' })).toBeInTheDocument();
    await enterPassword('CEO-0001');
    expect(await screen.findByRole('heading', { name: 'Authenticator code' })).toBeInTheDocument();
    await userEvent.click(screen.getAllByRole('textbox')[0]);
    await userEvent.paste('264019');
    await waitFor(() => expect(sessionStore.get()?.staff.role).toBe('ceo'));
    const calls = api.calls('POST /auth/login');
    // This is the office app: every sign-in says so (each app accepts only its own roles).
    expect(calls[1].body).toMatchObject({ staffCode: 'CEO-0001', password: 'password12', totpCode: '264019', app: 'office' });
    expect((calls[0].body as { deviceId: string }).deviceId).toBe(localStorage.getItem(DEVICE_ID_KEY));
    expect(await screen.findByTestId('navigated-away')).toBeInTheDocument();
  });

  it('Field agent: refused at the first step and pointed to Laboura Field at its real address', async () => {
    const api = mockApi({
      'POST /auth/login': apiError(401, 'Field agents use Laboura Field: https://field.laboura.com/'),
    });
    renderSignIn();
    await enterPassword('FA-0007');
    const notice = await screen.findByTestId('field-agent-refusal');
    expect(notice).toHaveTextContent('Use the Laboura Field app');
    expect(screen.getByRole('link', { name: 'Open Laboura Field' })).toHaveAttribute('href', 'https://field.laboura.com/');
    // No login code step and no session.
    expect(screen.queryByRole('heading', { name: 'Ask your Team Lead for your code' })).toBeNull();
    expect(api.calls('POST /auth/login/verify-code')).toHaveLength(0);
    expect(sessionStore.get()).toBeNull();
  });

  it('Call agent: password, then the code the Team Lead reads out (CA01 → CA02)', async () => {
    const api = mockApi({
      'POST /auth/login': { status: 'awaiting_code', loginRequestId: 'lr-1', loginRequestProof: 'proof-1', expiresAt: new Date(Date.now() + 300_000).toISOString() },
      'POST /auth/login/verify-code': tokenResponse('call_agent', 'CA-0042'),
    });
    renderSignIn();
    await enterPassword('CA-0042');
    expect(await screen.findByRole('heading', { name: 'Ask your Team Lead for your code' })).toBeInTheDocument();
    expect(screen.getByText(/Code request expires in [45]:\d\d/)).toBeInTheDocument();
    await userEvent.click(screen.getAllByRole('textbox')[0]);
    await userEvent.paste('481906');
    await waitFor(() => expect(sessionStore.get()?.staff.role).toBe('call_agent'));
    // The code works only for this device and this sign-in: both go back with it.
    expect(api.calls('POST /auth/login/verify-code')[0].body).toEqual({
      loginRequestId: 'lr-1',
      code: '481906',
      deviceId: localStorage.getItem(DEVICE_ID_KEY),
      loginRequestProof: 'proof-1',
      app: 'office',
    });
  });

  it('Team Lead: password, then their own authenticator code — no login code (rev 174–175)', async () => {
    const api = mockApi({
      'POST /auth/login': ({ body }: { body: { totpCode?: string } }) =>
        body.totpCode ? tokenResponse('team_lead', 'TL-0003') : apiError(401, 'TOTP 2FA code is required'),
    });
    renderSignIn();
    await enterPassword('TL-0003');
    expect(await screen.findByRole('heading', { name: 'Authenticator code' })).toBeInTheDocument();
    await userEvent.click(screen.getAllByRole('textbox')[0]);
    await userEvent.paste('112233');
    await waitFor(() => expect(sessionStore.get()?.staff.role).toBe('team_lead'));
    expect(api.calls('POST /auth/login/verify-code')).toHaveLength(0);
  });

  it('an expired code request asks to start again', async () => {
    mockApi({ 'POST /auth/login': { status: 'awaiting_code', loginRequestId: 'lr-3', expiresAt: new Date(Date.now() - 1000).toISOString() } });
    renderSignIn();
    await enterPassword('CA-0042');
    expect(await screen.findByText(/This code request has expired/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Start again' }));
    expect(screen.getByRole('heading', { name: 'Staff sign in' })).toBeInTheDocument();
  });

  it('shows the API reason for a refused login (locked, device)', async () => {
    mockApi({ 'POST /auth/login': apiError(401, 'This device is waiting for approval by your Team Lead') });
    renderSignIn();
    await enterPassword('CA-0042');
    expect(await screen.findByRole('alert')).toHaveTextContent('This device is waiting for approval by your Team Lead');
    expect(sessionStore.get()).toBeNull();
  });

  it('first login (S4): the temporary password opens set-up — selfie skipped when on file, new password twice, authenticator QR + first code, then sign in', async () => {
    const setup = {
      status: 'setup_required',
      setupTicket: 'ticket-1',
      expiresAt: new Date(Date.now() + 900_000).toISOString(),
      staff: { code: 'FIN-0001', name: 'Priya S', role: 'finance' },
      photoRequired: false,
      authenticatorSetupRequired: true,
      authenticatorCodeRequired: false,
      passwordRules: { minLength: 8, maxBytes: 72 },
      signInAt: 'web',
    };
    const api = mockApi({
      'POST /auth/login': setup,
      'POST /auth/setup/authenticator': { secret: 'JBSWY3DPEHPK3PXP', otpauthUrl: 'otpauth://totp/Laboura:FIN-0001?secret=JBSWY3DPEHPK3PXP' },
      'POST /auth/setup/complete': { success: true, code: 'FIN-0001', signInAt: 'web' },
    });
    renderSignIn();
    await userEvent.type(screen.getByLabelText(/Staff code/), 'FIN-0001');
    await userEvent.type(screen.getByLabelText(/Password/), 'k7m4-q2px');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByRole('heading', { name: 'Welcome, Priya S' })).toBeInTheDocument();
    expect(sessionStore.get()).toBeNull();
    // The temporary password again (any case, any dash) is refused before anything is sent.
    await userEvent.type(screen.getByLabelText(/^New password/), 'K7M4Q2PX');
    await userEvent.type(screen.getByLabelText(/Type the new password again/), 'K7M4Q2PX');
    await userEvent.click(screen.getByRole('button', { name: 'Next: authenticator' }));
    expect(await screen.findByText('Choose a password that is different from the temporary password.')).toBeInTheDocument();
    await userEvent.clear(screen.getByLabelText(/^New password/));
    await userEvent.clear(screen.getByLabelText(/Type the new password again/));
    await userEvent.type(screen.getByLabelText(/^New password/), 'my-own-pass');
    await userEvent.type(screen.getByLabelText(/Type the new password again/), 'my-own-pass');
    await userEvent.click(screen.getByRole('button', { name: 'Next: authenticator' }));
    expect(await screen.findByRole('heading', { name: 'Set up your authenticator' })).toBeInTheDocument();
    expect(screen.getByText(/JBSWY3DPEHPK3PXP/)).toBeInTheDocument();
    expect(api.calls('POST /auth/setup/authenticator')[0].body).toEqual({ setupTicket: 'ticket-1', deviceId: localStorage.getItem(DEVICE_ID_KEY) });
    await userEvent.click(screen.getAllByRole('textbox')[0]);
    await userEvent.paste('123456');
    await userEvent.click(screen.getByRole('button', { name: 'Set password' }));
    expect(await screen.findByTestId('setup-done')).toHaveTextContent('Sign in with staff code FIN-0001 and your new password.');
    expect(api.calls('POST /auth/setup/complete')[0].body).toEqual({
      setupTicket: 'ticket-1',
      newPassword: 'my-own-pass',
      confirmPassword: 'my-own-pass',
      totpCode: '123456',
      deviceId: localStorage.getItem(DEVICE_ID_KEY),
    });
    expect(sessionStore.get()).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Go to sign in' }));
    expect(screen.getByRole('heading', { name: 'Staff sign in' })).toBeInTheDocument();
  });

  it('first login: an ended set-up ticket sends them back to sign in again', async () => {
    mockApi({
      'POST /auth/login': {
        status: 'setup_required',
        setupTicket: 'ticket-2',
        expiresAt: new Date(Date.now() + 900_000).toISOString(),
        staff: { code: 'CA-0042', name: 'Ravi K', role: 'call_agent' },
        photoRequired: false,
        authenticatorSetupRequired: false,
        authenticatorCodeRequired: false,
        passwordRules: { minLength: 8, maxBytes: 72 },
        signInAt: 'web',
      },
      'POST /auth/setup/complete': apiError(401, 'This set-up has ended. Sign in again with your staff code and temporary password.'),
    });
    renderSignIn();
    await userEvent.type(screen.getByLabelText(/Staff code/), 'CA-0042');
    await userEvent.type(screen.getByLabelText(/Password/), 'K7M4-Q2PX');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    await screen.findByRole('heading', { name: 'Welcome, Ravi K' });
    await userEvent.type(screen.getByLabelText(/^New password/), 'my-own-pass');
    await userEvent.type(screen.getByLabelText(/Type the new password again/), 'my-own-pass');
    await userEvent.click(screen.getByRole('button', { name: 'Set password' }));
    expect(await screen.findByText(/This set-up has ended/)).toBeInTheDocument();
  });

  it('explains why the last session ended', async () => {
    mockApi({});
    renderSignIn();
    // The session store reports the end; the sign-in screen shows it.
    act(() => sessionStore.clear('idle'));
    expect(await screen.findByText('You were signed out after 60 minutes without activity.')).toBeInTheDocument();
  });
});
