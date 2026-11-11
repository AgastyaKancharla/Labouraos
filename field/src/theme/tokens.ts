/**
 * Design tokens copied from the approved field agent designs (FA01–FA22,
 * `:root` block). Screens use these names, never raw hex values, so a colour
 * change happens in one place.
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
  green: '#1C9A6C',
  green100: '#E1F5EC',
  amber: '#92670A',
  amber100: '#FFF4CC',
  amberBorder: '#F0DE95',
  cyan: '#0B6E82',
  cyan100: '#DCF6FD',
  tomato: '#BB232B',
  tomato100: '#FAE2E1',
  crit: '#B94E12',
  crit100: '#FFE7D6',
  neutral100: '#F1F5FC',
  white: '#FFFFFF',
  overlay: 'rgba(11,30,74,0.55)',
} as const;

/** Header and tab bar gradient (top → bottom). */
export const headerGradient = [colors.blue, colors.blueDark] as const;

/** The thin Laboura "swoosh" stripe under the header and above the tab bar. */
export const swoosh = {
  colors: ['#0055C0', '#02D0F8', '#02D0F8', '#FCCE00', '#FB6800', '#FE2901'] as const,
  locations: [0, 0.38, 0.4, 0.4, 0.76, 1] as const,
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
} as const;

/** Status chip tones (`.tag` classes in the designs). */
export const tones = {
  green: { fg: colors.green, bg: colors.green100 },
  amber: { fg: colors.amber, bg: colors.amber100 },
  cyan: { fg: colors.cyan, bg: colors.cyan100 },
  crit: { fg: colors.crit, bg: colors.crit100 },
  blue: { fg: colors.blue, bg: colors.blue100 },
  neutral: { fg: colors.soft, bg: colors.neutral100 },
  tomato: { fg: colors.tomato, bg: colors.tomato100 },
} as const;

export type Tone = keyof typeof tones;
