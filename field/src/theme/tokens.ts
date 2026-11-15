/**
 * Design tokens copied from the approved field agent designs (FA01–FA22,
 * `:root` block), plus the Command Center's full palette (Master Guide rev
 * 171–172, web/src/styles/tokens.css). Screens use these names, never raw hex
 * values, so a colour change happens in one place.
 */
export const colors = {
  ink: '#0B1E4A',
  soft: '#49588A',
  faint: '#5E6C96',
  bg: '#EEF3FC',
  surface: '#FFFFFF',
  border: '#DCE4F3',
  blue: '#0055C0',
  blueDark: '#003593',
  bluePressed: '#004AA8',
  blue100: '#E3EDFB',
  navy: '#032B73',
  navSoft: '#CFE4FF',
  navAccent: '#6EC3FF',
  cyanRaw: '#02D0F8',
  gold: '#FCCE00',
  /** Raw brand orange and red (Command Center `--orange-raw`, `--red-raw`): bars, fills, icon tiles only, never text. */
  orangeRaw: '#FB6800',
  redRaw: '#FE2901',
  navy100: '#E2E7F3',
  /** White text on the blue hero card, second line (Command Center `--nav-text-soft`). */
  onBlueSoft: '#CFE4FF',
  green: '#1C9A6C',
  /** Text-safe green for words on white and on green100 (5.7:1 and 5.0:1); `green` stays for fills and bars. */
  greenText: '#137552',
  green100: '#E1F5EC',
  amber: '#92670A',
  amber100: '#FFF4CC',
  amberBorder: '#F0DE95',
  cyan: '#0B6E82',
  cyan100: '#DCF6FD',
  tomato: '#BB232B',
  tomato100: '#FAE2E1',
  /** Text-safe orange (a shade darker than the Command Center's #B94E12 so chip words pass 4.5:1 on crit100). */
  crit: '#A8460F',
  crit100: '#FFE7D6',
  neutral100: '#F1F5FC',
  white: '#FFFFFF',
  overlay: 'rgba(11,30,74,0.55)',
} as const;

/** Header and tab bar gradient (top → bottom). */
export const headerGradient = [colors.blue, colors.blueDark] as const;

/** The blue hero card (Command Center `.hero`: 135°, navy → royal). */
export const heroGradient = [colors.navy, colors.blue] as const;

/** The thin Laboura "swoosh" stripe under the header and above the tab bar. */
export const swoosh = {
  colors: [colors.blue, colors.cyanRaw, colors.cyanRaw, colors.gold, colors.orangeRaw, colors.redRaw] as const,
  locations: [0, 0.38, 0.4, 0.4, 0.76, 1] as const,
};

/**
 * The full Laboura palette the way the Command Center uses it (Master Guide
 * rev 171–172): every accent has
 * - `raw`  the bright brand colour — bars, fills, icon tiles, large shapes only;
 * - `fg`   a text-safe version for words on white or on `bg`;
 * - `bg`   a light background for chips and soft tiles;
 * - `on`   the colour of an icon or number drawn ON `raw`
 *          (white on royal, navy, red and green; navy on cyan, gold and orange,
 *          which keeps every icon at 3:1 or better).
 * Mix them across tiles and lists — not one colour per thing.
 */
export const accents = {
  royal: { raw: colors.blue, fg: colors.blue, bg: colors.blue100, on: colors.white },
  navy: { raw: colors.navy, fg: colors.navy, bg: colors.navy100, on: colors.white },
  cyan: { raw: colors.cyanRaw, fg: colors.cyan, bg: colors.cyan100, on: colors.navy },
  gold: { raw: colors.gold, fg: colors.amber, bg: colors.amber100, on: colors.navy },
  orange: { raw: colors.orangeRaw, fg: colors.crit, bg: colors.crit100, on: colors.navy },
  red: { raw: colors.redRaw, fg: colors.tomato, bg: colors.tomato100, on: colors.white },
  green: { raw: colors.green, fg: colors.greenText, bg: colors.green100, on: colors.white },
} as const;

export type Accent = keyof typeof accents;

/**
 * Stat tile rules (Command Center `StatTile`): the short bar on top takes the
 * raw colour; on the warning and success tones the number and the border
 * take the colour too (text-safe for the number). The key is `number`, not
 * `value`: Reanimated's Babel plugin treats `x.value` in an inline style as a
 * shared value.
 */
export const statTones: Record<Accent, { bar: string; number: string; border: string }> = {
  royal: { bar: colors.blue, number: colors.ink, border: colors.border },
  navy: { bar: colors.navy, number: colors.ink, border: colors.border },
  cyan: { bar: colors.cyanRaw, number: colors.ink, border: colors.border },
  green: { bar: colors.green, number: colors.greenText, border: 'rgba(28,154,108,0.40)' },
  gold: { bar: colors.gold, number: colors.amber, border: 'rgba(252,206,0,0.70)' },
  orange: { bar: colors.orangeRaw, number: colors.crit, border: 'rgba(251,104,0,0.45)' },
  red: { bar: colors.redRaw, number: colors.tomato, border: 'rgba(254,41,1,0.40)' },
};

/**
 * Font family names as registered by `useAppFonts`. Each weight is its own
 * family so Android never fakes bold. On the web the browser falls back to
 * the system font for Kannada and Devanagari letters (IBM Plex Sans has no
 * glyphs for them).
 */
export const fonts = {
  display600: 'Sora_600SemiBold',
  display700: 'Sora_700Bold',
  display800: 'Sora_800ExtraBold',
  body400: 'IBMPlexSans_400Regular',
  body500: 'IBMPlexSans_500Medium',
  body600: 'IBMPlexSans_600SemiBold',
  body700: 'IBMPlexSans_700Bold',
} as const;

export const fontSize = {
  tiny: 10.5,
  label: 11.5,
  small: 12.5,
  body: 13.5,
  input: 16, // 16px stops iPhone Safari zooming into a focused input
  h2: 15,
  h1: 22,
  stat: 18,
  statLarge: 22,
} as const;

export const space = {
  xxs: 2,
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 28,
} as const;

export const radius = {
  sm: 8,
  md: 10,
  lg: 12,
  card: 16,
  pill: 999,
} as const;

/** Minimum size of anything tappable (agents use the app outdoors, one-handed). */
export const touch = {
  min: 48,
} as const;

export const shadow = {
  card: {
    shadowColor: colors.ink,
    shadowOpacity: 0.05,
    shadowRadius: 2,
    shadowOffset: { width: 0, height: 1 },
    elevation: 1,
  },
  primary: {
    shadowColor: colors.blue,
    shadowOpacity: 0.25,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 3,
  },
  /** Command Center `--shadow-hero`. */
  hero: {
    shadowColor: colors.navy,
    shadowOpacity: 0.22,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 10 },
    elevation: 6,
  },
} as const;

/**
 * Status chip tones (`.tag` classes in the designs). `dot` is the raw brand
 * colour of the chip's dot and border tint — the colour code at a glance;
 * the words stay in the text-safe `fg`. Pick by meaning, like the Command
 * Center's StatusPill: green done/verified, amber waiting/soon, crit act now,
 * tomato failed/refused, cyan information/in progress, blue selected/brand,
 * neutral not applicable.
 */
export const tones = {
  green: { fg: colors.greenText, bg: colors.green100, dot: colors.green },
  amber: { fg: colors.amber, bg: colors.amber100, dot: colors.gold },
  cyan: { fg: colors.cyan, bg: colors.cyan100, dot: colors.cyanRaw },
  crit: { fg: colors.crit, bg: colors.crit100, dot: colors.orangeRaw },
  blue: { fg: colors.blue, bg: colors.blue100, dot: colors.blue },
  navy: { fg: colors.navy, bg: colors.navy100, dot: colors.navy },
  neutral: { fg: colors.soft, bg: colors.neutral100, dot: colors.faint },
  tomato: { fg: colors.tomato, bg: colors.tomato100, dot: colors.redRaw },
} as const;

export type Tone = keyof typeof tones;

/** The accent (icon tile, bar) that goes with a status tone. */
export const toneAccent: Record<Tone, Accent> = {
  green: 'green',
  amber: 'gold',
  cyan: 'cyan',
  crit: 'orange',
  blue: 'royal',
  navy: 'navy',
  neutral: 'navy',
  tomato: 'red',
};
