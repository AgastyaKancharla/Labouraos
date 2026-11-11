import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { apiError, mockApi, renderScreen } from '../../../test/utils';
import DidTheyOffer from './index';

const render = () => renderScreen(<DidTheyOffer />, { portal: 'public', path: '/p/did-they-offer/ctok', route: '/p/did-they-offer/:token' });
const details = { firstName: 'Ramesh', businessName: 'Sri Sai Hotel', slotStartsAt: '2026-11-11T05:00:00Z', answered: false, language: null };

describe('P06-DidTheyOffer', () => {
  it('asks the one question and records the answer', async () => {
    const api = mockApi({ 'GET /interviews/check/ctok': details, 'POST /interviews/check/ctok': { candidateCheckAnswer: 'offered_yes' } });
    render();
    expect(await screen.findByRole('heading', { name: 'Quick question, Ramesh' })).toBeInTheDocument();
    expect(screen.getByText(/at Sri Sai Hotel/)).toBeInTheDocument();
    expect(screen.getByText(/a Team Lead checks it the same day/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Yes' }));
    expect(api.calls('POST /interviews/check/ctok')[0]!.body).toEqual({ answer: 'yes' });
    expect(await screen.findByText('Thank you, Ramesh')).toBeInTheDocument();
  });

  it('shows a failed answer', async () => {
    mockApi({ 'GET /interviews/check/ctok': details, 'POST /interviews/check/ctok': apiError(400, 'This interview is not waiting for your answer yet') });
    render();
    await userEvent.click(await screen.findByRole('button', { name: 'No' }));
    expect(await screen.findByRole('alert')).toBeInTheDocument();
  });
});
