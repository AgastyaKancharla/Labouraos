import { act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { sessionStore } from '../../auth/session';
import { DEVICE_ID_KEY } from '../../auth/device';
import { apiError, fakeJwt, mockApi, renderScreen } from '../../test/utils';
import StaffSignIn from './StaffSignIn';

function tokenResponse(role: string, code: string, extra: Record<string, unknown> = {}) {
  return {
    accessToken: fakeJwt({ role, ...(extra.totpEnrollmentRequired ? { scope: 'totp_setup' } : {}) }),
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
    expect(calls[1].body).toMatchObject({ staffCode: 'CEO-0001', password: 'password12', totpCode: '264019' });
    expect((calls[0].body as { deviceId: string }).deviceId).toBe(localStorage.getItem(DEVICE_ID_KEY));
    expect(await screen.findByTestId('navigated-away')).toBeInTheDocument();
  });

  it('Call agent: password, then the code the Team Lead reads out (CA01 → CA02)', async () => {
    const api = mockApi({
      'POST /auth/login': { status: 'awaiting_code', loginRequestId: 'lr-1', expiresAt: new Date(Date.now() + 300_000).toISOString() },
      'POST /auth/login/verify-code': tokenResponse('call_agent', 'CA-0042'),
    });
    renderSignIn();
    await enterPassword('CA-0042');
    expect(await screen.findByRole('heading', { name: 'Ask your Team Lead for your code' })).toBeInTheDocument();
    expect(screen.getByText(/Code request expires in [45]:\d\d/)).toBeInTheDocument();
    await userEvent.click(screen.getAllByRole('textbox')[0]);
    await userEvent.paste('481906');
    await waitFor(() => expect(sessionStore.get()?.staff.role).toBe('call_agent'));
    expect(api.calls('POST /auth/login/verify-code')[0].body).toEqual({ loginRequestId: 'lr-1', code: '481906' });
  });

  it('Team Lead is told to ask a Manager (TL02)', async () => {
    mockApi({ 'POST /auth/login': { status: 'awaiting_code', loginRequestId: 'lr-2', expiresAt: new Date(Date.now() + 300_000).toISOString() } });
    renderSignIn();
    await enterPassword('TL-0003');
    expect(await screen.findByRole('heading', { name: 'Ask a Manager for your code' })).toBeInTheDocument();
  });

  it('an expired code request asks to start again', async () => {
    mockApi({ 'POST /auth/login': { status: 'awaiting_code', loginRequestId: 'lr-3', expiresAt: new Date(Date.now() - 1000).toISOString() } });
    renderSignIn();
    await enterPassword('CA-0042');
    expect(await screen.findByText(/This code request has expired/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Start again' }));
    expect(screen.getByRole('heading', { name: 'Staff sign in' })).toBeInTheDocument();
  });

  it('shows the API reason for a refused login (locked, device, office network)', async () => {
    mockApi({ 'POST /auth/login': apiError(401, 'This device is waiting for approval by your Team Lead') });
    renderSignIn();
    await enterPassword('CA-0042');
    expect(await screen.findByRole('alert')).toHaveTextContent('This device is waiting for approval by your Team Lead');
    expect(sessionStore.get()).toBeNull();
  });

  it('first management sign-in sets up the authenticator, then asks to sign in again', async () => {
    const api = mockApi({
      'POST /auth/login': tokenResponse('finance', 'FIN-0001', { totpEnrollmentRequired: true }),
      'POST /staff/2fa/setup': { secret: 'JBSWY3DPEHPK3PXP', otpauthUrl: 'otpauth://totp/Laboura:FIN-0001?secret=JBSWY3DPEHPK3PXP' },
      'POST /staff/2fa/enable': { success: true, message: 'ok' },
      'POST /auth/logout': { success: true },
    });
    renderSignIn();
    await enterPassword('FIN-0001');
    expect(await screen.findByRole('heading', { name: 'Set up your authenticator' })).toBeInTheDocument();
    expect(screen.getByText(/JBSWY3DPEHPK3PXP/)).toBeInTheDocument();
    expect(sessionStore.get()).toBeNull();
    await userEvent.click(screen.getAllByRole('textbox')[0]);
    await userEvent.paste('123456');
    await userEvent.click(screen.getByRole('button', { name: 'Turn on' }));
    expect(await screen.findByText('Authenticator is on. Sign in again with a code from the app.')).toBeInTheDocument();
    expect(api.calls('POST /staff/2fa/enable')[0].body).toEqual({ totpCode: '123456' });
    expect(sessionStore.get()).toBeNull();
  });

  it('explains why the last session ended', async () => {
    mockApi({});
    renderSignIn();
    // The session store reports the end; the sign-in screen shows it.
    act(() => sessionStore.clear('idle'));
    expect(await screen.findByText('You were signed out after 60 minutes without activity.')).toBeInTheDocument();
  });
});
