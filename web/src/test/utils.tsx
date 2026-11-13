import type { ReactElement, ReactNode } from 'react';
import { render } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { vi } from 'vitest';
import { AppProviders, createQueryClient } from '../App';
import { sessionStore, type StaffIdentity } from '../auth/session';
import type { StaffRole } from '../auth/roles';
import { AppShell } from '../components/AppShell';
import { NowContext } from '../lib/useNow';
import { portalByKey, type PortalKey } from '../portals';

/**
 * Test helpers for screen agents. Typical screen test:
 *
 *   const api = mockApi({ 'GET /payments': [...], 'GET /refunds/due': [] });
 *   signInAs('ceo');
 *   renderScreen(<MyScreen />, { portal: 'ceo', path: '/ceo/payments' });
 *   expect(await screen.findByText('₹4,12,600')).toBeInTheDocument();
 *   expect(api.calls('GET /payments')[0].query.get('status')).toBe('pending');
 */

/** A fake, unsigned JWT the session store accepts (only `exp` and claims are read). */
export function fakeJwt(claims: Record<string, unknown> = {}, expiresInSeconds = 15 * 60): string {
  const b64 = (o: unknown) => btoa(JSON.stringify(o)).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
  const exp = Math.floor(Date.now() / 1000) + expiresInSeconds;
  return `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ exp, ...claims })}.signature`;
}

export const TEST_STAFF: Record<StaffRole, StaffIdentity> = {
  ceo: { id: 'staff-ceo', code: 'CEO-0001', name: 'Agastya Kancharla', role: 'ceo', email: 'ceo@laboura.test' },
  manager: { id: 'staff-mgr', code: 'MGR-0002', name: 'Priya Sharma', role: 'manager', email: 'mgr@laboura.test' },
  team_lead: { id: 'staff-tl', code: 'TL-0003', name: 'Ravi Shankar', role: 'team_lead', email: null },
  finance: { id: 'staff-fin', code: 'FIN-0001', name: 'Nisha Rao', role: 'finance', email: 'fin@laboura.test' },
  call_agent: { id: 'staff-ca', code: 'CA-0042', name: 'Deepa Nair', role: 'call_agent', email: null },
  field_agent: { id: 'staff-fa', code: 'FA-0007', name: 'Kiran Kumar', role: 'field_agent', email: null },
};

export function signInAs(role: StaffRole): StaffIdentity {
  const staff = TEST_STAFF[role];
  sessionStore.set({ token: fakeJwt({ sub: staff.id, role }), staff, expiresAt: Date.now() + 15 * 60 * 1000, totpSetupOnly: false });
  return staff;
}

export function signOutForTests() {
  sessionStore.clear('logout');
}

type Handler = unknown | ((req: { url: URL; body: unknown; init: RequestInit }) => unknown);
interface MockResponse {
  status: number;
  body: unknown;
}
export function apiError(status: number, message: string, requestId = 'req-test'): MockResponse {
  return { status, body: { statusCode: status, message, requestId, timestamp: new Date().toISOString() } };
}

/**
 * Stubs fetch. Keys are "METHOD /path" (query string ignored). A value is
 * the JSON body (status 200), a function of the request, or apiError(...).
 * Unmatched requests fail loudly so a test never hits the network.
 */
export function mockApi(routes: Record<string, Handler>) {
  const calls: { key: string; url: URL; body: unknown }[] = [];
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = new URL(typeof input === 'string' ? input : input.toString(), 'http://localhost');
    const method = (init.method ?? 'GET').toUpperCase();
    const key = `${method} ${url.pathname}`;
    const body = typeof init.body === 'string' ? JSON.parse(init.body) : undefined;
    calls.push({ key, url, body });
    if (!(key in routes)) {
      return new Response(JSON.stringify({ statusCode: 501, message: `No mock for ${key}` }), { status: 501 });
    }
    const handler = routes[key];
    const result = typeof handler === 'function' ? await (handler as (r: unknown) => unknown)({ url, body, init }) : handler;
    const isError = typeof result === 'object' && result !== null && 'status' in result && 'body' in result;
    const status = isError ? (result as MockResponse).status : 200;
    const payload = isError ? (result as MockResponse).body : result;
    return new Response(payload === undefined ? '' : JSON.stringify(payload), {
      status,
      headers: { 'Content-Type': 'application/json' },
    });
  });
  vi.stubGlobal('fetch', fetchMock);
  return {
    fetch: fetchMock,
    calls: (key: string) => calls.filter((c) => c.key === key).map((c) => ({ query: c.url.searchParams, body: c.body })),
  };
}

export interface RenderOptions {
  /** Wrap in this portal's AppShell (sidebar/header) and context. */
  portal?: PortalKey;
  /** Initial URL inside the app (the app is at the site root). */
  path?: string;
  /** Route pattern for useParams, e.g. '/ceo/businesses/:id'. Defaults to path. */
  route?: string;
  /** Fixed "now" for the screen (useNow / useClock). */
  now?: Date;
}

/** Renders one screen with every provider, a router and (optionally) its portal shell. */
export function renderScreen(ui: ReactElement, options: RenderOptions = {}) {
  const { portal, path = '/', route, now } = options;
  const queryClient = createQueryClient();
  queryClient.setDefaultOptions({ queries: { retry: false, staleTime: 0 } });
  const clock = now ? () => now : () => new Date();
  const wrap = (node: ReactElement) => {
    const wrapped: ReactNode = portal ? <AppShell portal={portalByKey(portal)}>{node}</AppShell> : node;
    return (
      <NowContext.Provider value={clock}>
        <AppProviders queryClient={queryClient}>
          <MemoryRouter initialEntries={[path]}>
            <Routes>
              <Route path={route ?? path.split('?')[0]} element={wrapped} />
              <Route path="*" element={<div data-testid="navigated-away" />} />
            </Routes>
          </MemoryRouter>
        </AppProviders>
      </NowContext.Provider>
    );
  };
  const result = render(wrap(ui));
  return { ...result, queryClient, rerender: (next: ReactElement) => result.rerender(wrap(next)) };
}
