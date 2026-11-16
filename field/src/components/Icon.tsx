import type { ReactNode } from 'react';
import Svg, { Circle, Path, Rect } from 'react-native-svg';
import { colors } from '@/theme';

export type IconName =
  | 'search'
  | 'camera'
  | 'plus'
  | 'chevron-right'
  | 'chevron-left'
  | 'wifi-off'
  | 'location'
  | 'home'
  | 'store'
  | 'user'
  | 'users'
  | 'user-plus'
  | 'briefcase'
  | 'clipboard'
  | 'calendar'
  | 'phone'
  | 'check'
  | 'check-circle'
  | 'x-circle'
  | 'clock'
  | 'alert'
  | 'bell'
  | 'target'
  | 'trophy'
  | 'map'
  | 'rupee'
  | 'id-card'
  | 'star'
  | 'chat'
  | 'shield'
  | 'flag'
  | 'chart'
  | 'document'
  | 'logout';

interface Props {
  name: IconName;
  size?: number;
  color?: string;
  /** Line width (2.4 like the designs' search icon; 2.2 reads better inside small tiles). */
  strokeWidth?: number;
}

type Draw = (p: { stroke: string; strokeWidth: number; fill: 'none'; strokeLinecap: 'round'; strokeLinejoin: 'round' }, color: string) => ReactNode;

/** Each icon on a 24 × 24 grid, drawn with round lines (no fills except tiny dots). */
const DRAW: Record<IconName, Draw> = {
  search: (c) => (
    <>
      <Circle cx={11} cy={11} r={7} {...c} />
      <Path d="m20 20-3.5-3.5" {...c} />
    </>
  ),
  camera: (c) => (
    <>
      <Rect x={3} y={7} width={18} height={13} rx={2} {...c} />
      <Path d="M8 7l2-3h4l2 3" {...c} />
      <Circle cx={12} cy={13.5} r={3.5} {...c} />
    </>
  ),
  plus: (c) => <Path d="M12 5v14M5 12h14" {...c} />,
  'chevron-right': (c) => <Path d="m9 6 6 6-6 6" {...c} />,
  'chevron-left': (c) => <Path d="m15 6-6 6 6 6" {...c} />,
  'wifi-off': (c) => (
    <>
      <Path d="M3 3l18 18" {...c} />
      <Path d="M8.5 16.5a5 5 0 0 1 7 0M5 12.5a10 10 0 0 1 5-2.7M14.5 9.9A10 10 0 0 1 19 12.5" {...c} />
      <Circle cx={12} cy={20} r={0.8} {...c} />
    </>
  ),
  location: (c) => (
    <>
      <Path d="M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21z" {...c} />
      <Circle cx={12} cy={9.5} r={2.5} {...c} />
    </>
  ),
  home: (c) => (
    <>
      <Path d="M3.5 11 12 4l8.5 7" {...c} />
      <Path d="M6 9.5V20h12V9.5M10 20v-5h4v5" {...c} />
    </>
  ),
  store: (c) => (
    <>
      <Path d="M4 9.5 5.5 4h13L20 9.5" {...c} />
      <Path d="M4 9.5a2.7 2.7 0 0 0 5.3 0 2.7 2.7 0 0 0 5.4 0 2.7 2.7 0 0 0 5.3 0" {...c} />
      <Path d="M5 12v8h14v-8M10 20v-4.5h4V20" {...c} />
    </>
  ),
  user: (c) => (
    <>
      <Circle cx={12} cy={8} r={4} {...c} />
      <Path d="M4.5 20.5a7.5 7.5 0 0 1 15 0" {...c} />
    </>
  ),
  users: (c) => (
    <>
      <Circle cx={9} cy={8.5} r={3.5} {...c} />
      <Path d="M2.5 20a6.5 6.5 0 0 1 13 0M15.5 5a3.5 3.5 0 0 1 0 7M17.5 14.2A6.5 6.5 0 0 1 21.5 20" {...c} />
    </>
  ),
  'user-plus': (c) => (
    <>
      <Circle cx={10} cy={8} r={4} {...c} />
      <Path d="M3 20.5a7 7 0 0 1 14 0M19 7.5v6M16 10.5h6" {...c} />
    </>
  ),
  briefcase: (c) => (
    <>
      <Rect x={3} y={7} width={18} height={13} rx={2} {...c} />
      <Path d="M9 7V5.5A1.5 1.5 0 0 1 10.5 4h3A1.5 1.5 0 0 1 15 5.5V7M3 13h18" {...c} />
    </>
  ),
  clipboard: (c) => (
    <>
      <Rect x={5} y={4.5} width={14} height={16.5} rx={2} {...c} />
      <Rect x={9} y={2.5} width={6} height={4} rx={1} {...c} />
      <Path d="M9 11.5h6M9 15.5h4" {...c} />
    </>
  ),
  calendar: (c) => (
    <>
      <Rect x={3.5} y={5} width={17} height={15.5} rx={2} {...c} />
      <Path d="M3.5 10h17M8 3v4M16 3v4" {...c} />
    </>
  ),
  phone: (c) => <Path d="M5 4h3.5l2 5-2.5 1.5a11 11 0 0 0 5.5 5.5L15 13.5l5 2V19a2 2 0 0 1-2 2A15 15 0 0 1 3 6a2 2 0 0 1 2-2z" {...c} />,
  check: (c) => <Path d="m5 12.5 4.5 4.5L19 7.5" {...c} />,
  'check-circle': (c) => (
    <>
      <Circle cx={12} cy={12} r={9} {...c} />
      <Path d="m8 12.5 3 3 5-6" {...c} />
    </>
  ),
  'x-circle': (c) => (
    <>
      <Circle cx={12} cy={12} r={9} {...c} />
      <Path d="m9 9 6 6M15 9l-6 6" {...c} />
    </>
  ),
  clock: (c) => (
    <>
      <Circle cx={12} cy={12} r={9} {...c} />
      <Path d="M12 7v5l3.5 2" {...c} />
    </>
  ),
  alert: (c, color) => (
    <>
      <Path d="M12 3.5 21.5 20h-19z" {...c} />
      <Path d="M12 10v4.5" {...c} />
      <Circle cx={12} cy={17.3} r={0.9} fill={color} />
    </>
  ),
  bell: (c) => (
    <>
      <Path d="M6 16.5V11a6 6 0 0 1 12 0v5.5l1.5 1.5h-15z" {...c} />
      <Path d="M10 20.5a2 2 0 0 0 4 0" {...c} />
    </>
  ),
  target: (c, color) => (
    <>
      <Circle cx={12} cy={12} r={9} {...c} />
      <Circle cx={12} cy={12} r={5} {...c} />
      <Circle cx={12} cy={12} r={1.4} fill={color} />
    </>
  ),
  trophy: (c) => (
    <>
      <Path d="M8 4h8v5a4 4 0 0 1-8 0z" {...c} />
      <Path d="M8 6H5a3 3 0 0 0 3.2 4M16 6h3a3 3 0 0 1-3.2 4M12 13v4M8.5 20.5h7M10 17h4" {...c} />
    </>
  ),
  map: (c) => (
    <>
      <Path d="M9 4 3.5 6v14L9 18l6 2 5.5-2V4L15 6z" {...c} />
      <Path d="M9 4v14M15 6v14" {...c} />
    </>
  ),
  rupee: (c) => <Path d="M7 4h10M7 8.5h10M7 4h3.5a4.5 4.5 0 0 1 0 9H7l7.5 7.5" {...c} />,
  'id-card': (c) => (
    <>
      <Rect x={3} y={5} width={18} height={14} rx={2} {...c} />
      <Circle cx={8.5} cy={10.5} r={2} {...c} />
      <Path d="M5.5 16a3 3 0 0 1 6 0M14 10h4M14 14h3" {...c} />
    </>
  ),
  star: (c) => <Path d="m12 3.5 2.7 5.5 6 .9-4.4 4.2 1 6-5.3-2.8-5.3 2.8 1-6L3.3 9.9l6-.9z" {...c} />,
  chat: (c) => <Path d="M4 5h16v11H10l-6 4.5z" {...c} />,
  shield: (c) => (
    <>
      <Path d="M12 3 19.5 6v6c0 4.6-3.2 7.8-7.5 9-4.3-1.2-7.5-4.4-7.5-9V6z" {...c} />
      <Path d="m9 12 2.2 2.2L15.5 10" {...c} />
    </>
  ),
  flag: (c) => <Path d="M5.5 21V4M5.5 4.5h11l-2 4 2 4h-11" {...c} />,
  chart: (c) => <Path d="M3.5 20.5h17M6.5 17v-5M11 17V7M15.5 17v-8M20 17V4" {...c} />,
  document: (c) => (
    <>
      <Path d="M6 3h8.5L19 7.5V21H6z" {...c} />
      <Path d="M14 3v5h5M9 13h6M9 17h6" {...c} />
    </>
  ),
  logout: (c) => <Path d="M14 4h5v16h-5M10 8l-4 4 4 4M6 12h10" {...c} />,
};

/** Line icons drawn with react-native-svg (stroke 2.4, like the search icon in FA03). Decorative: hidden from screen readers. */
export function Icon({ name, size = 16, color = colors.soft, strokeWidth = 2.4 }: Props) {
  const common = { stroke: color, strokeWidth, fill: 'none' as const, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" accessibilityElementsHidden importantForAccessibility="no">
      {DRAW[name](common, color)}
    </Svg>
  );
}
