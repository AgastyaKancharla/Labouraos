import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { mockApi, renderScreen, signInAs } from '../../../test/utils';
import { BypassChargesCard } from './BypassCharges';

describe('No-bypass charges on C-Business', () => {
  it('lists raised charges with fee + 50% + GST and raises one for an introduced person, with a reason', async () => {
    const api = mockApi({
      'GET /bypass-charges/business/b1': [
        { id: 'c1', code: 'BYP-00001', invoiceCode: 'INV-00042', jobSeeker: { id: 'js1', code: 'JS-00144', name: 'Prakash N' }, hiredOn: '2026-11-01', monthlySalaryPaise: 1500000, feePaise: 750000, penaltyPaise: 375000, gstPaise: 202500, totalPaise: 1327500, penaltyPercent: 50, reason: 'Seen there', status: 'waiting', raisedAt: '2026-11-10T05:00:00Z' },
      ],
      'GET /bypass-charges/business/b1/candidates': { noBypassMonths: 12, penaltyPercent: 50, feePercent: 50, gstPercent: 18, rows: [{ jobSeeker: { id: 'js2', code: 'JS-00150', name: 'Manjula' }, introducedAt: '2026-10-01T05:00:00Z' }] },
      'POST /bypass-charges/business/b1': { id: 'c2' },
    });
    signInAs('ceo');
    renderScreen(<BypassChargesCard businessId="b1" />, { portal: 'ceo', path: '/ceo/businesses/b1' });
    expect(await screen.findByText('₹13,275')).toBeInTheDocument();
    expect(screen.getByText('Waiting for payment')).toBeInTheDocument();
    const raise = await screen.findByRole('button', { name: 'Raise bypass charge' });
    await waitFor(() => expect(raise).toBeEnabled());
    await userEvent.click(raise);
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/50% of one month's salary\) \+ 50% of it, plus 18% GST/)).toBeInTheDocument();
    await userEvent.type(within(dialog).getByLabelText(/monthly salary/), '15000');
    await userEvent.type(within(dialog).getByLabelText(/Reason/), 'Seen working there on a revisit');
    const hired = within(dialog).getByLabelText(/Hired on/);
    await userEvent.type(hired, '2026-11-05');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Raise the charge' }));
    await waitFor(() => expect(api.calls('POST /bypass-charges/business/b1')[0]?.body).toMatchObject({ jobSeekerId: 'js2', monthlySalaryPaise: 1500000, reason: 'Seen working there on a revisit' }));
  });

  it('cancels a waiting charge with a reason, and says when there is no signed agreement', async () => {
    const api = mockApi({
      'GET /bypass-charges/business/b1': [
        { id: 'c1', code: 'BYP-00001', invoiceCode: 'INV-00042', jobSeeker: { id: 'js1', code: 'JS-00144', name: 'Prakash N' }, hiredOn: '2026-11-01', monthlySalaryPaise: 1500000, feePaise: 750000, penaltyPaise: 375000, gstPaise: 202500, totalPaise: 1327500, penaltyPercent: 50, reason: 'Seen there', status: 'waiting', raisedAt: '2026-11-10T05:00:00Z' },
      ],
      'GET /bypass-charges/business/b1/candidates': { agreementSigned: false, noBypassMonths: 12, penaltyPercent: 50, feePercent: 50, gstPercent: 18, rows: [{ jobSeeker: { id: 'js2', code: 'JS-00150', name: 'Manjula' }, introducedAt: '2026-10-01T05:00:00Z' }] },
      'POST /bypass-charges/c1/cancel': { id: 'c1', status: 'cancelled' },
    });
    signInAs('ceo');
    renderScreen(<BypassChargesCard businessId="b1" />, { portal: 'ceo', path: '/ceo/businesses/b1' });
    await userEvent.click(await screen.findByRole('button', { name: 'Cancel charge' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.type(within(dialog).getByLabelText(/Reason/), 'Owner showed the worker left on day 2');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel the charge' }));
    await waitFor(() => expect(api.calls('POST /bypass-charges/c1/cancel')[0]?.body).toEqual({ reason: 'Owner showed the worker left on day 2' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Raise bypass charge' })).toBeDisabled());
  });
});
