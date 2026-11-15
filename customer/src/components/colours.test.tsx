import { StyleSheet } from 'react-native';
import { render, screen } from '@testing-library/react-native';
import { I18nProvider } from '@/i18n';
import { createMemoryStore } from '@/lib/storage';
import { accents, colors, heroGradient } from '@/theme';
import { Card } from './Card';
import { HeroCard } from './HeroCard';
import { IconTile } from './IconTile';
import { StatGrid, StatTile } from './StatTile';
import { StatusChip } from './StatusChip';
import { StepList } from './StepList';
import { Text } from './Text';

const flat = (node: { props: { style?: unknown } }) => StyleSheet.flatten(node.props.style as never) as Record<string, unknown>;

async function renderI18n(ui: React.ReactElement) {
  return render(
    <I18nProvider storage={createMemoryStore()} initialLanguage="en">
      {ui}
    </I18nProvider>,
  );
}

describe('HeroCard', () => {
  it('royal → navy gradient with white title, the role line and its content', async () => {
    await render(
      <HeroCard eyebrow="Job seeker · JS-1234" title="Ravi" emoji="🔍" testID="hero">
        <Text>Day 12 of 30</Text>
      </HeroCard>,
    );
    expect(screen.getByTestId('hero')).toHaveTextContent(/Job seeker · JS-1234.*Ravi.*Day 12 of 30/);
    expect(flat(screen.getByText('Ravi')).color).toBe(colors.white);
    const gradient = screen.getByTestId('hero').children[0] as { props: { colors?: unknown } };
    expect(gradient.props.colors).toEqual(heroGradient.colors);
  });
});

describe('StatTile', () => {
  it('coloured top bar; royal keeps the number in ink', async () => {
    await render(
      <StatGrid>
        <StatTile label="Vacancies" value={3} accent="royal" icon="briefcase" testID="tile" />
      </StatGrid>,
    );
    expect(flat(screen.getByTestId('tile-bar-royal')).backgroundColor).toBe(colors.blue);
    expect(flat(screen.getByText('3')).color).toBe(colors.ink);
    expect(screen.getByTestId('tile').props.accessibilityLabel).toBe('Vacancies: 3');
  });

  it.each([
    ['good', colors.green],
    ['gold', colors.amber],
    ['orange', colors.crit],
    ['red', colors.tomato],
  ] as const)('warning tone %s colours the number in its text-safe colour and tints the border', async (accent, fg) => {
    await render(<StatTile label="Due" value="₹200" accent={accent} testID="tile" />);
    expect(flat(screen.getByText('₹200')).color).toBe(fg);
    expect(flat(screen.getByTestId(`tile-bar-${accent}`)).backgroundColor).toBe(accents[accent].raw);
    expect(flat(screen.getByTestId('tile')).borderColor).toBe(accents[accent].border);
  });
});

describe('IconTile, StatusChip and Card accent', () => {
  it('icon tile fills with the raw colour', async () => {
    await render(<IconTile icon="camera" accent="gold" testID="t" />);
    expect(flat(screen.getByTestId('t-gold', { includeHiddenElements: true })).backgroundColor).toBe(colors.goldRaw);
  });

  it('chip uses the text-safe colour on its light background', async () => {
    await render(<StatusChip label="Checks pending" tone="amber" />);
    expect(flat(screen.getByText('Checks pending')).color).toBe(colors.amber);
  });

  it('card gets a small coloured bar above its title', async () => {
    await render(
      <Card title="Call me back" accent="cyan" emoji="📞" testID="c">
        <Text>x</Text>
      </Card>,
    );
    expect(flat(screen.getByTestId('c-accent-cyan')).backgroundColor).toBe(colors.cyanRaw);
    expect(screen.getByText('Call me back')).toBeTruthy();
  });
});

describe('StepList with colour-coded steps', () => {
  it('each step has its own tile colour, done steps a green tick, the next step highlighted', async () => {
    await renderI18n(
      <StepList
        testID="s"
        steps={[
          { key: 'phone', label: 'Mobile number checked', state: 'done', icon: 'phone', accent: 'royal' },
          { key: 'selfie', label: 'Selfie', state: 'in_progress', icon: 'camera', accent: 'gold' },
          { key: 'id', label: 'ID check', state: 'not_started', icon: 'id-card', accent: 'orange' },
        ]}
      />,
    );
    expect(screen.getByTestId('s-phone-tile-royal', { includeHiddenElements: true })).toBeTruthy();
    expect(screen.getByTestId('s-selfie-tile-gold', { includeHiddenElements: true })).toBeTruthy();
    expect(screen.getByTestId('s-id-tile-orange', { includeHiddenElements: true })).toBeTruthy();
    expect(screen.getByTestId('s-phone-tick')).toBeTruthy();
    expect(flat(screen.getByTestId('s-selfie-in_progress')).backgroundColor).toBe(colors.amber100);
    expect(flat(screen.getByTestId('s-id-not_started')).backgroundColor).toBeUndefined();
    expect(screen.getByTestId('s-selfie-in_progress').props.accessibilityLabel).toBe('Selfie: In progress');
  });
});
