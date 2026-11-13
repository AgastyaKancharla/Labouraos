import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { App } from './App';
import { ROLE_HOME } from './auth/roles';
import { PORTALS } from './portals';
import { mockApi, signInAs } from './test/utils';

/**
 * Decided 14 Nov: app.laboura.com has one login page and each portal at a
 * clean address at the root — /login, /ceo, /manager, /team-lead, /finance,
 * /call-agent — plus the public pages at /p/…. The server answers exactly
 * these first segments with the app (WEB_APP_ROOTS in
 * src/modules/web-app/site-routing.middleware.ts); everything else is the API.
 */
const SERVER_WEB_ROOTS = ['login', 'ceo', 'manager', 'team-lead', 'finance', 'call-agent', 'p', 'field-app'];

const firstSegment = (path: string) => path.replace(/^\/+/, '').split('/')[0];

describe('the web app at the site root', () => {
  afterEach(() => window.history.pushState({}, '', '/'));

  it('puts every portal at a clean address the server serves', () => {
    expect(PORTALS.map((p) => p.root)).toEqual(['/ceo', '/manager', '/team-lead', '/finance', '/call-agent', '/p']);
    for (const portal of PORTALS) expect(SERVER_WEB_ROOTS).toContain(firstSegment(portal.root));
    for (const home of Object.values(ROLE_HOME)) expect(SERVER_WEB_ROOTS).toContain(firstSegment(home));
    // /field-agent stays the old console on the server; the web app's notice for field agents is /field-app.
    expect(ROLE_HOME.field_agent).toBe('/field-app');
  });

  it('shows the one login page for a portal opened at the root, with no /app in front', async () => {
    mockApi({});
    window.history.pushState({}, '', '/ceo/refunds');
    render(<App />);
    expect(await screen.findByRole('heading', { name: 'Staff sign in' })).toBeInTheDocument();
    expect(window.location.pathname).toBe('/login');
  });

  it('opens the CEO portal at /ceo with root links', async () => {
    signInAs('ceo');
    mockApi({ 'GET /login-codes/pending': [], 'GET /review-flags': [], 'GET /refunds/due': [] });
    window.history.pushState({}, '', '/ceo');
    render(<App />);
    const links = await screen.findAllByRole('link', { name: /Refund/ });
    expect(links[0].getAttribute('href')).toBe('/ceo/refunds');
    expect(document.querySelectorAll('a[href^="/app"]')).toHaveLength(0);
  });

  it('points a field agent who signs in here to Laboura Field', async () => {
    signInAs('field_agent');
    mockApi({});
    window.history.pushState({}, '', '/');
    render(<App />);
    expect(await screen.findByRole('link', { name: 'Open Laboura Field' })).toHaveAttribute('href', '/field/');
    expect(window.location.pathname).toBe('/field-app');
  });
});
