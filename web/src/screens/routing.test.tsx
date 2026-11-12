import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { AppProviders, AppRoutes, createQueryClient } from '../App';
import { landingPath } from '../auth/RequireRole';
import { en } from '../i18n/en';
import { PORTALS, portalByKey, screenPath } from '../portals';
import { mockApi, signInAs } from '../test/utils';
import { findScreenModulePath } from './registry';

function renderAt(path: string) {
  const qc = createQueryClient();
  qc.setDefaultOptions({ queries: { retry: false } });
  return render(
    <AppProviders queryClient={qc}>
      <MemoryRouter initialEntries={[path]}>
        <AppRoutes />
      </MemoryRouter>
    </AppProviders>,
  );
}

describe('portal registry', () => {
  it('every screen has a translated title, a unique path and nav items point at real screens', () => {
    for (const portal of PORTALS) {
      const paths = portal.screens.map((s) => s.path);
      expect(new Set(paths).size, portal.key).toBe(paths.length);
      for (const s of portal.screens) expect(en[s.title], s.id).toBeTruthy();
      for (const item of portal.sidebar?.sections.flatMap((x) => x.items) ?? []) {
        expect(portal.screens.some((s) => s.id === item.screen), `${portal.key} nav → ${item.screen}`).toBe(true);
      }
      for (const item of portal.topNav ?? []) expect(portal.screens.some((s) => s.id === item.screen)).toBe(true);
    }
  });

  it('builds screen paths with parameters', () => {
    const ceo = portalByKey('ceo');
    expect(screenPath(ceo, 'Main')).toBe('/ceo');
    expect(screenPath(ceo, 'C-Business', { id: 'BZ 1' })).toBe('/ceo/businesses/BZ%201');
    expect(() => screenPath(ceo, 'C-Business')).toThrow(/needs the "id"/);
    expect(() => screenPath(ceo, 'MG-Home')).toThrow();
  });

  it('finds a screen in its own portal folder first, then in any portal', () => {
    const files = ['./finance/FN-Review/index.tsx', './ceo/Main/index.tsx'];
    expect(findScreenModulePath('ceo', 'Main', files)).toBe('./ceo/Main/index.tsx');
    expect(findScreenModulePath('ceo', 'FN-Review', files)).toBe('./finance/FN-Review/index.tsx');
    expect(findScreenModulePath('ceo', 'C-Reports', files)).toBeNull();
  });

  it('sends a sign-in to the page asked for, or the role landing page', () => {
    expect(landingPath('ceo', '/ceo/refunds')).toBe('/ceo/refunds');
    expect(landingPath('ceo', '/finance/bank')).toBe('/ceo');
    expect(landingPath('call_agent', undefined)).toBe('/call-agent/attendance');
  });
});

describe('routes and guards', () => {
  it('sends a signed-out visitor to sign in', async () => {
    mockApi({});
    renderAt('/ceo/refunds');
    expect(await screen.findByRole('heading', { name: 'Staff sign in' })).toBeInTheDocument();
  });

  it('keeps each role on its own portal', async () => {
    signInAs('manager');
    mockApi({ 'GET /login-codes/pending': [], 'GET /review-flags': [], 'GET /manager/overview': { status: 500, body: { message: 'x' } } });
    renderAt('/ceo/refunds');
    // The Manager lands on their own Command Center (MG-Home, now built), never the CEO's page.
    expect(await screen.findByRole('heading', { level: 1, name: /^Good (morning|afternoon|evening)/ })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Plan vs Actual/ })).toHaveAttribute('href', '/manager/plan');
  });

  it('shows the CEO sidebar from Main.dc.html with live badge counts', async () => {
    signInAs('ceo');
    mockApi({
      'GET /login-codes/pending': [{ id: 1 }, { id: 2 }],
      'GET /review-flags': [{ id: 1 }],
      'GET /refunds/due': [],
      'GET /ceo/access': { summary: { waiting: 2, codesToday: 0, locked: 0, invitesPending: 0 }, locked: [], invites: [], codes: [] },
    });
    renderAt('/ceo/login-codes');
    const nav = await screen.findByRole('navigation', { name: 'Main' });
    for (const label of ['Command Center', 'Job Seekers', 'Refund Approvals', 'Pricing & Policy', 'Team & Access', 'Audit Log']) {
      expect(within(nav).getByRole('link', { name: new RegExp(label.replace(/[&]/g, '.')) })).toBeInTheDocument();
    }
    const loginCodes = within(nav).getByRole('link', { name: /Login Codes/ });
    expect(loginCodes).toHaveClass('active');
    expect(await within(loginCodes).findByText('2')).toHaveClass('nbadge');
    expect(await within(within(nav).getByRole('link', { name: /Flags/ })).findByText('1')).toBeInTheDocument();
    // Refund Approvals has no badge when nothing is due.
    expect(within(within(nav).getByRole('link', { name: /Refund Approvals/ })).queryByText(/\d/)).toBeNull();
    // The Login codes screen is built now (lazy-loaded), so wait for its heading.
    expect(await screen.findByRole('heading', { name: 'Login codes', level: 1 })).toBeInTheDocument();
  });

  it('renders every portal home for its role', async () => {
    const cases = [
      ['team_lead', '/team-lead', 'My team'],
      // Money today (FN-Home) greets the Finance person by name.
      ['finance', '/finance', /^Good (morning|afternoon|evening), Nisha$/],
      ['call_agent', '/call-agent', 'Home'],
    ] as const;
    for (const [role, path, title] of cases) {
      signInAs(role);
      mockApi({ 'GET /login-codes/pending': [], 'GET /review-flags': [], 'GET /refunds/due': [] });
      const { unmount } = renderAt(path);
      expect(await screen.findByRole('heading', { name: title, level: 1 })).toBeInTheDocument();
      unmount();
    }
  });

  it('call agent console has the CA03 header navigation and logs out', async () => {
    signInAs('call_agent');
    mockApi({ 'POST /auth/logout': { success: true } });
    renderAt('/call-agent/follow-ups');
    const nav = await screen.findByRole('navigation', { name: 'Main' });
    expect(within(nav).getByRole('link', { name: 'My follow-ups' })).toHaveClass('on');
    expect(within(nav).getAllByRole('link').map((a) => a.textContent)).toEqual(['Home', 'My follow-ups', 'My targets', 'Attendance']);
    await userEvent.click(screen.getByRole('button', { name: 'Log out' }));
    expect(await screen.findByText('You have signed out.')).toBeInTheDocument();
  });

  it('public pages need no sign-in and show the language switcher', async () => {
    mockApi({ 'GET /registration/abc123/status': { otpRequired: true, maskedPhone: '******2345', language: null, registrationComplete: false } });
    renderAt('/p/register/abc123');
    expect(await screen.findByRole('heading', { name: 'Complete your registration' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'ಕನ್ನಡ' }));
    expect(screen.getByRole('heading', { name: 'ನಿಮ್ಮ ನೋಂದಣಿ ಪೂರ್ಣಗೊಳಿಸಿ' })).toBeInTheDocument();
  });

  it('field agents are pointed to Laboura Field', async () => {
    signInAs('field_agent');
    mockApi({});
    renderAt('/');
    expect(await screen.findByRole('heading', { name: 'Use the Laboura Field app' })).toBeInTheDocument();
  });

  it('unknown pages show not found', async () => {
    signInAs('ceo');
    mockApi({ 'GET /login-codes/pending': [], 'GET /review-flags': [], 'GET /refunds/due': [] });
    renderAt('/ceo/nope/nothing');
    expect(await screen.findByRole('heading', { name: 'Page not found' })).toBeInTheDocument();
  });
});
