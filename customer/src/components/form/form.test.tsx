import { useState } from 'react';
import { StyleSheet } from 'react-native';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { I18nProvider } from '@/i18n';
import { createMemoryStore } from '@/lib/storage';
import { ChipPicker, PinField, SelectField } from './index';

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

describe('Locate me', () => {
  const Location = jest.requireMock('expo-location') as { requestForegroundPermissionsAsync: jest.Mock };
  const config = jest.requireActual('@/api/config') as typeof import('@/api/config');

  function Place({ onChange }: { onChange: (pin: unknown) => void }) {
    const [pin, setPin] = useState<import('@/api/types').Pin | null>(null);
    return (
      <PinField
        label="Shop on the map"
        value={pin}
        center={{ latitude: 12.93, longitude: 77.62 }}
        onChange={(p) => {
          setPin(p);
          onChange(p);
        }}
        testID="pin"
      />
    );
  }

  afterEach(() => jest.restoreAllMocks());

  it('reads the GPS, opens the map there, and saves where the person moved the pin', async () => {
    const onChange = jest.fn();
    await wrap(<Place onChange={onChange} />);
    await fireEvent.press(screen.getByTestId('pin'));
    expect(await screen.findByTestId('pin-map')).toBeTruthy();
    expect(screen.getByTestId('pin-map-view').props).toBeTruthy();
    await act(async () => {
      (globalThis as unknown as { __moveMap: (r: object) => void }).__moveMap({ latitude: 12.91675, longitude: 77.610234, latitudeDelta: 0.003, longitudeDelta: 0.003 });
    });
    await fireEvent.press(screen.getByTestId('pin-map-save'));
    expect(onChange).toHaveBeenCalledWith({ latitude: 12.91675, longitude: 77.610234, accuracyM: null });
    expect(screen.queryByTestId('pin-map')).toBeNull();
    expect(screen.getByTestId('pin-saved')).toHaveTextContent('Place saved on the map.');
  });

  it('without GPS permission the map still opens, on the chosen area', async () => {
    Location.requestForegroundPermissionsAsync.mockResolvedValueOnce({ granted: false });
    const onChange = jest.fn();
    await wrap(<Place onChange={onChange} />);
    await fireEvent.press(screen.getByTestId('pin'));
    expect(await screen.findByTestId('pin-map')).toBeTruthy();
    expect(screen.getByText(/Find the place on the map yourself/)).toBeTruthy();
    await fireEvent.press(screen.getByTestId('pin-map-cancel'));
    expect(onChange).not.toHaveBeenCalled();
  });

  it('a build without a map keeps the GPS-only pin', async () => {
    jest.spyOn(config, 'mapAvailable').mockReturnValue(false);
    const onChange = jest.fn();
    await wrap(<Place onChange={onChange} />);
    await fireEvent.press(screen.getByTestId('pin'));
    await waitFor(() => expect(onChange).toHaveBeenCalledWith({ latitude: 12.9166, longitude: 77.6101, accuracyM: 15 }));
    expect(screen.queryByTestId('pin-map')).toBeNull();
  });
});
