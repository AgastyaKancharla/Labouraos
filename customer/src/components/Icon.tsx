import Svg, { Circle, Path, Rect } from 'react-native-svg';
import { colors } from '@/theme';

export type IconName =
  | 'search' | 'camera' | 'plus' | 'chevron-right' | 'wifi-off' | 'location'
  | 'bell' | 'menu' | 'back' | 'check' | 'share' | 'copy' | 'phone' | 'user' | 'lock'
  | 'doc' | 'id-card' | 'rupee' | 'briefcase' | 'calendar' | 'clock' | 'refund' | 'users'
  | 'store' | 'link' | 'help' | 'globe' | 'info' | 'shield' | 'chat' | 'trash' | 'star';

interface Props {
  name: IconName;
  size?: number;
  color?: string;
}

/**
 * The line icons the app uses (stroke 2.4, copied from Laboura Field and
 * extended). Drawn with react-native-svg so they look the same on every
 * phone — used inside the coloured tiles (steps, stat tiles, inbox types).
 */
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
      {name === 'doc' ? (
        <>
          <Path d="M7 3h7l5 5v13H7z" {...common} />
          <Path d="M14 3v5h5M10 13h6M10 17h6" {...common} />
        </>
      ) : null}
      {name === 'id-card' ? (
        <>
          <Rect x={3} y={5} width={18} height={14} rx={2} {...common} />
          <Circle cx={9} cy={11} r={2} {...common} />
          <Path d="M6 16a3 3 0 0 1 6 0M14.5 10H18M14.5 14H18" {...common} />
        </>
      ) : null}
      {name === 'rupee' ? <Path d="M6.5 4h11M6.5 8.5h11M10 4c3 0 4.8 1.8 4.8 4.5S13 13 10 13H6.5l7.5 7" {...common} /> : null}
      {name === 'briefcase' ? (
        <>
          <Rect x={3} y={7} width={18} height={13} rx={2} {...common} />
          <Path d="M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2M3 13h18" {...common} />
        </>
      ) : null}
      {name === 'calendar' ? (
        <>
          <Rect x={4} y={5} width={16} height={15} rx={2} {...common} />
          <Path d="M8 3v4M16 3v4M4 10h16" {...common} />
        </>
      ) : null}
      {name === 'clock' ? (
        <>
          <Circle cx={12} cy={12} r={8.5} {...common} />
          <Path d="M12 7.5V12l3 2" {...common} />
        </>
      ) : null}
      {name === 'refund' ? (
        <>
          <Path d="M4 12a8 8 0 1 0 2.4-5.7" {...common} />
          <Path d="M4 4v4h4" {...common} />
          <Path d="m10 12 2 2 3.5-3.5" {...common} />
        </>
      ) : null}
      {name === 'users' ? (
        <>
          <Circle cx={9} cy={8} r={3.5} {...common} />
          <Path d="M2.5 20a6.5 6.5 0 0 1 13 0" {...common} />
          <Path d="M16 4.6a3.5 3.5 0 0 1 0 6.8M18 14.3a6.5 6.5 0 0 1 3.5 5.7" {...common} />
        </>
      ) : null}
      {name === 'store' ? (
        <>
          <Path d="M4 9.5 5.5 4h13L20 9.5a2.7 2.7 0 0 1-5.3 0 2.7 2.7 0 0 1-5.4 0 2.7 2.7 0 0 1-5.3 0z" {...common} />
          <Path d="M5.5 12v8h13v-8M10 20v-5h4v5" {...common} />
        </>
      ) : null}
      {name === 'link' ? (
        <>
          <Path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1" {...common} />
          <Path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" {...common} />
        </>
      ) : null}
      {name === 'help' ? (
        <>
          <Circle cx={12} cy={12} r={8.5} {...common} />
          <Path d="M9.6 9.5a2.5 2.5 0 0 1 4.8 1c0 1.7-2.4 2-2.4 3.5" {...common} />
          <Circle cx={12} cy={17} r={0.6} {...common} />
        </>
      ) : null}
      {name === 'globe' ? (
        <>
          <Circle cx={12} cy={12} r={8.5} {...common} />
          <Path d="M3.5 12h17M12 3.5c2.5 2.6 3.5 5.4 3.5 8.5s-1 5.9-3.5 8.5c-2.5-2.6-3.5-5.4-3.5-8.5s1-5.9 3.5-8.5z" {...common} />
        </>
      ) : null}
      {name === 'info' ? (
        <>
          <Circle cx={12} cy={12} r={8.5} {...common} />
          <Path d="M12 11v5.5" {...common} />
          <Circle cx={12} cy={7.8} r={0.6} {...common} />
        </>
      ) : null}
      {name === 'shield' ? (
        <>
          <Path d="M12 3 5 6v5.5c0 4.3 3 7.8 7 9.5 4-1.7 7-5.2 7-9.5V6z" {...common} />
          <Path d="m9 12 2.2 2.2L15.5 10" {...common} />
        </>
      ) : null}
      {name === 'chat' ? <Path d="M5 5h14a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1h-8l-4.5 3.5V17H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z" {...common} /> : null}
      {name === 'trash' ? (
        <>
          <Path d="M4 7h16M9 7V4.5h6V7M6 7l1 13h10l1-13" {...common} />
          <Path d="M10 11v5M14 11v5" {...common} />
        </>
      ) : null}
      {name === 'star' ? <Path d="m12 3.5 2.6 5.4 5.9.8-4.3 4.1 1 5.8L12 16.8l-5.2 2.8 1-5.8-4.3-4.1 5.9-.8z" {...common} /> : null}
    </Svg>
  );
}
