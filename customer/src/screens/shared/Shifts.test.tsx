import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import { account, bizProfile } from '@/test/fixtures';
import { fakeApi, renderWithApp } from '@/test/render';
import { apiErrorFromBody } from '@/api/errors';
import { hhmm, ShiftsCard } from './Shifts';

jest.mock('expo-router', () => require('@/test/expo-router-mock'));

const morning = { id: 'sh-1', name: 'Morning', startTime: '07:00', endTime: '15:00', label: 'Morning 07:00–15:00', category: 'day' as const };

describe('Your shifts (17 Nov)', () => {
  it('reads times as HH:MM', () => {
    expect(hhmm('7')).toBe('07:00');
    expect(hhmm('22:30')).toBe('22:30');
    expect(hhmm('7 AM')).toBe('07:00');
    expect(hhmm('7:30pm')).toBe('19:30');
    expect(hhmm('12 am')).toBe('00:00');
    expect(hhmm('24:00')).toBeNull();
    expect(hhmm('13 pm')).toBeNull();
    expect(hhmm('seven')).toBeNull();
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
    expect(screen.getByTestId('shift-confirm-sh-1')).toHaveTextContent(/Remove Morning 07:00–15:00\?/);
    expect(api.removeShift).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByTestId('shift-remove-yes-sh-1'));
    await waitFor(() => expect(screen.queryByTestId('shift-sh-1')).toBeNull());
    expect(api.removeShift).toHaveBeenCalledWith('p-biz', 'sh-1');
  });

  it('a shift name already used shows the server\'s real message (live error shape)', async () => {
    const api = fakeApi({
      shifts: async () => [morning],
      addShift: async () => {
        throw apiErrorFromBody(409, {
          statusCode: 409,
          message: 'This business already has a shift with this name',
          details: { statusCode: 409, code: 'VALIDATION_FAILED', message: 'This business already has a shift with this name', field: 'name' },
        });
      },
    });
    await renderWithApp(<ShiftsCard profileId="p-biz" />, { api, account: account({ profiles: [bizProfile] }) });
    await waitFor(() => screen.getByTestId('shift-sh-1'));
    await fireEvent.press(screen.getByTestId('shift-add'));
    await fireEvent.changeText(screen.getByTestId('add-shift-name'), 'Morning');
    await fireEvent.changeText(screen.getByTestId('add-shift-start'), '6 AM');
    await fireEvent.changeText(screen.getByTestId('add-shift-end'), '2 PM');
    await fireEvent.press(screen.getByTestId('add-shift-save'));
    await waitFor(() => expect(screen.getByTestId('add-shift-error')).toHaveTextContent('This business already has a shift with this name'));
    expect(api.addShift).toHaveBeenCalledWith('p-biz', { name: 'Morning', startTime: '06:00', endTime: '14:00' });
  });
});
