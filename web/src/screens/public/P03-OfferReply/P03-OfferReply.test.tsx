import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { apiError, mockApi, renderScreen } from '../../../test/utils';
import OfferReply from './index';

const offer = {
  firstName: 'Ramesh', job: 'Electrician', area: 'HSR Layout', salaryMinPaise: 1600000, salaryMaxPaise: 1800000, salaryPeriod: 'monthly',
  shift: 'day', slotStartsAt: '2026-11-10T05:00:00Z', slotEndsAt: '2026-11-10T12:30:00Z', replyDueAt: '2026-11-12T04:45:00Z',
  awaitingReply: true, belowGuaranteeFloor: false, language: 'hi',
};
const render = () => renderScreen(<OfferReply />, { portal: 'public', path: '/p/offer/otok', route: '/p/offer/:token' });

describe('P03-OfferReply / P03b-OfferYes', () => {
  it('shows the offer without the business, and after Yes shows the booking', async () => {
    const api = mockApi({
      'GET /interviews/reply/otok': offer,
      'POST /interviews/reply/otok': {
        status: 'confirmed',
        booked: { businessName: 'Sri Sai Hotel', address: '27th Main', area: 'HSR Layout Sector 2', slotStartsAt: offer.slotStartsAt, slotEndsAt: offer.slotEndsAt, contactPerson: 'Mr. Prakash' },
      },
    });
    render();
    expect(await screen.findByRole('heading', { name: 'रमेश, आपके लिए नौकरी का ऑफ़र'.replace('रमेश', 'Ramesh') })).toBeInTheDocument();
    await waitFor(() => expect(document.documentElement.lang).toBe('hi'));
    await userEvent.click(screen.getByRole('button', { name: 'EN' }));
    expect(screen.getByRole('heading', { name: 'A job offer for you, Ramesh' })).toBeInTheDocument();
    expect(screen.getByText('Electrician')).toBeInTheDocument();
    expect(screen.getByText('₹16,000–18,000 a month')).toBeInTheDocument();
    expect(screen.getByText(/uses up your 30-day guarantee/)).toBeInTheDocument();
    expect(screen.queryByText('Sri Sai Hotel')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: "Yes, I'll go" }));
    expect(api.calls('POST /interviews/reply/otok')[0]!.body).toEqual({ answer: 'yes' });
    expect(await screen.findByText("You're booked, Ramesh")).toBeInTheDocument();
    expect(screen.getByText('Sri Sai Hotel')).toBeInTheDocument();
    expect(screen.getByText('Mr. Prakash')).toBeInTheDocument();
    expect(screen.getByText(/Did they offer you the job\?/)).toBeInTheDocument();
  });

  it('asks before a No that ends the guarantee', async () => {
    const api = mockApi({ 'GET /interviews/reply/otok': { ...offer, language: null }, 'POST /interviews/reply/otok': { status: 'declined' } });
    render();
    await userEvent.click(await screen.findByRole('button', { name: 'No' }));
    expect(screen.getByText(/Saying no ends your 30-day guarantee/)).toBeInTheDocument();
    expect(api.calls('POST /interviews/reply/otok')).toHaveLength(0);
    await userEvent.click(screen.getAllByRole('button', { name: 'No' })[0]!);
    expect(api.calls('POST /interviews/reply/otok')[0]!.body).toEqual({ answer: 'no' });
    expect(await screen.findByText('Thank you for letting us know')).toBeInTheDocument();
  });

  it('says a below-minimum offer can be refused without losing the guarantee', async () => {
    mockApi({ 'GET /interviews/reply/otok': { ...offer, language: null, belowGuaranteeFloor: true } });
    render();
    expect(await screen.findByText(/saying no doesn't affect your guarantee/)).toBeInTheDocument();
  });

  it('explains a used link', async () => {
    mockApi({ 'GET /interviews/reply/otok': apiError(400, 'Consent link has already been used') });
    render();
    expect(await screen.findByText(/already been used/)).toBeInTheDocument();
  });
});
