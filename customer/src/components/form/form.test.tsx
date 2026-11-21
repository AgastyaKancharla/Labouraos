import { useState } from 'react';
import { StyleSheet } from 'react-native';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { I18nProvider } from '@/i18n';
import { createMemoryStore } from '@/lib/storage';
import { ChipPicker, SelectField } from './index';

const AREAS = ['BTM Layout', 'Jayanagar', 'HSR Layout', 'Koramangala', 'Indiranagar', 'Whitefield', 'Marathahalli', 'Yelahanka', 'Hebbal', 'Banashankari', 'Rajajinagar', 'Malleshwaram'].map((a) => ({ value: a, label: a }));

function Area() {
  const [value, setValue] = useState('');
  return <SelectField label="Area" value={value} choices={AREAS} onChange={setValue} testID="area" />;
}

function Trades() {
  const [values, setValues] = useState<string[]>([]);
  return <ChipPicker label="Trades" values={values} choices={AREAS} onChange={setValues} addLabel="+ Add" testID="trades" />;
}

const wrap = async (ui: React.ReactElement) => render(<I18nProvider storage={createMemoryStore()} initialLanguage="en">{ui}</I18nProvider>);

describe('choice sheets', () => {
  it('a long list gets a search box that narrows the choices', async () => {
    await wrap(<Area />);
    await fireEvent.press(screen.getByTestId('area'));
    expect(screen.getByTestId('area-option-Whitefield')).toBeTruthy();
    await fireEvent.changeText(screen.getByTestId('area-search'), 'layout');
    expect(screen.getByTestId('area-option-BTM Layout')).toBeTruthy();
    expect(screen.getByTestId('area-option-HSR Layout')).toBeTruthy();
    expect(screen.queryByTestId('area-option-Whitefield')).toBeNull();
    await fireEvent.changeText(screen.getByTestId('area-search'), 'zzz');
    expect(screen.getByText('Nothing matches. Try another spelling.')).toBeTruthy();
    await fireEvent.changeText(screen.getByTestId('area-search'), 'hsr');
    await fireEvent.press(screen.getByTestId('area-option-HSR Layout'));
    expect(screen.getByTestId('area')).toHaveTextContent(/HSR Layout/);
  });

  it('the list is not inside a pressable (so it scrolls on Android); the backdrop beside it closes the sheet', async () => {
    await wrap(<Trades />);
    await fireEvent.press(screen.getByTestId('trades-add'));
    const option = screen.getByTestId('trades-option-Hebbal');
    // Walk up from an option: no ancestor between it and the modal may take presses.
    let node = option.parent;
    let pressableAncestors = 0;
    while (node) {
      if (node.props.onPress && node !== option) pressableAncestors += 1;
      node = node.parent;
    }
    expect(pressableAncestors).toBe(0);
    const backdrop = screen.getByLabelText('Close');
    expect(StyleSheet.flatten(backdrop.props.style)).toMatchObject({ position: 'absolute' });
  });
});
