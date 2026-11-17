import { screen, waitFor } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { kiran, renderWithApp } from '@/test/render';
import { business, matchesPage, routeTable } from '@/test/selling-fixtures';
import MatchesScreen from '@/screens/FA15b-Matches';
import { CodeInput } from './CodeInput';
import { TopBar } from './TopBar';

jest.mock('expo-router', () => require('@/test/expo-router-mock'));

/**
 * Fix list A8 (16 Nov): everything tappable is at least 44 × 44 px (the
 * logo was 30, the account 36, the language 36 high, "Change" 48 × 20, the
 * vacancy chips and "+ Vacancy" 40 high), and the six code boxes fit their
 * card at 360 px.
 */
const MIN = 44;
const size = (node: { props: { style?: unknown } }) => StyleSheet.flatten(node.props.style as never) as Record<string, number | undefined>;
const tall = (s: Record<string, number | undefined>) => Math.max(s.height ?? 0, s.minHeight ?? 0);
const wide = (s: Record<string, number | undefined>) => Math.max(s.width ?? 0, s.minWidth ?? 0);

describe('tap targets of at least 44 px (A8)', () => {
  it('the header: logo and account (no language switcher, rev 193)', async () => {
    await renderWithApp(<TopBar title="Today" personName="Kiran Kumar" onLogout={() => undefined} />, { signedInAs: kiran });
    for (const id of ['logo-home', 'account-menu']) {
      const s = size(screen.getByTestId(id));
      expect(tall(s)).toBeGreaterThanOrEqual(MIN);
      expect(wide(s)).toBeGreaterThanOrEqual(MIN);
    }
    expect(screen.queryByTestId('language-switcher')).toBeNull();
  });

  it('the candidates page: "Change", the vacancy chips and "+ Vacancy"', async () => {
    (useLocalSearchParams as jest.Mock).mockReturnValue({ businessId: 'biz-1' });
    const { route } = routeTable({
      '/screens/field-selling/businesses/biz-1': business,
      '/screens/field-selling/vacancies/vac-1/matches?page=1': matchesPage(1),
      'POST /vacancies/vac-1/introductions/in-person': { count: 3 },
    });
    await renderWithApp(<MatchesScreen />, { signedInAs: kiran, route });
    await waitFor(() => screen.getByTestId('vacancy-chip-VC-0001'));
    const change = size(screen.getByTestId('change-business'));
    expect(tall(change)).toBeGreaterThanOrEqual(MIN);
    expect(wide(change)).toBeGreaterThanOrEqual(MIN);
    expect(tall(size(screen.getByTestId('vacancy-chip-VC-0001')))).toBeGreaterThanOrEqual(MIN);
    expect(tall(size(screen.getByTestId('add-vacancy')))).toBeGreaterThanOrEqual(MIN);
  });
});

describe('the six code boxes fit their card (A8)', () => {
  it('share the width (flex), with no fixed width that overflows at 360 px', async () => {
    await renderWithApp(<CodeInput value="12" onChange={() => undefined} label="Code" testID="code" />);
    type Json = { props?: { style?: unknown }; children?: (Json | string)[] | null };
    const boxes: Json[] = [];
    const walk = (node: Json | string | null) => {
      if (!node || typeof node === 'string') return;
      if (node.props?.style && size(node as { props: { style?: unknown } }).height === 52) boxes.push(node);
      for (const child of node.children ?? []) walk(child);
    };
    const tree = screen.toJSON() as Json | Json[] | null;
    for (const node of Array.isArray(tree) ? tree : [tree]) walk(node);
    expect(boxes.length).toBeGreaterThanOrEqual(6);
    for (const box of boxes.slice(0, 6)) {
      const s = size(box as { props: { style?: unknown } });
      expect(s.width).toBeUndefined();
      expect(s.flex).toBe(1);
      expect(s.maxWidth).toBeLessThanOrEqual(48);
    }
  });
});
