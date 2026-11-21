import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { apiError, mockApi, renderScreen } from '../../../test/utils';
import ReferralLinkPage from './index';

const SLUG = 'abcdefghjk';
const render = () => renderScreen(<ReferralLinkPage />, { portal: 'public', path: `/p/ref/${SLUG}`, route: '/p/ref/:slug' });

describe('P-ReferralLink (a referral partner\'s share link, rev 202)', () => {
  it('shows who invited them, checks their own number by a code and sends the lead', async () => {
    const api = mockApi({
      [`GET /referral-links/${SLUG}`]: { valid: true, partnerFirstName: 'Suresh' },
      [`POST /referral-links/${SLUG}/send-code`]: { requestId: 'req-9', success: true },
      [`POST /referral-links/${SLUG}/leads`]: { received: true },
    });
    render();
    expect(await screen.findByText('Suresh invited you to Laboura.')).toBeInTheDocument();
    expect(screen.queryByText(/RF-/)).not.toBeInTheDocument();
    const send = screen.getByRole('button', { name: 'Send code' });
    expect(send).toBeDisabled();
    await userEvent.type(screen.getByLabelText(/Your name/), 'Manju Nath');
    await userEvent.type(screen.getByLabelText(/Your mobile number/), '9845012345');
    await userEvent.click(screen.getByLabelText('A job'));
    await userEvent.click(screen.getByLabelText('Laboura may call me and send me WhatsApp messages about this.'));
    await userEvent.click(screen.getByRole('button', { name: 'Send code' }));
    expect(api.calls(`POST /referral-links/${SLUG}/send-code`)[0]!.body).toEqual({ phone: '9845012345' });
    await userEvent.click(screen.getAllByRole('textbox').at(-1)!);
    await userEvent.paste('123456');
    await waitFor(() => expect(api.calls(`POST /referral-links/${SLUG}/leads`)).toHaveLength(1));
    expect(api.calls(`POST /referral-links/${SLUG}/leads`)[0]!.body).toEqual({
      name: 'Manju Nath', phone: '9845012345', lookingFor: 'job', area: '', consent: true, requestId: 'req-9', code: '123456',
    });
    expect(await screen.findByText('Thank you! A Laboura agent will call you soon.')).toBeInTheDocument();
  });

  it('an inactive link says so plainly', async () => {
    mockApi({ [`GET /referral-links/${SLUG}`]: apiError(404, 'This link is not active.') });
    render();
    expect(await screen.findByText('This link is not active. You can still register in the Laboura app.')).toBeInTheDocument();
  });
});
