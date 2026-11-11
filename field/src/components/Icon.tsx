import Svg, { Circle, Path, Rect } from 'react-native-svg';
import { colors } from '@/theme';

export type IconName = 'search' | 'camera' | 'plus' | 'chevron-right' | 'wifi-off' | 'location';

interface Props {
  name: IconName;
  size?: number;
  color?: string;
}

/** The few line icons the designs use (stroke 2.4, like the search icon in FA03). */
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
    </Svg>
  );
}
