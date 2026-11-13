import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { apiError, mockApi, renderScreen, signInAs } from '../test/utils';
import { fakeCamera } from '../test/fakeCamera';
import { RequireRole } from './RequireRole';

const renderPortal = () => {
  signInAs('call_agent');
  return renderScreen(
    <RequireRole roles={['call_agent']}>
      <div>Call agent home</div>
    </RequireRole>,
    { path: '/call-agent' },
  );
};

describe('Staff photo at sign-in (StaffPhotoGate)', () => {
  it('someone with no photo takes a live camera selfie before going on', async () => {
    const getUserMedia = fakeCamera();
    const api = mockApi({
      'GET /staff/me/photo': { required: true, reason: 'missing', photoUrl: null },
      'POST /staff/me/photo': { required: false, reason: null, photoUrl: 'https://photos.example/me.jpg' },
    });
    const { container } = renderPortal();
    expect(await screen.findByRole('heading', { name: 'Take your staff photo' })).toBeInTheDocument();
    expect(screen.queryByText('Call agent home')).not.toBeInTheDocument();
    expect(container.querySelector('input[type="file"]')).toBeNull();
    await waitFor(() => expect(getUserMedia).toHaveBeenCalled());
    await userEvent.click(await screen.findByRole('button', { name: 'Take photo' }));
    expect(await screen.findByText('Call agent home')).toBeInTheDocument();
    const post = api.fetch.mock.calls.find(([url, init]) => String(url).endsWith('/staff/me/photo') && init?.method === 'POST');
    expect((post?.[1]?.body as FormData).get('captureSource')).toBe('live_camera');
    expect((post?.[1]?.headers as Record<string, string>).Authorization).toMatch(/^Bearer /);
  });

  it('says when the CEO asked for a new photo', async () => {
    fakeCamera();
    mockApi({ 'GET /staff/me/photo': { required: true, reason: 'retake', photoUrl: 'https://photos.example/old.jpg' } });
    renderPortal();
    expect(await screen.findByRole('heading', { name: 'Take a new staff photo' })).toBeInTheDocument();
    expect(screen.getByText(/The CEO asked for a new photo/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeInTheDocument();
  });

  it('goes straight on when there is a photo, and is never blocked when the API cannot say', async () => {
    mockApi({ 'GET /staff/me/photo': { required: false, reason: null, photoUrl: 'https://photos.example/me.jpg' } });
    renderPortal();
    expect(await screen.findByText('Call agent home')).toBeInTheDocument();
  });

  it('an error from the photo check does not block the portal', async () => {
    mockApi({ 'GET /staff/me/photo': apiError(500, 'Internal server error') });
    renderPortal();
    expect(await screen.findByText('Call agent home')).toBeInTheDocument();
  });
});
