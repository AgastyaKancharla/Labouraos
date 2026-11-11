import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { mockApi, renderScreen, signInAs } from '../../../test/utils';
import { NOW } from '../_lib/fixtures';
import MyTargets from './index';

describe('My targets (CA11)', () => {
  it('shows progress, pace and the leaderboard without anyone’s target', async () => {
    mockApi({
      'GET /call-work/targets': {
        year: 2026,
        month: 11,
        currentDay: 11,
        daysInMonth: 30,
        candidatesActivated: { achieved: 18, target: 30, expectedPace: 11, status: 'set', behindPace: false, breached: false },
        vacanciesCaptured: { achieved: 5, target: 12, expectedPace: 7, status: 'set', behindPace: true, breached: false },
        refundRate: { achieved: 0.04, target: 0.08, expectedPace: null, status: 'set', behindPace: false, breached: false, matured: 25 },
        leaderboard: [
          { position: 1, name: 'Kiran Kumar', staffCode: 'FA-0007', placementsClosed: 9, isMe: false },
          { position: 2, name: 'Deepa Nair', staffCode: 'CA-0042', placementsClosed: 2, isMe: true },
        ],
      },
    });
    signInAs('call_agent');
    renderScreen(<MyTargets />, { portal: 'call-agent', path: '/call-agent/targets', now: NOW });
    expect(await screen.findByText('On pace')).toBeInTheDocument();
    expect(screen.getByText('Behind pace')).toBeInTheDocument();
    expect(screen.getByText('You should be at about 7 by now. Your Team Lead has been told.')).toBeInTheDocument();
    expect(screen.getByText('4%')).toBeInTheDocument();
    expect(screen.getByText('target under 8%')).toBeInTheDocument();
    expect(screen.getByText('1. Kiran Kumar')).toBeInTheDocument();
    expect(screen.getByText('(you)')).toBeInTheDocument();
  });
});
