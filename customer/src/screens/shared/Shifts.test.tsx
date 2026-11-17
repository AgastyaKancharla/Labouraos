import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import { account, bizProfile } from '@/test/fixtures';
import { fakeApi, renderWithApp } from '@/test/render';
import { hhmm, ShiftsCard } from './Shifts';

jest.mock('expo-router', () => require('@/test/expo-router-mock'));

const morning = { id: 'sh-1', name: 'Morning', startTime: '07:00', endTime: '15:00', label: 'Morning 07:00–15:00', category: 'day' as const };

describe('Your shifts (17 Nov)', () => {
  it('reads times as HH:MM', () => {
    expect(hhmm('7')).toBe('07:00');
    expect(hhmm('22:30')).toBe('22:30');
    expect(hhmm('24:00')).toBeNull();
    expect(hhmm('7pm')).toBeNull();
  });

  it('the owner sees, adds and removes his business\'s shifts', async () => {
    const api = fakeApi({
      shifts: async () => [morning],
      addShift: async (_p: string, input: { name: string; startTime: string; endTime: string }) => ({ id: 'sh-2', ...input, label: `${input.name} ${input.startTime}–${input.endTime}`, category: 'day' as const }),
      removeShift: async () => undefined,
    });
    await renderWithApp(<ShiftsCard profileId="p-biz" />, { api, account: account({ profiles: [bizProfile] }) });
    await waitFor(() => screen.getByTestId('shift-sh-1'));
    expect(screen.getByTestId('shifts-card')).toHaveTextContent(/Your shifts.*Morning 07:00–15:00/);
    await fireEvent.press(screen.getByTestId('shift-add'));
    await fireEvent.press(screen.getByTestId('add-shift-save'));
    expect(screen.getByTestId('add-shift-invalid')).toBeTruthy();
    await fireEvent.changeText(screen.getByTestId('add-shift-name'), 'Evening');
    await fireEvent.changeText(screen.getByTestId('add-shift-start'), '15:00');
    await fireEvent.changeText(screen.getByTestId('add-shift-end'), '23:00');
    await fireEvent.press(screen.getByTestId('add-shift-save'));
    await waitFor(() => screen.getByTestId('shift-sh-2'));
    await fireEvent.press(screen.getByTestId('shift-remove-sh-1'));
    await waitFor(() => expect(screen.queryByTestId('shift-sh-1')).toBeNull());
    expect(api.removeShift).toHaveBeenCalledWith('p-biz', 'sh-1');
  });
});
