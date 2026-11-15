import { readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';
import { StyleSheet } from 'react-native';
import { render } from '@testing-library/react-native';
import { accents, colors, statTones, tones, type Accent } from '@/theme';
import { Emoji } from './Emoji';
import { HeroCard, HeroPill } from './HeroCard';
import { IconTile } from './IconTile';
import { StatGrid, StatTile } from './StatTile';
import { StatusChip } from './StatusChip';
import { Card } from './Card';

/** WCAG relative luminance and contrast ratio of two #RRGGBB colours. */
function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}
const flat = (style: unknown) => StyleSheet.flatten(style as never) as Record<string, unknown>;

describe('Command Center colours in Laboura Field (Master Guide rev 171–172)', () => {
  const names = Object.keys(accents) as Accent[];

  it('has the full palette: royal, navy, cyan, gold, orange, red and green', () => {
    expect(names.sort()).toEqual(['cyan', 'gold', 'green', 'navy', 'orange', 'red', 'royal']);
    expect([accents.royal.raw, accents.navy.raw, accents.cyan.raw, accents.gold.raw, accents.orange.raw, accents.red.raw, accents.green.raw]).toEqual([
      '#0055C0', '#032B73', '#02D0F8', '#FCCE00', '#FB6800', '#FE2901', '#1C9A6C',
    ]);
  });

  it('keeps words readable: text-safe colours reach 4.5:1 on white and on their light background', () => {
    for (const name of names) {
      const a = accents[name];
      expect([name, contrast(a.fg, colors.white) >= 4.5]).toEqual([name, true]);
      expect([name, contrast(a.fg, a.bg) >= 4.5]).toEqual([name, true]);
    }
    for (const [name, t] of Object.entries(tones)) {
      expect([name, contrast(t.fg, t.bg) >= 4.5]).toEqual([name, true]);
    }
    for (const [name, t] of Object.entries(statTones)) {
      expect([name, contrast(t.number, colors.white) >= 4.5]).toEqual([name, true]);
    }
  });

  it('draws icons on the raw colours at 3:1 or better, and white words only on royal, navy and the hero', () => {
    for (const name of names) expect([name, contrast(accents[name].on, accents[name].raw) >= 3]).toEqual([name, true]);
    expect(contrast(colors.white, colors.blue)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(colors.white, colors.navy)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(colors.onBlueSoft, colors.blue)).toBeGreaterThanOrEqual(4.5);
  });

  it('StatTile: a coloured bar on top; on the warning and success tones the number takes the text-safe colour', async () => {
    const screen = await render(
      <StatGrid>
        <StatTile accent="royal" value="6" label="shops visited" testID="royal" />
        <StatTile accent="gold" value="3" label="vacancies" testID="gold" />
      </StatGrid>,
    );
    expect(screen.getByTestId('royal')).toHaveTextContent('6shops visited');
    expect(screen.getByLabelText('3 vacancies')).toBeTruthy();
    expect(flat(screen.getByText('3').props.style).color).toBe(colors.amber);
    expect(flat(screen.getByText('6').props.style).color).toBe(colors.ink);
  });

  it('IconTile and Emoji are pictures only: hidden from screen readers and adding no words beside the drawn icon', async () => {
    const screen = await render(
      <>
        <IconTile icon="phone" accent="green" testID="tile" />
        <Emoji symbol="🏪" />
      </>,
    );
    // Not found by default: Testing Library skips what screen readers skip.
    expect(screen.queryByTestId('tile')).toBeNull();
    const tile = screen.getByTestId('tile', { includeHiddenElements: true });
    expect(tile.props.accessibilityElementsHidden).toBe(true);
    expect(flat(tile.props.style).backgroundColor).toBe(accents.green.raw);
    expect(screen.queryByText('🏪')).toBeNull();
    expect(screen.getByText('🏪', { includeHiddenElements: true }).props.accessibilityElementsHidden).toBe(true);
  });

  it('StatusChip: text-safe words with a raw-colour dot, no dot on the grey tone', async () => {
    const screen = await render(
      <>
        <StatusChip label="Overdue" tone="tomato" testID="red" />
        <StatusChip label="Not applicable" tone="neutral" testID="grey" />
      </>,
    );
    expect(flat(screen.getByText('Overdue').props.style).color).toBe(colors.tomato);
    expect(screen.getByTestId('red').children).toHaveLength(2);
    expect(screen.getByTestId('grey').children).toHaveLength(1);
  });

  it('HeroCard and Card titles keep their words (the colours are the only change)', async () => {
    const screen = await render(
      <>
        <HeroCard eyebrow="Today" title="Green Leaf Café" subtitle="BZ-00291" corner={<HeroPill label="Sun 15 Nov" />} testID="hero" />
        <Card title="Alerts" icon="bell" accent="orange" testID="card" />
      </>,
    );
    expect(screen.getByTestId('hero')).toHaveTextContent('TodaySun 15 NovGreen Leaf CaféBZ-00291');
    expect(screen.getByTestId('card')).toHaveTextContent('Alerts');
  });

  it('screens use token names, never raw hex colours', () => {
    const root = join(__dirname, '..', 'screens');
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const f of readdirSync(dir)) {
        const p = join(dir, f);
        if (statSync(p).isDirectory()) walk(p);
        else if (/\.tsx?$/.test(f) && !/\.test\./.test(f)) files.push(p);
      }
    };
    walk(root);
    // The few hand-picked borders the designs already had (match card, map rings, scripts) are the only exceptions.
    const allowed = new Set(['#A9DEC7', '#F2A68F', '#B7C3DD', '#C7DAF5', '#9DB3DE', '#E9EFFA']);
    const offenders = files.flatMap((p) =>
      (readFileSync(p, 'utf8').match(/#[0-9A-Fa-f]{6}\b/g) ?? []).filter((hex) => !allowed.has(hex.toUpperCase())).map((hex) => `${p}: ${hex}`),
    );
    expect(offenders).toEqual([]);
  });
});
