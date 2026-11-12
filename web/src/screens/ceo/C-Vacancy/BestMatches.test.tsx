import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { mockApi, renderScreen, signInAs } from '../../../test/utils';
import { BestMatchesCard } from './BestMatches';

describe('C-Vacancy Best matches now', () => {
  it('lists the matching engine’s best candidates with why, and whether each was shown', async () => {
    const api = mockApi({
      'GET /vacancies/v1/shortlist': {
        total: 2,
        matches: [
          { jobSeekerId: 'js1', priority: true, daysLeft: 4, card: { firstName: 'Manjunath', age: 27, trade: 'Cook', yearsExperience: 5, distanceKm: 2.04, matchReasons: [] } },
          { jobSeekerId: 'js2', priority: false, daysLeft: null, card: { firstName: 'Anitha', age: 29, trade: 'Cook', yearsExperience: 4, distanceKm: 6, matchReasons: [] } },
        ],
      },
    });
    signInAs('ceo');
    renderScreen(<BestMatchesCard vacancyId="v1" shownIds={['js1']} />, { portal: 'ceo', path: '/ceo/vacancies/v1' });
    const table = await screen.findByRole('table', { name: 'Best matches now' });
    const first = (await within(table).findByRole('link', { name: 'Manjunath, 27' })).closest('tr')!;
    expect(within(first).getByText(/Cook 5 yrs · 2 km · close to a refund \(4 days left\)/)).toBeInTheDocument();
    expect(within(first).getByText('Shown')).toBeInTheDocument();
    const second = within(table).getByRole('link', { name: 'Anitha, 29' }).closest('tr')!;
    expect(within(second).getByText('Not shown yet')).toBeInTheDocument();
    expect(screen.getByText('2 matches')).toBeInTheDocument();
    expect(api.calls('GET /vacancies/v1/shortlist')).toHaveLength(1);
  });
});
