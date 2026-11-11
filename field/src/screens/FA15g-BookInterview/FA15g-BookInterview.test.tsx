import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { todayKeyIst } from '@/components/form';
import { kiran, renderWithApp } from '@/test/render';
import { routeTable, settings } from '@/test/selling-fixtures';
import BookInterviewScreen from '.';

jest.mock('expo-router', () => require('@/test/expo-router-mock'));
beforeEach(() => jest.clearAllMocks());

const ctx = { vacancyId: 'vac-1', trade: 'Cook', businessName: 'Annapoorna Mess', candidateFirstName: 'Manjunath', attendanceRequired: true, walkInStart: '10:30', walkInEnd: '18:00', threeWayCalls: true };

describe('FA15g Book interview', () => {
  it('books with a picked date and time; "I will attend" is ticked and locked for a first interview', async () => {
    (useLocalSearchParams as jest.Mock).mockReturnValue({ vacancyId: 'vac-1', jobSeekerId: 'js-1' });
    const { route, calls } = routeTable({
      '/screens/field-selling/vacancies/vac-1/booking?jobSeekerId=js-1': ctx,
      '/screens/field-selling/settings': settings,
      'POST /field-selling/interviews': { interviewId: 'iv-7', type: 'at_shop', slotStartsAt: '', slotEndsAt: '', agentWillAttend: true },
    });
    await renderWithApp(<BookInterviewScreen />, { signedInAs: kiran, route });
    await waitFor(() => screen.getByText('Manjunath → Annapoorna Mess · Cook'));
    expect(screen.getByTestId('attend')).toBeDisabled();
    expect(screen.getByTestId('book')).toBeDisabled();
    const today = todayKeyIst();
    await fireEvent.press(screen.getByTestId('date'));
    await fireEvent.press(screen.getByTestId(`date-day-${today}`));
    await fireEvent.press(screen.getByTestId('time'));
    await fireEvent.press(screen.getByTestId('time-option-20:00'));
    await fireEvent.press(screen.getByTestId('book'));
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith('/job-seekers/interview/iv-7/booked'));
    expect(calls).toContainEqual({
      method: 'POST', path: '/field-selling/interviews',
      body: { date: today, time: '20:00', type: 'at_shop', agentWillAttend: true, vacancyId: 'vac-1', jobSeekerId: 'js-1' },
    });
  });

  it('from "Wants to meet" it books through the in-shop interview; walk-in uses the window', async () => {
    (useLocalSearchParams as jest.Mock).mockReturnValue({ vacancyId: 'vac-1', jobSeekerId: 'js-1', from: 'iv-1' });
    const { route, calls } = routeTable({
      '/screens/field-selling/vacancies/vac-1/booking?jobSeekerId=js-1': { ...ctx, attendanceRequired: false, threeWayCalls: false },
      '/screens/field-selling/settings': settings,
      'POST /field-selling/interviews/iv-1/meet': { interviewId: 'iv-8', type: 'walk_in', slotStartsAt: '', slotEndsAt: '', agentWillAttend: false },
    });
    await renderWithApp(<BookInterviewScreen />, { signedInAs: kiran, route });
    await waitFor(() => screen.getByTestId('type'));
    expect(screen.getByText(/3-way calls/)).toBeTruthy();
    await fireEvent.press(screen.getByTestId('type'));
    expect(screen.queryByTestId('type-option-phone')).toBeNull();
    await fireEvent.press(screen.getByTestId('type-option-walk_in'));
    await fireEvent.press(screen.getByTestId('date'));
    await fireEvent.press(screen.getByTestId(`date-day-${todayKeyIst()}`));
    await fireEvent.press(screen.getByTestId('book'));
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith('/job-seekers/interview/iv-8/booked'));
    expect(calls).toContainEqual({ method: 'POST', path: '/field-selling/interviews/iv-1/meet', body: { date: todayKeyIst(), time: '10:30', type: 'walk_in', agentWillAttend: false } });
  });
});
