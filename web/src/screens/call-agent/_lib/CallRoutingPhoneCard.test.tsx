import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { mockApi, renderScreen, signInAs } from '../../../test/utils';
import { CallRoutingPhoneCard } from './CallRoutingPhoneCard';

describe('"Your calling phone" (the phone the calling system rings first)', () => {
  it('not set: explains why calls fail, checks the number and saves it on his own account', async () => {
    const me = signInAs('call_agent');
    const api = mockApi({ [`PUT /staff/${me.id}/call-routing-phone`]: { set: true } });
    renderScreen(<CallRoutingPhoneCard isSet={false} />);
    expect(screen.getByText(/the calling system cannot ring you/)).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText('Mobile number (10 digits)'), '12345');
    await userEvent.click(screen.getByRole('button', { name: 'Save calling phone' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Enter 10 digits starting with 6–9.');
    expect(api.calls(`PUT /staff/${me.id}/call-routing-phone`)).toHaveLength(0);
    await userEvent.clear(screen.getByLabelText('Mobile number (10 digits)'));
    await userEvent.type(screen.getByLabelText('Mobile number (10 digits)'), '9812345678');
    await userEvent.click(screen.getByRole('button', { name: 'Save calling phone' }));
    await waitFor(() => expect(api.calls(`PUT /staff/${me.id}/call-routing-phone`)).toHaveLength(1));
    expect(api.calls(`PUT /staff/${me.id}/call-routing-phone`)[0].body).toEqual({ phone: '9812345678' });
  });

  it('set: says so and offers Change, never showing the number', () => {
    signInAs('call_agent');
    mockApi({});
    renderScreen(<CallRoutingPhoneCard isSet />);
    expect(screen.getByText(/rings this phone first/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Change' })).toBeInTheDocument();
  });
});
