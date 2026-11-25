import { useState } from 'react';
import { StyleSheet } from 'react-native';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { I18nProvider } from '@/i18n';
import { createMemoryStore } from '@/lib/storage';
import { ChipPicker, DateField, SelectField, formatTypedDate, typedToDateKey } from './index';

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

describe('long lists scroll', () => {
  it('the list has its own height limit (Android does not scroll a list that only its box limits)', async () => {
    await wrap(<Area />);
    await fireEvent.press(screen.getByTestId('area'));
    const list = screen.getByTestId('choice-sheet-list');
    const style = StyleSheet.flatten(list.props.style);
    expect(typeof style.maxHeight).toBe('number');
    expect(style.maxHeight).toBeGreaterThan(0);
  });
});

describe('DateField: type it or pick it (24 Nov)', () => {
  it('formats as it is typed and only accepts real dates', () => {
    expect(formatTypedDate('2411')).toBe('24/11');
    expect(formatTypedDate('24112026')).toBe('24/11/2026');
    expect(typedToDateKey('24/11/2026')).toBe('2026-11-24');
    expect(typedToDateKey('31/02/2026')).toBeNull();
  });

  it('a typed date inside the range is passed on; outside it is refused with the range', async () => {
    const changes: string[] = [];
    function Harness() {
      const [v, setV] = useState('');
      return (
        <DateField
          label="Start date"
          value={v}
          onChange={(k) => {
            changes.push(k);
            setV(k);
          }}
          min="2026-11-24"
          max="2027-05-23"
          testID="d"
        />
      );
    }
    await render(
      <I18nProvider storage={createMemoryStore()} initialLanguage="en">
        <Harness />
      </I18nProvider>,
    );
    await fireEvent.changeText(screen.getByTestId('d-type'), '01122026');
    expect(changes).toEqual(['2026-12-01']);
    expect(screen.getByTestId('d-value')).toHaveTextContent('Tue 1 Dec 2026');
    await fireEvent.changeText(screen.getByTestId('d-type'), '01012020');
    expect(screen.getByTestId('d-error')).toHaveTextContent('Choose a date from Tue 24 Nov 2026 to Sun 23 May 2027.');
  });
});
