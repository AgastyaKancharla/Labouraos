import { useId } from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, { Defs, LinearGradient, Path, Stop } from 'react-native-svg';
import { colors, swoosh } from '@/theme';

interface Props {
  /** The colour below the curve: the page the header sits on. */
  fill?: string;
  height?: number;
  testID?: string;
}

/**
 * Version 2's signature: the Laboura swoosh as a curve where a navy header
 * meets the page. The page colour rises in a gentle arc, with the brand
 * swoosh colours (royal → cyan → gold → orange → red) drawn along it.
 * Decoration only.
 */
export function SwooshCurve({ fill = colors.bg, height = 30, testID }: Props) {
  const id = useId().replace(/:/g, '');
  return (
    <View style={[styles.wrap, { height }]} pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants" testID={testID}>
      <Svg width="100%" height={height} viewBox="0 0 390 30" preserveAspectRatio="none">
        <Defs>
          <LinearGradient id={`sw${id}`} x1="0" y1="0" x2="1" y2="0">
            {swoosh.colors.map((c, i) => (
              <Stop key={i} offset={swoosh.locations[i]} stopColor={c} />
            ))}
          </LinearGradient>
        </Defs>
        <Path d="M0 24 Q195 -4 390 24 L390 30 L0 30 Z" fill={fill} />
        <Path d="M0 18 Q195 -10 390 18" fill="none" stroke={`url(#sw${id})`} strokeWidth={3} strokeLinecap="round" />
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({ wrap: { position: 'absolute', left: 0, right: 0, bottom: -1 } });
