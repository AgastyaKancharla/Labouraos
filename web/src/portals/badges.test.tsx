import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { mockApi, renderScreen, signInAs } from '../test/utils';

const bell = { openCount: 0, unseenCount: 0, latest: [], doneToday: [], asOf: '2026-11-16T06:00:00.000Z' };

async function navLink(name: RegExp) {
  return screen.findByRole('link', { name });
}

describe('sidebar counts for Interviews and Call Center', () => {
  it('CEO: interviews today and missed calls waiting come from GET /ceo/nav-counts', async () => {
    const api = mockApi({ 'GET /ceo/nav-counts': { interviewsToday: 4, callbacksWaiting: 3 }, 'GET /notifications/bell': bell });
    signInAs('ceo');
    renderScreen(<p>Home</p>, { portal: 'ceo', path: '/ceo' });
    expect(await within(await navLink(/Interviews/)).findByText('4')).toBeInTheDocument();
    expect(await within(await navLink(/Call Center/i)).findByText('3')).toBeInTheDocument();
    expect(api.calls('GET /manager/nav-counts')).toHaveLength(0);
  });

  it('Manager: missed calls waiting in their own tree come from GET /manager/nav-counts', async () => {
    const api = mockApi({ 'GET /manager/nav-counts': { callbacksWaiting: 2 }, 'GET /notifications/bell': bell });
    signInAs('manager');
    renderScreen(<p>Home</p>, { portal: 'manager', path: '/manager' });
    expect(await within(await navLink(/Call Center/i)).findByText('2')).toBeInTheDocument();
    expect(api.calls('GET /ceo/nav-counts')).toHaveLength(0);
  });

  it('shows no badge when nothing is waiting', async () => {
    mockApi({ 'GET /ceo/nav-counts': { interviewsToday: 0, callbacksWaiting: 0 }, 'GET /notifications/bell': bell });
    signInAs('ceo');
    renderScreen(<p>Home</p>, { portal: 'ceo', path: '/ceo' });
    const link = await navLink(/Interviews/);
    expect(link.querySelector('.nbadge')).toBeNull();
  });
});
