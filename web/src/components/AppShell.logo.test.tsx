import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { mockApi, renderScreen, signInAs } from '../test/utils';

/** Decided 16 Nov: clicking the Laboura logo anywhere opens that person's own Home. */
describe('The logo goes Home', () => {
  it.each([
    ['ceo', '/ceo/reports', '/ceo'],
    ['manager', '/manager/requests', '/manager'],
    ['team_lead', '/team-lead/requests', '/team-lead'],
    ['finance', '/finance/refunds', '/finance'],
  ] as const)('%s: the sidebar logo and the phone-bar logo link to Home', (role, path, home) => {
    mockApi({});
    signInAs(role);
    const portal = home.slice(1) as 'ceo' | 'manager' | 'team-lead' | 'finance';
    renderScreen(<div>page</div>, { portal, path });
    expect(screen.getByTestId('logo-home')).toHaveAttribute('href', home);
    const phone = screen.getByTestId('logo-home-phone');
    expect(phone).toHaveAttribute('href', home);
    expect(within(phone).getByText('LABOURA')).toBeInTheDocument();
  });

  it('call agent: the header logo links to the call agent Home', () => {
    mockApi({});
    signInAs('call_agent');
    renderScreen(<div>page</div>, { portal: 'call-agent', path: '/call-agent/follow-ups' });
    expect(screen.getByTestId('logo-home')).toHaveAttribute('href', '/call-agent');
  });
});
