import { Platform } from 'react-native';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { BottomBar } from './BottomBar';
import { CodeInput } from './CodeInput';
import { QuickActions } from './QuickActions';

describe('Version 2 pieces', () => {
  it('quick actions show at most four shortcuts and each one works', async () => {
    const press = jest.fn();
    const actions = ['a', 'b', 'c', 'd', 'e'].map((k) => ({ key: k, label: `Do ${k}`, icon: 'help' as const, accent: 'royal' as const, onPress: () => press(k) }));
    await render(<QuickActions actions={actions} testID="q" />);
    expect(screen.queryByTestId('q-e')).toBeNull();
    await fireEvent.press(screen.getByTestId('q-c'));
    expect(press).toHaveBeenCalledWith('c');
  });

  it('the bottom bar puts the main action in the middle and marks the current place', async () => {
    const add = jest.fn();
    const items = ['home', 'messages', 'profiles', 'help'].map((k) => ({ key: k, label: k, icon: 'home' as const, onPress: jest.fn(), active: k === 'home' }));
    await render(<BottomBar items={items} centre={{ label: 'Add vacancy', icon: 'plus', onPress: add, testID: 'centre' }} testID="bar" />);
    await fireEvent.press(screen.getByTestId('centre'));
    expect(add).toHaveBeenCalled();
    expect(screen.getByTestId('bar-home').props.accessibilityState).toEqual({ selected: true });
  });

  it('the code boxes ask the phone to offer the SMS code, and carry on once all six digits are in', async () => {
    const done = jest.fn();
    await render(<CodeInput label="Code" value="" onChange={() => undefined} onComplete={done} testID="code" />);
    const input = screen.getByTestId('code');
    expect(input.props.autoComplete).toBe(Platform.OS === 'android' ? 'sms-otp' : 'one-time-code');
    expect(input.props.textContentType).toBe('oneTimeCode');
    await fireEvent.changeText(input, '482719');
    expect(done).toHaveBeenCalledWith('482719');
  });
});
