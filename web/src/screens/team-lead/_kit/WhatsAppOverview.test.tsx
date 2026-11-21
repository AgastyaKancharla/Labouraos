import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { mockApi, renderScreen, signInAs } from '../../../test/utils';
import { WhatsAppOverview } from './WhatsAppOverview';

describe('Team Lead WhatsApp widget (rev 202)', () => {
  it('shows what waits, for how long and with whom, and hands one to a teammate', async () => {
    const api = mockApi({
      'GET /whatsapp/overview': {
        open: 4, waiting: 2, waitingOver15: 1, unassigned: 1, closedLast24h: 6, referralLeadsOpen: 3, referralLeadsUnassigned: 1, onShift: 2,
        agents: [
          { id: 'a1', code: 'CA-00002', name: 'Kavya', onShift: true, open: 2, waiting: 1 },
          { id: 'a2', code: 'CA-00003', name: 'Arun', onShift: false, open: 0, waiting: 0 },
        ],
        waitingList: [
          { id: 'w1', name: 'Ravi Kumar (JS-00012)', waitingWorkMinutes: 22, waitingSince: '2026-11-11T05:00:00Z', assignedTo: { id: 'a1', code: 'CA-00002', name: 'Kavya' } },
          { id: 'w2', name: 'New contact ···9911', waitingWorkMinutes: 4, waitingSince: '2026-11-11T05:30:00Z', assignedTo: null },
        ],
      },
      'POST /whatsapp/conversations/w2/assign': { assigned: true },
    });
    signInAs('team_lead');
    renderScreen(<WhatsAppOverview />, { portal: 'team-lead', path: '/team-lead' });
    expect(await screen.findByText('2 waiting for a reply')).toBeInTheDocument();
    expect(screen.getByText('1 over 15 min')).toBeInTheDocument();
    expect(screen.getByText('22 min')).toBeInTheDocument();
    expect(screen.getByText('Not assigned')).toBeInTheDocument();
    await userEvent.selectOptions(screen.getByLabelText('Hand New contact ···9911 to'), 'a2');
    await userEvent.click(screen.getAllByRole('button', { name: 'Assign' })[1]!);
    await waitFor(() => expect(api.calls('POST /whatsapp/conversations/w2/assign')[0]!.body).toEqual({ staffId: 'a2' }));
  });
});
