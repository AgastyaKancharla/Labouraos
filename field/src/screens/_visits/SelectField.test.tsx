import { fireEvent, render, screen } from '@testing-library/react-native';
import { I18nProvider } from '@/i18n';
import { SelectField } from './SelectField';

const choices = [
  { value: 'restaurant', label: 'Restaurant', group: 'Food & hospitality' },
  { value: 'tea_coffee_stall', label: 'Tea / coffee stall', group: 'Food & hospitality' },
  { value: 'dairy', label: 'Dairy', group: 'Agriculture' },
] as const;

async function open(onChange = jest.fn()) {
  await render(
    <I18nProvider>
      <SelectField label="Type of business" value="" choices={choices} onChange={onChange} searchable testID="type" />
    </I18nProvider>,
  );
  await fireEvent.press(screen.getByTestId('type'));
  return onChange;
}

describe('SelectField with a search box (26 Nov: the list closed when the search box was tapped)', () => {
  it('tapping and typing in the search box keeps the list open', async () => {
    await open();
    await fireEvent.press(screen.getByTestId('type-search'));
    expect(screen.getByTestId('type-restaurant')).toBeTruthy();
    await fireEvent.changeText(screen.getByTestId('type-search'), 'tea');
    expect(screen.getByTestId('type-tea_coffee_stall')).toBeTruthy();
    expect(screen.queryByTestId('type-restaurant')).toBeNull();
  });

  it('tapping outside the sheet closes it and the next open shows the whole list', async () => {
    await open();
    await fireEvent.changeText(screen.getByTestId('type-search'), 'tea');
    await fireEvent.press(screen.getByTestId('type-backdrop'));
    expect(screen.queryByTestId('type-tea_coffee_stall')).toBeNull();
    await fireEvent.press(screen.getByTestId('type'));
    expect(screen.getByTestId('type-search').props.value).toBe('');
    expect(screen.getByTestId('type-restaurant')).toBeTruthy();
  });

  it('picking a choice sets it and closes the list', async () => {
    const onChange = await open();
    await fireEvent.press(screen.getByTestId('type-dairy'));
    expect(onChange).toHaveBeenCalledWith('dairy');
    expect(screen.queryByTestId('type-search')).toBeNull();
  });
});
