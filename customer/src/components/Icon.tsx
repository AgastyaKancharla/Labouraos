import Svg, { Circle, Path, Rect } from 'react-native-svg';
import { colors } from '@/theme';

export type IconName =
  | 'search' | 'camera' | 'plus' | 'chevron-right' | 'wifi-off' | 'location'
  | 'bell' | 'menu' | 'back' | 'check' | 'share' | 'copy' | 'phone' | 'user' | 'lock';

interface Props {
  name: IconName;
  size?: number;
  color?: string;
}

/** The few line icons the app uses (stroke 2.4, copied from Laboura Field and extended). */
export function Icon({ name, size = 16, color = colors.soft }: Props) {
  const common = { stroke: color, strokeWidth: 2.4, fill: 'none', strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" accessibilityElementsHidden importantForAccessibility="no">
      {name === 'search' ? (
        <>
          <Circle cx={11} cy={11} r={7} {...common} />
          <Path d="m20 20-3.5-3.5" {...common} />
        </>
      ) : null}
      {name === 'camera' ? (
        <>
          <Rect x={3} y={7} width={18} height={13} rx={2} {...common} />
          <Path d="M8 7l2-3h4l2 3" {...common} />
          <Circle cx={12} cy={13.5} r={3.5} {...common} />
        </>
      ) : null}
      {name === 'plus' ? <Path d="M12 5v14M5 12h14" {...common} /> : null}
      {name === 'chevron-right' ? <Path d="m9 6 6 6-6 6" {...common} /> : null}
      {name === 'wifi-off' ? (
        <>
          <Path d="M3 3l18 18" {...common} />
          <Path d="M8.5 16.5a5 5 0 0 1 7 0M5 12.5a10 10 0 0 1 5-2.7M14.5 9.9A10 10 0 0 1 19 12.5" {...common} />
          <Circle cx={12} cy={20} r={0.8} {...common} />
        </>
      ) : null}
      {name === 'location' ? (
        <>
          <Path d="M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21z" {...common} />
          <Circle cx={12} cy={9.5} r={2.5} {...common} />
        </>
      ) : null}
      {name === 'bell' ? (
        <>
          <Path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15L6 16z" {...common} />
          <Path d="M10 20a2 2 0 0 0 4 0" {...common} />
        </>
      ) : null}
      {name === 'menu' ? <Path d="M4 7h16M4 12h16M4 17h16" {...common} /> : null}
      {name === 'back' ? <Path d="m15 6-6 6 6 6" {...common} /> : null}
      {name === 'check' ? <Path d="m5 12.5 4.5 4.5L19 7.5" {...common} /> : null}
      {name === 'share' ? (
        <>
          <Circle cx={18} cy={5.5} r={2.5} {...common} />
          <Circle cx={6} cy={12} r={2.5} {...common} />
          <Circle cx={18} cy={18.5} r={2.5} {...common} />
          <Path d="m8.2 10.8 7.6-4M8.2 13.2l7.6 4" {...common} />
        </>
      ) : null}
      {name === 'copy' ? (
        <>
          <Rect x={8} y={8} width={12} height={12} rx={2} {...common} />
          <Path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" {...common} />
        </>
      ) : null}
      {name === 'phone' ? <Path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2z" {...common} /> : null}
      {name === 'user' ? (
        <>
          <Circle cx={12} cy={8} r={4} {...common} />
          <Path d="M4 21a8 8 0 0 1 16 0" {...common} />
        </>
      ) : null}
      {name === 'lock' ? (
        <>
          <Rect x={5} y={11} width={14} height={10} rx={2} {...common} />
          <Path d="M8 11V7a4 4 0 0 1 8 0v4" {...common} />
        </>
      ) : null}
    </Svg>
  );
}
