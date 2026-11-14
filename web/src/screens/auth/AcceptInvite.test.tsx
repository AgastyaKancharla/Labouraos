import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { sessionStore } from '../../auth/session';
import { apiError, mockApi, renderScreen } from '../../test/utils';
import { fakeCamera } from '../../test/fakeCamera';
import AcceptInvite, { passwordProblem, type InvitePreview } from './AcceptInvite';

const TOKEN = 'a1'.repeat(32);
const PATH = `/p/invite/${TOKEN}`;

function previewOf(extra: Partial<InvitePreview> = {}): InvitePreview {
  return {
    name: 'Deepa Nair',
    code: 'CA-00042',
    role: 'call_agent',
    expiresAt: '2026-11-14T06:00:00.000Z',
    authenticatorRequired: false,
    passwordRules: { minLength: 12, maxBytes: 72 },
    signInAt: 'web',
    ...extra,
  };
}

function problem(status: number, reason: string, message = 'refused') {
  return { status, body: { statusCode: status, message, details: { message, reason } } };
}

function renderInvite() {
  return renderScreen(<AcceptInvite />, { path: PATH, route: '/p/invite/:token' });
}

async function typePasswords(password: string, confirm = password) {
  await userEvent.type(await screen.findByLabelText(/New password/), password);
  await userEvent.type(screen.getByLabelText(/Type the password again/), confirm);
}

describe('Invite page (accept invite)', () => {
  it('shows who the invite is for and their role, then sets the password and points to sign in', async () => {
    const api = mockApi({
      'POST /staff/accept-invite/preview': previewOf(),
      'POST /staff/accept-invite': { success: true, code: 'CA-00042', email: null },
    });
    renderInvite();
    expect(screen.getByText('Checking your invite…')).toBeInTheDocument();
    expect(await screen.findByRole('heading', { name: 'Welcome, Deepa Nair' })).toBeInTheDocument();
    expect(screen.getByText('CA-00042')).toBeInTheDocument();
    expect(screen.getByText('Call agent')).toBeInTheDocument();
    expect(screen.getByText('14 Nov 11:30')).toBeInTheDocument();
    expect(api.calls('POST /staff/accept-invite/preview')[0].body).toEqual({ token: TOKEN });

    await typePasswords('my lovely long password');
    await userEvent.click(screen.getByRole('button', { name: 'Set password' }));

    expect(await screen.findByRole('heading', { name: 'Your account is ready' })).toBeInTheDocument();
    expect(screen.getByText(/Sign in with staff code CA-00042/)).toBeInTheDocument();
    expect(api.calls('POST /staff/accept-invite')[0].body).toEqual({ token: TOKEN, password: 'my lovely long password' });
    expect(api.calls('POST /staff/accept-invite/authenticator')).toHaveLength(0);
    expect(screen.getByRole('link', { name: 'Go to sign in' })).toHaveAttribute('href', '/login');
    // Accepting an invite never signs anyone in.
    expect(sessionStore.get()).toBeNull();
  });

  it('checks the password rules from the API before sending anything', async () => {
    const api = mockApi({ 'POST /staff/accept-invite/preview': previewOf({ passwordRules: { minLength: 14, maxBytes: 72 } }) });
    renderInvite();
    await typePasswords('short-pass-1');
    await userEvent.click(await screen.findByRole('button', { name: 'Set password' }));
    expect(await screen.findByText('Use at least 14 characters.')).toBeInTheDocument();

    await userEvent.clear(screen.getByLabelText(/New password/));
    await userEvent.type(screen.getByLabelText(/New password/), 'a long enough password');
    await userEvent.click(screen.getByRole('button', { name: 'Set password' }));
    expect(await screen.findByText('The two passwords are not the same.')).toBeInTheDocument();
    expect(api.calls('POST /staff/accept-invite')).toHaveLength(0);
  });

  it('passwordProblem matches the API: characters for the minimum, UTF-8 bytes for the maximum', () => {
    const rules = { minLength: 12, maxBytes: 72 };
    expect(passwordProblem('a'.repeat(11), rules)).toBe('tooShort');
    expect(passwordProblem('a'.repeat(12), rules)).toBeNull();
    expect(passwordProblem('a'.repeat(72), rules)).toBeNull();
    expect(passwordProblem('a'.repeat(73), rules)).toBe('tooLong');
    // 25 Kannada letters are 75 bytes in UTF-8.
    expect(passwordProblem('ಕ'.repeat(25), rules)).toBe('tooLong');
  });

  it('management sets up the authenticator before finishing; the code goes with the password', async () => {
    const api = mockApi({
      'POST /staff/accept-invite/preview': previewOf({ name: 'Nisha Rao', code: 'FIN-00001', role: 'finance', authenticatorRequired: true }),
      'POST /staff/accept-invite/authenticator': { secret: 'JBSWY3DPEHPK3PXP', otpauthUrl: 'otpauth://totp/Laboura:FIN-00001?secret=JBSWY3DPEHPK3PXP' },
      'POST /staff/accept-invite': ({ body }: { body: { totpCode?: string } }) =>
        body.totpCode === '123456'
          ? { success: true, code: 'FIN-00001', email: 'fin@laboura.test' }
          : problem(400, 'totp_invalid', 'The authenticator code is not right. Check the app and try again.'),
    });
    renderInvite();
    expect(await screen.findByText('Finance')).toBeInTheDocument();
    await typePasswords('finance long password');
    await userEvent.click(screen.getByRole('button', { name: 'Next: authenticator' }));

    expect(await screen.findByRole('heading', { name: 'Set up your authenticator' })).toBeInTheDocument();
    expect(screen.getByText(/JBSWY3DPEHPK3PXP/)).toBeInTheDocument();
    expect(api.calls('POST /staff/accept-invite')).toHaveLength(0);

    await userEvent.click(screen.getAllByRole('textbox')[0]);
    await userEvent.paste('999999');
    await userEvent.click(screen.getByRole('button', { name: 'Finish set-up' }));
    expect(await screen.findByText('The authenticator code is not right. Check the app and try again.')).toBeInTheDocument();

    for (const box of screen.getAllByRole('textbox')) await userEvent.clear(box);
    await userEvent.click(screen.getAllByRole('textbox')[0]);
    await userEvent.paste('123456');
    await userEvent.click(screen.getByRole('button', { name: 'Finish set-up' }));

    expect(await screen.findByRole('heading', { name: 'Your account is ready' })).toBeInTheDocument();
    expect(screen.getByText(/Your authenticator is on/)).toBeInTheDocument();
    const calls = api.calls('POST /staff/accept-invite');
    expect(calls[calls.length - 1].body).toEqual({ token: TOKEN, password: 'finance long password', totpCode: '123456' });
  });

  it('a field agent is sent to Laboura Field', async () => {
    mockApi({
      'POST /staff/accept-invite/preview': previewOf({ role: 'field_agent', code: 'FA-00007', signInAt: 'field_app' }),
      'POST /staff/accept-invite': { success: true, code: 'FA-00007', email: null },
    });
    renderInvite();
    await typePasswords('field agent password');
    await userEvent.click(await screen.findByRole('button', { name: 'Set password' }));
    expect(await screen.findByRole('link', { name: 'Open Laboura Field' })).toHaveAttribute('href', '/field/');
  });

  it('a field agent is sent to Laboura Field at its own address when one is set', async () => {
    mockApi({
      'GET /auth/apps': { fieldAppUrl: 'https://field.laboura.com/' },
      'POST /staff/accept-invite/preview': previewOf({ role: 'field_agent', code: 'FA-00008', signInAt: 'field_app' }),
      'POST /staff/accept-invite': { success: true, code: 'FA-00008', email: null },
    });
    renderInvite();
    await typePasswords('field agent password');
    await userEvent.click(await screen.findByRole('button', { name: 'Set password' }));
    expect(await screen.findByRole('link', { name: 'Open Laboura Field' })).toHaveAttribute('href', 'https://field.laboura.com/');
  });

  it.each([
    [404, 'invalid', 'This invite link is not valid'],
    [410, 'expired', 'This invite has expired'],
    [410, 'used', 'This invite has already been used'],
  ])('a %i "%s" invite gets its own explanation', async (status, reason, heading) => {
    mockApi({ 'POST /staff/accept-invite/preview': problem(status, reason) });
    renderInvite();
    expect(await screen.findByRole('heading', { name: heading })).toBeInTheDocument();
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.queryByLabelText(/New password/)).not.toBeInTheDocument();
    if (reason === 'used') {
      expect(screen.getByRole('link', { name: 'Go to sign in' })).toHaveAttribute('href', '/login');
    }
  });

  it('an invite that expires while the page is open says so when the password is sent', async () => {
    mockApi({
      'POST /staff/accept-invite/preview': previewOf(),
      'POST /staff/accept-invite': problem(400, 'expired', 'Invalid or expired invite token'),
    });
    renderInvite();
    await typePasswords('my lovely long password');
    await userEvent.click(await screen.findByRole('button', { name: 'Set password' }));
    expect(await screen.findByRole('heading', { name: 'This invite has expired' })).toBeInTheDocument();
  });

  it('a server error while checking offers to try again', async () => {
    let attempts = 0;
    const api = mockApi({
      'POST /staff/accept-invite/preview': () => (++attempts === 1 ? apiError(500, 'Internal server error') : previewOf()),
    });
    renderInvite();
    await userEvent.click(await screen.findByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('heading', { name: 'Welcome, Deepa Nair' })).toBeInTheDocument();
    await waitFor(() => expect(api.calls('POST /staff/accept-invite/preview')).toHaveLength(2));
  });

  it('without a staff photo, takes a live camera selfie first with the invite token (no file picker), then the password', async () => {
    const getUserMedia = fakeCamera();
    const api = mockApi({
      'POST /staff/accept-invite/preview': previewOf({ photoRequired: true }),
      [`POST /staff/accept-invite/${TOKEN}/photo`]: { photoTakenAt: '2026-11-14T06:00:00.000Z' },
      'POST /staff/accept-invite': { success: true, code: 'CA-00042', email: null },
    });
    const { container } = renderInvite();
    expect(await screen.findByRole('heading', { name: 'First, your photo' })).toBeInTheDocument();
    expect(container.querySelector('input[type="file"]')).toBeNull();
    expect(screen.queryByLabelText(/New password/)).not.toBeInTheDocument();
    await waitFor(() => expect(getUserMedia).toHaveBeenCalledWith(expect.objectContaining({ video: expect.objectContaining({ facingMode: 'user' }), audio: false })));
    await userEvent.click(await screen.findByRole('button', { name: 'Take photo' }));
    expect(await screen.findByText('Photo saved. Now choose your password.')).toBeInTheDocument();
    const sent = api.fetch.mock.calls.find(([url]) => String(url).endsWith(`/staff/accept-invite/${TOKEN}/photo`));
    const form = sent?.[1]?.body as FormData;
    expect(form.get('captureSource')).toBe('live_camera');
    expect(form.get('photo')).toBeInstanceOf(Blob);
    await typePasswords('my lovely long password');
    await userEvent.click(screen.getByRole('button', { name: 'Set password' }));
    expect(await screen.findByRole('heading', { name: 'Your account is ready' })).toBeInTheDocument();
  });

  it('on a device with no camera the photo can wait until the first sign-in', async () => {
    Object.defineProperty(navigator, 'mediaDevices', { value: undefined, configurable: true });
    mockApi({ 'POST /staff/accept-invite/preview': previewOf({ photoRequired: true }) });
    renderInvite();
    expect(await screen.findByText(/camera couldn't be opened/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'No camera on this device? Take it when you first sign in' }));
    expect(await screen.findByLabelText(/New password/)).toBeInTheDocument();
  });
});

