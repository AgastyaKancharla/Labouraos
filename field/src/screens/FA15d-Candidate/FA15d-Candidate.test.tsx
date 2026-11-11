import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { kiran, renderWithApp } from '@/test/render';
import { candidate, routeTable } from '@/test/selling-fixtures';
import CandidateScreen from '.';

jest.mock('expo-router', () => require('@/test/expo-router-mock'));

describe('FA15d Candidate card', () => {
  it('shows what the owner may see — never a phone, last name, address or date of birth — and calls to confirm', async () => {
    (useLocalSearchParams as jest.Mock).mockReturnValue({ jobSeekerId: 'js-1', vacancyId: 'vac-1' });
    const { route } = routeTable({ '/screens/field-selling/candidates/js-1?vacancyId=vac-1': candidate });
    await renderWithApp(<CandidateScreen />, { signedInAs: kiran, route });
    await waitFor(() => screen.getByText('Manjunath, 27'));
    expect(screen.getByText('Cook · 5 years · JS-00241')).toBeTruthy();
    expect(screen.getByText('2 km · Madiwala')).toBeTruthy();
    expect(screen.getByText('₹15,000–17,000 a month')).toBeTruthy();
    expect(screen.getByText('Cook · Udupi Grand')).toBeTruthy();
    expect(screen.getByText('Immediately')).toBeTruthy();
    expect(screen.getByTestId('why')).toHaveTextContent('Why he matches: same trade, salary fits, lives 2 km away, day 26 of his 30');
    expect(screen.getByTestId('like')).toHaveTextContent('♥ Owner likes');
    await fireEvent.press(screen.getByTestId('call-to-confirm'));
    expect(router.push).toHaveBeenCalledWith('/job-seekers/call?vacancyId=vac-1&jobSeekerId=js-1');
  });
});
